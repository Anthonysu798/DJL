// FILE: guest-gateway.test.js
// Purpose: Drives the real bridge and the real Electron adapter in guest mode: an invited guest
//          reaches one group's chat and nothing else on the owner's computer.
// Layer: Integration test
// Exports: node:test suite
// Depends on: node:test, ws, ../src/bridge with mocked transports, ../src/electron-app-server-adapter

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { setTimeout: wait } = require("node:timers/promises");
const WebSocket = require("ws");

const { createElectronAppServerTransport } = require("../src/electron-app-server-adapter");

const SCOPE = {
  guestId: "a1b2c3d4e5f60718",
  groupId: "group-1",
  threadId: "group-thread",
  role: "chat",
  name: "Alex",
};
const guest = (role = "chat") => ({ id: SCOPE.guestId, name: "Alex", role });
const group = (id, threadId, guests) => ({
  id,
  threadId,
  projectId: `${id}-project`,
  name: id,
  folder: `/Users/owner/${id}`,
  brief: "owner's private brief",
  members: [{ id: `${id}-m1`, groupId: id, provider: "claudeAgent", handle: "Claude" }],
  guests,
  pendingHandoffs: [],
});
const thread = (id, text) => ({
  id,
  projectId: "p",
  title: id,
  createdAt: "2026-11-24T10:00:00.000Z",
  updatedAt: "2026-11-24T10:01:00.000Z",
  worktreePath: "/Users/owner/secret-folder",
  modelSelection: { provider: "group", model: "group" },
  runtimeMode: "approval-required",
  messages: [
    { id: `${id}-u1`, role: "user", text, turnId: "t1", createdAt: "2026-11-24T10:00:00.000Z" },
  ],
  activities: [
    {
      id: `${id}-a1`,
      turnId: "t1",
      tone: "tool",
      kind: "tool.completed",
      summary: "cat /Users/owner/.ssh/id_rsa",
      payload: { itemType: "command_execution", data: { command: "cat /Users/owner/.ssh/id_rsa" } },
      createdAt: "2026-11-24T10:00:02.000Z",
    },
  ],
  session: null,
  latestTurn: null,
  archivedAt: null,
  deletedAt: null,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createGuestAdapter({ guests = [guest()], scope = SCOPE } = {}) {
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
      if (tag === "groups.list")
        return {
          groups: [group("group-1", "group-thread", guests), group("group-2", "other-thread", [])],
          replies: [{ id: "r2", groupId: "group-2", text: "other group's reply" }],
          live: { memberStates: { "group-2-m1": "working" }, drafts: { "group-2-m1": "secret" } },
        };
      if (tag === "orchestration.dispatchCommand") return { sequence: 7 };
      if (tag === "groups.guestAgentJoin") {
        const joined = group("group-1", "group-thread", guests);
        joined.members.push({
          id: "visiting",
          groupId: "group-1",
          handle: "Bo",
          guestId: payload.guestId,
        });
        return joined;
      }
      if (tag.startsWith("groups.guestAgent")) return null;
      return {
        snapshotSequence: 1,
        projects: [],
        threads: [
          thread("group-thread", "hello group"),
          thread("other-thread", "owner's private chat"),
        ],
      };
    },
    subscribe(tag, payload, handlers) {
      streams.set(
        tag === "orchestration.subscribeThread" ? `${tag}:${payload.threadId}` : tag,
        handlers,
      );
      return () => {};
    },
    shutdown() {},
  };
  const outbound = [];
  const transport = createElectronAppServerTransport({
    endpoint: "ws://electron.test/ws",
    backend,
    now: () => "2026-11-24T10:02:00.000Z",
    guestScope: scope,
  });
  transport.onMessage((raw) => outbound.push(JSON.parse(raw)));
  let sequence = 0;
  return {
    outbound,
    streams,
    transport,
    start: () => startedHandler(),
    backendCalls: (tag) =>
      requests.filter((entry) => entry.tag === tag).map((entry) => entry.payload),
    async call(method, params) {
      const id = `guest-${++sequence}`;
      transport.send(JSON.stringify({ id, method, params }));
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await flush();
        const response = outbound.find((message) => message.id === id);
        if (response) return response;
      }
      return undefined;
    },
  };
}

test("a guest's group list is their one group, without the owner's paths or brief", async () => {
  const fake = createGuestAdapter();
  const { result } = await fake.call("djl/groups/list", {});
  assert.deepEqual(
    result.groups.map((entry) => entry.id),
    ["group-1"],
  );
  assert.deepEqual(result.replies, []);
  assert.deepEqual(result.live, { memberStates: {}, drafts: {} });
  assert.doesNotMatch(JSON.stringify(result), /owner|secret|group-2/);
});

