import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalOpenInput, TerminalSessionSnapshot } from "@synara/contracts";
const backend = vi.hoisted(() => ({
  open: vi.fn<(input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>>(),
  close: vi.fn(async () => {}),
  unsubscribe: vi.fn(),
  transport: null as ((state: "connecting" | "open" | "closed" | "disposed") => void) | null,
}));
vi.mock("~/nativeApi", () => {
  const api = { terminal: { open: backend.open, close: backend.close } };
  return { readNativeApi: () => api, ensureNativeApi: () => api };
});
vi.mock("~/wsTransportEvents", () => ({
  addWsTransportStateListener: (listener: NonNullable<typeof backend.transport>) => {
    backend.transport = listener;
    return () => {
      backend.transport = null;
    };
  },
}));
vi.mock("../terminal/terminalEventDispatcher", () => ({
  terminalEventDispatcher: { subscribeMetadata: () => backend.unsubscribe },
}));
import { WorkspaceTerminalSessions } from "./workspaceTerminalSessions";
const input = (id: string): TerminalOpenInput => ({ threadId: "w", terminalId: id, cwd: "/tmp" });
const snapshot = (id: string): TerminalSessionSnapshot => ({
  ...input(id),
  terminalId: id,
  status: "running",
  pid: 1,
  history: "",
  headlessQueries: true,
  exitCode: null,
  exitSignal: null,
  updatedAt: "now",
});
beforeEach(() => vi.clearAllMocks());
describe("workspace process ownership", () => {
  it("lets a retained renderer own reconnect and disposes it only on explicit close", async () => {
    backend.open.mockImplementation(async (request) => snapshot(request.terminalId!));
    const sessions = new WorkspaceTerminalSessions();
    const session = sessions.ensure(input("retained"));
    await session.ready;
    const dispose = vi.fn();
    const callbacks = sessions.retainRenderer(session, dispose);
    backend.open.mockClear();
    backend.transport!("closed");
    expect(session.state.status).toBe("connecting");
    backend.transport!("open");
    expect(backend.open).not.toHaveBeenCalled();
    callbacks.onTerminalRuntimeStatusChange!("retained", "ready");
    expect(session.state.status).toBe("ready");
    expect(dispose).not.toHaveBeenCalled();
    await sessions.close("w", "retained");
    expect(dispose).toHaveBeenCalledExactlyOnceWith();
  });

  it("keeps the retained renderer usable if an explicit close fails, then allows retry", async () => {
    backend.open.mockImplementation(async (request) => snapshot(request.terminalId!));
    const sessions = new WorkspaceTerminalSessions();
    const session = sessions.ensure(input("retry-close"));
    await session.ready;
    const dispose = vi.fn();
    sessions.retainRenderer(session, dispose);
    backend.close.mockRejectedValueOnce(new Error("Disconnected"));
    await expect(sessions.close("w", "retry-close")).rejects.toThrow("Disconnected");
    expect(session.cancelled).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(sessions.get("w", "retry-close")).toBe(session);
    await sessions.close("w", "retry-close");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(sessions.get("w", "retry-close")).toBeUndefined();
  });
  it("reports a real transport disconnect and recovers after reconnecting", async () => {
    backend.open.mockImplementation(async (request) => snapshot(request.terminalId!));
    const sessions = new WorkspaceTerminalSessions();
    const session = sessions.ensure(input("one"));
    await session.ready;
    expect(session.state.status).toBe("ready");
    backend.transport!("closed");
    expect(session.state.status).toBe("connecting");
    backend.transport!("open");
    await session.ready;
    expect(session.state.status).toBe("ready");
    await sessions.close("w", "one");
  });
  it("bounds concurrent startup, cancels queued panes, and never duplicates an existing process", async () => {
    const pending = new Map<string, (s: TerminalSessionSnapshot) => void>();
    backend.open.mockImplementation(
      (request) => new Promise((resolve) => pending.set(request.terminalId!, resolve)),
    );
    const sessions = new WorkspaceTerminalSessions();
    const one = sessions.ensure(input("one"));
    const two = sessions.ensure(input("two"));
    sessions.ensure(input("three"));
    sessions.ensure(input("four"));
    expect(sessions.ensure(input("one"))).toBe(one);
    expect(backend.open).toHaveBeenCalledTimes(2);
    expect(backend.open).toHaveBeenCalledWith({
      ...input("one"),
      includeHistory: false,
      headlessQueries: true,
    });
    await sessions.close("w", "three");
    pending.get("one")!(snapshot("one"));
    await one.ready;
    expect(backend.open).toHaveBeenCalledTimes(3);
    expect(pending.has("three")).toBe(false);
    pending.get("two")!(snapshot("two"));
    pending.get("four")!(snapshot("four"));
    await two.ready;
    await Promise.all(["one", "two", "four"].map((id) => sessions.close("w", id)));
    expect(backend.unsubscribe).toHaveBeenCalledTimes(4);
  });
  it("closes an in-flight startup after it resolves so a removed pane cannot leave a ghost process", async () => {
    let resolve!: (s: TerminalSessionSnapshot) => void;
    backend.open.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const sessions = new WorkspaceTerminalSessions();
    sessions.ensure(input("one"));
    const closing = sessions.close("w", "one");
    expect(backend.close).not.toHaveBeenCalled();
    resolve(snapshot("one"));
    await closing;
    expect(backend.close).toHaveBeenCalledExactlyOnceWith({
      threadId: "w",
      terminalId: "one",
      deleteHistory: true,
    });
  });
});
