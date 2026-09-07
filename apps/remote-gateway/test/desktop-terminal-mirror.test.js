"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDesktopTerminalMirror,
  splitOutputData,
  trimSnapshotHistory,
} = require("../src/desktop-terminal-mirror");

function createHarness(options = {}) {
  const requests = [];
  const emitted = [];
  let openCount = 0;
  const mirror = createDesktopTerminalMirror({
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      if (tag === "terminal.open") {
        openCount += 1;
        return {
          threadId: payload.threadId,
          terminalId: payload.terminalId,
          cwd: payload.cwd,
          status: "running",
          pid: 42,
          history: `history-${openCount}`,
          exitCode: null,
          exitSignal: null,
          updatedAt: "2026-09-04T00:00:00.000Z",
        };
      }
      return {};
    },
    emit: (method, params) => emitted.push({ method, params }),
    resolveCwd: (threadId) => (threadId === "thread-1" ? "/work/thread-1" : ""),
    ...options,
  });
  return { mirror, requests, emitted };
}

function outputEvent(data, overrides = {}) {
  return {
    threadId: "thread-1",
    terminalId: "default",
    type: "output",
    createdAt: "2026-09-04T00:00:01.000Z",
    data,
    byteLength: Buffer.byteLength(data, "utf8"),
    ...overrides,
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

test("open attaches with the thread cwd and returns the backend snapshot", async () => {
  const { mirror, requests } = createHarness();

  const result = await mirror.open({
    threadId: "thread-1",
    terminalId: "default",
    cols: 80,
    rows: 24,
  });

  assert.deepEqual(requests[0], {
    tag: "terminal.open",
    payload: {
      threadId: "thread-1",
      terminalId: "default",
      cwd: "/work/thread-1",
      cols: 80,
      rows: 24,
    },
  });
  assert.equal(result.snapshot.history, "history-1");
  assert.equal(mirror.isWatching("thread-1", "default"), true);
});

test("open without a resolvable cwd fails and leaves nothing watched", async () => {
  const { mirror, requests } = createHarness();

  await assert.rejects(() => mirror.open({ threadId: "thread-9" }), /working directory/);
  assert.equal(requests.length, 0);
  assert.equal(mirror.isWatching("thread-9", "default"), false);
});

test("events for unwatched terminals only populate the listing", async () => {
  const { mirror, emitted } = createHarness();

  mirror.handleEvent(outputEvent("hello", { terminalId: "term-b" }));

  assert.equal(emitted.length, 0);
  assert.deepEqual(mirror.list({ threadId: "thread-1" }), { terminals: ["default", "term-b"] });
});

test("watched output is forwarded and acks flow to the backend", async () => {
  const { mirror, emitted, requests } = createHarness();
  await mirror.open({ threadId: "thread-1", terminalId: "default" });

  mirror.handleEvent(outputEvent("hello"));
  await mirror.ack({ threadId: "thread-1", terminalId: "default", bytes: 5 });

  assert.deepEqual(emitted[0], {
    method: "djl/terminal/event",
    params: outputEvent("hello"),
  });
  assert.deepEqual(requests.at(-1), {
    tag: "terminal.ackOutput",
    payload: { threadId: "thread-1", terminalId: "default", bytes: 5 },
  });
});

test("large output is split into bounded chunks whose byte lengths add up", () => {
  const data = "é".repeat(10) + "😀" + "x".repeat(20);
  const chunks = splitOutputData(data, 12);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk, "utf8") <= 12);
  assert.equal(chunks.join(""), data);
  assert.equal(
    chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk, "utf8"), 0),
    Buffer.byteLength(data, "utf8"),
  );
});

test("oversized snapshot history is trimmed to its tail on a line boundary", () => {
  const snapshot = { history: "line-1\nline-2\nline-3\n", replayPreamble: "[?2004h" };

  const trimmed = trimSnapshotHistory(snapshot, 14);

  assert.equal(trimmed.history, "line-3\n");
  assert.equal(trimmed.replayPreamble, snapshot.replayPreamble);
  assert.equal(trimSnapshotHistory(snapshot, 1000), snapshot);
});

test("output past the lag limit is dropped until an ack triggers a resync", async () => {
  const { mirror, emitted, requests } = createHarness({
    lagLimitBytes: 10,
    resyncBytes: 4,
    maxOutputChunkBytes: 100,
  });
  await mirror.open({ threadId: "thread-1", terminalId: "default" });

  mirror.handleEvent(outputEvent("123456789012"));
  mirror.handleEvent(outputEvent("dropped"));
  assert.equal(emitted.length, 1);

  await mirror.ack({ threadId: "thread-1", terminalId: "default", bytes: 8 });
  await flushMicrotasks();

  const reopen = requests.filter((entry) => entry.tag === "terminal.open");
  assert.equal(reopen.length, 2);
  const started = emitted.find((entry) => entry.params.type === "started");
  assert.ok(started, "resync emits a synthetic started event");
  assert.equal(started.params.snapshot.history, "history-2");

  mirror.handleEvent(outputEvent("after"));
  assert.equal(emitted.at(-1).params.data, "after");
});

test("close only detaches the watch", async () => {
  const { mirror, emitted, requests } = createHarness();
  await mirror.open({ threadId: "thread-1", terminalId: "default" });
  const requestCount = requests.length;

  mirror.close({ threadId: "thread-1", terminalId: "default" });
  mirror.handleEvent(outputEvent("ignored"));

  assert.equal(requests.length, requestCount);
  assert.equal(emitted.length, 0);
  assert.equal(mirror.isWatching("thread-1", "default"), false);
});