test("a guest's message carries the guest's id, a namespaced command id and no files", async () => {
  const fake = createGuestAdapter();
  const response = await fake.call("djl/groups/send", {
    groupId: "group-1",
    text: " @Claude hello ",
    attachments: [{ id: "att-1", name: "x.png", mimeType: "image/png", sizeBytes: 3 }],
  });
  assert.equal(response.error, undefined);
  const [command] = fake.backendCalls("orchestration.dispatchCommand");
  assert.equal(command.type, "thread.turn.start");
  assert.equal(command.threadId, "group-thread");
  assert.match(command.message.messageId, /^group-guest-a1b2c3d4e5f60718-[A-Za-z0-9]+$/);
  assert.match(command.commandId, /-ga1b2c3d4e5f60718$/);
  assert.equal(command.message.text, "@Claude hello");
  assert.deepEqual(command.message.attachments, []);
});

test("a guest cannot write to another group, as a watcher, or after being removed", async () => {
  const otherGroup = await createGuestAdapter().call("djl/groups/send", {
    groupId: "group-2",
    text: "hi",
  });
  assert.match(otherGroup.error.message, /not available to guests/);

  const watcher = createGuestAdapter({ scope: { ...SCOPE, role: "viewer" } });
  assert.match(
    (await watcher.call("djl/groups/send", { groupId: "group-1", text: "hi" })).error.message,
    /guests/,
  );
  assert.equal(watcher.backendCalls("orchestration.dispatchCommand").length, 0);

  // The owner removed the guest (or made them a watcher) while this gateway was still running.
  for (const guests of [[], [guest("viewer")]]) {
    const stale = createGuestAdapter({ guests });
    const refused = await stale.call("djl/groups/send", { groupId: "group-1", text: "one more" });
    assert.match(refused.error.message, /not available to guests/);
    assert.equal(stale.backendCalls("orchestration.dispatchCommand").length, 0);
  }
});

test("a guest reads their group's messages only: no folder path, no tool activity, no other chat", async () => {
  const fake = createGuestAdapter();
  const read = await fake.call("thread/read", { threadId: "group-thread", includeTurns: true });
  assert.equal(read.result.thread.cwd, undefined);
  const items = read.result.thread.turns.flatMap((turn) => turn.items);
  assert.deepEqual(
    items.map((item) => item.type),
    ["userMessage"],
  );
  assert.doesNotMatch(JSON.stringify(read.result), /owner|id_rsa|secret-folder/);

  const other = await fake.call("thread/read", { threadId: "other-thread", includeTurns: true });
  assert.match(other.error.message, /not available to guests/);
});

test("everything that is the owner's is refused, and the chat list is empty", async () => {
  const fake = createGuestAdapter();
  assert.deepEqual((await fake.call("thread/list", {})).result, { data: [], nextCursor: null });
  assert.deepEqual((await fake.call("model/list", {})).result, { data: [] });
  for (const [method, params] of [
    ["turn/start", { threadId: "other-thread", input: [{ type: "text", text: "rm -rf" }] }],
    ["thread/start", { cwd: "/Users/owner" }],
    ["turn/interrupt", { threadId: "group-thread" }],
    ["thread/archive", { threadId: "group-thread" }],
    ["djl/terminal/write", { data: "ls\n" }],
    ["djl/groups/create", { name: "mine", members: [] }],
    ["djl/groups/stop", { groupId: "group-1" }],
    ["djl/groups/attachment", { attachmentId: "att-1", offset: 0 }],
    ["fuzzyFileSearch", { query: "passwords" }],
    ["skills/list", {}],
  ]) {
    const response = await fake.call(method, params);
    assert.match(response.error.message, /not available to guests/, method);
  }
  assert.equal(fake.backendCalls("orchestration.dispatchCommand").length, 0);
});

test("a guest's device cannot answer the owner's approval prompts", async () => {
  const fake = createGuestAdapter();
  fake.transport.send(JSON.stringify({ id: "approval-1", result: { decision: "approved" } }));
  await flush();
  await flush();
  assert.equal(fake.backendCalls("orchestration.dispatchCommand").length, 0);
});

