# Remote Streaming Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turns running on the DJL desktop, or started from the phone, stream to the paired iPhone token by token without full-snapshot refreshes, relay rate-limit closes, or buffered delivery.

**Architecture:** The gateway's Electron adapter projects backend thread events straight into phone notifications (a new pure module) and uses snapshots only for hydration. A new pure coalescer batches outbound notifications into one encrypted relay frame per 40 ms window. The relay budget rises, both ends treat close 4008 as transient, and the phone learns to decode JSON-RPC batch arrays.

**Tech Stack:** Node 22 (`node --test`) for `apps/remote-gateway`; Vitest for `apps/remote-relay`; Swift/XCTest via `xcodebuild` for `apps/ios`. Spec: `docs/superpowers/specs/2026-09-04-remote-streaming-latency-design.md`.

## Global Constraints

- Coalescing window: 40 ms. Worst case 25 frames/s per direction.
- Relay budget: `DEFAULT_MESSAGES_PER_WINDOW` becomes 600 per 10 s.
- Phone-started turns dispatch `thread.turn.start` with `assistantDeliveryMode: "streaming"`.
- A single pending notification is sent as a plain JSON object, never a one-element array.
- Responses (`id` present) and server requests (`id` and `method`) are never held in the window.
- Backend event field for time is `occurredAt`; forward it as `djlEmittedAt`.
- No new dependencies.
- Gateway tests run with `bun run --cwd apps/remote-gateway test` (or `node --test ./test/<file>` inside `apps/remote-gateway`). Relay tests: `bun run --cwd apps/remote-relay test`. iOS tests: the `xcodebuild test` command in Task 7.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/remote-gateway/src/electron-event-projection.js` (new) | Pure: backend thread/shell events in, phone notifications and per-thread state out. |
| `apps/remote-gateway/src/electron-app-server-adapter.js` | Wires the projection into subscriptions; snapshots only for hydration; streaming delivery mode on turn start. |
| `apps/remote-gateway/src/outbound-coalescer.js` (new) | Pure: buffers notification payload texts for one window, merges deltas, emits batch text. |
| `apps/remote-gateway/src/secure-transport.js` | Routes outbound payloads through the coalescer before the replay buffer. |
| `apps/remote-gateway/src/relay-reconnect-policy.js` (new) | Pure: reconnect delay from close code and attempt. |
| `apps/remote-gateway/src/bridge.js` | Uses the reconnect policy; flushes the coalescer on shutdown. |
| `apps/remote-relay/src/policy.ts` | Budget constant. |
| `apps/ios/DJL/Services/CodexService+Incoming.swift` | Batch array decoding. |
| `apps/ios/DJL/Services/CodexService+Connection.swift` | 4008 as transient. |
| `apps/ios/DJL/Services/CodexService+IncomingAssistant.swift` | Latency debug log. |

---

### Task 1: Pure event projection module

**Files:**
- Create: `apps/remote-gateway/src/electron-event-projection.js`
- Test: `apps/remote-gateway/test/electron-event-projection.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `createThreadEventProjection()` returning `{ hydrate(thread, snapshotSequence), applyThreadEvent(event), applyShellThread(threadShell), has(threadId), forget(threadId), activeTurnId(threadId) }`. `applyThreadEvent` and `applyShellThread` return an array of output records: `{ kind: "notification", method, params }` or `{ kind: "request", id, method, params, approval: { threadId, requestId } }`. `hydrate` records the thread's messages, activity ids, active turn, runtime mode, and sets `lastAppliedSequence` to `snapshotSequence`. Also exported: `appServerMessageItem(message)` and `approvalMethodFor(kind)` are re-used from the adapter and must stay exported there.

- [ ] **Step 1: Write the failing test file**

```js
// FILE: electron-event-projection.test.js
// Purpose: Verifies backend thread events project to phone notifications without snapshots.
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
    { id: "assistant-0", role: "assistant", text: "Hello", turnId: "turn-0", streaming: false, createdAt: "2026-09-04T09:59:01.000Z" },
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
  const done = projection.applyThreadEvent(
    messageSent({ text: "Hello", streaming: false }, 13),
  );

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
      params: { threadId: "thread-1", turnId: "turn-1", turn: { id: "turn-1", status: "inProgress" } },
    },
  ]);
  assert.deepEqual(completed, [
    {
      kind: "notification",
      method: "turn/completed",
      params: { threadId: "thread-1", turnId: "turn-1", turn: { id: "turn-1", status: "completed" } },
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
  projection.applyThreadEvent(
    threadEvent("thread.session-set", { threadId: "thread-1", session: { ...base, status: "running", activeTurnId: "turn-1", lastError: null } }, 11),
  );
  const failed = projection.applyThreadEvent(
    threadEvent("thread.session-set", { threadId: "thread-1", session: { ...base, status: "ready", activeTurnId: null, lastError: "boom" } }, 12),
  );
  projection.applyThreadEvent(
    threadEvent("thread.session-set", { threadId: "thread-1", session: { ...base, status: "running", activeTurnId: "turn-2", lastError: null } }, 13),
  );
  const interrupted = projection.applyThreadEvent(
    threadEvent("thread.session-set", { threadId: "thread-1", session: { ...base, status: "interrupted", activeTurnId: null, lastError: null } }, 14),
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

  const same = projection.applyShellThread({ id: "thread-1", runtimeMode: "approval-required", updatedAt: "x" });
  const changed = projection.applyShellThread({ id: "thread-1", runtimeMode: "full-access", updatedAt: "y" });
  const unknown = projection.applyShellThread({ id: "thread-9", runtimeMode: "full-access", updatedAt: "y" });

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/remote-gateway && node --test ./test/electron-event-projection.test.js`
Expected: FAIL with `Cannot find module '../src/electron-event-projection'`.

- [ ] **Step 3: Write the module**

