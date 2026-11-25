// FILE: guest-link-client.test.js
// Purpose: Drives the guest link client against the REAL host-side secure transport through a small
//          in-process relay (HTTP resolve endpoints + WebSocket forwarding on 127.0.0.1).
// Layer: Integration test
// Exports: node:test suite
// Depends on: node:test, http, ws, crypto, ../src/guest-link-client, ../src/secure-transport

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createPublicKey, generateKeyPairSync, randomUUID, verify } = require("crypto");
const { setTimeout: wait } = require("node:timers/promises");
const { WebSocketServer } = require("ws");
const { buildTrustedSessionResolveTranscript } = require("@djl/remote-protocol");

const { createGuestLinkClient } = require("../src/guest-link-client");
const { createBridgeSecureTransport } = require("../src/secure-transport");

const CODE = "ABCDEFGHJK";
// Retries and keep-alives 20x faster; the handshake timeout still leaves 600ms on loopback.
const fastTimer = (callback, ms) => setTimeout(callback, Math.max(5, ms / 20));

test("pairs with a code, then both directions carry application messages", async (t) => {
  const relay = await startRelay(t);
  const host = startHost(relay, { deviceState: createHostDeviceState() });
  const { client, statuses, messages, stateDir } = startClient(t, relay, { code: CODE });

  await waitFor(() => last(statuses)?.state === "connected");
  assert.deepEqual(
    statuses.map((status) => status.state),
    ["connecting", "connected"],
  );
  assert.equal(client.hostName(), "Owner's Mac");
  assert.equal(host.trustedUpdates.length, 1, "host trusted the new client");
  const saved = readState(stateDir);
  assert.equal(host.trustedUpdates[0].phoneDeviceId, saved.device.deviceId);
  assert.equal(host.trustedUpdates[0].phoneIdentityPublicKey, saved.device.publicKey);
  assert.equal(saved.host.macIdentityPublicKey, host.deviceState.macIdentityPublicKey);
  assert.equal(saved.host.relay, `${relay.relayUrl}`);

  // How the client addressed the relay, as the production relay expects it.
  assert.deepEqual(
    relay.requests.map((request) => request.path),
    ["/relay/v1/pairing/code/resolve", "/v1/pairing/code/resolve"],
  );
  assert.deepEqual(relay.requests[1].body, { code: CODE });
  assert.equal(relay.sockets[0].path, `/relay/${host.sessionId}`);
  assert.equal(relay.sockets[0].role, "iphone");

  assert.equal(client.send({ id: "guest-1", method: "thread/list", params: { limit: 5 } }), true);
  await waitFor(() => host.received.length === 1);
  assert.deepEqual(host.received[0], {
    id: "guest-1",
    method: "thread/list",
    params: { limit: 5 },
  });

  host.send({ id: "guest-1", result: { data: ["é", "🚀"] } });
  host.send({ method: "item/agentMessage/delta", params: { threadId: "t", delta: "Hi" } });
  host.send({ method: "turn/completed", params: { threadId: "t" } });
  await waitFor(() => messages.length === 3);
  assert.deepEqual(messages, [
    { id: "guest-1", result: { data: ["é", "🚀"] } },
    { method: "item/agentMessage/delta", params: { threadId: "t", delta: "Hi" } },
    { method: "turn/completed", params: { threadId: "t" } },
  ]);
});

test("a second client on the same state folder reconnects through trusted resolve", async (t) => {
  const relay = await startRelay(t);
  const host = startHost(relay, { deviceState: createHostDeviceState() });
  const first = startClient(t, relay, { code: CODE });
  await waitFor(() => last(first.statuses)?.state === "connected");
  first.client.stop();

  relay.requests.length = 0;
  const second = startClient(t, relay, { stateDir: first.stateDir });
  await waitFor(() => last(second.statuses)?.state === "connected");
  assert.deepEqual(
    relay.requests.map((request) => request.path),
    ["/v1/trusted/session/resolve"],
  );
  const resolve = relay.requests[0].body;
  assert.deepEqual(Object.keys(resolve).toSorted(), [
    "macDeviceId",
    "nonce",
    "phoneDeviceId",
    "phoneIdentityPublicKey",
    "signature",
    "timestamp",
  ]);
  assert.equal(host.handshakeModes.at(-1), "trusted_reconnect");
  assert.equal(host.trustedUpdates.length, 1, "no new trust was granted");
  assert.equal(second.client.hostName(), "Owner's Mac");

  assert.equal(second.client.send({ id: "again", method: "ping" }), true);
  await waitFor(() => host.received.length === 1);
  host.send({ id: "again", result: {} });
  await waitFor(() => second.messages.length === 1);
  assert.deepEqual(second.messages[0], { id: "again", result: {} });
});

