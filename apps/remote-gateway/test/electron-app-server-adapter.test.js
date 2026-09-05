const test = require("node:test");
const assert = require("node:assert/strict");

const {
  appServerThreadWithHistory,
  appServerTurns,
  createElectronAppServerTransport,
  extractInputText,
  listModels,
  listThreads,
} = require("../src/electron-app-server-adapter");

const PROJECT_WORKSPACE_ROOT = "/Users/tester/Documents/DJL";

const snapshot = {
  projects: [{ id: "project-djl", workspaceRoot: PROJECT_WORKSPACE_ROOT }],
  threads: [
    {
      id: "electron-thread",
      projectId: "project-djl",
      title: "Electron-owned chat",
      createdAt: "2026-07-19T12:00:00.000Z",
      updatedAt: "2026-07-19T12:01:00.000Z",
      modelSelection: {
        provider: "opencode",
        model: "deepseek/deepseek-chat",
        options: { variant: "high" },
      },
      runtimeMode: "approval-required",
      messages: [
        {
          id: "user-1",
          role: "user",
          text: "Hello from Electron",
          turnId: "turn-1",
          createdAt: "2026-07-19T12:00:00.000Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "Hello from DJL",
          turnId: "turn-1",
          createdAt: "2026-07-19T12:00:02.000Z",
          streaming: false,
        },
      ],
      activities: [],
      session: null,
      latestTurn: { turnId: "turn-1", state: "completed" },
      archivedAt: null,
      deletedAt: null,
    },
    {
      id: "archived-thread",
      projectId: "project-djl",
      title: "Archived",
      messages: [],
      activities: [],
      archivedAt: "2026-07-19T12:00:00.000Z",
      deletedAt: null,
    },
  ],
};

test("Electron adapter exposes only Electron's active chats with their own workspace metadata", () => {
  const result = listThreads(snapshot);

  assert.deepEqual(
    result.data.map((thread) => thread.id),
    ["electron-thread"],
  );
  assert.equal(result.data[0].cwd, PROJECT_WORKSPACE_ROOT);
  assert.equal(result.data[0].modelProvider, "opencode");
  assert.equal(result.data[0].model, "deepseek/deepseek-chat");
  assert.equal(result.data[0].runtimeMode, "approval-required");
});

test("Electron adapter sends one current row per Electron thread identity", () => {
  const duplicateSnapshot = {
    ...snapshot,
    threads: [
      {
        ...snapshot.threads[0],
        updatedAt: "2026-07-19T12:00:30.000Z",
        messages: [snapshot.threads[0].messages[0]],
      },
      snapshot.threads[0],
    ],
  };

  const result = listThreads(duplicateSnapshot);

  assert.deepEqual(
    result.data.map((thread) => thread.id),
    ["electron-thread"],
  );
  assert.equal(result.data[0].preview, "Hello from DJL");
});

test("Electron adapter materializes orchestration messages as iOS-compatible turn history", () => {
  const thread = snapshot.threads[0];
  const result = appServerThreadWithHistory(thread, snapshot);

  assert.equal(result.turns.length, 1);
  assert.deepEqual(
    result.turns[0].items.map((item) => item.type),
    ["userMessage", "agentMessage"],
  );
  assert.equal(result.turns[0].items[1].content[0].text, "Hello from DJL");
  assert.deepEqual(appServerTurns(thread), result.turns);
});

test("Electron adapter preserves the selected OpenCode model and extracts only visible input text", () => {
  const models = listModels(snapshot);
  assert.equal(models.items[0].model, "deepseek/deepseek-chat");
  assert.equal(extractInputText([{ type: "text", text: "Run pwd" }]), "Run pwd");
  assert.equal(extractInputText([{ type: "image" }]), "");
});

