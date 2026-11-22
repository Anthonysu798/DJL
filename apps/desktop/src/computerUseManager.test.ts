import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ComputerUseHistorySettings,
  ComputerUseRequest,
  ComputerUseResponse,
} from "@djl/contracts";
import { ComputerUseHistory } from "./computerUseHistory";
import { ComputerActivitySummaries } from "./computerActivitySummaries";
import { ComputerActivityRecorder } from "./computerActivityRecorder";
import { ComputerUseManager, type ComputerUseManagerEvent } from "./computerUseManager";

type Frame = { id: string; threadId: string; request: ComputerUseRequest };
const target = { bundleId: "dev.djl.fixture", pid: 123, windowId: 12 };
const thread = "thread-a";
const origin = { origin: "agent" } as const;
const renderer = { origin: "renderer" } as const;
const action = {
  type: "type",
  target: { kind: "point", x: 10, y: 10 },
  text: "SECRET input",
} as const;

class FakeHelper extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  activityPipe = new PassThrough();
  get stdio() {
    return [this.stdin, this.stdout, this.stderr, this.activityPipe];
  }
  frames: Frame[] = [];
  killed = false;
  ignoreTermination = false;
  exitOnKill = true;
  signals: NodeJS.Signals[] = [];
  replyAutomatically = true;
  stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      const frame = JSON.parse(chunk.toString()) as Frame;
      this.frames.push(frame);
      if (this.replyAutomatically) queueMicrotask(() => this.reply(frame));
      callback();
    },
  });
  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.killed = true;
    this.signals.push(signal);
    if (this.ignoreTermination && signal === "SIGTERM") return true;
    if (this.exitOnKill) this.emit("exit", 0);
    return true;
  }
  reply(frame: Frame, response?: ComputerUseResponse) {
    const request = frame.request;
    const fallback =
      request.method === "session.open"
        ? {
            method: request.method,
            result: {
              sessionId: `s-${frame.id}`,
              threadId: frame.threadId,
              target: request.target,
            },
          }
        : request.method === "session.perform"
          ? {
              method: request.method,
              result: {
                acknowledgement: "dispatched",
                effect: "unverified",
                message: "SECRET helper diagnostic",
              },
            }
          : request.method === "session.close"
            ? { method: request.method, result: { closed: true } }
            : request.method === "stop"
              ? {
                  method: request.method,
                  result: {
                    stoppedSessionIds: request.sessionId
                      ? [request.sessionId]
                      : this.frames
                          .filter(
                            (item) =>
                              item.threadId === frame.threadId &&
                              item.request.method === "session.open",
                          )
                          .map((item) => `s-${item.id}`),
                  },
                }
              : request.method === "activity.observe"
                ? {
                    method: request.method,
                    result: {
                      epoch: request.epoch,
                      observing:
                        request.settings.enabled &&
                        !request.settings.paused &&
                        request.settings.interactionCaptureEnabled === true,
                    },
                  }
                : {
                    method: request.method,
                    error: { code: "unsupported", message: "Unsupported in fake" },
                  };
    this.stdout.write(`${JSON.stringify({ id: frame.id, response: response ?? fallback })}\n`);
  }
}
const resources: Array<{ manager: ComputerUseManager; dir: string }> = [];
function setup(
  timeoutMs = 200,
  prepare?: (directory: string) => void,
  pauseClock?: FakePauseClock,
  platform: NodeJS.Platform = "darwin",
) {
  const dir = mkdtempSync(join(tmpdir(), "djl-computer-manager-"));
  prepare?.(dir);
  const helper = new FakeHelper();
  let launches = 0;
  const manager = new ComputerUseManager({
    helperPath: "/trusted/helper",
    historyDirectory: dir,
    platform,
    timeoutMs,
    terminationTimeoutMs: 20,
    ...(pauseClock ? { pauseClock } : {}),
    spawnHelper: () => {
      launches++;
      return helper as unknown as ChildProcessWithoutNullStreams;
    },
  });
  resources.push({ manager, dir });
  return { manager, helper, dir, launches: () => launches };
}
async function open(manager: ComputerUseManager, owner = thread) {
  const response = await manager.request(owner, { method: "session.open", target }, origin);
  if (response.method !== "session.open" || "error" in response) throw new Error("Open failed");
  return response.result.sessionId;
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(async () => {
  for (const { manager, dir } of resources.splice(0)) {
    await manager.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native computer-use manager", () => {
  it("starts contextual observation only with separate consent and rejects paused/old epoch records", async () => {
    const { manager, helper, launches } = setup();
    const settings = {
      enabled: true,
      paused: false,
      retentionDays: 30,
      intervalSeconds: 30,
      interactionCaptureEnabled: false,
      excludedBundleIds: [],
      excludedDomains: [],
    };
    await manager.request(thread, { method: "history.configure", settings }, renderer);
    await tick();
    expect(launches()).toBe(0);
    await manager.request(
      thread,
      { method: "history.configure", settings: { ...settings, interactionCaptureEnabled: true } },
      renderer,
    );
    await tick();
    await tick();
    const frame = helper.frames.find((item) => item.request.method === "activity.observe")!;
    expect(frame?.threadId).toBe("desktop:recorder");
    if (frame?.request.method !== "activity.observe")
      throw new Error("Expected private observer config");
    const epoch = frame.request.epoch;
    const event = {
      id: "context-record",
      capturedAt: new Date().toISOString(),
      target,
      appName: "Fixture",
      windowTitle: "Synthetic editor",
      kind: "text-input",
      text: "Synthetic revision",
    };
    helper.activityPipe.write(
      JSON.stringify({ event: { type: "activity-record", epoch, record: event } }) + "\n",
    );
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: {
        events: [expect.objectContaining({ text: "Synthetic revision" })],
        interactionStatus: { state: "observing" },
      },
    });
    expect(await manager.request(thread, { method: "activity.list" }, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    await manager.request(
      thread,
      {
        method: "history.configure",
        settings: { ...settings, interactionCaptureEnabled: true, paused: true },
      },
      renderer,
    );
    helper.activityPipe.write(
      JSON.stringify({
        event: { type: "activity-record", epoch, record: { ...event, id: "late" } },
      }) + "\n",
    );
    await tick();
    await tick();
    const page = await manager.request(thread, { method: "activity.list" }, renderer);
    expect(page).toMatchObject({
      result: {
        events: [expect.objectContaining({ id: "context-record" })],
        interactionStatus: { state: "inactive" },
      },
    });
    expect(JSON.stringify(page)).not.toContain('"late"');
  });

  it("does not let an activity pipe fake safe retire protected native input", async () => {
    const { manager, helper } = setup(20);
    const settings = {
      enabled: true,
      paused: false,
      retentionDays: 30,
      intervalSeconds: 30,
      interactionCaptureEnabled: true,
      excludedBundleIds: [],
      excludedDomains: [],
    };
    await manager.request(thread, { method: "history.configure", settings }, renderer);
    await tick();
    await tick();
    const frame = helper.frames.find((item) => item.request.method === "activity.observe")!;
    if (frame.request.method !== "activity.observe") throw new Error("Expected observer config");
    helper.stdout.write(
      JSON.stringify({ event: { type: "input-protection", state: "active" } }) + "\n",
    );
    helper.ignoreTermination = true;
    helper.activityPipe.write(
      JSON.stringify({
        event: { type: "input-protection", state: "safe", epoch: frame.request.epoch },
      }) + "\n",
    );
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: { interactionStatus: { state: "unavailable", reason: "capture-failed" } },
    });
    const stopped = manager.dispose();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(helper.signals).not.toContain("SIGKILL");
    helper.ignoreTermination = false;
    helper.stdout.write(
      JSON.stringify({ event: { type: "input-protection", state: "safe" } }) + "\n",
    );
    helper.emit("exit", 0);
    await stopped;
  });

  it("revokes a starting observer immediately without waiting for its old acknowledgement", async () => {
    const { manager, helper } = setup();
    helper.replyAutomatically = false;
    const settings = {
      enabled: true,
      paused: false,
      retentionDays: 30,
      intervalSeconds: 30,
      interactionCaptureEnabled: true,
      excludedBundleIds: [],
      excludedDomains: [],
    };
    await manager.request(thread, { method: "history.configure", settings }, renderer);
    await tick();
    const starting = helper.frames.find((item) => item.request.method === "activity.observe")!;
    expect(starting).toBeDefined();
    await manager.request(
      thread,
      { method: "history.configure", settings: { ...settings, paused: true } },
      renderer,
    );
    expect(
      helper.frames.some(
        (item) => item.request.method === "stop" && item.threadId === "desktop:recorder",
      ),
    ).toBe(true);
    await tick();
    const off = helper.frames.find(
      (item) => item.request.method === "activity.observe" && item.request.settings.paused,
    );
    expect(off).toBeDefined();
    helper.reply(starting);
    if (off) helper.reply(off);
    for (const frame of helper.frames.filter((item) => item.request.method === "stop"))
      helper.reply(frame);
    helper.replyAutomatically = true;
    await tick();
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: { interactionStatus: { state: "inactive" } },
    });
  });
  it.each(["native-status", "pipe-close"] as const)(
    "preserves %s failure over late observer acknowledgement",
    async (kind) => {
      const { manager, helper } = setup();
      helper.replyAutomatically = false;
      const settings = {
        enabled: true,
        paused: false,
        retentionDays: 30,
        intervalSeconds: 30,
        interactionCaptureEnabled: true,
        excludedBundleIds: [],
        excludedDomains: [],
      };
      await manager.request(thread, { method: "history.configure", settings }, renderer);
      await tick();
      const starting = helper.frames.find((frame) => frame.request.method === "activity.observe")!;
      if (starting.request.method !== "activity.observe") throw new Error("Expected observer");
      if (kind === "pipe-close") helper.activityPipe.emit("close");
      else
        helper.activityPipe.write(
          JSON.stringify({
            event: {
              type: "activity-observer-status",
              epoch: starting.request.epoch,
              state: "unavailable",
              droppedRecords: 7,
              reason: "permission-denied",
            },
          }) + "\n",
        );
      helper.replyAutomatically = true;
      helper.reply(starting);
      for (const stop of helper.frames.filter((frame) => frame.request.method === "stop"))
        helper.reply(stop);
      await tick();
      expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
        result: {
          interactionStatus: {
            state: "unavailable",
            reason: kind === "pipe-close" ? "transport-unavailable" : "permission-denied",
          },
        },
      });
    },
  );

  it.each(["before", "after"] as const)(
    "preserves native unavailable status arriving %s a valid negative observer acknowledgement",
    async (order) => {
      const { manager, helper } = setup();
      helper.replyAutomatically = false;
      await manager.request(
        thread,
        {
          method: "history.configure",
          settings: {
            enabled: true,
            paused: false,
            retentionDays: 30,
            intervalSeconds: 30,
            interactionCaptureEnabled: true,
            excludedBundleIds: [],
            excludedDomains: [],
          },
        },
        renderer,
      );
      await tick();
      const starting = helper.frames.find((frame) => frame.request.method === "activity.observe")!;
      if (starting.request.method !== "activity.observe") throw new Error("Expected observer");
      const epoch = starting.request.epoch;
      const status = () =>
        helper.activityPipe.write(
          JSON.stringify({
            event: {
              type: "activity-observer-status",
              epoch,
              state: "unavailable",
              droppedRecords: 7,
              reason: "secure-state-unavailable",
            },
          }) + "\n",
        );
      if (order === "before") status();
      helper.replyAutomatically = true;
      helper.reply(starting, {
        method: "activity.observe",
        result: {
          epoch: starting.request.epoch,
          observing: false,
        },
      });
      await tick();
      if (order === "after") status();
      expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
        result: {
          interactionStatus: {
            state: "unavailable",
            droppedRecords: 7,
            reason: "secure-state-unavailable",
          },
        },
      });
    },
  );

  it("rejects context ingestion after a negative observer acknowledgement without native status", async () => {
    const { manager, helper } = setup();
    helper.replyAutomatically = false;
    await manager.request(
      thread,
      {
        method: "history.configure",
        settings: {
          enabled: true,
          paused: false,
          retentionDays: 30,
          intervalSeconds: 30,
          interactionCaptureEnabled: true,
          excludedBundleIds: [],
          excludedDomains: [],
        },
      },
      renderer,
    );
    await tick();
    const starting = helper.frames.find((frame) => frame.request.method === "activity.observe")!;
    if (starting.request.method !== "activity.observe") throw new Error("Expected observer");
    helper.replyAutomatically = true;
    helper.reply(starting, {
      method: "activity.observe",
      result: {
        epoch: starting.request.epoch,
        observing: false,
      },
    });
    await tick();
    helper.activityPipe.write(
      JSON.stringify({
        event: {
          type: "activity-record",
          epoch: starting.request.epoch,
          record: {
            id: "unavailable-context",
            capturedAt: new Date().toISOString(),
            target,
            appName: "Fixture",
            windowTitle: "Synthetic only",
            kind: "text-input",
            text: "Synthetic",
          },
        },
      }) + "\n",
    );
    const page = await manager.request(thread, { method: "activity.list" }, renderer);
    expect(page).not.toHaveProperty("result.events");
    expect(page).toMatchObject({
      result: { interactionStatus: { state: "unavailable", reason: "capture-failed" } },
    });
  });

  it.each([
    ["context", "close"],
    ["context", "error"],
    ["configuration", "close"],
    ["configuration", "error"],
  ] as const)(
    "preserves transport failure after %s suspension and pipe %s",
    async (failure, signal) => {
      const { manager, helper, dir } = setup();
      helper.replyAutomatically = false;
      await manager.request(
        thread,
        {
          method: "history.configure",
          settings: {
            enabled: true,
            paused: false,
            retentionDays: 30,
            intervalSeconds: 30,
            interactionCaptureEnabled: true,
            excludedBundleIds: [],
            excludedDomains: [],
          },
        },
        renderer,
      );
      await tick();
      const starting = helper.frames.find((frame) => frame.request.method === "activity.observe")!;
      if (starting.request.method !== "activity.observe") throw new Error("Expected observer");
      helper.replyAutomatically = true;
      if (failure === "context") {
        renameSync(join(dir, "activity"), join(dir, "activity-moved"));
        try {
          helper.activityPipe.write(
            JSON.stringify({
              event: {
                type: "activity-record",
                epoch: starting.request.epoch,
                record: {
                  id: "unwritten-before-pipe-failure",
                  capturedAt: new Date().toISOString(),
                  target,
                  appName: "Fixture",
                  windowTitle: "Synthetic only",
                  kind: "text-input",
                  text: "Synthetic",
                },
              },
            }) + "\n",
          );
        } finally {
          renameSync(join(dir, "activity-moved"), join(dir, "activity"));
        }
      } else
        helper.reply(starting, {
          method: "activity.observe",
          error: {
            code: "unsupported",
            message: "Synthetic configuration failure",
          },
        });
      await tick();
      expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
        result: { interactionStatus: { state: "unavailable", reason: "capture-failed" } },
      });
      helper.activityPipe.emit(
        signal,
        ...(signal === "error" ? [new Error("Synthetic fd3 failure")] : []),
      );
      helper.reply(starting);
      await tick();
      const page = await manager.request(thread, { method: "activity.list" }, renderer);
      expect(page).not.toHaveProperty("result.events");
      expect(page).toMatchObject({
        result: { interactionStatus: { state: "unavailable", reason: "transport-unavailable" } },
      });
    },
  );

  it("requires an actual activity channel rather than only saved consent", async () => {
    const { manager, helper } = setup();
    Object.defineProperty(helper, "stdio", {
      get: () => [helper.stdin, helper.stdout, helper.stderr],
    });
    await manager.request(
      thread,
      {
        method: "history.configure",
        settings: {
          enabled: true,
          paused: false,
          retentionDays: 30,
          intervalSeconds: 30,
          interactionCaptureEnabled: true,
          excludedBundleIds: [],
          excludedDomains: [],
        },
      },
      renderer,
    );
    await tick();
    await tick();
    expect(helper.frames.filter((frame) => frame.request.method === "activity.observe")).toEqual(
      [],
    );
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: { interactionStatus: { state: "unavailable", reason: "transport-unavailable" } },
    });
  });

  it("renews native history authority after clear and rejects its old stream epoch", async () => {
    const { manager, helper } = setup();
    await manager.request(
      thread,
      {
        method: "history.configure",
        settings: {
          enabled: true,
          paused: false,
          retentionDays: 30,
          intervalSeconds: 30,
          interactionCaptureEnabled: true,
          excludedBundleIds: [],
          excludedDomains: [],
        },
      },
      renderer,
    );
    await tick();
    await tick();
    const first = helper.frames.find((frame) => frame.request.method === "activity.observe")!;
    if (first.request.method !== "activity.observe") throw new Error("Expected observer");
    const send = (id: string, epoch: string) =>
      helper.activityPipe.write(
        JSON.stringify({
          event: {
            type: "activity-record",
            epoch,
            record: {
              id,
              capturedAt: new Date().toISOString(),
              target,
              appName: "Fixture",
              windowTitle: "Synthetic only",
              kind: "accessibility",
              ax: { mode: "full", text: "Synthetic projection" },
            },
          },
        }) + "\n",
      );
    send("before", first.request.epoch);
    await manager.request(thread, { method: "activity.clear" }, renderer);
    send("late-before", first.request.epoch);
    await tick();
    await tick();
    const latest = helper.frames
      .filter((frame) => frame.request.method === "activity.observe")
      .at(-1)!;
    if (latest.request.method !== "activity.observe") throw new Error("Expected observer");
    expect(latest.request.epoch).not.toBe(first.request.epoch);
    send("after", latest.request.epoch);
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: { events: [expect.objectContaining({ id: "after" })] },
    });
    const page = await manager.request(thread, { method: "activity.list" }, renderer);
    expect(JSON.stringify(page)).not.toContain("before");
  });

  it("suspends rejected context after persistence fails without poisoning control traffic", async () => {
    const { manager, helper, dir } = setup();
    await manager.request(
      thread,
      {
        method: "history.configure",
        settings: {
          enabled: true,
          paused: false,
          retentionDays: 30,
          intervalSeconds: 30,
          interactionCaptureEnabled: true,
          excludedBundleIds: [],
          excludedDomains: [],
        },
      },
      renderer,
    );
    await tick();
    await tick();
    const frame = helper.frames.find((frame) => frame.request.method === "activity.observe")!;
    if (frame.request.method !== "activity.observe") throw new Error("Expected observer");
    renameSync(join(dir, "activity"), join(dir, "activity-moved"));
    try {
      helper.activityPipe.write(
        JSON.stringify({
          event: {
            type: "activity-record",
            epoch: frame.request.epoch,
            record: {
              id: "unwritten",
              capturedAt: new Date().toISOString(),
              target,
              appName: "Fixture",
              windowTitle: "Synthetic only",
              kind: "text-input",
              text: "Synthetic",
            },
          },
        }) + "\n",
      );
    } finally {
      renameSync(join(dir, "activity-moved"), join(dir, "activity"));
    }
    await tick();
    expect(
      helper.frames.some(
        (frame) => frame.request.method === "stop" && frame.threadId === "desktop:recorder",
      ),
    ).toBe(true);
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: { interactionStatus: { state: "unavailable", reason: "capture-failed" } },
    });
    expect(helper.signals).toEqual([]);
  });

  it("does not dispatch an obsolete enable after policy changes while the helper attaches", async () => {
    const { manager, helper, launches } = setup();
    const settings = {
      enabled: true,
      paused: false,
      retentionDays: 30,
      intervalSeconds: 30,
      interactionCaptureEnabled: true,
      excludedBundleIds: [],
      excludedDomains: [],
    };
    let revoked = false;
    manager.onEvent((event) => {
      if (event.type === "recording-changed" && launches() > 0 && !revoked) {
        revoked = true;
        void manager.request(
          thread,
          {
            method: "history.configure",
            settings: { ...settings, interactionCaptureEnabled: false },
          },
          renderer,
        );
      }
    });
    await manager.request(thread, { method: "history.configure", settings }, renderer);
    await tick();
    await tick();
    expect(revoked).toBe(true);
    expect(
      helper.frames.filter(
        (frame) =>
          frame.request.method === "activity.observe" &&
          frame.request.settings.interactionCaptureEnabled,
      ),
    ).toEqual([]);
  });

  it("replaces exited observer sources with a fresh child and epoch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "djl-observer-restart-"));
    const helpers: FakeHelper[] = [];
    const manager = new ComputerUseManager({
      helperPath: "/trusted/helper",
      historyDirectory: dir,
      platform: "darwin",
      spawnHelper: () => {
        const helper = new FakeHelper();
        helpers.push(helper);
        return helper as unknown as ChildProcessWithoutNullStreams;
      },
    });
    resources.push({ manager, dir });
    await manager.request(
      thread,
      {
        method: "history.configure",
        settings: {
          enabled: true,
          paused: false,
          retentionDays: 30,
          intervalSeconds: 30,
          interactionCaptureEnabled: true,
          excludedBundleIds: [],
          excludedDomains: [],
        },
      },
      renderer,
    );
    await tick();
    await tick();
    const first = helpers[0]!,
      firstFrame = first.frames.find((frame) => frame.request.method === "activity.observe")!;
    if (firstFrame.request.method !== "activity.observe") throw new Error("Expected observer");
    first.emit("exit", 0);
    await manager.request(thread, { method: "status" }, origin);
    await tick();
    await tick();
    expect(helpers).toHaveLength(2);
    const next = helpers[1]!,
      nextFrame = next.frames.find((frame) => frame.request.method === "activity.observe")!;
    if (nextFrame.request.method !== "activity.observe") throw new Error("Expected observer");
    expect(nextFrame.request.epoch).not.toBe(firstFrame.request.epoch);
    const event = {
      type: "activity-record",
      epoch: nextFrame.request.epoch,
      record: {
        id: "fresh-source",
        capturedAt: new Date().toISOString(),
        target,
        appName: "Fixture",
        windowTitle: "Synthetic",
        kind: "click",
      },
    };
    first.activityPipe.emit("data", Buffer.from(JSON.stringify({ event }) + "\n"));
    next.activityPipe.write(JSON.stringify({ event }) + "\n");
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: { events: [expect.objectContaining({ id: "fresh-source" })] },
    });
  });

  it("passes a real private fd3 to an owned child without mutating parent environment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "djl-observer-pipe-child-"));
    const helperPath = join(dir, "fixture.cjs");
    writeFileSync(
      helperPath,
      `#!${process.execPath}\nconst fs = require('node:fs');
const ready = process.env.DJL_CUA_ACTIVITY_FD === '3' && (fs.fstatSync(3).isSocket() || fs.fstatSync(3).isFIFO());
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const frame=JSON.parse(line), request=frame.request;
 if(request.method==='activity.observe') {
  const observing=ready && request.settings.enabled && !request.settings.paused && request.settings.interactionCaptureEnabled===true;
  process.stdout.write(JSON.stringify({id:frame.id,response:{method:request.method,result:{epoch:request.epoch,observing}}})+'\\n');
  if(observing) fs.writeSync(3, JSON.stringify({event:{type:'activity-record',epoch:request.epoch,record:{id:'real-channel-fixture',capturedAt:new Date().toISOString(),target:{bundleId:'dev.djl.fixture',pid:123,windowId:12},appName:'Owned pipe fixture',windowTitle:'Synthetic only',kind:'text-input',text:'Synthetic private channel'}}})+'\\n');
 } else process.stdout.write(JSON.stringify({id:frame.id,response:{method:'stop',result:{stoppedSessionIds:[]}}})+'\\n');
});
process.on('SIGTERM',()=>process.exit(0));\n`,
    );
    chmodSync(helperPath, 0o700);
    const before = process.env.DJL_CUA_ACTIVITY_FD;
    const manager = new ComputerUseManager({
      helperPath,
      historyDirectory: join(dir, "history"),
      platform: "darwin",
    });
    resources.push({ manager, dir });
    let resolve!: () => void;
    const recorded = new Promise<void>((done) => {
      resolve = done;
    });
    manager.onEvent((event) => {
      if (event.type !== "recording-changed") return;
      void manager.request(thread, { method: "activity.list" }, renderer).then((page) => {
        if (
          page.method === "activity.list" &&
          "result" in page &&
          page.result.events?.some((item) => item.id === "real-channel-fixture")
        )
          resolve();
      });
    });
    await manager.request(
      thread,
      {
        method: "history.configure",
        settings: {
          enabled: true,
          paused: false,
          retentionDays: 30,
          intervalSeconds: 30,
          interactionCaptureEnabled: true,
          excludedBundleIds: [],
          excludedDomains: [],
        },
      },
      renderer,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        recorded,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Owned child did not deliver its private record")),
            2000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    expect(process.env.DJL_CUA_ACTIVITY_FD).toBe(before);
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: { events: [expect.objectContaining({ text: "Synthetic private channel" })] },
    });
  });

  it("keeps semantic jobs host-authenticated and rejects late completion after pause or deletion", async () => {
    const { manager, dir } = setup(200, (directory) => {
      mkdirSync(join(directory, "activity"));
      writeFileSync(
        join(directory, "activity", "activity.json"),
        JSON.stringify({
          version: 1,
          snapshots: [
            {
              id: "source-a",
              capturedAt: new Date(Date.now() - 1_300_000).toISOString(),
              target,
              appName: "Synthetic fixture",
              windowTitle: "Synthetic draft",
              labels: ["Approved synthetic draft"],
            },
            {
              id: "source-b",
              capturedAt: new Date(Date.now() - 700_000).toISOString(),
              target,
              appName: "Synthetic fixture",
              windowTitle: "Second synthetic draft",
              labels: ["Revised synthetic draft"],
            },
          ],
        }),
      );
    });
    const endpoint = await manager.start();
    const post = (body: unknown, token = endpoint.token, browserOrigin?: string) =>
      fetch(`${endpoint.url}/summary-jobs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(browserOrigin ? { origin: browserOrigin } : {}),
        },
        body: JSON.stringify(body),
      });
    expect((await post({ operation: "claim" }, "incorrect")).status).toBe(401);
    expect((await post({ operation: "claim" }, endpoint.token, "https://example.com")).status).toBe(
      403,
    );
    expect((await post({ operation: "claim", enabled: true })).status).toBe(400);
    expect(await (await post({ operation: "claim" })).json()).toEqual({
      operation: "claim",
      job: null,
    });
    for (const caller of [origin, renderer])
      expect(await manager.request(thread, { method: "summary.claim" }, caller)).toMatchObject({
        error: { code: "invalid-request" },
      });
    const settings = {
      enabled: true,
      paused: false,
      semanticSummariesEnabled: true,
      interactionCaptureEnabled: false,
      retentionDays: 30,
      intervalSeconds: 30,
      excludedBundleIds: [],
      excludedDomains: [],
    };
    await manager.request(thread, { method: "history.configure", settings }, renderer);
    const first = (await (await post({ operation: "claim" })).json()) as {
      job: {
        leaseId: string;
        sourceIds: string[];
        applications: string[];
        startedAt: string;
        endedAt: string;
      };
    };
    expect(first.job.sourceIds).toEqual(["source-a"]);
    const finish = (job: typeof first.job) =>
      post({
        operation: "complete",
        leaseId: job.leaseId,
        provider: "fixture",
        model: "synthetic",
        content: {
          title: "Approve the synthetic draft",
          description: "You edited the synthetic draft. You approved it.",
          memory: "The user approved the synthetic draft.",
          recording: "The draft was approved.",
          citations: job.sourceIds,
          applications: job.applications,
        },
      });
    await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
    expect(await (await finish(first.job)).json()).toEqual({
      operation: "complete",
      accepted: false,
    });
    await manager.request(thread, { method: "history.configure", settings }, renderer);
    const second = (await (await post({ operation: "claim" })).json()) as typeof first;
    expect(await (await finish(second.job)).json()).toEqual({
      operation: "complete",
      accepted: true,
    });
    expect(
      JSON.parse(readFileSync(join(dir, "activity", "semantic", "semantic-summaries.json"), "utf8"))
        .entries[0].summary.content.title,
    ).toBe("Approve the synthetic draft");
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: {
        semanticSummaries: [
          expect.objectContaining({
            content: expect.objectContaining({ title: "Approve the synthetic draft" }),
          }),
        ],
        semanticStatus: { enabled: true },
      },
    });
    expect(await manager.request(thread, { method: "activity.list" }, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    manager.resumeThread(thread, { allowActivityHistory: true });
    expect(
      await manager.request(thread, { method: "activity.list", bundleId: target.bundleId }, origin),
    ).toMatchObject({ result: { semanticSummaries: [expect.any(Object)] } });
    manager.resumeThread(thread);
    expect(await manager.request(thread, { method: "activity.list" }, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    const third = (await (await post({ operation: "claim" })).json()) as typeof first;
    expect(third.job.sourceIds).toContain("source-b");
    expect(await (await post({ operation: "valid", leaseId: third.job.leaseId })).json()).toEqual({
      operation: "valid",
      valid: true,
    });
    const scope = {
      since: second.job.startedAt,
      until: second.job.endedAt,
      bundleId: target.bundleId,
    };
    expect(
      await manager.request(thread, { method: "activity.clear", ...scope }, origin),
    ).toMatchObject({ error: { code: "permission-denied" } });
    expect(
      await manager.request(thread, { method: "activity.clear", ...scope }, renderer),
    ).toMatchObject({ result: { deletedCount: 2 } });
    expect(await (await post({ operation: "valid", leaseId: second.job.leaseId })).json()).toEqual({
      operation: "valid",
      valid: false,
    });
    expect(await (await finish(second.job)).json()).toEqual({
      operation: "complete",
      accepted: false,
    });
    expect(await (await finish(third.job)).json()).toEqual({
      operation: "complete",
      accepted: false,
    });
    const clean = (await (await post({ operation: "claim" })).json()) as typeof first;
    expect(clean.job.sourceIds).toEqual(["source-b"]);
    await manager.request(thread, { method: "activity.clear" }, renderer);
    expect(await (await post({ operation: "claim" })).json()).toEqual({
      operation: "claim",
      job: null,
    });
  });
  it("reports unsupported native capabilities without spawning a macOS helper on other platforms", async () => {
    for (const platform of ["win32", "linux"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "djl-computer-unsupported-"));
      const manager = new ComputerUseManager({
        helperPath: "/absent/mac/helper",
        historyDirectory: dir,
        platform,
        spawnHelper: () => {
          throw new Error("Must not spawn");
        },
      });
      resources.push({ manager, dir });
      expect(await manager.request(thread, { method: "status" }, origin)).toMatchObject({
        method: "status",
        result: {
          platform,
          available: false,
          capabilities: { observation: false, backgroundActions: [], passiveHistory: false },
        },
      });
      expect(await manager.request(thread, { method: "apps.list" }, origin)).toMatchObject({
        error: { code: "unsupported" },
      });
      expect(
        await manager.request(thread, { method: "session.open", target }, origin),
      ).toMatchObject({ error: { code: "unsupported" } });
    }
  });
  it("starts lazily, enforces ownership and rejects caller-injected scope before dispatch", async () => {
    const { manager, helper, launches } = setup();
    expect(launches()).toBe(0);
    const sessionId = await open(manager);
    expect(launches()).toBe(1);
    expect(
      await manager.request("other", { method: "session.perform", sessionId, action }, origin),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
    expect(
      await manager.request(thread, { method: "session.observe", sessionId: "missing" }, origin),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
    expect(
      await manager.request(thread, { method: "status", threadId: "other" }, origin),
    ).toMatchObject({ error: { code: "invalid-request" } });
    expect(helper.frames).toHaveLength(1);
  });

  it("validates session-open identity and never trusts a target from another helper session", async () => {
    const { manager, helper } = setup();
    helper.replyAutomatically = false;
    const pending = manager.request(thread, { method: "session.open", target }, origin);
    await tick();
    helper.reply(helper.frames[0]!, {
      method: "session.open",
      result: { sessionId: "wrong", threadId: "another-thread" as never, target },
    });
    expect(await pending).toMatchObject({ error: { code: "helper-unavailable" } });
    expect(helper.killed).toBe(true);
  });

  it("stops an in-flight action immediately and revokes queued work before it can execute", async () => {
    const { manager, helper } = setup();
    const sessionId = await open(manager);
    helper.replyAutomatically = false;
    const first = manager.request(thread, { method: "session.perform", sessionId, action }, origin);
    await tick();
    const queued = manager.request(
      thread,
      { method: "session.perform", sessionId, action },
      origin,
    );
    const stopped = manager.stopThread(thread);
    await tick();
    expect(helper.frames.map((frame) => frame.request.method)).toEqual([
      "session.open",
      "session.perform",
      "stop",
    ]);
    const stopFrame = helper.frames.at(-1)!;
    helper.reply(stopFrame);
    expect(await stopped).toMatchObject({
      method: "stop",
      result: { stoppedSessionIds: [sessionId] },
    });
    expect(await first).toMatchObject({ error: { code: "cancelled" } });
    expect(await queued).toMatchObject({ error: { code: "cancelled" } });
    helper.reply(helper.frames[1]!);
    expect(
      await manager.request(thread, { method: "session.observe", sessionId }, origin),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
    expect(helper.frames).toHaveLength(3);
  });

  it("stops an opening session with a thread-scoped native stop before its ID is known", async () => {
    const { manager, helper } = setup();
    helper.replyAutomatically = false;
    const opening = manager.request(thread, { method: "session.open", target }, origin);
    await tick();
    const stopped = manager.stopThread(thread);
    await tick();
    expect(helper.frames.at(-1)?.request).toEqual({ method: "stop" });
    helper.reply(helper.frames.at(-1)!, { method: "stop", result: { stoppedSessionIds: [] } });
    expect(await stopped).toMatchObject({ method: "stop", result: { stoppedSessionIds: [] } });
    expect(await opening).toMatchObject({ error: { code: "cancelled" } });
  });

  it("revokes queued session opens when the helper exits before any session exists", async () => {
    const { manager, helper, launches } = setup();
    helper.replyAutomatically = false;
    const opening = manager.request(thread, { method: "session.open", target }, origin);
    const queued = manager.request(thread, { method: "session.open", target }, origin);
    await tick();
    helper.emit("exit", 1);
    expect(await opening).toMatchObject({ error: { code: "helper-unavailable" } });
    expect(await queued).toMatchObject({ error: { code: "cancelled" } });
    expect(launches()).toBe(1);
  });

  it("does not resurrect a session whose native stopped event precedes its open response", async () => {
    const { manager, helper } = setup();
    helper.replyAutomatically = false;
    const opening = manager.request(thread, { method: "session.open", target }, origin);
    await tick();
    const frame = helper.frames[0]!;
    const sessionId = `s-${frame.id}`;
    helper.stdout.write(`${JSON.stringify({ event: { type: "stopped", sessionId } })}\n`);
    helper.reply(frame);
    expect(await opening).toMatchObject({ error: { code: "cancelled" } });
    expect(
      await manager.request(thread, { method: "session.observe", sessionId }, origin),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
  });

  it("does not resurrect an opening session when its response and stopped event share a stdout chunk", async () => {
    const { manager, helper } = setup();
    helper.replyAutomatically = false;
    const opening = manager.request(thread, { method: "session.open", target }, origin);
    await tick();
    const frame = helper.frames[0]!;
    const sessionId = `s-${frame.id}`;
    helper.stdout.write(
      `${JSON.stringify({ id: frame.id, response: { method: "session.open", result: { sessionId, threadId: thread, target } } })}\n${JSON.stringify({ event: { type: "stopped", sessionId } })}\n`,
    );
    expect(await opening).toMatchObject({ error: { code: "cancelled" } });
    expect(
      await manager.request(thread, { method: "session.observe", sessionId }, origin),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
  });

  it.each(["request", "event"])(
    "session-specific Stop via %s preserves queued work for a sibling session",
    async (mode) => {
      const { manager, helper } = setup();
      const sessionA = await open(manager);
      const sessionB = await open(manager);
      helper.replyAutomatically = false;
      const first = manager.request(
        thread,
        { method: "session.perform", sessionId: sessionA, action },
        origin,
      );
      await tick();
      const sibling = manager.request(
        thread,
        { method: "session.perform", sessionId: sessionB, action },
        origin,
      );
      if (mode === "request") {
        const stopped = manager.request(thread, { method: "stop", sessionId: sessionA }, origin);
        await tick();
        helper.reply(helper.frames.findLast((item) => item.request.method === "stop")!);
        await stopped;
      } else
        helper.stdout.write(
          `${JSON.stringify({ event: { type: "stopped", sessionId: sessionA } })}\n`,
        );
      await tick();
      const siblingFrame = helper.frames.findLast(
        (item) => item.request.method === "session.perform" && item.request.sessionId === sessionB,
      );
      expect(siblingFrame).toBeDefined();
      helper.reply(siblingFrame!);
      expect(await first).toMatchObject({ error: { code: "cancelled" } });
      expect(await sibling).toMatchObject({ result: { acknowledgement: "dispatched" } });
    },
  );

  it("human native thread Stop suspends only its owner until a trusted new user turn", async () => {
    const { manager, helper } = setup();
    const sessionA = await open(manager);
    const siblingA = await open(manager);
    const sessionB = await open(manager, "thread-b");
    const threadStops: unknown[] = [];
    manager.onEvent((event) => {
      if (event.type === "thread-stopped") threadStops.push(event);
    });
    helper.replyAutomatically = false;
    const inFlight = manager.request(
      thread,
      { method: "session.perform", sessionId: sessionA, action },
      origin,
    );
    await tick();
    const queued = manager.request(
      thread,
      { method: "session.perform", sessionId: siblingA, action },
      origin,
    );
    helper.stdout.write(
      `${JSON.stringify({ event: { type: "thread-stopped", threadId: thread } })}\n`,
    );
    expect(await inFlight).toMatchObject({ error: { code: "cancelled" } });
    expect(await queued).toMatchObject({ error: { code: "cancelled" } });
    expect(await manager.request(thread, { method: "session.open", target }, origin)).toMatchObject(
      { error: { code: "cancelled" } },
    );
    expect(
      await manager.request(thread, { method: "session.observe", sessionId: siblingA }, origin),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
    expect(helper.frames.filter((frame) => frame.request.method === "stop")).toHaveLength(0);
    expect(threadStops).toEqual([{ type: "thread-stopped", threadId: thread }]);
    expect(helper.killed).toBe(false);
    helper.replyAutomatically = true;
    expect(
      await manager.request(
        "thread-b",
        { method: "session.perform", sessionId: sessionB, action },
        origin,
      ),
    ).toMatchObject({ result: { acknowledgement: "dispatched" } });
    manager.resumeThread(thread);
    await open(manager);
  });

  it("blocks reopening after whole-thread Stop until the trusted host starts a new user turn", async () => {
    const { manager, helper } = setup();
    await open(manager);
    await manager.stopThread(thread);
    const count = helper.frames.length;
    expect(await manager.request(thread, { method: "session.open", target }, origin)).toMatchObject(
      { error: { code: "cancelled" } },
    );
    expect(await manager.request(thread, { method: "turn-start" }, origin)).toMatchObject({
      error: { code: "invalid-request" },
    });
    expect(await manager.request(thread, { method: "turn-start" }, renderer)).toMatchObject({
      error: { code: "invalid-request" },
    });
    expect(helper.frames).toHaveLength(count);
    manager.resumeThread(thread);
    await open(manager);
  });

  it("escalates an ignored SIGTERM and blocks respawn until the old helper has exited", async () => {
    const { manager, helper, launches } = setup(20);
    helper.ignoreTermination = true;
    helper.exitOnKill = false;
    helper.replyAutomatically = false;
    expect(await manager.request(thread, { method: "status" }, origin)).toMatchObject({
      error: { code: "timeout" },
    });
    expect(helper.signals).toEqual(["SIGTERM"]);
    expect(await manager.request(thread, { method: "status" }, origin)).toMatchObject({
      error: { code: "helper-unavailable" },
    });
    expect(launches()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(helper.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(await manager.request(thread, { method: "status" }, origin)).toMatchObject({
      error: { code: "helper-unavailable" },
    });
    expect(launches()).toBe(1);
    helper.emit("exit", 0);
    helper.replyAutomatically = true;
    await manager.request(thread, { method: "status" }, origin);
    expect(launches()).toBe(2);
  });

  it("establishes helper retirement before stopped-event callbacks can request another helper", async () => {
    const { manager, helper, launches } = setup(20);
    const sessionId = await open(manager);
    helper.ignoreTermination = true;
    helper.exitOnKill = false;
    helper.replyAutomatically = false;
    let callbackRequest: Promise<ComputerUseResponse> | undefined;
    manager.onEvent((event) => {
      if (event.type === "stopped")
        callbackRequest = manager.request("observer", { method: "status" }, origin);
    });
    await manager.request(thread, { method: "session.perform", sessionId, action }, origin);
    expect(await callbackRequest).toMatchObject({ error: { code: "helper-unavailable" } });
    expect(launches()).toBe(1);
    helper.emit("exit", 0);
  });

  it("bounds disposal when a helper ignores cooperative termination", async () => {
    const { manager, helper } = setup();
    await open(manager);
    helper.ignoreTermination = true;
    helper.exitOnKill = false;
    await manager.dispose();
    expect(helper.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("keeps an unacknowledged input operation alive until its ordered native response", async () => {
    const { manager, helper } = setup(20);
    const sessionId = await open(manager);
    helper.ignoreTermination = true;
    helper.exitOnKill = false;
    helper.replyAutomatically = false;
    try {
      await manager.request(thread, { method: "session.perform", sessionId, action }, origin);
      const input = helper.frames.find((frame) => frame.request.method === "session.perform")!;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(helper.signals).toEqual(["SIGTERM"]);
      helper.reply(input);
      await tick();
      expect(helper.signals).toEqual(["SIGTERM", "SIGKILL"]);
    } finally {
      helper.emit("exit", 0);
    }
  });

  it("retains native keyboard protection through retirement until a strict safe event", async () => {
    const { manager, helper, launches } = setup(20);
    await open(manager);
    helper.ignoreTermination = true;
    helper.exitOnKill = false;
    try {
      helper.stdout.write('{"event":{"type":"input-protection","state":"active"}}\n');
      helper.replyAutomatically = false;
      await manager.request(thread, { method: "status" }, origin);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(helper.signals).toEqual(["SIGTERM"]);
      expect(await manager.request(thread, { method: "status" }, origin)).toMatchObject({
        error: { code: "helper-unavailable" },
      });
      expect(launches()).toBe(1);
      helper.stdout.write('{"event":{"type":"input-protection","state":"safe","extra":true}}\n');
      await tick();
      expect(helper.signals).toEqual(["SIGTERM"]);
      helper.stdout.write('{"event":{"type":"input-protection",');
      helper.stdout.write('"state":"safe"}}\n');
      await tick();
      expect(helper.signals).toEqual(["SIGTERM", "SIGKILL"]);
    } finally {
      helper.emit("exit", 0);
    }
  });

  it("checks observation target identity before exposing AX content", async () => {
    const { manager, helper } = setup();
    const sessionId = await open(manager);
    helper.replyAutomatically = false;
    const observation = manager.request(thread, { method: "session.observe", sessionId }, origin);
    await tick();
    helper.reply(helper.frames.at(-1)!, {
      method: "session.observe",
      result: {
        sessionId,
        snapshotId: "snapshot",
        target: { ...target, windowId: 99 },
        capturedAt: new Date().toISOString(),
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        elements: [],
        truncated: false,
      },
    });
    expect(await observation).toMatchObject({ error: { code: "helper-unavailable" } });
    expect(helper.killed).toBe(true);
  });

  it("keeps another thread's session usable after a thread-scoped stop", async () => {
    const { manager, helper } = setup();
    const firstSession = await open(manager);
    const otherSession = await open(manager, "thread-b");
    await manager.stopThread(thread);
    expect(
      await manager.request(
        "thread-b",
        { method: "session.perform", sessionId: otherSession, action },
        origin,
      ),
    ).toMatchObject({ result: { acknowledgement: "dispatched" } });
    expect(
      await manager.request(
        thread,
        { method: "session.perform", sessionId: firstSession, action },
        origin,
      ),
    ).toMatchObject({ error: { code: "unauthorized-session" } });
    expect(helper.killed).toBe(false);
  });

  it("reserves Stop all for renderer controls while agent Stop remains thread-scoped", async () => {
    const { manager, helper } = setup();
    const sessionA = await open(manager);
    const sessionB = await open(manager, "thread-b");
    await manager.request(thread, { method: "stop" }, origin);
    expect(
      await manager.request(
        "thread-b",
        { method: "session.perform", sessionId: sessionB, action },
        origin,
      ),
    ).toMatchObject({ result: { acknowledgement: "dispatched" } });
    const sessionC = await open(manager, "thread-c");
    await manager.request("desktop:settings", { method: "stop" }, renderer);
    for (const [owner, sessionId] of [
      [thread, sessionA],
      ["thread-b", sessionB],
      ["thread-c", sessionC],
    ]) {
      expect(
        await manager.request(owner!, { method: "session.observe", sessionId }, origin),
      ).toMatchObject({ error: { code: "unauthorized-session" } });
    }
    expect(
      helper.frames
        .filter((frame) => frame.request.method === "stop")
        .map((frame) => frame.threadId),
    ).toEqual([thread, "thread-b", "thread-c"]);
    expect(
      await manager.request("previously-unseen", { method: "session.open", target }, origin),
    ).toMatchObject({ error: { code: "cancelled" } });
    manager.resumeThread("previously-unseen");
    await open(manager, "previously-unseen");
  });

  it("renderer Stop all cancels sessions still waiting in the queue", async () => {
    const { manager, helper } = setup();
    helper.replyAutomatically = false;
    const a = manager.request(thread, { method: "session.open", target }, origin);
    const b = manager.request("thread-b", { method: "session.open", target }, origin);
    await tick();
    const stopped = manager.request("desktop:settings", { method: "stop" }, renderer);
    await tick();
    expect(
      helper.frames
        .filter((frame) => frame.request.method === "stop")
        .map((frame) => frame.threadId)
        .toSorted(),
    ).toEqual([thread, "thread-b"]);
    for (const frame of helper.frames.filter((item) => item.request.method === "stop"))
      helper.reply(frame, { method: "stop", result: { stoppedSessionIds: [] } });
    await stopped;
    expect(await a).toMatchObject({ error: { code: "cancelled" } });
    expect(await b).toMatchObject({ error: { code: "cancelled" } });
    expect(helper.frames.filter((frame) => frame.request.method === "session.open")).toHaveLength(
      1,
    );
  });

  it("still dispatches native Stop if history storage becomes unavailable", async () => {
    const { manager, helper, dir } = setup();
    await open(manager);
    renameSync(dir, `${dir}-moved`);
    try {
      await manager.stopThread(thread);
      expect(helper.frames.at(-1)?.request.method).toBe("stop");
    } finally {
      renameSync(`${dir}-moved`, dir);
    }
  });

  it("reserves bounded transport capacity for Stop when other threads fill the request limit", async () => {
    const { manager, helper } = setup(2_000);
    await open(manager);
    helper.replyAutomatically = false;
    const reads = Array.from({ length: 100 }, (_, index) =>
      manager.request(`reader-${index}`, { method: "status" }, origin),
    );
    const stopped = manager.stopThread(thread);
    await tick();
    expect(helper.frames.at(-1)?.request.method).toBe("stop");
    helper.reply(helper.frames.at(-1)!);
    expect(await stopped).toMatchObject({
      method: "stop",
      result: { stoppedSessionIds: expect.any(Array) },
    });
    await manager.dispose();
    await Promise.all(reads);
  });

  it("kills a wedged helper on deadline and rejects all pending operations", async () => {
    const { manager, helper } = setup(20);
    helper.replyAutomatically = false;
    const a = manager.request(thread, { method: "status" }, origin);
    const b = manager.request("other", { method: "apps.list" }, origin);
    expect(await a).toMatchObject({ error: { code: "timeout" } });
    expect(await b).toMatchObject({ error: { code: "helper-unavailable" } });
    expect(helper.killed).toBe(true);
  });

  it.each(["malformed", "oversized", "exit"])("fails closed on %s helper output", async (mode) => {
    const { manager, helper } = setup();
    helper.replyAutomatically = false;
    const response = manager.request(thread, { method: "status" }, origin);
    await tick();
    if (mode === "malformed") helper.stdout.write("not json\n");
    if (mode === "oversized") helper.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 1, 120));
    if (mode === "exit") helper.emit("exit", 1);
    expect(await response).toMatchObject({ error: { code: "helper-unavailable" } });
  });

  it("authenticates the localhost endpoint and bounds/strictly checks JSON requests", async () => {
    const { manager, launches } = setup();
    const endpoint = await manager.start();
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/computer-use$/);
    const post = (body: string, token = endpoint.token) =>
      fetch(endpoint.url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body,
      });
    expect((await post("{}", "bad-token")).status).toBe(401);
    expect(
      (await post(JSON.stringify({ threadId: thread, request: { method: "status", extra: true } })))
        .status,
    ).toBe(400);
    expect((await post("x".repeat(128 * 1024 + 1))).status).toBe(413);
    const response = await post(
      JSON.stringify({ threadId: thread, request: { method: "history.settings" } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(launches()).toBe(0);
  });

  it("authenticates a strict host-only turn-start route outside model and renderer request methods", async () => {
    const { manager } = setup();
    const endpoint = await manager.start();
    await open(manager);
    await manager.stopThread(thread);
    const start = (body: unknown, token = endpoint.token) =>
      fetch(`${endpoint.url}/turn-start`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await start({ threadId: thread }, "wrong-token")).status).toBe(401);
    expect((await start({ threadId: thread, request: { method: "status" } })).status).toBe(400);
    expect((await start({ threadId: thread, allowActivityHistory: "true" })).status).toBe(400);
    expect(await manager.request(thread, { method: "session.open", target }, origin)).toMatchObject(
      { error: { code: "cancelled" } },
    );
    const resumed = await start({ threadId: thread });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toEqual({ resumed: true });
    await open(manager);
    expect((await start({ threadId: thread, allowActivityHistory: true })).status).toBe(200);
    expect(await manager.request(thread, { method: "activity.list" }, origin)).toMatchObject({
      result: { snapshots: [], summaries: [] },
    });
    expect((await start({ threadId: thread, allowActivityHistory: false })).status).toBe(200);
    expect(await manager.request(thread, { method: "activity.list" }, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
  });

  it("persists only bounded sanitized action metadata, with private files and thread filtering", async () => {
    const { manager, dir } = setup();
    const sessionId = await open(manager);
    const events: unknown[] = [];
    manager.onEvent((event) => events.push(event));
    await manager.request(thread, { method: "session.perform", sessionId, action }, origin);
    await manager.request(thread, { method: "session.close", sessionId }, origin);
    const list = await manager.request(thread, { method: "history.list", limit: 2 }, origin);
    expect(list).toMatchObject({
      method: "history.list",
      result: {
        events: [{ type: "session-closed" }, { type: "action", actionType: "type" }],
        nextCursor: expect.any(String),
      },
    });
    expect(await manager.request("other", { method: "history.list" }, origin)).toMatchObject({
      result: { events: [] },
    });
    const persisted = readdirSync(dir)
      .filter((name) => statSync(join(dir, name)).isFile())
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("");
    expect(persisted).not.toContain("SECRET");
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "activity", phase: "before", actionType: "type" }),
    );
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const name of readdirSync(dir)) {
      const stat = statSync(join(dir, name));
      expect(stat.mode & 0o777).toBe(stat.isDirectory() ? 0o700 : 0o600);
    }
    const second = new ComputerUseManager({ helperPath: "/trusted/helper", historyDirectory: dir });
    try {
      expect(await second.request(thread, { method: "history.list" }, origin)).toMatchObject({
        result: { events: expect.arrayContaining([expect.objectContaining({ type: "action" })]) },
      });
    } finally {
      await second.dispose();
    }
  });

  it("only requests system permission from a renderer-origin human action", async () => {
    const { manager, helper } = setup();
    const request = { method: "permissions.request", permission: "accessibility" } as const;
    expect(await manager.request(thread, request, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    expect(helper.frames).toHaveLength(0);
    const response = await manager.request("desktop:settings", request, renderer);
    expect(response.method).toBe("permissions.request");
    expect(helper.frames).toHaveLength(1);
  });

  it("reserves passive settings and clearing for renderer-origin human controls", async () => {
    const { manager } = setup();
    const initial = await manager.request(thread, { method: "history.settings" }, renderer);
    expect(initial).toMatchObject({
      result: { enabled: false, paused: false, retentionDays: 30, intervalSeconds: 30 },
    });
    const settings = {
      enabled: true,
      paused: true,
      retentionDays: 5,
      intervalSeconds: 30,
      excludedBundleIds: [],
      excludedDomains: [],
    };
    expect(
      await manager.request(thread, { method: "history.configure", settings }, origin),
    ).toMatchObject({ error: { code: "permission-denied" } });
    expect(await manager.request(thread, { method: "history.clear" }, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    expect(await manager.request(thread, { method: "history.settings" }, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    expect(
      await manager.request(thread, { method: "history.list", source: "passive" }, origin),
    ).toMatchObject({ error: { code: "permission-denied" } });
    expect(
      await manager.request(thread, { method: "history.configure", settings }, renderer),
    ).toMatchObject({ result: settings });
    await open(manager);
    expect(await manager.request(thread, { method: "history.clear" }, renderer)).toMatchObject({
      result: { deletedCount: 1 },
    });
    expect(await manager.request(thread, { method: "history.list" }, origin)).toMatchObject({
      result: { events: [] },
    });
  });

  it("requires a trusted per-turn history grant and revokes it on the next turn or Stop", async () => {
    const { manager, helper } = setup();
    const list = { method: "activity.list", limit: 20 };
    expect(await manager.request(thread, list, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    expect(
      await manager.request(thread, { ...list, allowActivityHistory: true }, origin),
    ).toMatchObject({ error: { code: "invalid-request" } });
    manager.resumeThread(thread, { allowActivityHistory: true });
    expect(await manager.request(thread, list, origin)).toEqual({
      method: "activity.list",
      result: { snapshots: [], summaries: [] },
    });
    expect(await manager.request("other", list, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    manager.resumeThread(thread);
    expect(await manager.request(thread, list, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    manager.resumeThread(thread, { allowActivityHistory: true });
    await manager.stopThread(thread);
    expect(await manager.request(thread, list, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    expect(helper.frames).toHaveLength(0);
    expect(await manager.request(thread, list, renderer)).toMatchObject({
      result: { snapshots: [] },
    });
  });

  it("resolves a human floating Open chat event from the owned session identity", async () => {
    const { manager, helper } = setup();
    const sessionId = await open(manager);
    const events: ComputerUseManagerEvent[] = [];
    manager.onEvent((event) => events.push(event));
    helper.stdout.write(`${JSON.stringify({ event: { type: "show-thread", sessionId } })}\n`);
    expect(events).toEqual([{ type: "show-thread", threadId: thread }]);
    expect(
      await manager.request(thread, { method: "session.close", sessionId }, origin),
    ).toMatchObject({ result: { closed: true } });
    helper.stdout.write(`${JSON.stringify({ event: { type: "show-thread", sessionId } })}\n`);
    expect(events.filter((event) => event.type === "show-thread")).toHaveLength(1);
    expect(
      await manager.request(thread, { method: "show-thread", threadId: "other" }, origin),
    ).toMatchObject({ error: { code: "invalid-request" } });
  });

  it("does not let renderer or agent bypass the recorder policy or clear activity through a tool", async () => {
    const { manager, helper } = setup();
    const settings = {
      enabled: true,
      paused: false,
      retentionDays: 30,
      intervalSeconds: 5,
      excludedBundleIds: [],
      excludedDomains: [],
    };
    for (const caller of [origin, renderer])
      expect(
        await manager.request(thread, { method: "activity.capture", settings }, caller),
      ).toMatchObject({ error: { code: "permission-denied" } });
    for (const caller of [origin, renderer])
      expect(
        await manager.request(
          thread,
          {
            method: "activity.observe",
            epoch: "forged",
            settings: { ...settings, interactionCaptureEnabled: true },
          },
          caller,
        ),
      ).toMatchObject({ error: { code: "permission-denied" } });
    expect(await manager.request(thread, { method: "activity.clear" }, origin)).toMatchObject({
      error: { code: "permission-denied" },
    });
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toEqual({
      method: "activity.clear",
      result: { deletedCount: 0 },
    });
    expect(helper.frames).toHaveLength(0);
  });

  it("sends native cancellation when a queued recorder capture is paused", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { manager, helper } = setup(10_000);
      const settings = {
        enabled: true,
        paused: false,
        semanticSummariesEnabled: true,
        interactionCaptureEnabled: false,
        retentionDays: 30,
        intervalSeconds: 5,
        includedBundleIds: [target.bundleId],
        excludedBundleIds: [],
        excludedDomains: [],
      };
      await manager.request(thread, { method: "history.configure", settings }, renderer);
      helper.replyAutomatically = false;
      await vi.advanceTimersByTimeAsync(5_000);
      const capture = helper.frames.find((frame) => frame.request.method === "activity.capture")!;
      const {
        semanticSummariesEnabled: _semantic,
        interactionCaptureEnabled: _interaction,
        ...nativeSettings
      } = settings;
      expect(capture.request).toEqual({ method: "activity.capture", settings: nativeSettings });
      await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
      const stop = helper.frames.find((frame) => frame.request.method === "stop")!;
      expect(stop.threadId).toBe("desktop:recorder");
      helper.reply(stop);
      // A native response that raced with cancellation must not be persisted.
      helper.reply(capture, {
        method: "activity.capture",
        result: {
          id: "late",
          capturedAt: new Date().toISOString(),
          target,
          appName: "Fixture",
          windowTitle: "Synthetic only",
          labels: ["Late observation"],
        },
      });
      await tick();
      expect(await manager.request(thread, { method: "activity.list" }, renderer)).toEqual({
        method: "activity.list",
        result: {
          snapshots: [],
          summaries: [],
          semanticSummaries: [],
          semanticStatus: { enabled: false, pending: 0, running: false },
        },
      });
      helper.replyAutomatically = true;
    } finally {
      vi.useRealTimers();
    }
  });
});

class FakePauseClock {
  instant = Date.parse("2026-10-28T12:00:00.000Z");
  next = 0;
  callbacks = new Map<number, { callback: () => void; delay: number }>();
  now = () => this.instant;
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.next;
    this.callbacks.set(id, { callback, delay });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimeout = (id: ReturnType<typeof setTimeout>) => {
    this.callbacks.delete(id as unknown as number);
  };
  fire() {
    const [id, entry] = [...this.callbacks][0]!;
    this.callbacks.delete(id);
    entry.callback();
  }
}
const pauseSettings: ComputerUseHistorySettings = {
  enabled: true,
  paused: true,
  retentionDays: 30,
  intervalSeconds: 3600,
  interactionCaptureEnabled: true,
  semanticSummariesEnabled: false,
  excludedBundleIds: [],
  excludedDomains: [],
};
async function readPause(manager: ComputerUseManager) {
  const response = await manager.request(thread, { method: "history.settings" }, renderer);
  if (response.method !== "history.settings" || "error" in response)
    throw new Error("settings failed");
  return response.result;
}
async function configurePause(manager: ComputerUseManager, settings = pauseSettings) {
  return manager.request(thread, { method: "history.configure", settings }, renderer);
}
describe("host-owned timed pause", () => {
  it("denies agents, rejects disabled timers, persists exact durations and resumes current policy without native metadata", async () => {
    const clock = new FakePauseClock();
    const { manager, helper, dir } = setup(200, undefined, clock);
    expect(
      await manager.request(thread, { method: "history.pause", action: "30m" }, origin),
    ).toMatchObject({ error: { code: "permission-denied" } });
    expect(
      await manager.request(thread, { method: "history.pause", action: "30m" }, renderer),
    ).toMatchObject({ error: { code: "invalid-request" } });
    expect((await readPause(manager)).enabled).toBe(false);
    await configurePause(manager);
    const scheduled = await manager.request(
      thread,
      { method: "history.pause", action: "30m" },
      renderer,
    );
    expect(scheduled).toMatchObject({ result: { pauseResumeAt: "2026-10-28T12:30:00.000Z" } });
    expect(JSON.parse(readFileSync(join(dir, "operations.json"), "utf8")).pauseResumeAt).toBe(
      "2026-10-28T12:30:00.000Z",
    );
    await configurePause(manager, { ...pauseSettings, excludedDomains: ["private.test"] });
    clock.instant += 1800000;
    clock.fire();
    await tick();
    await tick();
    expect(await readPause(manager)).toMatchObject({
      paused: false,
      excludedDomains: ["private.test"],
    });
    expect((await readPause(manager)).pauseResumeAt).toBeUndefined();
    const native = helper.frames.filter(
      (frame) =>
        frame.request.method === "activity.observe" || frame.request.method === "activity.capture",
    );
    expect(native.length).toBeGreaterThan(0);
    for (const frame of native) {
      expect(frame.request).not.toHaveProperty("settings.pauseResumeAt");
      expect(frame.request).not.toHaveProperty("settings.pauseResumeError");
    }
  });
  it("cancels replaced/manual/disabled/disposed callbacks and rearms a backwards clock once", async () => {
    const clock = new FakePauseClock();
    const { manager } = setup(200, undefined, clock);
    await configurePause(manager);
    await manager.request(thread, { method: "history.pause", action: "1h" }, renderer);
    const stale = [...clock.callbacks.values()][0]!.callback;
    expect([...clock.callbacks.values()][0]!.delay).toBe(3600000);
    await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
    stale();
    expect((await readPause(manager)).paused).toBe(true);
    clock.instant -= 60000;
    clock.fire();
    expect(clock.callbacks.size).toBe(1);
    expect([...clock.callbacks.values()][0]!.delay).toBe(1860000);
    await manager.request(thread, { method: "history.pause", action: "indefinite" }, renderer);
    expect(clock.callbacks.size).toBe(0);
    expect((await readPause(manager)).pauseResumeAt).toBeUndefined();
    await manager.request(thread, { method: "history.pause", action: "1h" }, renderer);
    await manager.request(thread, { method: "history.pause", action: "resume" }, renderer);
    expect(clock.callbacks.size).toBe(0);
    await manager.request(thread, { method: "history.pause", action: "1h" }, renderer);
    await configurePause(manager, { ...pauseSettings, enabled: false });
    stale();
    expect((await readPause(manager)).enabled).toBe(false);
    await configurePause(manager);
    await manager.request(thread, { method: "history.pause", action: "1h" }, renderer);
    await manager.dispose();
    expect(clock.callbacks.size).toBe(0);
  });
  it("reconciles future and expired persisted state before starting any capture", async () => {
    for (const remaining of [1800000, -1]) {
      const clock = new FakePauseClock();
      const deadline = new Date(clock.instant + remaining).toISOString();
      const { manager, helper } = setup(
        200,
        (directory) =>
          writeFileSync(
            join(directory, "operations.json"),
            JSON.stringify({
              version: 1,
              settings: pauseSettings,
              pauseResumeAt: deadline,
              events: [],
            }),
          ),
        clock,
      );
      await manager.start();
      await tick();
      await tick();
      expect((await readPause(manager)).paused).toBe(remaining > 0);
      expect(clock.callbacks.size).toBe(remaining > 0 ? 1 : 0);
      if (remaining > 0)
        expect(
          helper.frames.filter((frame) => frame.request.method === "activity.capture"),
        ).toHaveLength(0);
      await manager.dispose();
    }
  });
  it("keeps failed automatic persistence stopped with fixed failure readback and human recovery", async () => {
    const clock = new FakePauseClock();
    const { manager, helper, dir } = setup(200, undefined, clock);
    await configurePause(manager);
    await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
    await tick();
    rmSync(join(dir, "operations.json"));
    mkdirSync(join(dir, "operations.json"));
    const before = helper.frames.length;
    clock.instant += 1800000;
    clock.fire();
    await tick();
    await tick();
    expect(await readPause(manager)).toMatchObject({
      paused: true,
      pauseResumeError: "resume-failed",
    });
    expect((await readPause(manager)).pauseResumeAt).toBeUndefined();
    expect(clock.callbacks.size).toBe(0);
    expect(
      helper.frames
        .slice(before)
        .some(
          (frame) =>
            frame.request.method === "activity.observe" &&
            frame.request.settings.interactionCaptureEnabled,
        ),
    ).toBe(false);
    rmSync(join(dir, "operations.json"), { recursive: true });
    await configurePause(manager);
    expect((await readPause(manager)).pauseResumeError).toBeUndefined();
  });
  it("human global Stop cancels pending resume while thread Stop leaves human preferences alone", async () => {
    const clock = new FakePauseClock();
    const { manager } = setup(200, undefined, clock);
    await configurePause(manager);
    await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
    await manager.stopThread(thread);
    expect(clock.callbacks.size).toBe(1);
    const stale = [...clock.callbacks.values()][0]!.callback;
    expect(await manager.request(thread, { method: "stop" }, renderer)).toMatchObject({
      result: { stoppedSessionIds: [] },
    });
    expect(await readPause(manager)).toMatchObject({ paused: true });
    expect((await readPause(manager)).pauseResumeAt).toBeUndefined();
    expect(clock.callbacks.size).toBe(0);
    clock.instant += 1800000;
    stale();
    expect((await readPause(manager)).paused).toBe(true);
  });
});

describe("pause failure fencing", () => {
  it("reports paused after committed automatic resume apply and rollback persistence both fail", async () => {
    const clock = new FakePauseClock();
    const { manager, helper, dir } = setup(200, undefined, clock);
    await configurePause(manager);
    await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
    const original = ComputerActivityRecorder.prototype.configure;
    const failure = vi
      .spyOn(ComputerActivityRecorder.prototype, "configure")
      .mockImplementation(function (this: ComputerActivityRecorder, settings) {
        original.call(this, settings);
        rmSync(join(dir, "operations.json"));
        mkdirSync(join(dir, "operations.json"));
        throw new Error("Synthetic policy apply failure after commit");
      });
    try {
      clock.instant += 1800000;
      clock.fire();
      await tick();
      await tick();
      expect(await readPause(manager)).toMatchObject({
        enabled: true,
        paused: true,
        pauseResumeError: "resume-failed",
      });
      expect(clock.callbacks.size).toBe(0);
      expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
        result: { interactionStatus: { state: "inactive" } },
      });
      expect(
        helper.frames.some(
          (frame) =>
            frame.request.method === "activity.observe" &&
            frame.request.settings.interactionCaptureEnabled,
        ),
      ).toBe(false);
    } finally {
      failure.mockRestore();
      rmSync(join(dir, "operations.json"), { recursive: true });
    }
  });
  it("finishes native owner Stop even if indefinite-pause persistence fails", async () => {
    const clock = new FakePauseClock();
    const { manager, helper, dir } = setup(200, undefined, clock);
    const sessionId = await open(manager);
    await configurePause(manager);
    await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
    renameSync(join(dir, "operations.json"), join(dir, "saved-before-stop.json"));
    mkdirSync(join(dir, "operations.json"));
    try {
      expect(await manager.request(thread, { method: "stop" }, renderer)).toMatchObject({
        result: { stoppedSessionIds: [sessionId] },
      });
      expect(
        helper.frames.some((frame) => frame.threadId === thread && frame.request.method === "stop"),
      ).toBe(true);
      expect(clock.callbacks.size).toBe(0);
      expect(await readPause(manager)).toMatchObject({
        paused: true,
        pauseResumeError: "resume-failed",
      });
      expect((await readPause(manager)).pauseResumeAt).toBeUndefined();
    } finally {
      rmSync(join(dir, "operations.json"), { recursive: true });
      renameSync(join(dir, "saved-before-stop.json"), join(dir, "operations.json"));
    }
    // Failed disk replacement cannot promise durable cancellation across restart.
    expect(new ComputerUseHistory(dir).getState().pauseResumeAt).toBe("2026-10-28T12:30:00.000Z");
  });
});

it("keeps the failure latch closed when recorder start throws after policy commit", async () => {
  const clock = new FakePauseClock();
  const { manager, helper } = setup(200, undefined, clock);
  await configurePause(manager);
  await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
  const start = vi.spyOn(ComputerActivityRecorder.prototype, "start").mockImplementationOnce(() => {
    throw new Error("Synthetic late start failure");
  });
  try {
    clock.instant += 1800000;
    clock.fire();
    await tick();
    await tick();
    expect(await readPause(manager)).toMatchObject({
      paused: true,
      pauseResumeError: "resume-failed",
    });
    expect(
      helper.frames.some(
        (frame) =>
          frame.request.method === "activity.observe" &&
          frame.request.settings.interactionCaptureEnabled,
      ),
    ).toBe(false);
    // An unrelated clear refresh must not reopen observation under the failed policy.
    await manager.request(thread, { method: "activity.clear" }, renderer);
    await tick();
    await tick();
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
      result: { interactionStatus: { state: "inactive" } },
    });
    expect(clock.callbacks.size).toBe(0);
    await expect(manager.start()).rejects.toThrow("History policy requires human recovery");
  } finally {
    start.mockRestore();
  }
});

it("fails expired startup before any capture when resume persistence fails", async () => {
  const clock = new FakePauseClock();
  const deadline = "2026-10-28T11:59:59.000Z";
  const { manager, helper, dir, launches } = setup(
    200,
    (directory) =>
      writeFileSync(
        join(directory, "operations.json"),
        JSON.stringify({
          version: 1,
          settings: pauseSettings,
          pauseResumeAt: deadline,
          events: [],
        }),
      ),
    clock,
  );
  rmSync(join(dir, "operations.json"));
  mkdirSync(join(dir, "operations.json"));
  try {
    await expect(manager.start()).rejects.toThrow();
    expect(launches()).toBe(0);
    expect(helper.frames).toEqual([]);
    expect(clock.callbacks.size).toBe(0);
    expect(await readPause(manager)).toMatchObject({
      paused: true,
      pauseResumeError: "resume-failed",
    });
  } finally {
    rmSync(join(dir, "operations.json"), { recursive: true });
  }
});

it("preserves stopped truthful state after a human policy apply failure and recovers explicitly", async () => {
  const clock = new FakePauseClock();
  const { manager, helper } = setup(200, undefined, clock);
  const policy = { ...pauseSettings, paused: false, semanticSummariesEnabled: true };
  await configurePause(manager, policy);
  await tick();
  await tick();
  const count = helper.frames.length;
  // This passes the public schema but fails real recorder domain-policy validation after commit.
  expect(
    await configurePause(manager, {
      ...policy,
      excludedDomains: ["https://invalid.test/"],
    }),
  ).toMatchObject({ error: { code: "internal" } });
  await tick();
  await tick();
  expect((await readPause(manager)).paused).toBe(true);
  expect(
    helper.frames
      .slice(count)
      .some(
        (frame) =>
          frame.request.method === "activity.observe" &&
          frame.request.settings.interactionCaptureEnabled,
      ),
  ).toBe(false);
  expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
    result: {
      semanticStatus: { enabled: false, running: false },
      interactionStatus: { state: "inactive" },
    },
  });
  await configurePause(manager, policy);
  await tick();
  await tick();
  expect((await readPause(manager)).paused).toBe(false);
  expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
    result: { interactionStatus: { state: "observing" } },
  });
});

// Restored preferences must never grant unsupported platforms native capture authority.
describe("persisted pause platform boundary", () => {
  it.each([
    ["win32", 1_800_000],
    ["win32", -1],
    ["linux", 1_800_000],
    ["linux", -1],
  ] as const)(
    "keeps %s stopped after startup and timer advancement (remaining %i)",
    async (platform, remaining) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const clock = new FakePauseClock();
      const { manager, helper, launches } = setup(
        200,
        (directory) =>
          writeFileSync(
            join(directory, "operations.json"),
            JSON.stringify({
              version: 1,
              settings: { ...pauseSettings, intervalSeconds: 5 },
              pauseResumeAt: new Date(clock.instant + remaining).toISOString(),
              events: [],
            }),
          ),
        clock,
        platform,
      );
      try {
        await manager.start();
        clock.instant += 1_800_000;
        // Drive any incorrectly armed automatic callback rather than assuming it is absent.
        if (clock.callbacks.size) clock.fire();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(launches()).toBe(0);
        expect(
          helper.frames.filter((frame) => frame.request.method === "activity.capture"),
        ).toEqual([]);
        expect(clock.callbacks.size).toBe(0);
        expect((await readPause(manager)).paused).toBe(true);
      } finally {
        await manager.dispose();
        vi.useRealTimers();
      }
    },
  );

  it.each([1_800_000, -1])(
    "preserves macOS expiry capture after restored startup (remaining %i)",
    async (remaining) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const clock = new FakePauseClock();
      const { manager, helper, launches } = setup(
        200,
        (directory) =>
          writeFileSync(
            join(directory, "operations.json"),
            JSON.stringify({
              version: 1,
              settings: { ...pauseSettings, intervalSeconds: 5 },
              pauseResumeAt: new Date(clock.instant + remaining).toISOString(),
              events: [],
            }),
          ),
        clock,
        "darwin",
      );
      try {
        await manager.start();
        expect((await readPause(manager)).paused).toBe(remaining > 0);
        if (remaining > 0) {
          expect(launches()).toBe(0);
          clock.instant += remaining;
          clock.fire();
        }
        await vi.advanceTimersByTimeAsync(5_000);
        expect(launches()).toBe(1);
        expect(helper.frames.some((frame) => frame.request.method === "activity.capture")).toBe(
          true,
        );
        expect((await readPause(manager)).paused).toBe(false);
        expect((await readPause(manager)).pauseResumeAt).toBeUndefined();
      } finally {
        await manager.dispose();
        vi.useRealTimers();
      }
    },
  );
});

describe("pending activity clear recovery", () => {
  it("withholds passive reads after a raw commit and semantic failure until an authorized retry", async () => {
    const { manager, dir } = setup();
    const semantic = join(dir, "activity", "semantic");
    renameSync(semantic, `${semantic}-moved`);
    try {
      expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
        "error",
      );
      expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
        "error",
      );
      expect(
        JSON.parse(readFileSync(join(dir, "operations.json"), "utf8")).pendingActivityClear,
      ).toEqual({});
    } finally {
      renameSync(`${semantic}-moved`, semantic);
    }
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
      "error",
    );
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toEqual({
      method: "activity.clear",
      result: { deletedCount: 0 },
    });
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
      "result",
    );
  });
});

function seedRecoveryStores(directory: string) {
  const history = new ComputerUseHistory(directory);
  history.configure({ ...history.getSettings(), enabled: true, semanticSummariesEnabled: true });
  const rawDirectory = join(directory, "activity");
  mkdirSync(rawDirectory, { recursive: true });
  const evidence = {
    id: "synthetic-clear-source",
    capturedAt: "2026-10-28T12:01:00.000Z",
    target,
    appName: "Synthetic fixture",
    windowTitle: "Synthetic draft",
    labels: ["Synthetic draft approved"],
  };
  writeFileSync(
    join(rawDirectory, "activity.json"),
    JSON.stringify({ version: 1, snapshots: [evidence], events: [] }),
  );
  const summaries = new ComputerActivitySummaries({
    directory: join(rawDirectory, "semantic"),
    settings: history.getSettings(),
    now: () => new Date("2026-10-28T12:11:00.000Z"),
    readEvidence: () => [evidence],
  });
  const job = summaries.claim()!;
  expect(
    summaries.complete(
      job.leaseId,
      {
        title: "Synthetic draft",
        description: "The synthetic draft was approved.",
        memory: "Synthetic draft approval",
        recording: "Synthetic approval",
        citations: job.sourceIds,
        applications: job.applications,
      },
      { provider: "synthetic", model: "synthetic" },
    ),
  ).toBe(true);
}

it.each(["before-marker", "marker", "raw", "semantic", "removed"] as const)(
  "restarts safely at the committed %s interruption prefix",
  async (boundary) => {
    const { manager, dir } = setup(200, seedRecoveryStores);
    const snapshot = mkdtempSync(join(tmpdir(), "djl-clear-crash-"));
    const copyStores = () => {
      for (const path of [
        "operations.json",
        "activity/activity.json",
        "activity/semantic/semantic-summaries.json",
      ]) {
        const destination = join(snapshot, path);
        mkdirSync(join(destination, ".."), { recursive: true });
        cpSync(join(dir, path), destination);
      }
    };
    const interrupted = () => {
      copyStores();
      throw new Error("Synthetic process interruption");
    };
    let restore: () => void;
    if (boundary === "before-marker" || boundary === "marker") {
      const original = ComputerUseHistory.prototype.beginActivityClear;
      const spy = vi
        .spyOn(ComputerUseHistory.prototype, "beginActivityClear")
        .mockImplementationOnce(function (this: ComputerUseHistory, scope) {
          if (boundary === "marker") original.call(this, scope);
          interrupted();
        });
      restore = () => spy.mockRestore();
    } else if (boundary === "raw") {
      const original = ComputerActivityRecorder.prototype.clear;
      const spy = vi
        .spyOn(ComputerActivityRecorder.prototype, "clear")
        .mockImplementationOnce(function (this: ComputerActivityRecorder, scope) {
          original.call(this, scope);
          return interrupted();
        });
      restore = () => spy.mockRestore();
    } else if (boundary === "semantic") {
      const original = ComputerActivitySummaries.prototype.clear;
      const spy = vi
        .spyOn(ComputerActivitySummaries.prototype, "clear")
        .mockImplementationOnce(function (this: ComputerActivitySummaries, scope) {
          original.call(this, scope);
          return interrupted();
        });
      restore = () => spy.mockRestore();
    } else {
      const original = ComputerUseHistory.prototype.finishActivityClear;
      const spy = vi
        .spyOn(ComputerUseHistory.prototype, "finishActivityClear")
        .mockImplementationOnce(function (this: ComputerUseHistory, scope) {
          original.call(this, scope);
          interrupted();
        });
      restore = () => spy.mockRestore();
    }
    try {
      expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
        "error",
      );
    } finally {
      restore();
    }
    // The crash fixture is already captured before any graceful disposal rewrite.
    try {
      const reopened = setup(200, (directory) => cpSync(snapshot, directory, { recursive: true }));
      const held = !["before-marker", "removed"].includes(boundary);
      const read = await reopened.manager.request(thread, { method: "activity.list" }, renderer);
      expect(read).toHaveProperty(held ? "error" : "result");
      reopened.manager.resumeThread(thread, { allowActivityHistory: true });
      if (held) {
        expect(
          await reopened.manager.request(thread, { method: "activity.list" }, origin),
        ).toHaveProperty("error");
        expect(
          await reopened.manager.request(thread, { method: "activity.clear" }, origin),
        ).toMatchObject({ error: { code: "permission-denied" } });
        expect(new ComputerUseHistory(reopened.dir).getPendingActivityClear()).toEqual({});
      }
      const retry = await reopened.manager.request(thread, { method: "activity.clear" }, renderer);
      const deletedCount =
        boundary === "before-marker" || boundary === "marker" ? 2 : boundary === "raw" ? 1 : 0;
      expect(retry).toEqual({ method: "activity.clear", result: { deletedCount } });
      expect(new ComputerUseHistory(reopened.dir).getPendingActivityClear()).toBeUndefined();
      expect(
        await reopened.manager.request(thread, { method: "activity.list" }, renderer),
      ).toMatchObject({ result: { snapshots: [] } });
    } finally {
      rmSync(snapshot, { recursive: true, force: true });
    }
  },
);

it("keeps a volatile fence after marker write failure and rejects later settings until replay", async () => {
  const { manager, dir } = setup();
  const raw = vi.spyOn(ComputerActivityRecorder.prototype, "clear");
  const semantic = vi.spyOn(ComputerActivitySummaries.prototype, "clear");
  const file = join(dir, "operations.json");
  renameSync(file, `${file}-saved`);
  mkdirSync(file);
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
      "error",
    );
    expect(raw).not.toHaveBeenCalled();
    expect(semantic).not.toHaveBeenCalled();
    expect(
      await manager.request(
        thread,
        { method: "history.configure", settings: pauseSettings },
        renderer,
      ),
    ).toHaveProperty("error");
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
      "error",
    );
    expect(await manager.request(thread, { method: "history.list" }, renderer)).toHaveProperty(
      "result",
    );
  } finally {
    raw.mockRestore();
    semantic.mockRestore();
    rmSync(file, { recursive: true });
    renameSync(`${file}-saved`, file);
  }
  expect(new ComputerUseHistory(dir).getPendingActivityClear()).toBeUndefined();
  expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
    "error",
  );
  expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
    "result",
  );
});

it("orders memory fences and committed stores, rejects synchronous reentry, and refreshes after the guard", async () => {
  const { manager, dir } = setup(200, seedRecoveryStores);
  const order: string[] = [];
  const pending: Array<Promise<ComputerUseResponse>> = [];
  const originalStop = ComputerActivityRecorder.prototype.stop;
  const stop = vi
    .spyOn(ComputerActivityRecorder.prototype, "stop")
    .mockImplementation(function (this: ComputerActivityRecorder) {
      order.push("stop");
      originalStop.call(this);
    });
  const originalHold = ComputerActivitySummaries.prototype.holdActivityClear;
  const hold = vi
    .spyOn(ComputerActivitySummaries.prototype, "holdActivityClear")
    .mockImplementation(function (this: ComputerActivitySummaries) {
      order.push("hold");
      originalHold.call(this);
    });
  const originalBegin = ComputerUseHistory.prototype.beginActivityClear;
  const begin = vi
    .spyOn(ComputerUseHistory.prototype, "beginActivityClear")
    .mockImplementation(function (this: ComputerUseHistory, scope) {
      expect(order).toContain("stop");
      expect(order).toContain("hold");
      originalBegin.call(this, scope);
      order.push("marker");
    });
  const originalRaw = ComputerActivityRecorder.prototype.clear;
  const raw = vi
    .spyOn(ComputerActivityRecorder.prototype, "clear")
    .mockImplementation(function (this: ComputerActivityRecorder, scope) {
      expect(new ComputerUseHistory(dir).getPendingActivityClear()).toEqual({});
      pending.push(manager.request(thread, { method: "activity.list" }, renderer));
      pending.push(
        manager.request(thread, { method: "history.pause", action: "indefinite" }, renderer),
      );
      const count = originalRaw.call(this, scope);
      order.push("raw");
      return count;
    });
  const originalSemantic = ComputerActivitySummaries.prototype.clear;
  const semantic = vi
    .spyOn(ComputerActivitySummaries.prototype, "clear")
    .mockImplementation(function (this: ComputerActivitySummaries, scope) {
      const count = originalSemantic.call(this, scope);
      order.push("semantic");
      return count;
    });
  const originalFinish = ComputerUseHistory.prototype.finishActivityClear;
  const finish = vi
    .spyOn(ComputerUseHistory.prototype, "finishActivityClear")
    .mockImplementation(function (this: ComputerUseHistory, scope) {
      originalFinish.call(this, scope);
      order.push("removed");
    });
  const unsubscribe = manager.onEvent((event) => {
    if (event.type === "recording-changed") {
      order.push("refresh");
      expect(new ComputerUseHistory(dir).getPendingActivityClear()).toBeUndefined();
    }
  });
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toEqual({
      method: "activity.clear",
      result: { deletedCount: 2 },
    });
    expect((await Promise.all(pending)).every((response) => "error" in response)).toBe(true);
    expect(order.slice(-5)).toEqual(["marker", "raw", "semantic", "removed", "refresh"]);
  } finally {
    unsubscribe();
    stop.mockRestore();
    hold.mockRestore();
    begin.mockRestore();
    raw.mockRestore();
    semantic.mockRestore();
    finish.mockRestore();
  }
});

it("retries marker removal with residual zero while read and job polls cannot recover", async () => {
  const { manager, dir } = setup(200, seedRecoveryStores);
  const finish = vi
    .spyOn(ComputerUseHistory.prototype, "finishActivityClear")
    .mockImplementationOnce(() => {
      throw new Error("Synthetic marker removal failure");
    });
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
      "error",
    );
  } finally {
    finish.mockRestore();
  }
  expect(new ComputerUseHistory(dir).getPendingActivityClear()).toEqual({});
  expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
    "error",
  );
  expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toEqual({
    method: "activity.clear",
    result: { deletedCount: 0 },
  });
});

it("stops a live fake owner immediately during held recovery and durably cancels the pause before release", async () => {
  const clock = new FakePauseClock();
  const { manager, dir } = setup(200, undefined, clock);
  await configurePause(manager);
  await manager.request(thread, { method: "history.pause", action: "30m" }, renderer);
  const stale = [...clock.callbacks.values()][0]!.callback;
  await open(manager);
  const finish = vi
    .spyOn(ComputerUseHistory.prototype, "finishActivityClear")
    .mockImplementation(() => {
      throw new Error("Synthetic recovery failure");
    });
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
      "error",
    );
    expect(await manager.request(thread, { method: "stop" }, renderer)).toMatchObject({
      method: "stop",
      result: { stoppedSessionIds: expect.any(Array) },
    });
    clock.instant += 1_800_001;
    stale();
    expect(clock.callbacks.size).toBe(0);
    expect(new ComputerUseHistory(dir).getState().pauseResumeAt).toBeDefined();
  } finally {
    finish.mockRestore();
  }
  expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
    "result",
  );
  expect(new ComputerUseHistory(dir).getState()).toMatchObject({ paused: true });
  expect(new ComputerUseHistory(dir).getState().pauseResumeAt).toBeUndefined();
  expect(clock.callbacks.size).toBe(0);
});

it.each([1_800_000, -1])(
  "reconciles the current deadline only after held clear recovery (%s)",
  async (remaining) => {
    const clock = new FakePauseClock();
    const deadline = new Date(clock.now() + remaining).toISOString();
    const { manager, dir } = setup(
      200,
      (directory) => {
        const history = new ComputerUseHistory(directory);
        history.configure(pauseSettings, deadline);
        history.beginActivityClear({});
      },
      clock,
    );
    expect(clock.callbacks.size).toBe(0);
    expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
      "error",
    );
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
      "result",
    );
    const state = new ComputerUseHistory(dir).getState();
    expect(state.paused).toBe(remaining > 0);
    expect(state.pauseResumeAt).toBe(remaining > 0 ? deadline : undefined);
    expect(clock.callbacks.size).toBe(remaining > 0 ? 1 : 0);
  },
);

it("reports committed deletion despite later activation failure and keeps policy stopped", async () => {
  const { manager, dir } = setup(200, seedRecoveryStores);
  const start = vi.spyOn(ComputerActivityRecorder.prototype, "start").mockImplementationOnce(() => {
    throw new Error("Synthetic activation failure");
  });
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toEqual({
      method: "activity.clear",
      result: { deletedCount: 2 },
    });
  } finally {
    start.mockRestore();
  }
  expect(new ComputerUseHistory(dir).getPendingActivityClear()).toBeUndefined();
  expect(await manager.request(thread, { method: "history.settings" }, renderer)).toMatchObject({
    result: { paused: true },
  });
  expect(await manager.request(thread, { method: "activity.list" }, renderer)).toMatchObject({
    result: { snapshots: [] },
  });
});

it("rejects startup replay before endpoint creation and permits a later authorized control retry", async () => {
  const { manager, launches } = setup(200, (directory) => {
    const history = new ComputerUseHistory(directory);
    history.beginActivityClear({});
  });
  const clear = vi.spyOn(ComputerActivityRecorder.prototype, "clear").mockImplementationOnce(() => {
    throw new Error("Synthetic raw failure");
  });
  try {
    await expect(manager.start()).rejects.toThrow("Synthetic raw failure");
  } finally {
    clear.mockRestore();
  }
  expect(launches()).toBe(0);
  expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
    "error",
  );
  expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
    "result",
  );
});

it("keeps marker and invalid leases on disposal after failed recovery", async () => {
  const { manager, dir } = setup(200, seedRecoveryStores);
  const clear = vi.spyOn(ComputerActivityRecorder.prototype, "clear").mockImplementationOnce(() => {
    throw new Error("Synthetic raw failure");
  });
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
      "error",
    );
  } finally {
    clear.mockRestore();
  }
  await manager.dispose();
  expect(new ComputerUseHistory(dir).getPendingActivityClear()).toEqual({});
  expect(await manager.request(thread, { method: "activity.list" }, renderer)).toHaveProperty(
    "error",
  );
});

it("gates authenticated summary jobs during recovery without giving polls deletion authority", async () => {
  const { manager, dir } = setup();
  const endpoint = await manager.start();
  const semantic = join(dir, "activity", "semantic");
  renameSync(semantic, `${semantic}-moved`);
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
      "error",
    );
  } finally {
    renameSync(`${semantic}-moved`, semantic);
  }
  const poll = (body: unknown, authorization = `Bearer ${endpoint.token}`) =>
    fetch(`${endpoint.url}/summary-jobs`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await poll({ operation: "claim" }, "Bearer invalid")).status).toBe(401);
  const claim = await poll({ operation: "claim" });
  expect(claim.status).toBe(503);
  for (const command of [
    { operation: "valid", leaseId: "old" },
    { operation: "fail", leaseId: "old", code: "generation-failed" },
    {
      operation: "complete",
      leaseId: "old",
      provider: "synthetic",
      model: "synthetic",
      content: {
        title: "Synthetic title",
        description: "Synthetic description",
        memory: "Synthetic memory",
        recording: "Synthetic recording",
        applications: ["org.djl.fixture"],
        citations: ["synthetic"],
      },
    },
  ]) {
    const response = await poll(command);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      operation: command.operation,
      ...(command.operation === "valid" ? { valid: false } : { accepted: false }),
    });
  }
  expect(new ComputerUseHistory(dir).getPendingActivityClear()).toEqual({});
  expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
    "result",
  );
});

it("finishes an earlier scope before a different clear and returns only the new scope count", async () => {
  const { manager, dir } = setup(200, (directory) => {
    seedRecoveryStores(directory);
    new ComputerUseHistory(directory).beginActivityClear({});
  });
  expect(
    await manager.request(thread, { method: "activity.clear", bundleId: "other.app" }, renderer),
  ).toEqual({ method: "activity.clear", result: { deletedCount: 0 } });
  expect(new ComputerUseHistory(dir).getPendingActivityClear()).toBeUndefined();
  expect(
    JSON.parse(readFileSync(join(dir, "activity", "activity.json"), "utf8")).snapshots,
  ).toEqual([]);
});

it("leaves the committed intent for the next owner when disposal interrupts raw clear", async () => {
  const { manager, dir } = setup(200, seedRecoveryStores);
  let disposal: Promise<void> | undefined;
  const original = ComputerActivityRecorder.prototype.clear;
  const raw = vi
    .spyOn(ComputerActivityRecorder.prototype, "clear")
    .mockImplementationOnce(function (this: ComputerActivityRecorder, scope) {
      const count = original.call(this, scope);
      disposal = manager.dispose();
      return count;
    });
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
      "error",
    );
    await disposal;
    expect(new ComputerUseHistory(dir).getPendingActivityClear()).toEqual({});
  } finally {
    raw.mockRestore();
  }
});

it.each(["persisted", "volatile"] as const)(
  "returns a fixed settings error for %s held clear without replaying",
  async (kind) => {
    const { manager, dir } = setup(200, (directory) => {
      const history = new ComputerUseHistory(directory);
      history.configure({ ...history.getSettings(), enabled: true, paused: false });
      if (kind === "persisted") history.beginActivityClear({});
    });
    if (kind === "volatile") {
      const file = join(dir, "operations.json");
      renameSync(file, `${file}-saved`);
      mkdirSync(file);
      try {
        expect(
          await manager.request(thread, { method: "activity.clear" }, renderer),
        ).toHaveProperty("error");
      } finally {
        rmSync(file, { recursive: true });
        renameSync(`${file}-saved`, file);
      }
    }
    const raw = vi.spyOn(ComputerActivityRecorder.prototype, "clear");
    const semantic = vi.spyOn(ComputerActivitySummaries.prototype, "clear");
    try {
      expect(await manager.request(thread, { method: "history.settings" }, renderer)).toEqual({
        method: "history.settings",
        error: {
          code: "internal",
          message:
            "History clear recovery is required. Recording and history processing are stopped.",
        },
      });
      expect(await manager.request(thread, { method: "history.list" }, renderer)).toHaveProperty(
        "result",
      );
      expect(raw).not.toHaveBeenCalled();
      expect(semantic).not.toHaveBeenCalled();
      expect(new ComputerUseHistory(dir).getPendingActivityClear()).toEqual(
        kind === "persisted" ? {} : undefined,
      );
      expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
        "result",
      );
      expect(await manager.request(thread, { method: "history.settings" }, renderer)).toMatchObject(
        {
          result: { enabled: true, paused: false },
        },
      );
    } finally {
      raw.mockRestore();
      semantic.mockRestore();
    }
  },
);

it("rejects clear from live-owner shutdown callbacks before replay or activation", async () => {
  const { manager, helper, dir } = setup();
  await manager.request(
    thread,
    { method: "history.configure", settings: { ...pauseSettings, paused: false } },
    renderer,
  );
  await open(manager);
  const finish = vi
    .spyOn(ComputerUseHistory.prototype, "finishActivityClear")
    .mockImplementationOnce(() => {
      throw new Error("Synthetic held marker");
    });
  try {
    expect(await manager.request(thread, { method: "activity.clear" }, renderer)).toHaveProperty(
      "error",
    );
  } finally {
    finish.mockRestore();
  }
  expect(new ComputerUseHistory(dir).getPendingActivityClear()).toEqual({});
  const attempts: Array<Promise<ComputerUseResponse>> = [];
  const unsubscribe = manager.onEvent((event) => {
    if (event.type === "history" || event.type === "stopped")
      attempts.push(manager.request(thread, { method: "activity.clear" }, renderer));
  });
  const start = vi.spyOn(ComputerActivityRecorder.prototype, "start");
  const raw = vi.spyOn(ComputerActivityRecorder.prototype, "clear");
  const removal = vi.spyOn(ComputerUseHistory.prototype, "finishActivityClear");
  const beforeFrames = helper.frames.length;
  try {
    await manager.dispose();
    expect(attempts.length).toBeGreaterThan(0);
    for (const response of await Promise.all(attempts)) expect(response).toHaveProperty("error");
    expect(raw).not.toHaveBeenCalled();
    expect(removal).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(new ComputerUseHistory(dir).getPendingActivityClear()).toEqual({});
    expect(helper.frames.slice(beforeFrames).some((frame) => frame.request.method === "stop")).toBe(
      true,
    );
    expect(helper.killed).toBe(true);
  } finally {
    unsubscribe();
    start.mockRestore();
    raw.mockRestore();
    removal.mockRestore();
  }
});

describe("replacement-engine isolation", () => {
  it("retains history settings while refusing the legacy actuator in Cua mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "djl-computer-manager-"));
    const helper = new FakeHelper();
    const spawnHelper = vi.fn(() => helper as unknown as ChildProcessWithoutNullStreams);
    const manager = new ComputerUseManager({
      helperPath: "/trusted/helper",
      historyDirectory: dir,
      platform: "darwin",
      controlEngine: "cua",
      spawnHelper,
    });
    resources.push({ manager, dir });
    const response = await manager.request(thread, { method: "session.open", target }, origin);
    expect(response).toMatchObject({ error: { code: "unsupported" } });
    expect(spawnHelper).not.toHaveBeenCalled();
    expect(await manager.request(thread, { method: "history.settings" }, renderer)).toMatchObject({
      method: "history.settings",
      result: { enabled: false },
    });
  });
});