test("a wrong pairing code is refused and never retried", async (t) => {
  const relay = await startRelay(t);
  startHost(relay, { deviceState: createHostDeviceState() });
  const { client, statuses } = startClient(t, relay, { code: "ZZZZZZZZZZ" });
  await waitFor(() => last(statuses)?.state === "refused");
  const requestCount = relay.requests.length;
  await wait(300);
  assert.deepEqual(
    statuses.map((status) => status.state),
    ["connecting", "refused"],
  );
  assert.equal(relay.requests.length, requestCount, "no retry after a refusal");
  assert.equal(relay.sockets.length, 0);
  assert.equal(client.send({ method: "x" }), false);

  const malformed = startClient(t, relay, { code: "not-a-code" });
  await waitFor(() => last(malformed.statuses)?.state === "refused");
  assert.equal(relay.requests.length, requestCount, "a malformed code never reaches the relay");
});

test("goes offline when the host leaves and reconnects when it is back", async (t) => {
  const relay = await startRelay(t);
  const deviceState = createHostDeviceState();
  const firstHost = startHost(relay, { deviceState });
  const { client, statuses, messages } = startClient(t, relay, { code: CODE });
  await waitFor(() => last(statuses)?.state === "connected");

  relay.detach(firstHost);
  await waitFor(() => last(statuses)?.state === "offline");
  assert.equal(client.send({ method: "x" }), false);
  const resolvesWhileAway = () =>
    relay.requests.filter((request) => request.path === "/v1/trusted/session/resolve").length;
  await waitFor(() => resolvesWhileAway() >= 2, "keeps retrying while the host is away");

  // A restarted host process: same identity and trust, a new relay session.
  const secondHost = startHost(relay, { deviceState: firstHost.deviceState });
  await waitFor(() => last(statuses)?.state === "connected");
  assert.notEqual(secondHost.sessionId, firstHost.sessionId);
  assert.equal(secondHost.handshakeModes.at(-1), "trusted_reconnect");

  secondHost.send({ id: "after", result: { ok: true } });
  await waitFor(() => messages.some((message) => message.id === "after"));
  assert.equal(client.send({ id: "back", method: "ping" }), true);
  await waitFor(() => secondHost.received.length === 1);
});

test("drops replayed host output and catches up after a reconnect", async (t) => {
  const relay = await startRelay(t);
  const host = startHost(relay, { deviceState: createHostDeviceState() });
  const { statuses, messages } = startClient(t, relay, { code: CODE });
  await waitFor(() => last(statuses)?.state === "connected");

  host.send({ id: "r1", result: 1 });
  await waitFor(() => messages.length === 1);
  // A host relay flap rebinds its socket and re-sends everything after the last resume cursor.
  host.transport.bindLiveSendWireMessage((text) => relay.toPhones(host.sessionId, text));
  host.send({ id: "r2", result: 2 });
  await waitFor(() => messages.length >= 2);

  // The client's socket drops; the host keeps producing output meanwhile.
  relay.dropPhones(host.sessionId);
  await waitFor(() => last(statuses)?.state === "offline");
  host.send({ id: "r3", result: 3 });
  await waitFor(() => last(statuses)?.state === "connected");
  await waitFor(() => messages.length >= 3);
  await wait(100);
  assert.deepEqual(
    messages.map((message) => message.id),
    ["r1", "r2", "r3"],
  );
});