test("Electron adapter sends mutation commands as the direct Electron RPC payload", async () => {
  const requests = [];
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      return snapshot;
    },
    subscribe: () => () => {},
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });

  transport.send(
    JSON.stringify({
      id: "ios-turn-start",
      method: "turn/start",
      params: {
        threadId: "electron-thread",
        input: [{ type: "text", text: "Reply from iOS" }],
        model: "deepseek/deepseek-chat",
        effort: "medium",
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const dispatched = requests.find((request) => request.tag === "orchestration.dispatchCommand");
  assert.equal(dispatched.payload.type, "thread.turn.start");
  assert.equal(dispatched.payload.message.text, "Reply from iOS");
  assert.equal(dispatched.payload.command, undefined);
});

test("Electron adapter reuses command and message identities for duplicate mobile RPC delivery", async () => {
  const requests = [];
  const activeSnapshot = structuredClone(snapshot);
  activeSnapshot.threads[0].session = { activeTurnId: "turn-duplicate" };
  activeSnapshot.threads[0].latestTurn = { turnId: "turn-duplicate", state: "running" };
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      return activeSnapshot;
    },
    subscribe: () => () => {},
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));
  const request = JSON.stringify({
    id: "ios-duplicate-turn-start",
    method: "turn/start",
    params: {
      threadId: "electron-thread",
      input: [{ type: "text", text: "Deliver once" }],
    },
  });

  transport.send(request);
  transport.send(request);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const dispatched = requests
    .filter((entry) => entry.tag === "orchestration.dispatchCommand")
    .map((entry) => entry.payload);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0].commandId, dispatched[1].commandId);
  assert.equal(dispatched[0].message.messageId, dispatched[1].message.messageId);
  const receipts = outbound
    .filter((message) => message.id === "ios-duplicate-turn-start")
    .map((message) => message.result?.djlMutation);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].id, receipts[1].id);
  assert.equal(receipts[0].status, "confirmed");
  transport.shutdown();
});

