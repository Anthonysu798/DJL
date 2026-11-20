// FILE: electron-groups.test.js
// Purpose: Verifies the phone's Multi agents group methods, group event forwarding, group attachments, and that group replies keep their member id on the thread stream.
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

function createGroupBackend({
  thread = GROUP_THREAD,
  handlers = {},
  endpoint = "ws://electron.test/ws",
  fetchImpl,
} = {}) {
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
    endpoint,
    backend,
    now: () => "2026-11-19T10:02:00.000Z",
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  let callSequence = 0;
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));
  return {
    transport,
    outbound,
    streams,
    start: () => startedHandler(),
    backendCalls: (tag) => requests.filter((r) => r.tag === tag).map((r) => r.payload),
    async call(method, params) {
      const id = `phone-${method}-${++callSequence}`;
      transport.send(JSON.stringify({ id, method, params }));
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await flush();
        const response = outbound.find((m) => m.id === id);
        if (response) return response;
      }
      return undefined;
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

// Attachments ---------------------------------------------------------------

const TOKEN_ENDPOINT = "ws://127.0.0.1:4100/ws?token=secret-token";
const CHUNK = 384 * 1024;
const HASH = "a".repeat(64);
const REFERENCE = {
  type: "file",
  id: "att-1",
  name: "Plan.pdf",
  mimeType: "application/pdf",
  sizeBytes: CHUNK + 10,
  contentHash: HASH,
  uploadMethod: "stream",
};

function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return respond(new URL(url), init);
  };
  return { impl, calls };
}

function fileBytes(size) {
  return Buffer.from(Array.from({ length: size }, (_, index) => index % 251));
}

function uploadParams(bytes, offset, end, extra = {}) {
  return {
    groupId: "group-1",
    uploadId: "up_1",
    name: "Plan.pdf",
    mimeType: "application/pdf",
    sizeBytes: bytes.length,
    offset,
    data: bytes.subarray(offset, end).toString("base64"),
    final: end >= bytes.length,
    ...extra,
  };
}

test("initialize advertises group attachment support", async () => {
  const fake = createGroupBackend();
  const response = await fake.call("initialize", {});
  assert.equal(response.result.capabilities.djlGroupAttachments, true);
});

test("djl/groups/upload assembles chunks and stores the file on the group's thread", async () => {
  const http = fakeFetch(() => Response.json({ ...REFERENCE, extra: "dropped" }));
  const fake = createGroupBackend({ endpoint: TOKEN_ENDPOINT, fetchImpl: http.impl });
  const bytes = fileBytes(CHUNK + 10);

  const first = await fake.call("djl/groups/upload", uploadParams(bytes, 0, CHUNK));
  assert.deepEqual(first.result, { received: CHUNK });
  assert.equal(http.calls.length, 0, "nothing is sent before the final chunk");

  const last = await fake.call("djl/groups/upload", uploadParams(bytes, CHUNK, bytes.length));
  assert.deepEqual(last.result, { attachment: REFERENCE });
  assert.equal(http.calls.length, 1);
  const [{ url, init }] = http.calls;
  assert.equal(url.protocol, "http:");
  assert.equal(url.host, "127.0.0.1:4100");
  assert.equal(url.pathname, "/api/attachments/upload");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    token: "secret-token",
    threadId: "group-thread",
    name: "Plan.pdf",
    mimeType: "application/pdf",
    sizeBytes: String(CHUNK + 10),
  });
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "Content-Type": "application/octet-stream" });
  assert.ok(Buffer.from(init.body).equals(bytes), "the backend receives the assembled bytes");
});

test("djl/groups/upload refuses chunks out of order", async () => {
  const http = fakeFetch(() => Response.json(REFERENCE));
  const fake = createGroupBackend({ endpoint: TOKEN_ENDPOINT, fetchImpl: http.impl });
  const bytes = fileBytes(CHUNK + 10);
  const unknown = await fake.call("djl/groups/upload", uploadParams(bytes, CHUNK, bytes.length));
  assert.equal(unknown.error.message, "Upload out of order");

  await fake.call("djl/groups/upload", uploadParams(bytes, 0, CHUNK));
  const skipped = await fake.call("djl/groups/upload", {
    ...uploadParams(bytes, CHUNK, bytes.length),
    offset: CHUNK + 1,
  });
  assert.equal(skipped.error.message, "Upload out of order");
  // The upload survives a wrong offset, so the right chunk still completes it.
  const last = await fake.call("djl/groups/upload", uploadParams(bytes, CHUNK, bytes.length));
  assert.deepEqual(last.result, { attachment: REFERENCE });
});