test("a host whose identity key differs from the trusted one is never connected", async (t) => {
  const impostors = {
    // The relay honestly reports the new key: the resolve answer already fails the pin.
    "relay reports the other key": (trusted, other) => ({
      deviceState: { ...trusted, ...other },
    }),
    // The relay lies about the key; the host answers with its own key.
    "host presents the other key": (trusted, other) => ({
      deviceState: { ...trusted, ...other },
      advertisedKey: trusted.macIdentityPublicKey,
    }),
    // The host claims the trusted key but can only sign with its own.
    "host claims the trusted key": (trusted, other) => ({
      deviceState: { ...trusted, macIdentityPrivateKey: other.macIdentityPrivateKey },
    }),
  };
  for (const [name, impostor] of Object.entries(impostors)) {
    const relay = await startRelay(t);
    const genuine = startHost(relay, { deviceState: createHostDeviceState() });
    const paired = startClient(t, relay, { code: CODE });
    await waitFor(() => last(paired.statuses)?.state === "connected");
    paired.client.stop();
    relay.detach(genuine);

    const { macIdentityPublicKey, macIdentityPrivateKey } = createHostDeviceState();
    const otherKey = { macIdentityPublicKey, macIdentityPrivateKey };
    const fake = startHost(relay, impostor(genuine.deviceState, otherKey));
    const { statuses } = startClient(t, relay, { stateDir: paired.stateDir });
    await waitFor(() => last(statuses)?.state === "refused", name);
    assert.ok(!statuses.some((status) => status.state === "connected"), name);
    assert.equal(fake.readySessions, 0, `${name}: the impostor never got a secure session`);
    assert.equal(
      readState(paired.stateDir).host.macIdentityPublicKey,
      genuine.deviceState.macIdentityPublicKey,
      `${name}: the pin is unchanged`,
    );
  }
});

test("the state file is private and never holds the pairing code", async (t) => {
  const relay = await startRelay(t);
  startHost(relay, { deviceState: createHostDeviceState() });
  const { client, statuses, stateDir } = startClient(t, relay, { code: CODE });
  await waitFor(() => last(statuses)?.state === "connected");

  const files = fs.readdirSync(stateDir);
  assert.equal(files.length, 1);
  const file = path.join(stateDir, files[0]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(stateDir).mode & 0o777, 0o700);
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, new RegExp(CODE));
  assert.doesNotMatch(text, /"code"/);

  client.forget();
  assert.deepEqual(fs.readdirSync(stateDir), []);
});

// ---------------------------------------------------------------------------------------------
// Fake relay: the subset of apps/remote-relay the phone uses, with the real host transport behind.

async function startRelay(t) {
  const hostsBySession = new Map();
  const hostsByMac = new Map();
  const codes = new Map();
  const phonesBySession = new Map();
  const requests = [];
  const sockets = [];

  const server = http.createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : null;
    requests.push({ path: request.url, body });
    const reply = (status, value) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.method === "POST" && request.url === "/v1/pairing/code/resolve") {
      const sessionId = codes.get(body?.code);
      if (!sessionId) {
        return reply(404, { ok: false, code: "pairing_code_unavailable", error: "unavailable" });
      }
      const host = hostsBySession.get(sessionId);
      if (!host) return reply(409, { ok: false, code: "host_offline", error: "offline" });
      const payload = host.transport.createPairingPayload();
      return reply(200, {
        ok: true,
        v: payload.v,
        sessionId: payload.sessionId,
        macDeviceId: payload.macDeviceId,
        macIdentityPublicKey: host.advertisedKey ?? payload.macIdentityPublicKey,
        displayName: payload.displayName,
        expiresAt: payload.expiresAt,
      });
    }
    if (request.method === "POST" && request.url === "/v1/trusted/session/resolve") {
      const host = hostsByMac.get(body?.macDeviceId);
      if (!host) return reply(404, { ok: false, code: "mac_offline", error: "offline" });
      const [trustedId, trustedKey] = Object.entries(host.deviceState.trustedPhones)[0] ?? [];
      if (body.phoneDeviceId !== trustedId || body.phoneIdentityPublicKey !== trustedKey) {
        return reply(403, { ok: false, code: "phone_not_trusted", error: "rejected" });
      }
      const transcript = buildTrustedSessionResolveTranscript({
        ...body,
        phoneIdentityPublicKey: Buffer.from(body.phoneIdentityPublicKey, "base64"),
      });
      const key = createPublicKey({
        key: { crv: "Ed25519", kty: "OKP", x: toBase64Url(body.phoneIdentityPublicKey) },
        format: "jwk",
      });
      if (!verify(null, transcript, key, Buffer.from(body.signature, "base64"))) {
        return reply(403, { ok: false, code: "invalid_signature", error: "rejected" });
      }
      return reply(200, {
        ok: true,
        macDeviceId: host.deviceState.macDeviceId,
        macIdentityPublicKey: host.advertisedKey ?? host.deviceState.macIdentityPublicKey,
        displayName: host.displayName,
        sessionId: host.sessionId,
      });
    }
    reply(404, { ok: false, code: "not_found", error: "Route not found." });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const match = /^\/relay\/([A-Za-z0-9_-]{16,128})$/.exec(request.url);
    if (!match || request.headers["x-role"] !== "iphone") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (phone) => {
      const sessionId = match[1];
      sockets.push({ path: request.url, role: request.headers["x-role"] });
      const phones = phonesBySession.get(sessionId) ?? new Set();
      phonesBySession.set(sessionId, phones);
      for (const existing of phones) existing.close(4001, "Replaced by a newer iphone connection");
      phones.add(phone);
      phone.on("close", () => phones.delete(phone));
      phone.send(presence(hostsBySession.has(sessionId)));
      phone.on("message", (data) => {
        const host = hostsBySession.get(sessionId);
        if (!host) {
          phone.close(4004, "The paired computer is offline");
          return;
        }
        host.transport.handleIncomingWireMessage(String(data), {
          sendControlMessage: (message) => phone.send(JSON.stringify(message)),
          onApplicationMessage: (payloadText) => host.received.push(JSON.parse(payloadText)),
        });
      });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  const toPhones = (sessionId, text) => {
    for (const phone of phonesBySession.get(sessionId) ?? []) phone.send(text);
  };
  return {
    relayUrl: `ws://127.0.0.1:${server.address().port}/relay`,
    requests,
    sockets,
    toPhones,
    attach(host, code) {
      hostsBySession.set(host.sessionId, host);
      hostsByMac.set(host.deviceState.macDeviceId, host);
      codes.set(code, host.sessionId);
      host.transport.bindLiveSendWireMessage((text) => toPhones(host.sessionId, text));
      toPhones(host.sessionId, presence(true));
    },
    dropPhones(sessionId) {
      for (const phone of phonesBySession.get(sessionId) ?? []) phone.close(1011, "Relay error");
    },
    detach(host) {
      hostsBySession.delete(host.sessionId);
      hostsByMac.delete(host.deviceState.macDeviceId);
      toPhones(host.sessionId, presence(false));
    },
  };
}