test("Electron adapter reports a failed mobile mutation with its stable identity", async () => {
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async (tag) => {
      if (tag === "orchestration.dispatchCommand") throw new Error("backend rejected mutation");
      return snapshot;
    },
    subscribe: () => () => {},
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

  transport.send(
    JSON.stringify({
      id: "ios-failed-archive",
      method: "thread/archive",
      params: { threadId: "electron-thread" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const failure = outbound.find((message) => message.id === "ios-failed-archive");
  assert.equal(failure.error.message, "backend rejected mutation");
  assert.equal(failure.error.data.djlMutation.status, "failed");
  assert.match(failure.error.data.djlMutation.id, /^djl-remote-mutation-/);
  transport.shutdown();
});

test("Electron adapter maps every iOS access mode onto the Electron turn runtime", async () => {
  const cases = [
    {
      name: "ask for approval",
      params: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "workspaceWrite", networkAccess: true },
      },
      expected: "approval-required",
    },
    {
      name: "approve for me",
      params: {
        approvalPolicy: "onRequest",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write",
      },
      expected: "auto-approval",
    },
    {
      name: "full access",
      params: {
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      },
      expected: "full-access",
    },
    {
      name: "full access from legacy approval policy only",
      params: {
        approval_policy: "never",
      },
      expected: "full-access",
    },
  ];

  for (const testCase of cases) {
    const requests = [];
    let currentSnapshot = structuredClone(snapshot);
    const backend = {
      onStarted() {},
      onError() {},
      onClose() {},
      request: async (tag, payload) => {
        requests.push({ tag, payload });
        if (tag === "orchestration.dispatchCommand") {
          currentSnapshot.threads[0].runtimeMode = payload.runtimeMode;
          currentSnapshot.threads[0].session = { activeTurnId: `turn-${payload.runtimeMode}` };
        }
        return currentSnapshot;
      },
      subscribe: () => () => {},
      shutdown() {},
    };
    const transport = createElectronAppServerTransport({
      endpoint: "ws://electron.test/ws",
      backend,
    });
    const outbound = [];
    transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

    transport.send(
      JSON.stringify({
        id: `ios-${testCase.expected}`,
        method: "turn/start",
        params: {
          threadId: "electron-thread",
          input: [{ type: "text", text: testCase.name }],
          ...testCase.params,
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dispatched = requests.find((request) => request.tag === "orchestration.dispatchCommand");
    assert.equal(dispatched.payload.runtimeMode, testCase.expected, testCase.name);
    assert.equal(
      outbound.find((message) => message.id === `ios-${testCase.expected}`)?.result?.runtimeMode,
      testCase.expected,
      `${testCase.name} response`,
    );
    transport.shutdown();
  }
});

test("Electron adapter creates a new chat with the iOS default access mode", async () => {
  const requests = [];
  let currentSnapshot = structuredClone(snapshot);
  let idCounter = 0;
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      if (tag === "orchestration.dispatchCommand" && payload.type === "thread.create") {
        currentSnapshot.threads.push({
          id: payload.threadId,
          projectId: payload.projectId,
          title: payload.title,
          modelSelection: payload.modelSelection,
          runtimeMode: payload.runtimeMode,
          createdAt: payload.createdAt,
          updatedAt: payload.createdAt,
          messages: [],
          activities: [],
          session: null,
          latestTurn: null,
          archivedAt: null,
          deletedAt: null,
        });
      }
      return currentSnapshot;
    },
    subscribe: () => () => {},
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
    makeId: () => `id-${++idCounter}`,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

  transport.send(
    JSON.stringify({
      id: "ios-thread-start",
      method: "thread/start",
      params: {
        cwd: PROJECT_WORKSPACE_ROOT,
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write",
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const dispatched = requests.find(
    (request) =>
      request.tag === "orchestration.dispatchCommand" && request.payload.type === "thread.create",
  );
  assert.equal(dispatched.payload.runtimeMode, "auto-approval");
  const response = outbound.find((message) => message.id === "ios-thread-start");
  assert.equal(response.result.runtimeMode, "auto-approval");
  assert.equal(response.result.thread.runtimeMode, "auto-approval");
  transport.shutdown();
});

test("Electron adapter preserves the thread mode when turn access fields are omitted", async () => {
  const requests = [];
  const fullAccessSnapshot = structuredClone(snapshot);
  fullAccessSnapshot.threads[0].runtimeMode = "full-access";
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      return fullAccessSnapshot;
    },
    subscribe: () => () => {},
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });

  transport.send(
    JSON.stringify({
      id: "ios-preserve-mode",
      method: "turn/start",
      params: {
        threadId: "electron-thread",
        input: [{ type: "text", text: "Keep access" }],
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const dispatched = requests.find((request) => request.tag === "orchestration.dispatchCommand");
  assert.equal(dispatched.payload.runtimeMode, "full-access");
  transport.shutdown();
});

test("Electron adapter advertises and applies immediate per-thread runtime mode sync", async () => {
  const requests = [];
  let currentSnapshot = structuredClone(snapshot);
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      if (tag === "orchestration.dispatchCommand") {
        currentSnapshot.threads[0].runtimeMode = payload.runtimeMode;
      }
      return currentSnapshot;
    },
    subscribe: () => () => {},
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

  transport.send(JSON.stringify({ id: "initialize-ios", method: "initialize", params: {} }));
  transport.send(
    JSON.stringify({
      id: "set-full-access",
      method: "djl/thread/runtimeMode/set",
      params: { threadId: "electron-thread", runtimeMode: "full-access" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    outbound.find((message) => message.id === "initialize-ios")?.result?.capabilities
      ?.djlThreadRuntimeModeSync,
    true,
  );
  const dispatched = requests.find(
    (request) =>
      request.tag === "orchestration.dispatchCommand" &&
      request.payload.type === "thread.runtime-mode.set",
  );
  assert.deepEqual(dispatched.payload, {
    type: "thread.runtime-mode.set",
    commandId: dispatched.payload.commandId,
    threadId: "electron-thread",
    runtimeMode: "full-access",
    createdAt: dispatched.payload.createdAt,
  });
  assert.equal(
    outbound.find((message) => message.id === "set-full-access")?.result?.runtimeMode,
    "full-access",
  );
  transport.shutdown();
});

test("Electron adapter pushes Electron-originated runtime mode changes to iOS", async () => {
  let threadSubscription = null;
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async () => snapshot,
    subscribe(tag, _payload, handlers) {
      if (tag === "orchestration.subscribeThread") threadSubscription = handlers;
      return () => {};
    },
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

  transport.send(
    JSON.stringify({ id: "list-before-mode-change", method: "thread/list", params: {} }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(threadSubscription);

  const changedThread = structuredClone(snapshot.threads[0]);
  changedThread.runtimeMode = "auto-approval";
  changedThread.updatedAt = "2026-07-19T12:02:00.000Z";
  threadSubscription.onChunk([{ kind: "snapshot", snapshot: { thread: changedThread } }]);

  const update = outbound.find((message) => message.method === "djl/thread/runtimeMode/updated");
  assert.deepEqual(update?.params, {
    threadId: "electron-thread",
    runtimeMode: "auto-approval",
    updatedAt: "2026-07-19T12:02:00.000Z",
  });
  transport.shutdown();
});

test("Electron adapter ignores an out-of-order thread snapshot", async () => {
  let threadSubscription = null;
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async () => snapshot,
    subscribe(tag, _payload, handlers) {
      if (tag === "orchestration.subscribeThread") threadSubscription = handlers;
      return () => {};
    },
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

  transport.send(
    JSON.stringify({ id: "list-before-stale-update", method: "thread/list", params: {} }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const newest = structuredClone(snapshot.threads[0]);
  newest.runtimeMode = "full-access";
  newest.updatedAt = "2026-07-19T12:04:00.000Z";
  threadSubscription.onChunk([
    {
      kind: "snapshot",
      snapshot: { snapshotSequence: 10, thread: newest },
    },
  ]);

  const stale = structuredClone(snapshot.threads[0]);
  stale.runtimeMode = "auto-approval";
  stale.updatedAt = "2026-07-19T12:03:00.000Z";
  threadSubscription.onChunk([
    {
      kind: "snapshot",
      snapshot: { snapshotSequence: 9, thread: stale },
    },
  ]);

  const updates = outbound.filter((message) => message.method === "djl/thread/runtimeMode/updated");
  assert.deepEqual(
    updates.map((message) => message.params.runtimeMode),
    ["full-access"],
  );
  transport.shutdown();
});

test("Electron adapter retains a failed approval response for an idempotent retry", async () => {
  let threadSubscription = null;
  let approvalAttempt = 0;
  const approvalCommands = [];
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async (tag, payload) => {
      if (tag === "orchestration.dispatchCommand") {
        approvalAttempt += 1;
        approvalCommands.push(payload);
        if (approvalAttempt === 1) throw new Error("temporary approval failure");
        return { sequence: 22 };
      }
      return snapshot;
    },
    subscribe(tag, _payload, handlers) {
      if (tag === "orchestration.subscribeThread") threadSubscription = handlers;
      return () => {};
    },
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

  transport.send(JSON.stringify({ id: "list-before-approval", method: "thread/list", params: {} }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const approvalThread = structuredClone(snapshot.threads[0]);
  approvalThread.activities = [
    {
      id: "activity-approval-1",
      kind: "approval.requested",
      summary: "Run command",
      payload: { requestId: "provider-approval-1", requestKind: "command" },
    },
  ];
  threadSubscription.onChunk([
    {
      kind: "snapshot",
      snapshot: { snapshotSequence: 12, thread: approvalThread },
    },
  ]);
  const approvalRequest = outbound.find(
    (message) => message.method === "item/commandExecution/requestApproval",
  );
  assert.ok(approvalRequest);

  const response = JSON.stringify({
    id: approvalRequest.id,
    result: { decision: "accept" },
  });
  transport.send(response);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const failure = outbound.find((message) => message.method === "djl/serverRequest/failed");
  assert.equal(failure.params.requestId, approvalRequest.id);
  assert.equal(failure.params.djlMutation.status, "failed");

  transport.send(response);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(approvalCommands.length, 2);
  assert.equal(approvalCommands[0].commandId, approvalCommands[1].commandId);
  assert.ok(
    outbound.some(
      (message) =>
        message.method === "serverRequest/resolved" &&
        message.params.requestId === approvalRequest.id,
    ),
  );
  transport.shutdown();
});

test("Electron adapter reconciles a completed phone-originated turn when a subscription callback is missed", async () => {
  const initialThread = {
    ...snapshot.threads[0],
    messages: [],
    session: null,
    latestTurn: null,
  };
  const activeThread = {
    ...initialThread,
    session: { activeTurnId: "turn-phone" },
    latestTurn: { turnId: "turn-phone", state: "running" },
    messages: [
      {
        id: "user-phone",
        role: "user",
        text: "Reply from iOS",
        turnId: "turn-phone",
        createdAt: "2026-07-19T12:03:00.000Z",
      },
    ],
  };
  const completedThread = {
    ...activeThread,
    session: null,
    latestTurn: { turnId: "turn-phone", state: "completed" },
    messages: [
      ...activeThread.messages,
      {
        id: "assistant-phone",
        role: "assistant",
        text: "Completed by DJL Electron",
        turnId: "turn-phone",
        createdAt: "2026-07-19T12:03:01.000Z",
        streaming: false,
      },
    ],
  };
  let phase = "initial";
  const backend = {
    onStarted() {},
    onError() {},
    onClose() {},
    request: async (tag) => {
      if (tag === "orchestration.dispatchCommand") {
        phase = "active";
        return {};
      }
      const thread =
        phase === "initial" ? initialThread : phase === "active" ? activeThread : completedThread;
      return { projects: snapshot.projects, threads: [thread] };
    },
    subscribe: () => () => {},
    shutdown() {},
  };
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
  });
  const outbound = [];
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));

  transport.send(
    JSON.stringify({
      id: "ios-turn-start",
      method: "turn/start",
      params: {
        threadId: "electron-thread",
        input: [{ type: "text", text: "Reply from iOS" }],
      },
    }),
  );
  setTimeout(() => {
    phase = "completed";
  }, 30);
  await new Promise((resolve) => setTimeout(resolve, 320));

  assert.ok(
    outbound.some(
      (message) => message.method === "turn/started" && message.params.turnId === "turn-phone",
    ),
  );
  assert.ok(
    outbound.some(
      (message) =>
        message.method === "item/completed" && message.params.item.id === "assistant-phone",
    ),
  );
  assert.ok(
    outbound.some(
      (message) => message.method === "turn/completed" && message.params.turnId === "turn-phone",
    ),
  );
  transport.shutdown();
});

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
  fake.pushShell([
    {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 5,
        projects: [],
        threads: [{ id: "electron-thread", runtimeMode: "approval-required" }],
        updatedAt: "x",
      },
    },
  ]);
  fake.pushThread("electron-thread", [detailSnapshotChunk(snapshot.threads[0], 5)]);
  const snapshotCallsBefore = fake.requests.filter(
    (r) => r.tag === "orchestration.getSnapshot",
  ).length;

  fake.pushThread("electron-thread", [assistantEvent(6, "Hel", true), assistantEvent(7, "lo", true)]);
  fake.pushThread("electron-thread", [assistantEvent(8, "Hello", false)]);
  await flushMicrotasks();

  const deltas = outbound.filter((m) => m.method === "item/agentMessage/delta");
  assert.deepEqual(
    deltas.map((m) => m.params.delta),
    ["Hel", "lo"],
  );
  assert.equal(deltas[0].params.itemId, "assistant-2");
  assert.equal(deltas[0].params.djlEmittedAt, "2026-07-19T12:02:00.000Z");
  const completed = outbound.filter((m) => m.method === "item/completed");
  assert.equal(completed.length, 1);
  assert.equal(completed[0].params.item.content[0].text, "Hello");
  const snapshotCallsAfter = fake.requests.filter(
    (r) => r.tag === "orchestration.getSnapshot",
  ).length;
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
  assert.equal(
    outbound.filter((m) => m.method === "turn/started").at(-1)?.params.turnId,
    "turn-3",
  );
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

  fake.pushShell([
    { kind: "thread-upserted", sequence: 6, thread: { id: "brand-new", runtimeMode: "full-access" } },
  ]);
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
