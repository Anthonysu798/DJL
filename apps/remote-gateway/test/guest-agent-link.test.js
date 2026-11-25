// FILE: guest-agent-link.test.js
// Purpose: The lender's side of a visiting agent: announcing it, answering the group's turns
//          through this computer's backend, and stopping cleanly.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, ../src/guest-agent-link

const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: wait } = require("node:timers/promises");

const { createGuestAgentLink } = require("../src/guest-agent-link");

function setup({ sessions = ["s1"], heartbeatMs = 10_000 } = {}) {
  const sent = [];
  const statuses = [];
  const asks = [];
  const requests = [];
  let transport = null;
  let opened = 0;
  const client = {
    started: false,
    forgotten: false,
    stopped: false,
    start() {
      this.started = true;
    },
    send(message) {
      sent.push(message);
      return true;
    },
    stop() {
      this.stopped = true;
    },
    forget() {
      this.forgotten = true;
    },
  };
  const backend = {
    request: async (tag, payload) => {
      requests.push({ tag, payload });
      if (tag === "groups.lentAgentOpen")
        return { sessionId: sessions[Math.min(opened++, sessions.length - 1)] };
      return {};
    },
    subscribe(tag, payload, handlers) {
      const ask = { tag, payload, handlers, stopped: false };
      asks.push(ask);
      return () => {
        ask.stopped = true;
      };
    },
  };
  const link = createGuestAgentLink({
    linkId: "link00001",
    provider: "codex",
    model: "gpt-x",
    stateDir: "/unused",
    relayUrl: "wss://relay.test/relay",
    code: "ABCDEFGHJK",
    backend,
    heartbeatMs,
    draftFlushMs: 5,
    onStatus: (status) => statuses.push(status),
    createClient: (options) => {
      transport = options;
      return client;
    },
  });
  link.start();
  return {
    link,
    client,
    sent,
    statuses,
    asks,
    requests,
    connect: async () => {
      transport.onStatus({ state: "connected", hostName: "Alice's Mac" });
      await wait(0);
    },
    transport: () => transport,
    receive: (message) => transport.onMessage(message),
    last: () => statuses.at(-1),
  };
}

test("it announces its agent once connected and reports where the agent went", async () => {
  const t = setup();
  assert.equal(t.transport().code, "ABCDEFGHJK");
  assert.equal(t.last().state, "connecting");
  await t.connect();
  assert.deepEqual(t.sent, [
    {
      id: "join-1",
      method: "djl/groups/agent/join",
      params: { provider: "codex", model: "gpt-x", sessionId: "s1" },
    },
  ]);
  // Connected for the user only once the group accepted the agent.
  assert.equal(t.last().state, "connecting");
  t.receive({ id: "join-1", result: { groupName: "Launch team", handle: "Bo" } });
  assert.deepEqual(t.last(), {
    state: "connected",
    hostName: "Alice's Mac",
    groupName: "Launch team",
    handle: "Bo",
    busy: false,
  });
  t.link.stop();
});

test("it keeps saying it is there", async () => {
  const t = setup({ heartbeatMs: 15 });
  await t.connect();
  const joins = () => t.sent.filter((message) => message.method === "djl/groups/agent/join");
  // Waits for the repeats rather than a fixed time, so a busy machine cannot fail it.
  for (let attempt = 0; attempt < 200 && joins().length < 3; attempt += 1) await wait(10);
  t.link.stop();
  assert.ok(joins().length >= 3, `expected repeated announcements, got ${joins().length}`);
});

test("a turn is answered by this computer's agent, with drafts on the way", async () => {
  const t = setup();
  await t.connect();
  t.receive({ method: "djl/groups/agent/turn", params: { turnId: "t1", prompt: "hello group" } });
  await wait(0);
  assert.deepEqual(t.asks[0].payload, {
    linkId: "link00001",
    sessionId: "s1",
    provider: "codex",
    model: "gpt-x",
    prompt: "hello group",
  });
  assert.equal(t.last().busy, true);
  t.asks[0].handlers.onChunk([
    { type: "draft", delta: "Hel", restart: true },
    { type: "draft", delta: "lo", restart: false },
  ]);
  await wait(20);
  t.asks[0].handlers.onChunk([{ type: "done", status: "ok", text: "Hello" }]);
  const methods = t.sent.slice(1).map((message) => [message.method, message.params]);
  assert.deepEqual(methods, [
    ["djl/groups/agent/draft", { turnId: "t1", delta: "Hello", restart: true }],
    ["djl/groups/agent/reply", { turnId: "t1", status: "ok", text: "Hello" }],
  ]);
  assert.equal(t.asks[0].stopped, true);
  assert.equal(t.last().busy, false);
  t.link.stop();
});

