import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ComputerActivityStream } from "./computerActivityStream";

const record = {
  id: "fixture-record",
  capturedAt: "2026-10-28T12:00:00.000Z",
  target: { bundleId: "org.djl.fixture", pid: 42, windowId: 7 },
  appName: "Fixture",
  windowTitle: "Synthetic draft",
  kind: "text-input",
  text: "Synthetic revision",
};
function setup() {
  const state = { epoch: "epoch-a", allowed: true };
  const accept = vi.fn(() => true),
    failed = vi.fn(),
    changed = vi.fn();
  const stream = new ComputerActivityStream({
    epoch: () => state.epoch,
    allowed: () => state.allowed,
    record: accept,
    onFailure: failed,
    onChanged: changed,
  });
  const pipe = new PassThrough();
  stream.attach(pipe);
  const send = (event: unknown, target = pipe) => target.write(`${JSON.stringify({ event })}\n`);
  return { stream, pipe, state, accept, failed, changed, send };
}
describe("private contextual activity stream", () => {
  it("preserves JSONL framing and UTF8 across chunks and epoch changes", () => {
    const { stream, pipe, state, accept, send } = setup();
    const line = Buffer.from(
      JSON.stringify({
        event: {
          type: "activity-record",
          epoch: state.epoch,
          record: { ...record, text: "Synthetic 中文" },
        },
      }) + "\n",
    );
    const split = line.indexOf(Buffer.from("中")) + 1;
    pipe.write(line.subarray(0, split));
    expect(accept).not.toHaveBeenCalled();
    pipe.write(line.subarray(split));
    expect(accept).toHaveBeenCalledWith(
      "epoch-a",
      expect.objectContaining({ text: "Synthetic 中文" }),
    );
    pipe.write(line.subarray(0, split));
    state.epoch = "epoch-b";
    stream.policyChanged();
    pipe.write(line.subarray(split));
    send({ type: "activity-record", epoch: state.epoch, record });
    expect(accept).toHaveBeenCalledTimes(2);
    stream.detach();
  });
  it("requires current consent/epoch/child and discards retired source data", () => {
    const { stream, pipe, state, accept, send } = setup();
    state.allowed = false;
    stream.policyChanged();
    send({ type: "activity-record", epoch: state.epoch, record });
    state.allowed = true;
    state.epoch = "epoch-b";
    stream.policyChanged();
    send({ type: "activity-record", epoch: "epoch-a", record });
    const next = new PassThrough();
    stream.attach(next);
    send({ type: "activity-record", epoch: "epoch-b", record }, pipe);
    expect(accept).not.toHaveBeenCalled();
    send({ type: "activity-record", epoch: "epoch-b", record }, next);
    expect(accept).toHaveBeenCalledOnce();
    stream.detach();
  });
  it("gives pipe status precedence over a late stdout acknowledgement", () => {
    const { stream, state, send } = setup();
    send({
      type: "activity-observer-status",
      epoch: state.epoch,
      state: "unavailable",
      droppedRecords: 3,
      reason: "permission-denied",
    });
    stream.acknowledge(state.epoch, true);
    expect(stream.status).toEqual({
      state: "unavailable",
      droppedRecords: 3,
      reason: "permission-denied",
    });
    stream.detach();
  });
  it("latches physical pipe failure across epochs and acknowledgements", () => {
    const { stream, pipe, state, failed } = setup();
    pipe.emit("close");
    expect(failed).toHaveBeenCalledOnce();
    state.epoch = "epoch-b";
    stream.policyChanged();
    stream.acknowledge(state.epoch, true);
    expect(stream.hasChannel).toBe(false);
    expect(stream.status).toMatchObject({ state: "unavailable", reason: "transport-unavailable" });
    stream.detach();
  });
  it.each(["malformed", "oversized", "fake-control", "rejected-context"])(
    "suspends %s history without forwarding control traffic",
    (kind) => {
      const { stream, pipe, state, failed, accept, send } = setup();
      if (kind === "malformed") pipe.write("not JSON\n");
      if (kind === "oversized") pipe.write(Buffer.alloc(192 * 1024 + 1, 120));
      if (kind === "fake-control")
        send({ type: "input-protection", epoch: state.epoch, state: "safe" });
      if (kind === "rejected-context") {
        accept.mockReturnValue(false);
        send({ type: "activity-record", epoch: state.epoch, record });
      }
      const calls = accept.mock.calls.length;
      send({ type: "activity-record", epoch: state.epoch, record });
      expect(accept.mock.calls).toHaveLength(calls);
      expect(failed).toHaveBeenCalledOnce();
      expect(stream.status).toMatchObject({ state: "unavailable", reason: "capture-failed" });
      stream.detach();
    },
  );
  it("distinguishes no consent from a missing channel", () => {
    const { stream, state } = setup();
    stream.detach();
    expect(stream.status).toMatchObject({ state: "unavailable", reason: "transport-unavailable" });
    state.allowed = false;
    stream.policyChanged();
    expect(stream.status).toEqual({ state: "inactive", droppedRecords: 0 });
  });
  it.each(["close", "error"] as const)("keeps intentional inactivity after pipe %s", (signal) => {
    const { stream, pipe, state, failed } = setup();
    pipe.write("invalid context JSON\n");
    expect(failed).toHaveBeenCalledOnce();
    state.allowed = false;
    state.epoch = "paused-epoch";
    stream.policyChanged();
    pipe.emit(signal, ...(signal === "error" ? [new Error("Synthetic fd3 failure")] : []));
    stream.acknowledge(state.epoch, true);
    expect(stream.status).toEqual({ state: "inactive", droppedRecords: 0 });
    expect(failed).toHaveBeenCalledOnce();
    stream.detach();
  });
  it("drops the remainder of a retired child's chunk after reentrant replacement", () => {
    const { stream, pipe, state, accept } = setup();
    const next = new PassThrough();
    accept.mockImplementationOnce(() => {
      stream.attach(next);
      return true;
    });
    const line =
      JSON.stringify({ event: { type: "activity-record", epoch: state.epoch, record } }) + "\n";
    pipe.write(line + line);
    expect(accept).toHaveBeenCalledOnce();
    next.write(line);
    expect(accept).toHaveBeenCalledTimes(2);
    stream.detach();
  });
  it("does not ingest records after native infrastructure reports unavailable", () => {
    const { stream, state, send, accept } = setup();
    send({
      type: "activity-observer-status",
      epoch: state.epoch,
      state: "unavailable",
      droppedRecords: 0,
      reason: "permission-denied",
    });
    send({ type: "activity-record", epoch: state.epoch, record });
    expect(accept).not.toHaveBeenCalled();
    expect(stream.status.state).toBe("unavailable");
    stream.detach();
  });
  it("absorbs a late transport error after intentional detach", () => {
    const { stream, pipe } = setup();
    stream.detach();
    expect(() => pipe.emit("error", new Error("Synthetic late pipe error"))).not.toThrow();
  });
  it("rejects invalid UTF8 rather than persisting replacement text", () => {
    const { stream, pipe, state, accept, failed } = setup();
    const line = Buffer.from(
      JSON.stringify({ event: { type: "activity-record", epoch: state.epoch, record } }) + "\n",
    );
    line[line.indexOf("Synthetic revision")] = 255;
    pipe.write(line);
    expect(accept).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    stream.detach();
  });
});