test("group events reach a guest only for their own group", async () => {
  const fake = createGuestAdapter();
  fake.start();
  await flush();
  const stream = fake.streams.get("groups.subscribe");
  assert.ok(stream, "the guest gateway subscribes to group events");
  fake.outbound.length = 0;
  stream.onChunk([
    { type: "member.state", groupId: "group-2", memberId: "group-2-m1", state: "working" },
    {
      type: "reply.draft",
      groupId: "group-2",
      memberId: "group-2-m1",
      delta: "secret",
      restart: false,
    },
    { type: "member.state", groupId: "group-1", memberId: "group-1-m1", state: "working" },
    { type: "group.upserted", group: group("group-1", "group-thread", [guest()]) },
  ]);
  const events = fake.outbound.filter((message) => message.method?.startsWith("djl/groups/"));
  assert.deepEqual(
    events.map((message) => message.params.type),
    ["member.state", "group.upserted"],
  );
  assert.equal(events[1].params.group.folder, "(hidden)");
  assert.doesNotMatch(JSON.stringify(events), /group-2|secret|owner/);
});

// ─── The bridge itself, in guest mode ────────────────────────────────────────

function loadBridge(createCodexTransportImpl) {
  const bridgePath = require.resolve("../src/bridge");
  const originalLoad = Module._load;
  delete require.cache[bridgePath];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === bridgePath && request === "./codex-transport")
      return { createCodexTransport: createCodexTransportImpl };
    if (parent?.filename === bridgePath && request === "./secure-transport")
      return {
        createBridgeSecureTransport: (options) => ({
          createPairingPayload: () => ({
            v: 1,
            expiresAt: Date.now() + 60_000,
            displayName: options.displayName,
          }),
          bindLiveSendWireMessage() {},
          handleIncomingWireMessage(message, { onApplicationMessage }) {
            onApplicationMessage(message);
            return true;
          },
          queueOutboundApplicationMessage: (message, send) => send(message),
        }),
      };
    if (parent?.filename === bridgePath && request === "./secure-device-state")
      return {
        loadOrCreateBridgeDeviceState: () => ({
          macDeviceId: "guest-mac",
          macIdentityPublicKey: "guest-key",
          relaySessionSecret: "test-relay-session-secret-that-is-long-enough",
          trustedPhones: {},
        }),
        rememberLastSeenPhoneAppVersion: (state) => state,
        resolveBridgeRelaySession: (deviceState) => ({ sessionId: "guest-session", deviceState }),
      };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require("../src/bridge");
  } finally {
    Module._load = originalLoad;
    delete require.cache[bridgePath];
  }
}

function fakeCodex() {
  const listeners = {};
  const sent = [];
  return {
    sent,
    transportOptions: null,
    describe: () => "fake adapter",
    send: (message) => sent.push(JSON.parse(message)),
    onMessage: (handler) => (listeners.message = handler),
    onClose: (handler) => (listeners.close = handler),
    onError() {},
    onStarted: (handler) => setImmediate(() => handler({ mode: "djl-electron" })),
    shutdown: () => listeners.close?.(),
    emit: (message) => listeners.message?.(JSON.stringify(message)),
  };
}

async function waitFor(predicate, timeoutMs = 1500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition");
    await wait(5);
  }
}

const guestConfig = (port, overrides = {}) => ({
  relayUrl: `ws://127.0.0.1:${port}`,
  pushServiceUrl: "",
  pushPreviewMaxChars: 160,
  refreshEnabled: false,
  refreshDebounceMs: 1,
  keepMacAwakeEnabled: false,
  codexEndpoint: "",
  electronBackendEndpoint: "ws://127.0.0.1:1/?token=test",
  refreshCommand: "",
  codexBundleId: "",
  codexAppPath: "",
  desktopIpcEnabled: false,
  desktopIpcLiveSyncEnabled: false,
  remoteThreadScopeEnabled: false,
  guestScope: JSON.stringify(SCOPE),
  displayName: "Launch (DJL group)",
  ...overrides,
});

