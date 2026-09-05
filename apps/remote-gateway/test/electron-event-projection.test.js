// FILE: electron-event-projection.test.js
// Purpose: Verifies backend thread events project to phone notifications without snapshots.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/electron-event-projection

const test = require("node:test");
const assert = require("node:assert/strict");
const { createThreadEventProjection } = require("../src/electron-event-projection");

const THREAD = {
  id: "thread-1",
  title: "Chat",
  runtimeMode: "approval-required",
  updatedAt: "2026-09-04T10:00:00.000Z",
  session: null,
  latestTurn: null,
  messages: [
    { id: "user-0", role: "user", text: "Hi", turnId: "turn-0", createdAt: "2026-09-04T09:59:00.000Z" },
    {
      id: "assistant-0",
      role: "assistant",
      text: "Hello",
      turnId: "turn-0",
      streaming: false,
      createdAt: "2026-09-04T09:59:01.000Z",
    },
  ],
  activities: [],
};

function threadEvent(type, payload, sequence) {
  return {
    sequence,
    eventId: `event-${sequence}`,
    aggregateKind: "thread",
    aggregateId: "thread-1",
    occurredAt: "2026-09-04T10:00:01.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  };
}

function messageSent(overrides, sequence) {
  return threadEvent(
    "thread.message-sent",
    {
      threadId: "thread-1",
      messageId: "assistant-1",
      role: "assistant",
      text: "",
      turnId: "turn-1",
      streaming: true,
      createdAt: "2026-09-04T10:00:01.000Z",
      updatedAt: "2026-09-04T10:00:01.000Z",
      ...overrides,
    },
    sequence,
  );
}

test("assistant streaming events become deltas and one completed item", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);

  const first = projection.applyThreadEvent(messageSent({ text: "Hel" }, 11));
  const second = projection.applyThreadEvent(messageSent({ text: "lo" }, 12));
  const done = projection.applyThreadEvent(messageSent({ text: "Hello", streaming: false }, 13));

  assert.deepEqual(first, [
    {
      kind: "notification",
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "Hel",
        djlEmittedAt: "2026-09-04T10:00:01.000Z",
      },
    },
  ]);
  assert.equal(second[0].params.delta, "lo");
  assert.equal(done.length, 1);
  assert.equal(done[0].method, "item/completed");
  assert.equal(done[0].params.threadId, "thread-1");
  assert.equal(done[0].params.turnId, "turn-1");
  assert.equal(done[0].params.item.id, "assistant-1");
  assert.equal(done[0].params.item.type, "agentMessage");
  assert.equal(done[0].params.item.content[0].text, "Hello");
});

test("completion text replaces tracked text when a delta was missed", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);

  projection.applyThreadEvent(messageSent({ text: "Hel" }, 11));
  const done = projection.applyThreadEvent(
    messageSent({ text: "Hello world", streaming: false }, 13),
  );

  assert.equal(done[0].params.item.content[0].text, "Hello world");
});

test("events at or below the hydrated sequence are ignored", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);

  assert.deepEqual(projection.applyThreadEvent(messageSent({ text: "old" }, 10)), []);
  assert.deepEqual(projection.applyThreadEvent(messageSent({ text: "older" }, 3)), []);
  assert.equal(projection.applyThreadEvent(messageSent({ text: "new" }, 11)).length, 1);
});

test("user messages announce once", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);
  const event = messageSent(
    { messageId: "user-1", role: "user", text: "Question", streaming: false },
    11,
  );

  const first = projection.applyThreadEvent(event);
  const again = projection.applyThreadEvent({ ...event, sequence: 12 });

  assert.deepEqual(first, [
    {
      kind: "notification",
      method: "codex/event/user_message",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "user-1", message: "Question" },
    },
  ]);
  assert.deepEqual(again, []);
});

test("session-set drives turn started and turn completed", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);
  const session = (activeTurnId, status, lastError = null) =>
    threadEvent(
      "thread.session-set",
      {
        threadId: "thread-1",
        session: {
          threadId: "thread-1",
          status,
          providerName: "opencode",
          runtimeMode: "approval-required",
          activeTurnId,
          lastError,
          updatedAt: "2026-09-04T10:00:02.000Z",
        },
      },
      status === "running" ? 11 : 12,
    );

  const started = projection.applyThreadEvent(session("turn-1", "running"));
  const completed = projection.applyThreadEvent(session(null, "ready"));

  assert.deepEqual(started, [
    {
      kind: "notification",
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        turn: { id: "turn-1", status: "inProgress" },
      },
    },
  ]);
  assert.deepEqual(completed, [
    {
      kind: "notification",
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        turn: { id: "turn-1", status: "completed" },
      },
    },
  ]);
  assert.equal(projection.activeTurnId("thread-1"), null);
});