```js
// FILE: electron-event-projection.js
// Purpose: Projects DJL Electron orchestration thread/shell events into phone app-server notifications.
// Layer: CLI helper
// Exports: createThreadEventProjection
// Depends on: crypto

const { createHash } = require("crypto");

const RUNTIME_MODES = new Set([
  "approval-required",
  "accept-edits",
  "auto-approval",
  "full-access",
]);

// One projection instance tracks every subscribed thread. State is keyed by
// thread id and rebuilt from a detail snapshot on hydrate; events after the
// snapshot sequence mutate it and yield phone notifications.
function createThreadEventProjection() {
  const states = new Map();

  function hydrate(thread, snapshotSequence) {
    const threadId = stringValue(thread?.id);
    if (!threadId) return;
    states.set(threadId, {
      lastAppliedSequence: normalizeSequence(snapshotSequence) ?? -1,
      activeTurnId: stringValue(thread.session?.activeTurnId) || null,
      runtimeMode: normalizeRuntimeMode(thread.runtimeMode),
      title: stringValue(thread.title),
      messages: new Map(
        (thread.messages || []).map((message) => [
          message.id,
          {
            text: message.text || "",
            streaming: message.streaming === true,
            turnId: stringValue(message.turnId) || null,
            createdAt: stringValue(message.createdAt),
          },
        ]),
      ),
      activityIds: new Set((thread.activities || []).map((activity) => activity.id)),
    });
  }

  function applyThreadEvent(event) {
    const threadId = stringValue(event?.aggregateId) || stringValue(event?.payload?.threadId);
    const state = states.get(threadId);
    if (!state) return [];
    const sequence = normalizeSequence(event.sequence);
    if (sequence == null || sequence <= state.lastAppliedSequence) return [];
    state.lastAppliedSequence = sequence;

    switch (event.type) {
      case "thread.message-sent":
        return projectMessageSent(threadId, state, event);
      case "thread.session-set":
        return projectSessionSet(threadId, state, event);
      case "thread.activity-appended":
        return projectActivity(threadId, state, event);
      case "thread.meta-updated":
        return projectMeta(threadId, state, event);
      default:
        return [];
    }
  }

  function applyShellThread(threadShell) {
    const threadId = stringValue(threadShell?.id);
    const state = states.get(threadId);
    if (!state) return [];
    const runtimeMode = normalizeRuntimeMode(threadShell.runtimeMode);
    if (!runtimeMode || runtimeMode === state.runtimeMode) return [];
    state.runtimeMode = runtimeMode;
    return [
      notification("djl/thread/runtimeMode/updated", {
        threadId,
        runtimeMode,
        ...(stringValue(threadShell.updatedAt) ? { updatedAt: threadShell.updatedAt } : {}),
      }),
    ];
  }

  return {
    hydrate,
    applyThreadEvent,
    applyShellThread,
    has: (threadId) => states.has(threadId),
    forget: (threadId) => {
      states.delete(threadId);
    },
    activeTurnId: (threadId) => states.get(threadId)?.activeTurnId ?? null,
  };
}

function projectMessageSent(threadId, state, event) {
  const payload = event.payload || {};
  const messageId = stringValue(payload.messageId);
  if (!messageId) return [];
  const turnId = stringValue(payload.turnId) || state.activeTurnId;
  const previous = state.messages.get(messageId);

  if (payload.role === "user") {
    if (previous) return [];
    state.messages.set(messageId, {
      text: payload.text || "",
      streaming: false,
      turnId,
      createdAt: stringValue(payload.createdAt),
    });
    return [
      notification("codex/event/user_message", {
        threadId,
        turnId,
        itemId: messageId,
        message: payload.text || "",
      }),
    ];
  }

  if (payload.role !== "assistant") return [];
  const createdAt = previous?.createdAt || stringValue(payload.createdAt);

  if (payload.streaming === true) {
    const delta = payload.text || "";
    state.messages.set(messageId, {
      text: (previous?.text || "") + delta,
      streaming: true,
      turnId,
      createdAt,
    });
    if (!delta) return [];
    return [
      notification("item/agentMessage/delta", {
        threadId,
        turnId,
        itemId: messageId,
        delta,
        djlEmittedAt: stringValue(event.occurredAt),
      }),
    ];
  }

  const text = typeof payload.text === "string" ? payload.text : previous?.text || "";
  state.messages.set(messageId, { text, streaming: false, turnId, createdAt });
  return [
    notification("item/completed", {
      threadId,
      turnId,
      item: {
        id: messageId,
        type: "agentMessage",
        role: "assistant",
        content: [{ type: "outputText", text }],
        createdAt,
      },
    }),
  ];
}

function projectSessionSet(threadId, state, event) {
  const session = event.payload?.session || {};
  const nextTurnId = stringValue(session.activeTurnId) || null;
  const previousTurnId = state.activeTurnId;
  state.activeTurnId = nextTurnId;
  if (nextTurnId && nextTurnId !== previousTurnId) {
    return [
      notification("turn/started", {
        threadId,
        turnId: nextTurnId,
        turn: { id: nextTurnId, status: "inProgress" },
      }),
    ];
  }
  if (!nextTurnId && previousTurnId) {
    const status = session.lastError
      ? "failed"
      : session.status === "interrupted"
        ? "interrupted"
        : "completed";
    return [
      notification("turn/completed", {
        threadId,
        turnId: previousTurnId,
        turn: { id: previousTurnId, status },
      }),
    ];
  }
  return [];
}

function projectActivity(threadId, state, event) {
  const activity = event.payload?.activity;
  const activityId = stringValue(activity?.id);
  if (!activityId || state.activityIds.has(activityId)) return [];
  state.activityIds.add(activityId);
  if (activity.kind !== "approval.requested") return [];
  const requestId = stringValue(activity.payload?.requestId);
  if (!requestId) return [];
  const detail = stringValue(activity.payload?.detail) || stringValue(activity.summary);
  return [
    {
      kind: "request",
      id: stableEntityId("djl-electron-approval", `${threadId}|${requestId}`),
      method: approvalMethodFor(activity.payload?.requestKind),
      params: {
        threadId,
        turnId: stringValue(activity.turnId) || state.activeTurnId,
        itemId: activityId,
        command: detail,
        reason: detail,
        djlActionSource: "djl-electron-embedded-bridge",
      },
      approval: { threadId, requestId },
    },
  ];
}

function projectMeta(threadId, state, event) {
  const title = stringValue(event.payload?.title);
  if (!title || title === state.title) return [];
  state.title = title;
  return [
    notification("thread/name/updated", {
      threadId,
      thread_id: threadId,
      name: title,
      title,
    }),
  ];
}

function notification(method, params) {
  return { kind: "notification", method, params };
}

function approvalMethodFor(kind) {
  return kind === "file-change"
    ? "item/fileChange/requestApproval"
    : "item/commandExecution/requestApproval";
}

function stableEntityId(prefix, identity) {
  const digest = createHash("sha256").update(String(identity)).digest("hex").slice(0, 32);
  return `${prefix}-${digest}`;
}

function normalizeRuntimeMode(value) {
  const normalized = stringValue(value);
  return RUNTIME_MODES.has(normalized) ? normalized : null;
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = { createThreadEventProjection };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/remote-gateway && node --test ./test/electron-event-projection.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/remote-gateway/src/electron-event-projection.js apps/remote-gateway/test/electron-event-projection.test.js
git commit -m "feat(remote-gateway): project Electron thread events without snapshots

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Wire the projection into the Electron adapter

**Files:**
- Modify: `apps/remote-gateway/src/electron-app-server-adapter.js` (the `createElectronAppServerTransport` closure: `refreshSnapshot`, `subscribeToThread`, `refreshThread`, `reconcileStartedTurn`, `applyThreadSnapshot`, `startTurn`, `readSnapshot`, shell subscription in `rpc.onStarted`)
- Test: `apps/remote-gateway/test/electron-app-server-adapter.test.js`

**Interfaces:**
- Consumes: `createThreadEventProjection` from Task 1.
- Produces: the adapter emits the same notification methods as before; `getSnapshot` is not called while a turn streams; `thread.turn.start` commands include `assistantDeliveryMode: "streaming"`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/remote-gateway/test/electron-app-server-adapter.test.js`:

```js
// Backend fake that records requests and lets a test push subscription chunks.
function createStreamingBackend(initialSnapshot) {
  const requests = [];
  const threadSubscribers = new Map();
  let shellSubscriber = null;
  let startedHandler = null;
  const backend = {
    onStarted(handler) {
      startedHandler = handler;
    },
    onError() {},
    onClose() {},
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      return initialSnapshot;
    },
    subscribe(tag, payload, handlers) {
      if (tag === "orchestration.subscribeShell") {
        shellSubscriber = handlers;
        return () => {
          shellSubscriber = null;
        };
      }
      threadSubscribers.set(payload.threadId, handlers);
      return () => {
        threadSubscribers.delete(payload.threadId);
      };
    },
    shutdown() {},
  };
  return {
    backend,
    requests,
    start: () => startedHandler?.(),
    pushThread: (threadId, values) => threadSubscribers.get(threadId)?.onChunk(values),
    failThread: (threadId) => threadSubscribers.get(threadId)?.onError?.(new Error("dropped")),
    pushShell: (values) => shellSubscriber?.onChunk(values),
    subscribedThreadIds: () => Array.from(threadSubscribers.keys()),
  };
}

function detailSnapshotChunk(thread, snapshotSequence) {
  return { kind: "snapshot", snapshot: { snapshotSequence, thread } };
}

function assistantEvent(sequence, text, streaming) {
  return {
    kind: "event",
    event: {
      sequence,
      eventId: `event-${sequence}`,
      aggregateKind: "thread",
      aggregateId: "electron-thread",
      occurredAt: "2026-07-19T12:02:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.message-sent",
      payload: {
        threadId: "electron-thread",
        messageId: "assistant-2",
        role: "assistant",
        text,
        turnId: "turn-2",
        streaming,
        createdAt: "2026-07-19T12:02:00.000Z",
        updatedAt: "2026-07-19T12:02:00.000Z",
      },
    },
  };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Electron adapter streams deltas from thread events without snapshot refreshes", async () => {
  const fake = createStreamingBackend(snapshot);
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend: fake.backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

  fake.start();
  await flushMicrotasks();
  fake.pushShell([{ kind: "snapshot", snapshot: { snapshotSequence: 5, projects: [], threads: [{ id: "electron-thread", runtimeMode: "approval-required" }], updatedAt: "x" } }]);
  fake.pushThread("electron-thread", [detailSnapshotChunk(snapshot.threads[0], 5)]);
  const snapshotCallsBefore = fake.requests.filter((r) => r.tag === "orchestration.getSnapshot").length;

  fake.pushThread("electron-thread", [assistantEvent(6, "Hel", true), assistantEvent(7, "lo", true)]);
  fake.pushThread("electron-thread", [assistantEvent(8, "Hello", false)]);
  await flushMicrotasks();

  const deltas = outbound.filter((m) => m.method === "item/agentMessage/delta");
  assert.deepEqual(deltas.map((m) => m.params.delta), ["Hel", "lo"]);
  assert.equal(deltas[0].params.itemId, "assistant-2");
  assert.equal(deltas[0].params.djlEmittedAt, "2026-07-19T12:02:00.000Z");
  const completed = outbound.filter((m) => m.method === "item/completed");
  assert.equal(completed.length, 1);
  assert.equal(completed[0].params.item.content[0].text, "Hello");
  const snapshotCallsAfter = fake.requests.filter((r) => r.tag === "orchestration.getSnapshot").length;
  assert.equal(snapshotCallsAfter, snapshotCallsBefore, "streaming must not call getSnapshot");
  transport.shutdown();
});

test("Electron adapter re-hydrates a thread after its stream fails", async () => {
  const fake = createStreamingBackend(snapshot);
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend: fake.backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));
  fake.start();
  await flushMicrotasks();
  fake.pushThread("electron-thread", [detailSnapshotChunk(snapshot.threads[0], 5)]);

  fake.failThread("electron-thread");
  await flushMicrotasks();

  assert.deepEqual(fake.subscribedThreadIds(), ["electron-thread"]);
  const resumed = structuredClone(snapshot.threads[0]);
  resumed.session = { activeTurnId: "turn-3" };
  fake.pushThread("electron-thread", [detailSnapshotChunk(resumed, 9)]);
  assert.equal(outbound.filter((m) => m.method === "turn/started").at(-1)?.params.turnId, "turn-3");
  transport.shutdown();
});

test("Electron adapter subscribes to threads announced on the shell stream", async () => {
  const fake = createStreamingBackend(snapshot);
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend: fake.backend,
  });
  fake.start();
  await flushMicrotasks();

  fake.pushShell([{ kind: "thread-upserted", sequence: 6, thread: { id: "brand-new", runtimeMode: "full-access" } }]);
  assert.ok(fake.subscribedThreadIds().includes("brand-new"));
  fake.pushShell([{ kind: "thread-removed", sequence: 7, threadId: "brand-new" }]);
  assert.ok(!fake.subscribedThreadIds().includes("brand-new"));
  transport.shutdown();
});

test("Electron adapter asks for streaming delivery on phone-started turns", async () => {
  const fake = createStreamingBackend(snapshot);
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend: fake.backend,
  });

  transport.send(
    JSON.stringify({
      id: "ios-streaming-turn",
      method: "turn/start",
      params: { threadId: "electron-thread", input: [{ type: "text", text: "Stream please" }] },
    }),
  );
  await flushMicrotasks();

  const dispatched = fake.requests.find((r) => r.tag === "orchestration.dispatchCommand");
  assert.equal(dispatched.payload.assistantDeliveryMode, "streaming");
  transport.shutdown();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/remote-gateway && node --test ./test/electron-app-server-adapter.test.js`
Expected: the four new tests FAIL (delta list empty, `assistantDeliveryMode` undefined, shell subscribe missing).

- [ ] **Step 3: Rewrite the live path in the adapter**

In `apps/remote-gateway/src/electron-app-server-adapter.js`:

Add the import after the existing requires:

```js
const { createThreadEventProjection } = require("./electron-event-projection");
```

Inside `createElectronAppServerTransport`, after `const threadStates = new Map();` add:

```js
  const projection = createThreadEventProjection();
```

Replace the `rpc.onStarted(...)` block, `refreshSnapshot`, `subscribeToThread`, and `refreshThread` with:

```js
  rpc.onStarted(() => {
    if (stopped) return;
    listeners.emitStarted({
      mode: "djl-electron",
      launchDescription: "DJL Electron embedded backend",
    });
    void hydrateFromSnapshot();
    if (!shellUnsubscribe) {
      shellUnsubscribe = rpc.subscribe(
        ORCHESTRATION.subscribeShell,
        {},
        {
          onChunk(values) {
            for (const value of values) handleShellItem(value);
          },
          onEnd() {
            shellUnsubscribe = null;
          },
          onError() {
            shellUnsubscribe = null;
          },
        },
      );
    }
  });

  // One full snapshot per backend (re)start: it seeds the thread list and the
  // per-thread subscriptions. Everything after that arrives as events.
  async function hydrateFromSnapshot() {
    if (stopped) return;
    let snapshot;
    try {
      snapshot = await rpc.request(ORCHESTRATION.getSnapshot, {});
    } catch (error) {
      logDiagnostic(diagnostics, "snapshot-failed", error);
      return;
    }
    const threads = readableThreads(snapshot);
    logDiagnostic(diagnostics, `snapshot threads=${threads.length}`);
    for (const thread of threads) {
      applyThreadSnapshot(thread, {
        announceExisting: false,
        snapshotSequence: snapshot.snapshotSequence,
      });
      subscribeToThread(thread.id);
    }
  }

  function handleShellItem(value) {
    if (!value || typeof value !== "object") return;
    if (value.kind === "snapshot") {
      for (const thread of value.snapshot?.threads || []) {
        if (thread?.id && !thread.archivedAt && !thread.deletedAt) subscribeToThread(thread.id);
      }
      return;
    }
    if (value.kind === "thread-upserted" && value.thread?.id) {
      if (value.thread.archivedAt || value.thread.deletedAt) {
        unsubscribeFromThread(value.thread.id);
        return;
      }
      subscribeToThread(value.thread.id);
      for (const output of projection.applyShellThread(value.thread)) emitOutput(output);
      return;
    }
    if (value.kind === "thread-removed" && value.threadId) {
      unsubscribeFromThread(value.threadId);
    }
  }

  function subscribeToThread(threadId) {
    if (!threadId || activeThreadSubscriptions.has(threadId) || stopped) return;
    const unsubscribe = rpc.subscribe(
      ORCHESTRATION.subscribeThread,
      { threadId },
      {
        onChunk(values) {
          for (const value of values) {
            if (value?.kind === "snapshot" && value.snapshot?.thread) {
              applyThreadSnapshot(value.snapshot.thread, {
                announceExisting: true,
                snapshotSequence: value.snapshot.snapshotSequence,
              });
              continue;
            }
            if (value?.kind === "event" && value.event) {
              handleThreadEvent(threadId, value.event);
            }
          }
        },
        onEnd() {
          activeThreadSubscriptions.delete(threadId);
        },
        onError() {
          // The server ends a lagging stream so the client resyncs from a
          // fresh detail snapshot; resubscribing delivers that snapshot first.
          activeThreadSubscriptions.delete(threadId);
          projection.forget(threadId);
          if (!stopped) subscribeToThread(threadId);
        },
      },
    );
    activeThreadSubscriptions.set(threadId, unsubscribe);
  }

  function unsubscribeFromThread(threadId) {
    const unsubscribe = activeThreadSubscriptions.get(threadId);
    if (unsubscribe) unsubscribe();
    activeThreadSubscriptions.delete(threadId);
    projection.forget(threadId);
    threadStates.delete(threadId);
    stopTurnReconciliation(threadId);
  }

  function handleThreadEvent(threadId, event) {
    const outputs = projection.applyThreadEvent(event);
    for (const output of outputs) {
      if (output.kind === "notification" && output.method === "turn/started") {
        stopTurnReconciliation(threadId);
      }
      emitOutput(output);
    }
    const state = threadStates.get(threadId);
    if (state) state.activeTurnId = projection.activeTurnId(threadId);
  }

  function emitOutput(output) {
    if (output.kind === "request") {
      pendingApprovalResponses.set(output.id, output.approval);
      emitRaw({ id: output.id, method: output.method, params: output.params });
      return;
    }
    emitNotification(output.method, output.params);
  }

  // Used by request handlers that still need a current thread (turn/start,
  // runtime mode). It is not on the streaming path.
  async function refreshThread(threadId) {
    if (stopped) return null;
    try {
      const snapshot = await rpc.request(ORCHESTRATION.getSnapshot, {});
      const thread = readableThreads(snapshot).find((entry) => entry.id === threadId);
      if (thread) {
        applyThreadSnapshot(thread, {
          announceExisting: true,
          snapshotSequence: snapshot.snapshotSequence,
        });
      }
      return thread || null;
    } catch {
      return null;
    }
  }
```