test("djl/groups/upload refuses oversize, overlong, incomplete and invalid uploads", async () => {
  const http = fakeFetch(() => Response.json(REFERENCE));
  const fake = createGroupBackend({ endpoint: TOKEN_ENDPOINT, fetchImpl: http.impl });
  const bytes = fileBytes(20);
  const error = async (params) => (await fake.call("djl/groups/upload", params)).error.message;

  assert.equal(
    await error(uploadParams(bytes, 0, 10, { sizeBytes: 100 * 1024 * 1024 + 1 })),
    "Attachment is empty or larger than 100 MB.",
  );
  assert.equal(
    await error(uploadParams(bytes, 0, 20, { sizeBytes: 10 })),
    "Upload is larger than its declared size.",
  );
  assert.equal(
    await error(
      uploadParams(bytes, 0, 10, { data: Buffer.alloc(512 * 1024 + 3).toString("base64") }),
    ),
    "Invalid upload chunk.",
  );
  assert.equal(await error(uploadParams(bytes, 0, 10, { final: true })), "Upload is incomplete.");
  assert.equal(
    await error(uploadParams(bytes, 0, 10, { uploadId: "bad id" })),
    "Invalid upload id.",
  );
  assert.equal(
    await error(uploadParams(bytes, 0, 10, { name: "../secret" })),
    "Invalid attachment name.",
  );
  assert.equal(
    await error(uploadParams(bytes, 0, 10, { mimeType: "x".repeat(101) })),
    "Invalid attachment MIME type.",
  );
  assert.equal(http.calls.length, 0);
});

test("djl/groups/upload drops an upload idle for ten minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const http = fakeFetch(() => Response.json(REFERENCE));
  const fake = createGroupBackend({ endpoint: TOKEN_ENDPOINT, fetchImpl: http.impl });
  const bytes = fileBytes(CHUNK + 10);
  await fake.call("djl/groups/upload", uploadParams(bytes, 0, CHUNK));
  t.mock.timers.tick(10 * 60 * 1000 + 1);
  const late = await fake.call("djl/groups/upload", uploadParams(bytes, CHUNK, bytes.length));
  assert.equal(late.error.message, "Upload out of order");
  assert.equal(http.calls.length, 0);
});

test("attachment methods need the desktop app's endpoint", async () => {
  const fake = createGroupBackend({ endpoint: null });
  const bytes = fileBytes(10);
  const upload = await fake.call("djl/groups/upload", uploadParams(bytes, 0, 10));
  assert.equal(upload.error.message, "Attachments need the DJL desktop app.");
  const download = await fake.call("djl/groups/attachment", { attachmentId: "att-1", offset: 0 });
  assert.equal(download.error.message, "Attachments need the DJL desktop app.");
});

test("djl/groups/send carries exactly the validated attachment references", async () => {
  const fake = createGroupBackend();
  const image = { ...REFERENCE, type: "image", id: "img-1", mimeType: "image/png", name: "a.png" };
  const response = await fake.call("djl/groups/send", {
    groupId: "group-1",
    text: "",
    attachments: [
      { ...REFERENCE, extra: "dropped" },
      { ...image, dataUrl: "data:" },
    ],
  });
  assert.equal(response.result.djlMutation.status, "confirmed");
  const [command] = fake.backendCalls("orchestration.dispatchCommand");
  assert.equal(command.message.text, "");
  assert.deepEqual(command.message.attachments, [REFERENCE, image]);
});

test("djl/groups/send rejects an invalid attachment reference", async () => {
  const fake = createGroupBackend();
  const invalid = [
    { ...REFERENCE, type: "image" },
    { ...REFERENCE, contentHash: "abc" },
    { ...REFERENCE, uploadMethod: "inline" },
    { ...REFERENCE, id: "../etc" },
    { ...REFERENCE, sizeBytes: 0 },
    { ...REFERENCE, name: "a/b.pdf" },
  ];
  for (const attachment of invalid) {
    const response = await fake.call("djl/groups/send", {
      groupId: "group-1",
      text: "hi",
      attachments: [attachment],
    });
    assert.equal(response.error.message, "Invalid attachment.", JSON.stringify(attachment));
  }
  const tooMany = await fake.call("djl/groups/send", {
    groupId: "group-1",
    text: "hi",
    attachments: Array.from({ length: 21 }, () => REFERENCE),
  });
  assert.equal(tooMany.error.message, "Send at most 20 attachments.");
  const empty = await fake.call("djl/groups/send", {
    groupId: "group-1",
    text: "",
    attachments: [],
  });
  assert.equal(empty.error.message, "A message is required.");
  assert.deepEqual(fake.backendCalls("orchestration.dispatchCommand"), []);
});