// The host half of bridge.js, reduced to its secure transport.
function startHost(relay, { deviceState, advertisedKey, code = CODE }) {
  const host = {
    sessionId: randomUUID(),
    deviceState,
    advertisedKey,
    displayName: "Owner's Mac",
    received: [],
    trustedUpdates: [],
    handshakeModes: [],
    readySessions: 0,
  };
  host.transport = createBridgeSecureTransport({
    sessionId: host.sessionId,
    relayUrl: relay.relayUrl,
    deviceState,
    displayName: host.displayName,
    persistTrustedPhone: false,
    onTrustedPhoneUpdate(nextDeviceState, phone) {
      host.deviceState = nextDeviceState;
      host.trustedUpdates.push(phone);
    },
    onSecureSessionReady(session) {
      host.readySessions += 1;
      host.handshakeModes.push(session.handshakeMode);
    },
  });
  host.send = (message) =>
    host.transport.queueOutboundApplicationMessage(JSON.stringify(message), (text) =>
      relay.toPhones(host.sessionId, text),
    );
  relay.attach(host, code);
  return host;
}

function startClient(t, relay, { code, stateDir } = {}) {
  const folder = stateDir ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guest-link-")), "s");
  const statuses = [];
  const messages = [];
  const client = createGuestLinkClient({
    stateDir: folder,
    relayUrl: relay.relayUrl,
    code,
    onMessage: (message) => messages.push(message),
    onStatus: (status) => statuses.push(status),
    setTimer: fastTimer,
  });
  t.after(() => client.stop());
  client.start();
  return { client, statuses, messages, stateDir: folder };
}

function createHostDeviceState() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    macDeviceId: `mac-${randomUUID()}`,
    macIdentityPrivateKey: Buffer.from(
      privateKey.export({ format: "jwk" }).d,
      "base64url",
    ).toString("base64"),
    macIdentityPublicKey: Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString(
      "base64",
    ),
    trustedPhones: {},
  };
}

function presence(online) {
  return JSON.stringify({ kind: "hostPresence", online, at: Date.now() });
}

function readState(stateDir) {
  return JSON.parse(fs.readFileSync(path.join(stateDir, "guest-link.json"), "utf8"));
}

function toBase64Url(base64) {
  return Buffer.from(base64, "base64").toString("base64url");
}

function last(values) {
  return values[values.length - 1];
}

async function waitFor(predicate, label = "condition", timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await wait(10);
  }
}