In `applyThreadSnapshot`, after `threadStates.set(thread.id, next);` add:

```js
    projection.hydrate(thread, snapshotSequence);
```

In `startTurn`, add `assistantDeliveryMode: "streaming",` to the dispatched command right after `dispatchMode: "queue",`.

In `readSnapshot`, keep the `subscribeToThread` loop (it is harmless and covers threads created by the phone).

In `shutdown()`, nothing changes: `activeThreadSubscriptions` and `shellUnsubscribe` are already torn down.

- [ ] **Step 4: Run the adapter tests**

Run: `cd apps/remote-gateway && node --test ./test/electron-app-server-adapter.test.js`
Expected: PASS, including the four new tests and every existing test.

- [ ] **Step 5: Run the whole gateway suite**

Run: `bun run --cwd apps/remote-gateway test`
Expected: PASS. If `bridge.test.js` fails because it asserted snapshot refresh counts, read the failing assertion and update it to the event-driven expectation; do not weaken unrelated assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/remote-gateway/src/electron-app-server-adapter.js apps/remote-gateway/test/electron-app-server-adapter.test.js
git commit -m "feat(remote-gateway): stream Electron turns from thread events

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pure outbound coalescer

**Files:**
- Create: `apps/remote-gateway/src/outbound-coalescer.js`
- Test: `apps/remote-gateway/test/outbound-coalescer.test.js`

**Interfaces:**
- Produces: `createOutboundCoalescer({ windowMs = 40, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, flush })`. `push(payloadText)` classifies the text; `flushNow()` forces delivery; `stop()` cancels the timer and flushes. `flush(text)` receives exactly one payload text per relay frame: a plain object for responses, requests, and single notifications; a JSON array string for two or more coalesced notifications.

- [ ] **Step 1: Write the failing tests**

```js
// FILE: outbound-coalescer.test.js
// Purpose: Verifies notification batching, delta merging, and ordering around responses.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createOutboundCoalescer } = require("../src/outbound-coalescer");

function createFakeTimers() {
  let pending = null;
  return {
    setTimeoutFn(callback) {
      pending = callback;
      return 1;
    },
    clearTimeoutFn() {
      pending = null;
    },
    fire() {
      const callback = pending;
      pending = null;
      callback?.();
    },
    hasPending: () => pending !== null,
  };
}

const delta = (itemId, text) =>
  JSON.stringify({
    method: "item/agentMessage/delta",
    params: { threadId: "t", turnId: "u", itemId, delta: text, djlEmittedAt: "2026-09-04T10:00:00.000Z" },
  });

test("notifications inside one window are sent as one batch array", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(JSON.stringify({ method: "turn/started", params: { threadId: "t" } }));
  coalescer.push(JSON.stringify({ method: "item/plan/delta", params: { threadId: "t", delta: "x" } }));
  assert.deepEqual(flushed, []);
  assert.equal(timers.hasPending(), true);

  timers.fire();
  assert.equal(flushed.length, 1);
  const batch = JSON.parse(flushed[0]);
  assert.deepEqual(batch.map((m) => m.method), ["turn/started", "item/plan/delta"]);
});

test("a single notification flushes as a plain object", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(JSON.stringify({ method: "turn/started", params: { threadId: "t" } }));
  timers.fire();

  assert.equal(JSON.parse(flushed[0]).method, "turn/started");
});

test("consecutive deltas for the same item merge into one delta", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(delta("a", "Hel"));
  coalescer.push(delta("a", "lo"));
  coalescer.push(delta("b", "Other"));
  coalescer.push(delta("a", "!"));
  timers.fire();

  const batch = JSON.parse(flushed[0]);
  assert.deepEqual(
    batch.map((m) => [m.params.itemId, m.params.delta]),
    [["a", "Hello"], ["b", "Other"], ["a", "!"]],
  );
  assert.equal(batch[0].params.djlEmittedAt, "2026-09-04T10:00:00.000Z");
});

test("responses and server requests flush pending notifications first and bypass the window", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(delta("a", "Hel"));
  coalescer.push(JSON.stringify({ id: "r1", result: { ok: true } }));
  coalescer.push(JSON.stringify({ id: "q1", method: "item/commandExecution/requestApproval", params: {} }));

  assert.equal(flushed.length, 3);
  assert.equal(JSON.parse(flushed[0]).method, "item/agentMessage/delta");
  assert.equal(JSON.parse(flushed[1]).id, "r1");
  assert.equal(JSON.parse(flushed[2]).id, "q1");
  assert.equal(timers.hasPending(), false);
});

test("unparseable text passes through immediately", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push("not json");

  assert.deepEqual(flushed, ["not json"]);
});

test("stop flushes what is pending and cancels the timer", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(delta("a", "x"));
  coalescer.stop();

  assert.equal(flushed.length, 1);
  assert.equal(timers.hasPending(), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/remote-gateway && node --test ./test/outbound-coalescer.test.js`
Expected: FAIL with `Cannot find module '../src/outbound-coalescer'`.

- [ ] **Step 3: Write the module**