function withGuestStateEnv(t) {
  const saved = {
    dir: process.env.DJL_DEVICE_STATE_DIR,
    mirror: process.env.DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE,
  };
  process.env.DJL_DEVICE_STATE_DIR = "/tmp/djl-guest-test/state";
  process.env.DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE = "/tmp/djl-guest-test/state/mirror.json";
  const restore = () => {
    for (const [key, value] of [
      ["DJL_DEVICE_STATE_DIR", saved.dir],
      ["DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE", saved.mirror],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  t?.after(restore);
  return restore;
}

test("a lent agent's gateway announces it, passes its turns out and its answers in", async () => {
  const scope = { ...SCOPE, role: "agent", name: "Bo" };
  const fake = createGuestAdapter({ guests: [guest("agent")], scope });
  fake.start();
  // No chat is streamed to a guest who only lends an agent.
  assert.equal(fake.streams.has("groups.subscribe"), false);
  assert.equal(fake.streams.has("groups.guestAgentTurns"), false);

  const joined = await fake.call("djl/groups/agent/join", {
    provider: "codex",
    model: " gpt-x ",
    sessionId: "s1",
    groupId: "group-2",
    guestId: "someone-else",
  });
  // The group and guest come from this gateway's scope, never from the device.
  assert.deepEqual(fake.backendCalls("groups.guestAgentJoin"), [
    {
      groupId: "group-1",
      guestId: SCOPE.guestId,
      provider: "codex",
      model: "gpt-x",
      sessionId: "s1",
    },
  ]);
  assert.deepEqual(joined.result, { groupName: "group-1", handle: "Bo" });

  fake.streams.get("groups.guestAgentTurns").onChunk([
    { type: "turn", turnId: "t1", prompt: "the group's message" },
    { type: "cancel", turnId: "t1" },
  ]);
  assert.deepEqual(
    fake.outbound.filter((message) => message.method?.startsWith("djl/groups/agent/")),
    [
      { method: "djl/groups/agent/turn", params: { turnId: "t1", prompt: "the group's message" } },
      { method: "djl/groups/agent/cancel", params: { turnId: "t1" } },
    ],
  );

  await fake.call("djl/groups/agent/draft", { turnId: "t1", delta: "Hi", restart: true });
  await fake.call("djl/groups/agent/reply", {
    turnId: "t1",
    status: "ok",
    text: "Hi all",
    guestId: "someone-else",
  });
  assert.deepEqual(fake.backendCalls("groups.guestAgentDraft"), [
    { groupId: "group-1", guestId: SCOPE.guestId, turnId: "t1", delta: "Hi", restart: true },
  ]);
  assert.deepEqual(fake.backendCalls("groups.guestAgentReply"), [
    { groupId: "group-1", guestId: SCOPE.guestId, turnId: "t1", status: "ok", text: "Hi all" },
  ]);

  // It still cannot read or write the chat, or anything of the owner's.
  for (const [method, params] of [
    ["djl/groups/list", {}],
    ["thread/read", { threadId: "group-thread" }],
    ["djl/groups/send", { groupId: "group-1", text: "hi" }],
    ["thread/start", {}],
  ]) {
    const response = await fake.call(method, params);
    assert.equal(response.error?.message, "This is not available to guests.", method);
  }
});

test("an over-long answer is cut to what the backend accepts, so the turn still ends", async () => {
  const fake = createGuestAdapter({
    guests: [guest("agent")],
    scope: { ...SCOPE, role: "agent", name: "Bo" },
  });
  await fake.call("djl/groups/agent/reply", {
    turnId: "t1",
    status: "ok",
    text: "x".repeat(250_000),
  });
  assert.equal(fake.backendCalls("groups.guestAgentReply")[0].text.length, 200_000);
});

test("a guest in the chat cannot pose as an agent", async () => {
  const fake = createGuestAdapter();
  const response = await fake.call("djl/groups/agent/join", { provider: "codex", sessionId: "s1" });
  assert.equal(response.error?.message, "This is not available to guests.");
  assert.deepEqual(fake.backendCalls("groups.guestAgentJoin"), []);
});

test("the bridge in guest mode never runs its local handlers and lets only the guest's chat out", async (t) => {
  withGuestStateEnv(t);
  const relayServer = new WebSocket.Server({ port: 0 });
  await new Promise((resolve) => relayServer.once("listening", resolve));
  const relayMessages = [];
  let relaySocket = null;
  let registeredName = null;
  relayServer.on("connection", (socket, request) => {
    relaySocket = socket;
    registeredName = request.headers["x-machine-name"] ?? null;
    socket.on("message", (data) => {
      try {
        relayMessages.push(JSON.parse(data.toString("utf8")));
      } catch {}
    });
  });
  let codex = null;
  let transportOptions = null;
  const { startBridge } = loadBridge((options) => {
    transportOptions = options;
    codex = fakeCodex();
    return codex;
  });
  let bridge = null;
  t.after(() => {
    bridge?.stop();
    relaySocket?.close();
    relayServer.close();
  });
  bridge = startBridge({ printPairingQr: false, config: guestConfig(relayServer.address().port) });
  await waitFor(() => relaySocket && relaySocket.readyState === WebSocket.OPEN);

  // The adapter is created with the scope, and the relay sees the group's name, not the host's.
  assert.equal(transportOptions.guestScope.guestId, SCOPE.guestId);
  assert.equal(registeredName, "Launch (DJL group)");

  const fromGuest = (message) => relaySocket.send(JSON.stringify(message));
  // Requests the ordinary bridge answers itself from the owner's disk, git and settings.
  fromGuest({ id: "g1", method: "workspace/readFile", params: { path: "/etc/hosts" } });
  fromGuest({ id: "g2", method: "project/list", params: {} });
  fromGuest({ id: "g3", method: "git/status", params: { cwd: "/" } });
  fromGuest({ id: "g4", method: "desktop/preferences/update", params: { keepMacAwake: true } });
  fromGuest({
    id: "g5",
    method: "account/login/openOnMac",
    params: { url: "https://example.com" },
  });
  fromGuest({ id: "g6", method: "notifications/push/register", params: { token: "t" } });
  // A reply, as if answering an approval prompt.
  fromGuest({ id: "approval-7", result: { decision: "approved" } });
  fromGuest({ id: "g8", method: "djl/groups/list", params: {} });
  await waitFor(() => codex.sent.some((message) => message.id === "g8"));

  // Each request went straight to the adapter (which refuses what a guest may not do); none
  // was answered by a local handler, and the reply was dropped.
  assert.deepEqual(
    codex.sent.map((message) => message.id),
    ["g1", "g2", "g3", "g4", "g5", "g6", "g8"],
  );
  await wait(50);
  assert.deepEqual(
    relayMessages.filter((message) => message.id !== undefined),
    [],
    "no local handler answered the guest",
  );

  // Outbound: only the guest's own chat and replies to the guest's requests leave.
  relayMessages.length = 0;
  codex.emit({
    method: "item/agentMessage/delta",
    params: { threadId: "other-thread", delta: "secret" },
  });
  codex.emit({ method: "thread/started", params: { thread: { id: "t9", cwd: "/Users/owner" } } });
  codex.emit({
    id: "srv-1",
    method: "item/commandExecution/requestApproval",
    params: { threadId: "group-thread" },
  });
  codex.emit({ method: "djl/terminal/output", params: { data: "ls" } });
  // A tool call the agent finished in the guest's own group chat stays inside too.
  codex.emit({
    method: "item/completed",
    params: {
      threadId: "group-thread",
      item: { type: "commandExecution", command: "cat /Users/owner/.ssh/id_rsa" },
    },
  });
  codex.emit({
    method: "item/agentMessage/delta",
    params: { threadId: "group-thread", delta: "hello" },
  });
  codex.emit({ id: "g8", result: { groups: [] } });
  await waitFor(() => relayMessages.some((message) => message.id === "g8"));
  assert.deepEqual(
    relayMessages.filter((message) => message.method !== "djl/presence/heartbeat"),
    [
      { method: "item/agentMessage/delta", params: { threadId: "group-thread", delta: "hello" } },
      { id: "g8", result: { groups: [] } },
    ],
  );
});

test("a guest scope that cannot be read stops the bridge instead of opening an ordinary one", (t) => {
  const { startBridge } = loadBridge(() => fakeCodex());
  // Without its own state folder a guest gateway would take over the owner's identity.
  assert.throws(
    () => startBridge({ printPairingQr: false, config: guestConfig(1) }),
    /its own device state folder/,
  );
  withGuestStateEnv(t);
  for (const guestScope of [
    "{not json",
    JSON.stringify({ ...SCOPE, role: "owner" }),
    JSON.stringify({ ...SCOPE, guestId: "" }),
  ])
    assert.throws(
      () => startBridge({ printPairingQr: false, config: guestConfig(1, { guestScope }) }),
      /guest scope/,
    );
  // A guest gateway without the desktop backend would fall back to the full Codex bridge.
  assert.throws(
    () =>
      startBridge({
        printPairingQr: false,
        config: guestConfig(1, { electronBackendEndpoint: "" }),
      }),
    /needs the DJL desktop backend/,
  );
});

test("a guest's state folder gets a brand-new identity and trusts nobody", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-guest-identity-"));
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  process.env.DJL_DEVICE_STATE_DIR = dir;
  process.env.DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE = path.join(dir, "mirror.json");
  delete process.env.DJL_DEVICE_STATE_FILE;
  const { loadOrCreateBridgeDeviceState } = require("../src/secure-device-state");
  const first = loadOrCreateBridgeDeviceState();
  assert.deepEqual(first.trustedPhones, {});
  assert.ok(first.macDeviceId);
  assert.ok(fs.existsSync(path.join(dir, "device-state.json")));
  // The mirror lives in the guest's own folder, never in the shared Keychain entry.
  assert.ok(fs.existsSync(path.join(dir, "mirror.json")));
  assert.equal(loadOrCreateBridgeDeviceState().macDeviceId, first.macDeviceId);
});
