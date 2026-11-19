// FILE: electron-groups.test.js
// Purpose: Verifies the phone's Multi agents group methods, group event forwarding, and that group replies keep their member id on the thread stream.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/electron-app-server-adapter

const test = require("node:test");
const assert = require("node:assert/strict");

const { createElectronAppServerTransport } = require("../src/electron-app-server-adapter");

const GROUP_REPLY_ID = "assistant:turn-1:gm.member-claude.reply-1";
const GROUP = {
  id: "group-1",
  threadId: "group-thread",
  projectId: "group-project",
  name: "Launch",
  members: [{ id: "member-claude", groupId: "group-1", provider: "claudeAgent", handle: "Claude" }],
  pendingHandoffs: [],
};
const LIVE = {
  memberStates: { "member-claude": "working" },
  drafts: { "member-claude": "So far" },
};
const GROUP_THREAD = {
  id: "group-thread",
  projectId: "group-project",
  title: "Launch",
  createdAt: "2026-11-19T10:00:00.000Z",
  updatedAt: "2026-11-19T10:01:00.000Z",
  modelSelection: { provider: "group", model: "group" },
  runtimeMode: "approval-required",
  messages: [
    {
      id: "user-1",
      role: "user",
      text: "@Claude hello",
      turnId: null,
      createdAt: "2026-11-19T10:00:00.000Z",
    },
    {
      id: GROUP_REPLY_ID,
      role: "assistant",
      text: "Hello!",
      turnId: "turn-1",
      createdAt: "2026-11-19T10:00:05.000Z",
      streaming: false,
    },
  ],
  activities: [],
  session: null,
  latestTurn: { turnId: "turn-1", state: "completed" },
  archivedAt: null,
  deletedAt: null,
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createGroupBackend({ thread = GROUP_THREAD, handlers = {} } = {}) {
  const requests = [];
  const streams = new Map();
  let startedHandler = null;
  const backend = {
    onStarted(handler) {
      startedHandler = handler;
    },
    onError() {},
    onClose() {},
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      if (handlers[tag]) return handlers[tag](payload);
      if (tag === "groups.list") return { groups: [GROUP], replies: [], live: LIVE };
      if (tag === "orchestration.dispatchCommand") return { sequence: 42 };
      return {
        snapshotSequence: 5,
        projects: [{ id: "group-project", kind: "group", workspaceRoot: "/groups/group-1" }],
        threads: [thread],
      };
    },
    subscribe(tag, payload, streamHandlers) {
      const key = tag === "orchestration.subscribeThread" ? `${tag}:${payload.threadId}` : tag;
      streams.set(key, streamHandlers);
      return () => {
        if (streams.get(key) === streamHandlers) streams.delete(key);
      };
    },
    shutdown() {},
  };
  const outbound = [];
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
    now: () => "2026-11-19T10:02:00.000Z",
  });
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));
  return {
    transport,
    outbound,
    streams,
    start: () => startedHandler(),
    backendCalls: (tag) => requests.filter((r) => r.tag === tag).map((r) => r.payload),
    async call(method, params) {
      const id = `phone-${method}`;
      transport.send(JSON.stringify({ id, method, params }));
      await flush();
      return outbound.find((m) => m.id === id);
    },
  };
}

test("initialize advertises group support", async () => {
  const fake = createGroupBackend();
  const response = await fake.call("initialize", {});
  assert.equal(response.result.capabilities.djlGroups, true);
});

test("djl/groups/list returns the backend's groups, replies and live state", async () => {
  const fake = createGroupBackend();
  const response = await fake.call("djl/groups/list", {});
  assert.deepEqual(fake.backendCalls("groups.list"), [{}]);
  assert.deepEqual(response.result, { groups: [GROUP], replies: [], live: LIVE });
});

test("djl/groups/agents lists the group member agents, ready ones first", async () => {
  const fake = createGroupBackend({
    handlers: {
      "harnesses.listAccounts": () => ({
        accounts: [
          { id: "codex", installed: true, enabled: true, status: "required" },
          { id: "claudeAgent", installed: true, enabled: true, status: "ready" },
          { id: "opencode", installed: true, enabled: true, status: "ready" },
          { id: "gemini", installed: true, enabled: true, status: "ready" },
        ],
      }),
    },
  });
  const { agents } = (await fake.call("djl/groups/agents", {})).result;
  assert.deepEqual(fake.backendCalls("harnesses.listAccounts"), [{}]);
  assert.deepEqual(agents.slice(0, 3), [
    { provider: "claudeAgent", displayName: "Claude", ready: true },
    { provider: "gemini", displayName: "Gemini", ready: true },
    { provider: "codex", displayName: "Codex", ready: false },
  ]);
  assert.deepEqual(
    agents.map((agent) => agent.provider),
    [
      "claudeAgent",
      "gemini",
      "codex",
      "cursor",
      "grok",
      "kimi",
      "iflow",
      "qwen",
      "codebuddy",
      "pi",
    ],
  );
});