```js
// FILE: outbound-coalescer.js
// Purpose: Batches phone-bound notifications into one relay frame per short window and merges adjacent deltas.
// Layer: CLI helper
// Exports: createOutboundCoalescer, DEFAULT_COALESCE_WINDOW_MS
// Depends on: nothing

const DEFAULT_COALESCE_WINDOW_MS = 40;
const DELTA_METHOD = "item/agentMessage/delta";

// Streaming produces dozens of tiny notifications a second. The relay budgets
// frames, not bytes, so a 40ms window turns a burst into one encrypted frame
// while responses and approval prompts keep their exact position in the order.
function createOutboundCoalescer({
  windowMs = DEFAULT_COALESCE_WINDOW_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  flush,
} = {}) {
  if (typeof flush !== "function") {
    throw new Error("outbound coalescer requires a flush callback");
  }
  const pending = [];
  let timer = null;

  function push(payloadText) {
    const parsed = safeParse(payloadText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      flushPending();
      flush(payloadText);
      return;
    }
    const isNotification = typeof parsed.method === "string" && parsed.id == null;
    if (!isNotification) {
      flushPending();
      flush(payloadText);
      return;
    }
    const last = pending[pending.length - 1];
    if (last && canMergeDeltas(last, parsed)) {
      last.params = {
        ...last.params,
        delta: `${last.params.delta}${parsed.params.delta}`,
      };
    } else {
      pending.push(parsed);
    }
    if (timer == null) {
      timer = setTimeoutFn(() => {
        timer = null;
        flushPending();
      }, windowMs);
      timer?.unref?.();
    }
  }

  function flushPending() {
    if (timer != null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    flush(JSON.stringify(batch.length === 1 ? batch[0] : batch));
  }

  return {
    push,
    flushNow: flushPending,
    stop: flushPending,
  };
}

function canMergeDeltas(previous, next) {
  return (
    previous.method === DELTA_METHOD &&
    next.method === DELTA_METHOD &&
    typeof previous.params?.delta === "string" &&
    typeof next.params?.delta === "string" &&
    previous.params.threadId === next.params.threadId &&
    previous.params.itemId === next.params.itemId &&
    previous.params.turnId === next.params.turnId
  );
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { createOutboundCoalescer, DEFAULT_COALESCE_WINDOW_MS };
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/remote-gateway && node --test ./test/outbound-coalescer.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/remote-gateway/src/outbound-coalescer.js apps/remote-gateway/test/outbound-coalescer.test.js
git commit -m "feat(remote-gateway): coalesce phone-bound notifications per 40ms window

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Route secure-transport output through the coalescer

**Files:**
- Modify: `apps/remote-gateway/src/secure-transport.js` (`createBridgeSecureTransport` options, `queueOutboundApplicationMessage`, returned object)
- Modify: `apps/remote-gateway/src/bridge.js` (`prepareBridgeShutdown`)
- Test: `apps/remote-gateway/test/secure-transport.test.js`

**Interfaces:**
- Consumes: `createOutboundCoalescer` from Task 3.
- Produces: `createBridgeSecureTransport` accepts `coalesceWindowMs`, `setTimeoutFn`, `clearTimeoutFn`; the returned object gains `flushOutbound()`. `queueOutboundApplicationMessage(payloadText, sendWireMessage)` keeps its signature.

- [ ] **Step 1: Write the failing test**

Add a key-derivation helper at the bottom of `apps/remote-gateway/test/secure-transport.test.js`, next to `decryptEnvelope`:

```js
// Derives the direction keys the same way the bridge does, from the handshake
// transcript, so tests can decrypt what the bridge sent.
function deriveMacToPhoneKey({
  transcriptBytes,
  serverHello,
  phoneEphemeral,
  sessionId,
  macDeviceId,
  phoneDeviceId,
}) {
  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey({
      key: {
        crv: "X25519",
        d: base64ToBase64Url(phoneEphemeral.privateKey),
        kty: "OKP",
        x: base64ToBase64Url(phoneEphemeral.publicKey),
      },
      format: "jwk",
    }),
    publicKey: createPublicKey({
      key: {
        crv: "X25519",
        kty: "OKP",
        x: base64ToBase64Url(serverHello.macEphemeralPublicKey),
      },
      format: "jwk",
    }),
  });
  const salt = createHash("sha256").update(transcriptBytes).digest();
  const infoPrefix = `djl-e2ee-v1|${sessionId}|${macDeviceId}|${phoneDeviceId}|${serverHello.keyEpoch}`;
  return Buffer.from(
    hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${infoPrefix}|macToPhone`, "utf8"), 32),
  );
}
```

Add this test after the "round-trips encrypted payloads" test:

```js
test("secure transport batches notifications into one encrypted frame per window", () => {
  const macIdentity = createOkpKeyPair("ed25519");
  const phoneIdentity = createOkpKeyPair("ed25519");
  const phoneEphemeral = createOkpKeyPair("x25519");
  let pendingTimer = null;
  const secureTransport = createTestBridgeSecureTransport({
    sessionId: "session-batch",
    relayUrl: "wss://relay.example/relay",
    deviceState: {
      macDeviceId: "mac-batch",
      macIdentityPrivateKey: macIdentity.privateKey,
      macIdentityPublicKey: macIdentity.publicKey,
      trustedPhones: { "phone-batch": phoneIdentity.publicKey },
    },
    setTimeoutFn(callback) {
      pendingTimer = callback;
      return 1;
    },
    clearTimeoutFn() {
      pendingTimer = null;
    },
  });
  const wireMessages = [];
  secureTransport.bindLiveSendWireMessage((message) => {
    wireMessages.push(message);
  });
  const { serverHello, transcriptBytes } = finishHandshake({
    secureTransport,
    sessionId: "session-batch",
    macDeviceId: "mac-batch",
    phoneDeviceId: "phone-batch",
    macIdentity,
    phoneIdentity,
    phoneEphemeral,
    handshakeMode: HANDSHAKE_MODE_TRUSTED_RECONNECT,
    lastAppliedBridgeOutboundSeq: 0,
  });
  const macToPhoneKey = deriveMacToPhoneKey({
    transcriptBytes,
    serverHello,
    phoneEphemeral,
    sessionId: "session-batch",
    macDeviceId: "mac-batch",
    phoneDeviceId: "phone-batch",
  });
  wireMessages.length = 0;

  const send = (message) => wireMessages.push(message);
  secureTransport.queueOutboundApplicationMessage(
    JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "t", turnId: "u", itemId: "i", delta: "Hel" } }),
    send,
  );
  secureTransport.queueOutboundApplicationMessage(
    JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "t", turnId: "u", itemId: "i", delta: "lo" } }),
    send,
  );
  secureTransport.queueOutboundApplicationMessage(
    JSON.stringify({ method: "turn/completed", params: { threadId: "t", turnId: "u" } }),
    send,
  );
  assert.equal(wireMessages.length, 0, "notifications wait for the window");

  pendingTimer();

  assert.equal(wireMessages.length, 1);
  const payload = decryptEnvelope(JSON.parse(wireMessages[0]), macToPhoneKey);
  assert.equal(payload.bridgeOutboundSeq, 1);
  const batch = JSON.parse(payload.payloadText);
  assert.deepEqual(batch.map((m) => m.method), ["item/agentMessage/delta", "turn/completed"]);
  assert.equal(batch[0].params.delta, "Hello");

  secureTransport.queueOutboundApplicationMessage(
    JSON.stringify({ id: "resp-1", result: { ok: true } }),
    send,
  );
  assert.equal(wireMessages.length, 2, "responses bypass the window");
  assert.equal(decryptEnvelope(JSON.parse(wireMessages[1]), macToPhoneKey).bridgeOutboundSeq, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/remote-gateway && node --test ./test/secure-transport.test.js`
Expected: the new test FAILS at `assert.equal(wireMessages.length, 0, ...)` because each notification is sent immediately today.

- [ ] **Step 3: Integrate the coalescer**

In `apps/remote-gateway/src/secure-transport.js`:

Add the require after the `secure-device-state` require:

```js
const { createOutboundCoalescer } = require("./outbound-coalescer");
```

Extend the factory signature:

```js
function createBridgeSecureTransport({
  sessionId,
  relayUrl,
  deviceState,
  displayName = "",
  onTrustedPhoneUpdate = null,
  onSecureSessionReady = null,
  persistTrustedPhone = true,
  diagnostics = false,
  coalesceWindowMs = undefined,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
```

Replace `queueOutboundApplicationMessage` with the pair below. The old body becomes `enqueueOutboundPayload`; the public function feeds the coalescer. The coalescer needs the sender, so remember the latest one.

```js
  let pendingSendWireMessage = null;
  const outboundCoalescer = createOutboundCoalescer({
    ...(coalesceWindowMs == null ? {} : { windowMs: coalesceWindowMs }),
    setTimeoutFn,
    clearTimeoutFn,
    flush: (payloadText) => enqueueOutboundPayload(payloadText, pendingSendWireMessage),
  });

  function queueOutboundApplicationMessage(payloadText, sendWireMessage) {
    const normalizedPayload = normalizeNonEmptyString(payloadText);
    if (!normalizedPayload) {
      return;
    }
    pendingSendWireMessage = sendWireMessage;
    outboundCoalescer.push(normalizedPayload);
  }

  function enqueueOutboundPayload(normalizedPayload, sendWireMessage) {
    const bufferEntry = {
      bridgeOutboundSeq: nextBridgeOutboundSeq,
      payloadText: normalizedPayload,
      sizeBytes: Buffer.byteLength(normalizedPayload, "utf8"),
    };
    nextBridgeOutboundSeq += 1;
    outboundBuffer.push(bufferEntry);
    outboundBufferBytes += bufferEntry.sizeBytes;
    trimOutboundBuffer();

    const liveSessionSender = activeSession?.sendWireMessage;
    const effectiveSendWireMessage =
      typeof liveSessionSender === "function" ? liveSessionSender : sendWireMessage;
    if (activeSession?.isResumed && typeof effectiveSendWireMessage === "function") {
      sendBufferedEntry(bufferEntry, effectiveSendWireMessage);
    }
  }
```

In the returned object add:

```js
    flushOutbound() {
      outboundCoalescer.flushNow();
    },
```

In `apps/remote-gateway/src/bridge.js`, in `prepareBridgeShutdown()` add as the first line after `isShuttingDown = true;`:

```js
    secureTransport.flushOutbound?.();
```

- [ ] **Step 4: Run the secure-transport tests, then the full gateway suite**

Run: `cd apps/remote-gateway && node --test ./test/secure-transport.test.js`
Expected: PASS. The existing round-trip test still passes because responses bypass the window.

Run: `bun run --cwd apps/remote-gateway test`
Expected: PASS. The bridge tests do not decrypt relay frames, so they are unaffected by batching. If one of them fails on a count of relay `send` calls made right after a notification, that assertion now observes the 40 ms window: insert `await new Promise((resolve) => setTimeout(resolve, 60));` before it and keep the expected count.

- [ ] **Step 5: Commit**

```bash
git add apps/remote-gateway/src/secure-transport.js apps/remote-gateway/src/bridge.js apps/remote-gateway/test/secure-transport.test.js
git commit -m "feat(remote-gateway): send coalesced notification batches over the relay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Relay budget

**Files:**
- Modify: `apps/remote-relay/src/policy.ts:8`
- Test: `apps/remote-relay/src/policy.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe` block in `policy.test.ts`:

```ts
  it("allows 600 frames per ten-second window by default", () => {
    let state: MessageBudgetState | undefined;
    for (let index = 0; index < 600; index += 1) {
      const result = consumeMessageBudget(state, 1_000 + index);
      expect(result.allowed).toBe(true);
      state = result.state;
    }
    expect(consumeMessageBudget(state, 1_601).allowed).toBe(false);
  });
```

Add `MessageBudgetState` to the import list from `./policy` at the top of the file if it is not already imported (`import { ..., type MessageBudgetState } from "./policy";`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd apps/remote-relay test`
Expected: the new test FAILS at frame 201.

- [ ] **Step 3: Raise the constant**

In `apps/remote-relay/src/policy.ts` change:

```ts
export const DEFAULT_MESSAGES_PER_WINDOW = 600;
```

- [ ] **Step 4: Run the relay tests and build**

Run: `bun run --cwd apps/remote-relay test && bun run --cwd apps/remote-relay build`
Expected: PASS and a clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/remote-relay/src/policy.ts apps/remote-relay/src/policy.test.ts
git commit -m "feat(remote-relay): raise per-socket frame budget to 600 per 10s

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Gateway reconnect policy for 4008

**Files:**
- Create: `apps/remote-gateway/src/relay-reconnect-policy.js`
- Modify: `apps/remote-gateway/src/bridge.js:1077-1101` (`scheduleRelayReconnect`)
- Test: `apps/remote-gateway/test/relay-reconnect-policy.test.js`

**Interfaces:**
- Produces: `relayReconnectDelayMs({ closeCode, attempt, random = Math.random })` returning a non-negative integer of milliseconds; `RELAY_CLOSE_RATE_LIMITED = 4008`.

- [ ] **Step 1: Write the failing test**

```js
// FILE: relay-reconnect-policy.test.js
// Purpose: Verifies relay reconnect delays by close code.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RELAY_CLOSE_RATE_LIMITED,
  relayReconnectDelayMs,
} = require("../src/relay-reconnect-policy");

test("rate-limited closes reconnect immediately", () => {
  assert.equal(RELAY_CLOSE_RATE_LIMITED, 4008);
  assert.equal(relayReconnectDelayMs({ closeCode: 4008, attempt: 1, random: () => 0.9 }), 0);
  assert.equal(relayReconnectDelayMs({ closeCode: 4008, attempt: 5, random: () => 0.9 }), 0);
});

test("other closes back off linearly to five seconds plus bounded jitter", () => {
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 1, random: () => 0 }), 1_000);
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 3, random: () => 0 }), 3_000);
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 9, random: () => 0 }), 5_000);
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 1, random: () => 0.5 }), 1_500);
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 9, random: () => 0.999 }), 6_999);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/remote-gateway && node --test ./test/relay-reconnect-policy.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the module**

```js
// FILE: relay-reconnect-policy.js
// Purpose: Decides how long the bridge waits before reopening the relay socket after a close.
// Layer: CLI helper
// Exports: relayReconnectDelayMs, RELAY_CLOSE_RATE_LIMITED
// Depends on: nothing

const RELAY_CLOSE_RATE_LIMITED = 4008;
const MAX_BASE_DELAY_MS = 5_000;
const MAX_JITTER_MS = 2_000;

// A 4008 means the relay dropped us for sending too fast, not that the
// relay or the phone went away. Waiting only makes the phone stall longer;
// the replay buffer redelivers anything the phone missed.
function relayReconnectDelayMs({ closeCode, attempt, random = Math.random }) {
  if (closeCode === RELAY_CLOSE_RATE_LIMITED) return 0;
  const baseDelayMs = Math.min(1_000 * Math.max(1, attempt), MAX_BASE_DELAY_MS);
  const jitterMs = Math.floor(random() * Math.min(baseDelayMs, MAX_JITTER_MS));
  return baseDelayMs + jitterMs;
}

module.exports = { RELAY_CLOSE_RATE_LIMITED, relayReconnectDelayMs };
```

- [ ] **Step 4: Use it in bridge.js**

Add the require near the other local requires at the top of `bridge.js`:

```js
const { RELAY_CLOSE_RATE_LIMITED, relayReconnectDelayMs } = require("./relay-reconnect-policy");
```

Replace the body of `scheduleRelayReconnect` from `reconnectAttempt += 1;` through `const delayMs = baseDelayMs + jitterMs;` with:

```js
    reconnectAttempt += 1;
    if (closeCode === RELAY_CLOSE_RATE_LIMITED) {
      console.warn("[djl] relay rate limit hit; reconnecting immediately");
    }
    const delayMs = relayReconnectDelayMs({ closeCode, attempt: reconnectAttempt });
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/remote-gateway && node --test ./test/relay-reconnect-policy.test.js && bun run --cwd apps/remote-gateway test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/remote-gateway/src/relay-reconnect-policy.js apps/remote-gateway/src/bridge.js apps/remote-gateway/test/relay-reconnect-policy.test.js
git commit -m "feat(remote-gateway): reconnect immediately after a relay rate-limit close

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Phone decodes JSON-RPC batch arrays

**Files:**
- Modify: `apps/ios/DJL/Services/CodexService+Incoming.swift:20-84` (`WireMessagePreDecoder`, `processIncomingText`, `handleDecodedRPCResult`)
- Create: `apps/ios/DJLTests/CodexServiceBatchIncomingTests.swift`

**Interfaces:**
- Produces: `WireMessagePreDecoder.Result` gains `case batch([RPCMessage])`. `processIncomingText` dispatches each element of an array in order.

- [ ] **Step 1: Write the failing test**

```swift
// FILE: CodexServiceBatchIncomingTests.swift
// Purpose: Verifies coalesced JSON-RPC batch frames from the bridge apply in order.
// Layer: Unit Test
// Exports: CodexServiceBatchIncomingTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexServiceBatchIncomingTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testBatchArrayAppliesEveryNotificationInOrder() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let batch = """
        [
          {"method":"turn/started","params":{"threadId":"\(threadID)","turnId":"\(turnID)"}},
          {"method":"item/agentMessage/delta","params":{"threadId":"\(threadID)","turnId":"\(turnID)","itemId":"item-1","delta":"Hel"}},
          {"method":"item/agentMessage/delta","params":{"threadId":"\(threadID)","turnId":"\(turnID)","itemId":"item-1","delta":"lo"}}
        ]
        """

        service.processIncomingText(batch)
        service.flushPendingAssistantDeltas(for: threadID)

        XCTAssertEqual(service.threadRunBadgeState(for: threadID), .running)
        let assistant = service.messages(for: threadID).filter { $0.role == .assistant }
        XCTAssertEqual(assistant.count, 1)
        XCTAssertEqual(assistant.first?.text, "Hello")
    }

    func testBatchWithOneBadElementStillAppliesTheRest() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"
        let batch = """
        [
          {"method":"turn/started","params":{"threadId":"\(threadID)","turnId":"\(turnID)"}},
          42,
          {"method":"item/agentMessage/delta","params":{"threadId":"\(threadID)","turnId":"\(turnID)","itemId":"item-1","delta":"ok"}}
        ]
        """

        service.processIncomingText(batch)
        service.flushPendingAssistantDeltas(for: threadID)

        XCTAssertEqual(service.threadRunBadgeState(for: threadID), .running)
        XCTAssertEqual(service.messages(for: threadID).filter { $0.role == .assistant }.first?.text, "ok")
        XCTAssertEqual(service.lastErrorMessage, "Unable to decode server payload")
    }

    func testPreDecoderClassifiesArraysAsBatches() {
        let result = WireMessagePreDecoder.classify(
            "[{\"method\":\"turn/started\",\"params\":{}},{\"id\":\"r\",\"result\":{}}]"
        )

        XCTAssertFalse(result.isSecure)
        guard case .batch(let messages)? = result.rpcResult else {
            return XCTFail("Expected a batch result")
        }
        XCTAssertEqual(messages.count, 2)
        XCTAssertEqual(messages[0].method, "turn/started")
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexServiceBatchIncomingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        service.messagesByThread = [:]
        Self.retainedServices.append(service)
        return service
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/ios`:

```bash
xcodebuild test -project DJL.xcodeproj -scheme DJL -destination 'platform=iOS Simulator,id=AD05D790-2A21-4DF7-9FFB-22177ABBDCEB' -only-testing:DJLTests/CodexServiceBatchIncomingTests -derivedDataPath /private/tmp/claude-501/-Users-toni798-Documents-Production-DJL/765f9bc7-caab-49df-b17e-93b2d363c56c/scratchpad/DerivedData CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "error:|Test Case|\*\* TEST"
```

Expected: compile error on `.batch` (no such case), so the build fails.

- [ ] **Step 3: Implement batch decoding**

In `apps/ios/DJL/Services/CodexService+Incoming.swift` replace the `WireMessagePreDecoder` enum and the two `CodexService` functions:

```swift
nonisolated enum WireMessagePreDecoder {
    enum Result: Sendable {
        case message(RPCMessage)
        case batch([RPCMessage])
        case decodeFailed
        case invalidUTF8
    }

    struct Classification: Sendable {
        let isSecure: Bool
        let rpcResult: Result?
    }

    private static let secureKindValues = [
        "\"serverHello\"", "\"secureReady\"", "\"secureError\"", "\"encryptedEnvelope\""
    ]

    static func decodeRPCMessage(from text: String) -> Result {
        guard let data = text.data(using: .utf8) else { return .invalidUTF8 }
        if isBatchText(text) {
            return decodeBatch(from: data)
        }
        do {
            let message = try JSONDecoder().decode(RPCMessage.self, from: data)
            return .message(message)
        } catch {
            return .decodeFailed
        }
    }

    // The bridge coalesces notifications into a JSON-RPC batch array. Decode
    // element by element so one malformed entry cannot drop the whole frame.
    static func decodeBatch(from data: Data) -> Result {
        guard let elements = try? JSONDecoder().decode([JSONValue].self, from: data) else {
            return .decodeFailed
        }
        var messages: [RPCMessage] = []
        var sawFailure = false
        for element in elements {
            guard let elementData = try? JSONEncoder().encode(element),
                  let message = try? JSONDecoder().decode(RPCMessage.self, from: elementData) else {
                sawFailure = true
                continue
            }
            messages.append(message)
        }
        if messages.isEmpty {
            return .decodeFailed
        }
        return sawFailure ? .batchWithFailures(messages) : .batch(messages)
    }

    static func isBatchText(_ text: String) -> Bool {
        text.first(where: { !$0.isWhitespace }) == "["
    }

    static func classify(_ text: String) -> Classification {
        if text.contains("\"kind\":") {
            for value in secureKindValues {
                if text.contains(value) {
                    return Classification(isSecure: true, rpcResult: nil)
                }
            }
        }
        return Classification(isSecure: false, rpcResult: decodeRPCMessage(from: text))
    }
}
```

Add `case batchWithFailures([RPCMessage])` to `Result` (it is used above), so the enum reads:

```swift
    enum Result: Sendable {
        case message(RPCMessage)
        case batch([RPCMessage])
        case batchWithFailures([RPCMessage])
        case decodeFailed
        case invalidUTF8
    }
```

Then:

```swift
extension CodexService {
    func processIncomingText(_ text: String) {
        handleDecodedRPCResult(WireMessagePreDecoder.decodeRPCMessage(from: text), rawText: text)
    }

    // Handles a pre-decoded RPC message from off-actor transport paths.
    func handleDecodedRPCResult(_ result: WireMessagePreDecoder.Result, rawText: String) {
        switch result {
        case .message(let message):
            lastRawMessage = rawText
            handleIncomingRPCMessage(message)
        case .batch(let messages):
            lastRawMessage = rawText
            for message in messages {
                handleIncomingRPCMessage(message)
            }
        case .batchWithFailures(let messages):
            lastRawMessage = rawText
            for message in messages {
                handleIncomingRPCMessage(message)
            }
            lastErrorMessage = "Unable to decode server payload"
        case .decodeFailed:
            lastErrorMessage = "Unable to decode server payload"
        case .invalidUTF8:
            break
        }
    }
```

`JSONValue` (in `apps/ios/DJL/Models/JSONValue.swift`) is `Codable`, so the `JSONEncoder` round trip above compiles as written.

- [ ] **Step 4: Run the new test class, then the full unit suite**

Run the Step 2 command again.
Expected: 3 passed.

Run the full suite (replace `-only-testing:DJLTests/CodexServiceBatchIncomingTests` with `-only-testing:DJLTests`).
Expected: `** TEST SUCCEEDED **`, 835 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/DJL/Services/CodexService+Incoming.swift apps/ios/DJLTests/CodexServiceBatchIncomingTests.swift
git commit -m "feat(ios): decode coalesced JSON-RPC batch frames from the bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Phone treats 4008 as transient and logs delta latency

**Files:**
- Modify: `apps/ios/DJL/Services/CodexService+Connection.swift:15-16` and `:837-883`, `:1210-1217`
- Modify: `apps/ios/DJL/Services/CodexService+Incoming.swift` (`appendAgentDelta` call site, line ~306) or `CodexService+IncomingAssistant.swift` where `appendAgentDelta(from:)` is defined
- Create: `apps/ios/DJLTests/CodexServiceRelayRateLimitTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
// FILE: CodexServiceRelayRateLimitTests.swift
// Purpose: Verifies a relay rate-limit close keeps the pairing and retries.
// Layer: Unit Test
// Exports: CodexServiceRelayRateLimitTests
// Depends on: XCTest, Network, DJL

import XCTest
import Network
@testable import DJL

@MainActor
final class CodexServiceRelayRateLimitTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testRateLimitedCloseKeepsSessionAndRetries() {
        let service = makeService()
        service.relaySessionId = "session-\(UUID().uuidString)"
        service.relayUrl = "wss://relay.test/relay"
        service.isConnected = true
        service.isInitialized = true
        service.setForegroundState(true)

        service.handleReceiveError(
            CodexServiceError.disconnected,
            relayCloseCode: .privateCode(4008)
        )

        XCTAssertFalse(service.isConnected)
        XCTAssertNotNil(service.relaySessionId)
        XCTAssertTrue(service.shouldAutoReconnectOnForeground)
        XCTAssertEqual(service.connectionRecoveryState, .retrying(attempt: 0, message: "Catching up…"))
        XCTAssertNil(service.lastErrorMessage)
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexServiceRelayRateLimitTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        service.messagesByThread = [:]
        Self.retainedServices.append(service)
        return service
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run the Task 7 Step 2 command with `-only-testing:DJLTests/CodexServiceRelayRateLimitTests`.
Expected: FAIL on the recovery state or `lastErrorMessage` assertion (4008 is currently an unknown code).

- [ ] **Step 3: Implement**

In `CodexService+Connection.swift` add next to the other close-code sets:

```swift
    private static let rateLimitedRelayCloseCodeRawValue: UInt16 = 4008
```

Add a helper after `explicitRelayDropMessage(for:)`:

```swift
    // The relay closed the socket for sending too fast. The pairing and the
    // session are still valid; the bridge replays what was missed on reconnect.
    func isRateLimitedRelayClose(_ closeCode: NWProtocolWebSocket.CloseCode?) -> Bool {
        relayCloseCodeRawValue(closeCode) == Self.rateLimitedRelayCloseCodeRawValue
    }
```

In `receiveErrorDisposition(for:relayCloseCode:)` change the auto-recovery condition and the recovery state:

```swift
        let isRateLimitedClose = isRateLimitedRelayClose(relayCloseCode)
        let shouldAttemptAutoRecovery = !shouldClearSavedRelaySession
            && explicitRelayDropMessage == nil
            && (retryableSessionUnavailableMessage != nil
                || isRateLimitedClose
                || isRecoverableTransientConnectionError(error)
                || isBenignDisconnect)

        let connectionRecoveryState: CodexConnectionRecoveryState = shouldAttemptAutoRecovery
            ? .retrying(
                attempt: 0,
                message: isRateLimitedClose ? "Catching up…" : recoveryStatusMessage(for: error)
            )
            : .idle
```

For the latency log, open `apps/ios/DJL/Services/CodexService+IncomingAssistant.swift:23`, whose signature is `func appendAgentDelta(from paramsObject: IncomingParamsObject?)`, and add at the top of its body:

```swift
        #if DEBUG
        if let emittedAt = paramsObject?["djlEmittedAt"]?.stringValue,
           let emittedDate = ISO8601DateFormatter.djlFractional.date(from: emittedAt) {
            let latencyMs = Int(Date().timeIntervalSince(emittedDate) * 1000)
            debugRuntimeLog("[djl-latency] delta latency_ms=\(latencyMs)")
        }
        #endif
```

Add the formatter once, in the same file at top level:

```swift
private extension ISO8601DateFormatter {
    static let djlFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
```

- [ ] **Step 4: Run the new test class, then the full unit suite**

Expected: the rate-limit test passes; full suite `** TEST SUCCEEDED **` with 836 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/DJL/Services/CodexService+Connection.swift apps/ios/DJL/Services/CodexService+Incoming.swift apps/ios/DJL/Services/CodexService+IncomingAssistant.swift apps/ios/DJLTests/CodexServiceRelayRateLimitTests.swift
git commit -m "feat(ios): retry through relay rate-limit closes and log delta latency

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-remote-streaming-latency-design.md` (append a "Measured" section)

- [ ] **Step 1: Run every automated suite once more**

```bash
bun run --cwd apps/remote-gateway test
bun run --cwd apps/remote-relay test
cd apps/ios && xcodebuild test -project DJL.xcodeproj -scheme DJL -destination 'platform=iOS Simulator,id=AD05D790-2A21-4DF7-9FFB-22177ABBDCEB' -only-testing:DJLTests -derivedDataPath /private/tmp/claude-501/-Users-toni798-Documents-Production-DJL/765f9bc7-caab-49df-b17e-93b2d363c56c/scratchpad/DerivedData CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "\*\* TEST|Executed [0-9]+ tests"
```

Expected: all green; the iOS line reads `Executed 836 tests, with 0 failures`.

- [ ] **Step 2: Manual timing on the simulator**

1. Build and run the desktop app from this worktree (`bun run --cwd apps/desktop dev` or the project's usual dev command) so the gateway child starts with the new code.
2. Pair the simulator app (Settings, Remote, scan or enter the code).
3. Start a turn on the desktop; watch the simulator. Then start a turn from the simulator.
4. Read the simulator's debug log (`xcrun simctl spawn booted log stream --predicate 'eventMessage CONTAINS "djl-latency"'`) and note the median `latency_ms` for each case.

- [ ] **Step 3: Record the numbers**

Append to the spec:

```markdown
## Measured

| Case | Before | After |
| --- | --- | --- |
| Desktop-started turn, median delta latency | <fill from log> ms | <fill from log> ms |
| Phone-started turn, first token | <observed> s | <observed> s |
```

Replace the placeholders with the observed values before committing. If a number cannot be measured, write `not measured` and say why.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-04-remote-streaming-latency-design.md
git commit -m "docs: record measured remote streaming latency

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