test("a cancelled turn stops the agent and sends no answer", async () => {
  const t = setup();
  await t.connect();
  t.receive({ method: "djl/groups/agent/turn", params: { turnId: "t1", prompt: "long task" } });
  await wait(0);
  t.receive({ method: "djl/groups/agent/cancel", params: { turnId: "t1" } });
  assert.equal(t.asks[0].stopped, true);
  t.asks[0].handlers.onChunk([{ type: "done", status: "ok", text: "too late" }]);
  assert.equal(
    t.sent.some((message) => message.method === "djl/groups/agent/reply"),
    false,
  );
  t.link.stop();
});

test("a failing agent answers with what went wrong", async () => {
  const t = setup();
  await t.connect();
  t.receive({ method: "djl/groups/agent/turn", params: { turnId: "t1", prompt: "hi" } });
  await wait(0);
  t.asks[0].handlers.onChunk([{ type: "done", status: "failed", text: "not signed in" }]);
  assert.deepEqual(t.sent.at(-1).params, { turnId: "t1", status: "failed", text: "not signed in" });
  t.link.stop();
});

test("a turn written for a session the agent no longer has is refused, then re-announced", async () => {
  const t = setup({ sessions: ["s1", "s2"] });
  await t.connect();
  t.receive({ method: "djl/groups/agent/turn", params: { turnId: "t1", prompt: "hi" } });
  await wait(5);
  assert.equal(t.asks.length, 0);
  const reply = t.sent.find((message) => message.method === "djl/groups/agent/reply");
  assert.equal(reply.params.status, "failed");
  assert.equal(t.sent.at(-1).method, "djl/groups/agent/join");
  assert.equal(t.sent.at(-1).params.sessionId, "s2");
  t.link.stop();
});

test("losing the connection stops what the agent was answering", async () => {
  const t = setup();
  await t.connect();
  t.receive({ id: "join-1", result: { groupName: "Launch team", handle: "Bo" } });
  t.receive({ method: "djl/groups/agent/turn", params: { turnId: "t1", prompt: "hi" } });
  await wait(0);
  t.transport().onStatus({ state: "offline", hostName: "Alice's Mac", error: "host is asleep" });
  assert.equal(t.asks[0].stopped, true);
  assert.deepEqual(t.last(), {
    state: "offline",
    hostName: "Alice's Mac",
    groupName: "Launch team",
    handle: "Bo",
    busy: false,
    error: "host is asleep",
  });
  t.link.stop();
});

test("a group that no longer wants the agent ends the link's welcome", async () => {
  const t = setup();
  await t.connect();
  t.receive({ id: "join-1", error: { code: -32601, message: "This is not available to guests." } });
  assert.equal(t.last().state, "refused");
  t.link.stop();
});

test("an agent the owner removed stops for good instead of retrying", async () => {
  const t = setup();
  await t.connect();
  t.receive({ id: "join-1", result: { groupName: "Launch team", handle: "Bo" } });
  t.receive({ method: "djl/groups/agent/removed", params: {} });
  assert.equal(t.last().state, "refused");
  assert.equal(t.client.stopped, true);
  // What the dying connection reports afterwards does not turn it back into "offline".
  t.transport().onStatus({ state: "offline", hostName: "Alice's Mac" });
  assert.equal(t.last().state, "refused");
});

test("leaving forgets the host and closes the agent's session", async () => {
  const t = setup();
  await t.connect();
  await t.link.leave();
  assert.equal(t.client.forgotten, true);
  assert.deepEqual(t.requests.at(-1), {
    tag: "groups.lentAgentClose",
    payload: { linkId: "link00001" },
  });
});