test("djl/groups/create passes the name and members and returns the group", async () => {
  const fake = createGroupBackend({ handlers: { "groups.create": () => GROUP } });
  const params = { name: "Launch", members: [{ provider: "claudeAgent" }, { provider: "codex" }] };
  const response = await fake.call("djl/groups/create", params);
  assert.deepEqual(fake.backendCalls("groups.create"), [params]);
  assert.deepEqual(response.result, GROUP);
});

test("djl/groups/send queues a group turn the way the desktop composer does", async () => {
  const fake = createGroupBackend();
  const response = await fake.call("djl/groups/send", { groupId: "group-1", text: " @all hi " });
  const [command] = fake.backendCalls("orchestration.dispatchCommand");
  assert.match(command.commandId, /^djl-remote-command-[0-9a-f]{32}$/);
  assert.match(command.message.messageId, /^djl-message-[0-9a-f]{32}$/);
  assert.deepEqual(command, {
    type: "thread.turn.start",
    commandId: command.commandId,
    threadId: "group-thread",
    message: {
      messageId: command.message.messageId,
      role: "user",
      text: "@all hi",
      attachments: [],
    },
    modelSelection: { provider: "group", model: "group" },
    dispatchMode: "queue",
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdAt: "2026-11-19T10:02:00.000Z",
  });
  assert.deepEqual(Object.keys(response.result), ["djlMutation"]);
  assert.equal(response.result.djlMutation.status, "confirmed");
  assert.equal(response.result.djlMutation.sequence, 42);
});

test("djl/groups/send steers while the group's round is running", async () => {
  const running = { ...GROUP_THREAD, session: { status: "running", activeTurnId: "turn-2" } };
  const fake = createGroupBackend({ thread: running });
  await fake.call("djl/groups/send", { groupId: "group-1", text: "@Claude also this" });
  assert.equal(fake.backendCalls("orchestration.dispatchCommand")[0].dispatchMode, "steer");
});

test("djl/groups/send refuses an empty message and an unknown group", async () => {
  const fake = createGroupBackend();
  const empty = await fake.call("djl/groups/send", { groupId: "group-1", text: "  " });
  assert.equal(empty.error.message, "A message is required.");
  assert.equal(empty.error.data.djlMutation.status, "failed");
  fake.outbound.length = 0;
  const missing = await fake.call("djl/groups/send", { groupId: "nope", text: "hi" });
  assert.equal(missing.error.message, "Group not found");
  assert.deepEqual(fake.backendCalls("orchestration.dispatchCommand"), []);
});

test("djl/groups/stop interrupts the group thread's turn", async () => {
  const fake = createGroupBackend();
  const response = await fake.call("djl/groups/stop", { groupId: "group-1" });
  const [command] = fake.backendCalls("orchestration.dispatchCommand");
  assert.deepEqual(command, {
    type: "thread.turn.interrupt",
    commandId: command.commandId,
    threadId: "group-thread",
    createdAt: "2026-11-19T10:02:00.000Z",
  });
  assert.equal(response.result.djlMutation.status, "confirmed");
});

test("member stop, pause and warning requests map onto the backend group methods", async () => {
  const fake = createGroupBackend({
    handlers: {
      "groups.stopMember": () => undefined,
      "groups.resolvePause": () => undefined,
      "groups.update": () => ({ ...GROUP, skipAllWarning: true }),
    },
  });
  const memberRef = { groupId: "group-1", memberId: "member-claude" };
  assert.deepEqual((await fake.call("djl/groups/stopMember", memberRef)).result, {});
  assert.deepEqual(fake.backendCalls("groups.stopMember"), [memberRef]);

  const pause = { groupId: "group-1", action: "continue", continueText: "Continue" };
  assert.deepEqual((await fake.call("djl/groups/resolvePause", pause)).result, {});
  assert.deepEqual(fake.backendCalls("groups.resolvePause"), [pause]);

  const warning = { groupId: "group-1", skipAllWarning: true };
  const updated = await fake.call("djl/groups/setSkipAllWarning", warning);
  assert.deepEqual(fake.backendCalls("groups.update"), [warning]);
  assert.deepEqual(updated.result, { ...GROUP, skipAllWarning: true });
});