test("djl/groups/attachment pages a stored attachment from one cached download", async () => {
  const bytes = fileBytes(CHUNK + 10);
  const http = fakeFetch(
    () => new Response(bytes, { headers: { "Content-Type": "application/pdf; charset=binary" } }),
  );
  const fake = createGroupBackend({
    endpoint: "wss://desktop.test/ws?token=secret-token",
    fetchImpl: http.impl,
  });

  const first = (await fake.call("djl/groups/attachment", { attachmentId: "att-1", offset: 0 }))
    .result;
  assert.deepEqual(
    { ...first, data: undefined },
    { data: undefined, offset: 0, sizeBytes: CHUNK + 10, mimeType: "application/pdf", done: false },
  );
  const second = (
    await fake.call("djl/groups/attachment", { attachmentId: "att-1", offset: CHUNK })
  ).result;
  assert.equal(second.done, true);
  assert.equal(second.offset, CHUNK);
  const joined = Buffer.concat([
    Buffer.from(first.data, "base64"),
    Buffer.from(second.data, "base64"),
  ]);
  assert.ok(joined.equals(bytes), "the two chunks rebuild the file");

  assert.equal(http.calls.length, 1, "the file is fetched once for both chunks");
  const [{ url, init }] = http.calls;
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, "/attachments/att-1");
  assert.equal(url.searchParams.get("token"), "secret-token");
  assert.equal(init.method, "GET");

  const invalid = await fake.call("djl/groups/attachment", { attachmentId: "../x", offset: 0 });
  assert.equal(invalid.error.message, "Invalid attachment id.");
});

test("djl/groups/attachment reports a missing attachment", async () => {
  const http = fakeFetch(() => new Response("Not Found", { status: 404 }));
  const fake = createGroupBackend({ endpoint: TOKEN_ENDPOINT, fetchImpl: http.impl });
  const response = await fake.call("djl/groups/attachment", { attachmentId: "gone", offset: 0 });
  assert.equal(response.error.message, "Attachment not found.");
});

test("user messages carry their file metadata in history and on the live stream", async () => {
  const stored = [
    { ...REFERENCE },
    { type: "assistant-selection", id: "sel-1", assistantMessageId: "m", text: "quote" },
  ];
  const summary = [
    {
      type: "file",
      id: "att-1",
      name: "Plan.pdf",
      mimeType: "application/pdf",
      sizeBytes: CHUNK + 10,
    },
  ];
  const withFiles = {
    ...GROUP_THREAD,
    messages: [{ ...GROUP_THREAD.messages[0], attachments: stored }, GROUP_THREAD.messages[1]],
  };
  const fake = createGroupBackend({ thread: withFiles });
  fake.start();
  await flush();

  const history = (await fake.call("thread/read", { threadId: "group-thread" })).result.thread;
  const [userItem] = history.turns[0].items;
  assert.deepEqual(userItem.attachments, summary);
  assert.deepEqual(userItem.content, [{ type: "inputText", text: "@Claude hello" }]);
  assert.equal("attachments" in history.turns[1].items[0], false, "replies have none");

  const stream = fake.streams.get("orchestration.subscribeThread:group-thread");
  // A new user message in a detail snapshot.
  const fromSnapshot = {
    id: "user-2",
    role: "user",
    text: "",
    turnId: null,
    createdAt: "2026-11-19T10:04:00.000Z",
    attachments: stored,
  };
  stream.onChunk([
    {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 6,
        thread: { ...withFiles, messages: [...withFiles.messages, fromSnapshot] },
      },
    },
  ]);
  // A new user message as a live event.
  stream.onChunk([
    {
      kind: "event",
      event: {
        sequence: 7,
        aggregateKind: "thread",
        aggregateId: "group-thread",
        occurredAt: "2026-11-19T10:05:00.000Z",
        type: "thread.message-sent",
        payload: {
          threadId: "group-thread",
          messageId: "user-3",
          role: "user",
          text: "see file",
          attachments: stored,
          turnId: null,
          streaming: false,
          createdAt: "2026-11-19T10:05:00.000Z",
        },
      },
    },
  ]);
  const userMessages = fake.outbound
    .filter((m) => m.method === "codex/event/user_message")
    .map((m) => m.params);
  const byId = Object.fromEntries(userMessages.map((params) => [params.itemId, params]));
  assert.deepEqual(byId["user-2"].attachments, summary);
  assert.equal(byId["user-2"].message, "");
  assert.deepEqual(byId["user-3"].attachments, summary);
  assert.equal(byId["user-3"].message, "see file");
  fake.transport.shutdown();
});