test("session errors and interruptions map to failed and interrupted", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);
  const base = {
    threadId: "thread-1",
    providerName: "opencode",
    runtimeMode: "approval-required",
    updatedAt: "2026-09-04T10:00:02.000Z",
  };
  const sessionEvent = (session, sequence) =>
    threadEvent("thread.session-set", { threadId: "thread-1", session: { ...base, ...session } }, sequence);

  projection.applyThreadEvent(
    sessionEvent({ status: "running", activeTurnId: "turn-1", lastError: null }, 11),
  );
  const failed = projection.applyThreadEvent(
    sessionEvent({ status: "ready", activeTurnId: null, lastError: "boom" }, 12),
  );
  projection.applyThreadEvent(
    sessionEvent({ status: "running", activeTurnId: "turn-2", lastError: null }, 13),
  );
  const interrupted = projection.applyThreadEvent(
    sessionEvent({ status: "interrupted", activeTurnId: null, lastError: null }, 14),
  );

  assert.equal(failed[0].params.turn.status, "failed");
  assert.equal(interrupted[0].params.turn.status, "interrupted");
});

test("approval activities become server requests exactly once", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);
  const activity = {
    id: "activity-1",
    tone: "info",
    kind: "approval.requested",
    summary: "Run npm test",
    payload: { requestId: "req-1", requestKind: "command", detail: "npm test" },
    turnId: "turn-1",
    createdAt: "2026-09-04T10:00:03.000Z",
  };

  const first = projection.applyThreadEvent(
    threadEvent("thread.activity-appended", { threadId: "thread-1", activity }, 11),
  );
  const again = projection.applyThreadEvent(
    threadEvent("thread.activity-appended", { threadId: "thread-1", activity }, 12),
  );

  assert.equal(first.length, 1);
  assert.equal(first[0].kind, "request");
  assert.equal(first[0].method, "item/commandExecution/requestApproval");
  assert.match(first[0].id, /^djl-electron-approval-/);
  assert.deepEqual(first[0].approval, { threadId: "thread-1", requestId: "req-1" });
  assert.equal(first[0].params.command, "npm test");
  assert.equal(first[0].params.djlActionSource, "djl-electron-embedded-bridge");
  assert.deepEqual(again, []);
});

test("meta title changes rename the thread", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);

  const renamed = projection.applyThreadEvent(
    threadEvent("thread.meta-updated", { threadId: "thread-1", title: "Renamed" }, 11),
  );
  const unrelated = projection.applyThreadEvent(
    threadEvent("thread.meta-updated", { threadId: "thread-1", isPinned: true }, 12),
  );

  assert.deepEqual(renamed, [
    {
      kind: "notification",
      method: "thread/name/updated",
      params: { threadId: "thread-1", thread_id: "thread-1", name: "Renamed", title: "Renamed" },
    },
  ]);
  assert.deepEqual(unrelated, []);
});

test("shell upserts announce runtime mode changes only", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);

  const same = projection.applyShellThread({
    id: "thread-1",
    runtimeMode: "approval-required",
    updatedAt: "x",
  });
  const changed = projection.applyShellThread({
    id: "thread-1",
    runtimeMode: "full-access",
    updatedAt: "y",
  });
  const unknown = projection.applyShellThread({
    id: "thread-9",
    runtimeMode: "full-access",
    updatedAt: "y",
  });

  assert.deepEqual(same, []);
  assert.deepEqual(changed, [
    {
      kind: "notification",
      method: "djl/thread/runtimeMode/updated",
      params: { threadId: "thread-1", runtimeMode: "full-access", updatedAt: "y" },
    },
  ]);
  assert.deepEqual(unknown, []);
  assert.equal(projection.has("thread-9"), false);
});

test("events for unknown threads are ignored and forget drops state", () => {
  const projection = createThreadEventProjection();
  assert.deepEqual(projection.applyThreadEvent(messageSent({ text: "x" }, 1)), []);
  projection.hydrate(THREAD, 10);
  assert.equal(projection.has("thread-1"), true);
  projection.forget("thread-1");
  assert.equal(projection.has("thread-1"), false);
});