test("group events and drafts are forwarded to the phone", async () => {
  const fake = createGroupBackend();
  fake.start();
  await flush();
  const stream = fake.streams.get("groups.subscribe");
  assert.ok(stream, "adapter subscribes to group events on start");

  const snapshot = { type: "snapshot", groups: [GROUP], replies: [], live: LIVE };
  const state = {
    type: "member.state",
    groupId: "group-1",
    memberId: "member-claude",
    state: "working",
  };
  stream.onChunk([snapshot, state]);
  stream.onChunk([
    {
      type: "reply.draft",
      groupId: "group-1",
      memberId: "member-claude",
      delta: "Hel",
      restart: true,
    },
  ]);

  assert.deepEqual(
    fake.outbound.filter((m) => m.method === "djl/groups/event"),
    [
      { method: "djl/groups/event", params: snapshot },
      { method: "djl/groups/event", params: state },
    ],
  );
  assert.deepEqual(
    fake.outbound.filter((m) => m.method === "djl/groups/draft"),
    [
      {
        method: "djl/groups/draft",
        params: { groupId: "group-1", memberId: "member-claude", delta: "Hel", restart: true },
      },
    ],
  );

  stream.onError(new Error("lagging"));
  const resubscribed = fake.streams.get("groups.subscribe");
  assert.ok(resubscribed && resubscribed !== stream, "a failed stream is subscribed again");
  fake.transport.shutdown();
  assert.equal(fake.streams.has("groups.subscribe"), false, "shutdown unsubscribes");
});

test("a group reply keeps its member id in history and on the live thread stream", async () => {
  const fake = createGroupBackend();
  fake.start();
  await flush();
  const history = (await fake.call("thread/read", { threadId: "group-thread" })).result.thread;
  assert.equal(history.modelProvider, "group");
  assert.deepEqual(
    history.turns.map((turn) => [turn.id, turn.items]),
    [
      [
        "djl-history-user-1",
        [
          {
            id: "user-1",
            type: "userMessage",
            role: "user",
            content: [{ type: "inputText", text: "@Claude hello" }],
            createdAt: "2026-11-19T10:00:00.000Z",
          },
        ],
      ],
      [
        "turn-1",
        [
          {
            id: GROUP_REPLY_ID,
            type: "agentMessage",
            role: "assistant",
            content: [{ type: "outputText", text: "Hello!" }],
            createdAt: "2026-11-19T10:00:05.000Z",
          },
        ],
      ],
    ],
  );

  // Group threads are subscribed like any other thread, so their events reach the phone.
  const stream = fake.streams.get("orchestration.subscribeThread:group-thread");
  stream.onChunk([{ kind: "snapshot", snapshot: { snapshotSequence: 5, thread: GROUP_THREAD } }]);
  const nextReplyId = "assistant:turn-2:gm.member-claude.reply-2";
  const messageSent = (sequence, streaming) => ({
    kind: "event",
    event: {
      sequence,
      aggregateKind: "thread",
      aggregateId: "group-thread",
      occurredAt: "2026-11-19T10:03:00.000Z",
      type: "thread.message-sent",
      payload: {
        threadId: "group-thread",
        messageId: nextReplyId,
        role: "assistant",
        text: "Done.",
        turnId: "turn-2",
        streaming,
        createdAt: "2026-11-19T10:03:00.000Z",
      },
    },
  });
  stream.onChunk([messageSent(6, true), messageSent(7, false)]);

  assert.deepEqual(
    fake.outbound.filter((m) => m.method === "item/agentMessage/delta"),
    [
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "group-thread",
          turnId: "turn-2",
          itemId: nextReplyId,
          delta: "Done.",
          djlEmittedAt: "2026-11-19T10:03:00.000Z",
        },
      },
    ],
  );
  assert.deepEqual(
    fake.outbound.filter((m) => m.method === "item/completed"),
    [
      {
        method: "item/completed",
        params: {
          threadId: "group-thread",
          turnId: "turn-2",
          item: {
            id: nextReplyId,
            type: "agentMessage",
            role: "assistant",
            content: [{ type: "outputText", text: "Done." }],
            createdAt: "2026-11-19T10:03:00.000Z",
          },
        },
      },
    ],
  );
  fake.transport.shutdown();
});
