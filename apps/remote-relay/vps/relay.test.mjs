import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRelayMacRegistrationTranscript,
  buildRelayPhoneConnectTranscript,
} from "@djl/remote-protocol";
import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";

const integration = it.runIf(process.env.DJL_RUN_VPS_TESTS === "1");
const sockets = [];
let worker, directory, base, adminToken;

async function start(testEnvironment = {}) {
  const port = await new Promise((resolve) => {
    const socket = createServer();
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
  base = `http://127.0.0.1:${port}`;
  directory ??= await mkdtemp(join(tmpdir(), "djl-relay-test-"));
  adminToken ??= randomBytes(32).toString("hex");
  worker = spawn(
    fileURLToPath(new URL("../node_modules/.bin/workerd", import.meta.url)),
    [
      "serve",
      "--experimental",
      `--socket-addr=http=127.0.0.1:${port}`,
      `--directory-path=state=${directory}`,
      fileURLToPath(new URL("config.capnp", import.meta.url)),
    ],
    {
      env: { ...process.env, RELAY_ADMIN_TOKEN: adminToken, ...testEnvironment },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let startupError = "";
  worker.stderr.on("data", (chunk) => {
    startupError = `${startupError}${chunk}`.slice(-4000);
  });
  for (let n = 0; n < 100; n++) {
    if (worker.exitCode !== null)
      throw new Error(`Relay runtime exited before health check: ${startupError}`);
    if (
      await fetch(`${base}/health`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Relay did not become healthy");
}
async function stop() {
  if (!worker || worker.exitCode !== null) return;
  const stopping = worker;
  const exited = new Promise((resolve) => stopping.once("exit", resolve));
  stopping.kill("SIGTERM");
  const deadline = setTimeout(() => stopping.kill("SIGKILL"), 2000);
  try {
    await exited;
  } finally {
    clearTimeout(deadline);
  }
}
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await stop();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});
function open(session, role, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace("http:", "ws:")}/relay/${session}?role=${role}`, {
      headers,
    });
    sockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}
const nextMessage = (socket) =>
  new Promise((resolve) => socket.once("message", (data) => resolve(data.toString())));
const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const registration = (code = "ABCDEFGH23") => ({
  "x-djl-session-secret": randomBytes(32).toString("hex"),
  "x-djl-notification-secret": randomBytes(32).toString("hex"),
  "x-mac-device-id": "test-mac",
  "x-mac-identity-public-key": randomBytes(32).toString("base64"),
  "x-machine-name": "QA Mac",
  "x-pairing-code": code,
  "x-pairing-version": "2",
  "x-pairing-expires-at": String(Date.now() + 120_000),
});

function identity(deviceId) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return {
    deviceId,
    publicKey: raw.toString("base64"),
    sign: (transcript) => sign(null, transcript(raw), privateKey).toString("base64"),
  };
}
const signedRegistration = (session, mac, code, trustedPhone) => ({
  ...registration(code),
  "x-mac-device-id": mac.deviceId,
  "x-mac-identity-public-key": mac.publicKey,
  "x-mac-registration-signature": mac.sign((macIdentityPublicKey) =>
    buildRelayMacRegistrationTranscript({
      sessionId: session,
      macDeviceId: mac.deviceId,
      macIdentityPublicKey,
    }),
  ),
  ...(trustedPhone
    ? {
        "x-trusted-phone-device-id": trustedPhone.deviceId,
        "x-trusted-phone-public-key": trustedPhone.publicKey,
      }
    : {}),
});
const phoneHeaders = (session, phone, signedSession = session) => ({
  "x-phone-device-id": phone.deviceId,
  "x-phone-identity-public-key": phone.publicKey,
  "x-phone-signature": phone.sign((phoneIdentityPublicKey) =>
    buildRelayPhoneConnectTranscript({
      sessionId: signedSession,
      phoneDeviceId: phone.deviceId,
      phoneIdentityPublicKey,
    }),
  ),
});
// Records every frame after the relay's own hostPresence greeting.
async function openPhone(session, headers) {
  const socket = await open(session, "iphone", headers);
  const frames = [];
  await new Promise((resolve) =>
    socket.on("message", (data) => {
      const frame = data.toString();
      if (frame.includes('"hostPresence"')) resolve();
      else frames.push(frame);
    }),
  );
  return { socket, frames };
}
const closeCode = (socket) => new Promise((resolve) => socket.once("close", resolve));
const received = async (phone, expected) => {
  while (!phone.frames.includes(expected)) await new Promise((resolve) => setTimeout(resolve, 10));
};
const frame = (kind, fields = {}) => JSON.stringify({ kind, ...fields });
const registrationFrame = (headers, overrides = {}) =>
  frame("relayMacRegistration", {
    registration: {
      macDeviceId: headers["x-mac-device-id"],
      macIdentityPublicKey: headers["x-mac-identity-public-key"],
      displayName: headers["x-machine-name"],
      trustedPhoneDeviceId: headers["x-trusted-phone-device-id"],
      trustedPhonePublicKey: headers["x-trusted-phone-public-key"],
      pairingCode: headers["x-pairing-code"],
      pairingVersion: 2,
      pairingExpiresAt: Number(headers["x-pairing-expires-at"]),
      ...overrides,
    },
  });

integration(
  "pins a signed computer identity against a session that claims its device id",
  async () => {
    await start();
    const mac = identity("pinned-mac");
    const session = randomBytes(24).toString("base64url");
    const owner = signedRegistration(session, mac, "ABCDEFGH23");
    await open(session, "mac", owner);

    const hijack = () => randomBytes(24).toString("base64url");
    const impostor = identity("pinned-mac");
    const impostorSession = hijack();
    // Unsigned, signed with another key, and the owner's key with a signature for another session.
    await expect(
      open(hijack(), "mac", { ...registration("ZZZZZZZZ23"), "x-mac-device-id": mac.deviceId }),
    ).rejects.toThrow("403");
    await expect(
      open(impostorSession, "mac", signedRegistration(impostorSession, impostor, "ZZZZZZZZ23")),
    ).rejects.toThrow("403");
    await expect(
      open(hijack(), "mac", signedRegistration(session, mac, "ZZZZZZZZ23")),
    ).rejects.toThrow("401");

    const resolved = await post("/v1/pairing/code/resolve", { code: "ABCDEFGH23" });
    expect(await resolved.json()).toMatchObject({
      sessionId: session,
      macIdentityPublicKey: mac.publicKey,
    });
    expect((await post("/v1/pairing/code/resolve", { code: "ZZZZZZZZ23" })).status).toBe(404);
    // The owner reconnects with its signature; an unsigned computer still registers elsewhere.
    await open(session, "mac", owner);
    await open(hijack(), "mac", registration("YYYYYYYY23"));
  },
  20_000,
);

integration(
  "keeps a stranger with the session id from displacing or tapping the trusted phone",
  async () => {
    await start();
    const mac = identity("routing-mac");
    const trustedPhone = identity("trusted-phone");
    const session = randomBytes(24).toString("base64url");
    const headers = signedRegistration(session, mac, "ABCDEFGH23", trustedPhone);
    const host = await open(session, "mac", headers);
    const trusted = await openPhone(session, phoneHeaders(session, trustedPhone));

    await expect(
      open(session, "iphone", phoneHeaders(session, trustedPhone, "another-session-id-123")),
    ).rejects.toThrow("401");
    const stranger = await openPhone(session);
    const strangerClosed = closeCode(stranger.socket);
    const candidate = await openPhone(session, phoneHeaders(session, identity("other-phone")));
    // A newer untrusted socket replaces the older untrusted one, never the trusted phone.
    expect(await strangerClosed).toBe(4001);

    const toHost = nextMessage(host);
    candidate.socket.send(frame("clientHello"));
    expect(await toHost).toBe(frame("clientHello"));

    host.send(frame("encryptedEnvelope", { ciphertext: "secret" }));
    host.send("opaque-host-frame");
    host.send(registrationFrame(headers));
    host.send(registrationFrame(headers, { macDeviceId: "someone-else" }));
    host.send(registrationFrame(headers, { pairingExpiresAt: Date.now() - 1 }));
    host.send(frame("serverHello"));
    host.send(frame("secureError"));
    host.send(frame("secureReady"));
    await Promise.all([trusted, candidate].map((phone) => received(phone, frame("secureReady"))));

    const handshake = [frame("serverHello"), frame("secureError"), frame("secureReady")];
    expect(candidate.frames).toEqual(handshake);
    expect(trusted.frames).toEqual([
      frame("encryptedEnvelope", { ciphertext: "secret" }),
      "opaque-host-frame",
      ...handshake,
    ]);
    expect(trusted.socket.readyState).toBe(WebSocket.OPEN);
  },
  20_000,
);

integration(
  "moves ciphertext to the phone the computer names as newly paired",
  async () => {
    await start();
    const mac = identity("pairing-mac");
    const oldPhone = identity("old-phone");
    const newPhone = identity("new-phone");
    const session = randomBytes(24).toString("base64url");
    const headers = signedRegistration(session, mac, "ABCDEFGH23", oldPhone);
    const host = await open(session, "mac", headers);
    const previous = await openPhone(session, phoneHeaders(session, oldPhone));
    const pairing = await openPhone(session, phoneHeaders(session, newPhone));
    const previousClosed = closeCode(previous.socket);

    // Sent after the pairing window closed: the trusted phone still moves.
    host.send(
      registrationFrame(headers, {
        trustedPhoneDeviceId: newPhone.deviceId,
        trustedPhonePublicKey: newPhone.publicKey,
        pairingExpiresAt: Date.now() - 1,
      }),
    );
    expect(await previousClosed).toBe(4001);
    const delivered = nextMessage(pairing.socket);
    host.send(frame("encryptedEnvelope", { ciphertext: "for-new-phone" }));
    expect(await delivered).toBe(frame("encryptedEnvelope", { ciphertext: "for-new-phone" }));
    expect(previous.frames).toEqual([]);

    // The replaced phone is now only a candidate and cannot take the session back.
    const returning = await openPhone(session, phoneHeaders(session, oldPhone));
    host.send(frame("encryptedEnvelope", { ciphertext: "still-for-new-phone" }));
    host.send(frame("secureError"));
    await received(returning, frame("secureError"));
    expect(returning.frames).toEqual([frame("secureError")]);
    expect(pairing.socket.readyState).toBe(WebSocket.OPEN);
  },
  20_000,
);

integration(
  "answers an oversized chunked JSON body at the cap without waiting for it to end",
  async () => {
    await start();
    const socket = connect(Number(new URL(base).port), "127.0.0.1");
    sockets.push({ terminate: () => socket.destroy() });
    const status = new Promise((resolve) =>
      socket.once("data", (data) => resolve(data.toString().split(" ")[1])),
    );
    // No content-length and no terminating chunk: only counting bytes can end this read.
    const body = " ".repeat(16_385);
    socket.write(
      "POST /v1/pairing/code/resolve HTTP/1.1\r\nhost: relay\r\n" +
        "content-type: application/json\r\ntransfer-encoding: chunked\r\n\r\n" +
        `${body.length.toString(16)}\r\n${body}\r\n`,
    );
    expect(await status).toBe("400");
  },
  20_000,
);

integration(
  "keeps provider registration authenticated and distinguishes FCM from APNs",
  async () => {
    // Invalid test-only key prevents OAuth/network delivery while exercising real storage/routes.
    await start({
      FCM_PROJECT_ID: "djl-test-only",
      FCM_CLIENT_EMAIL: "test@test.invalid",
      FCM_PRIVATE_KEY: "invalid-test-only",
    });
    const sessionId = randomBytes(24).toString("base64url");
    const headers = registration();
    await open(sessionId, "mac", headers);
    expect(await (await fetch(`${base}/v1/push/capabilities`)).json()).toEqual({
      providers: ["fcm"],
    });
    const input = {
      sessionId,
      notificationSecret: headers["x-djl-notification-secret"],
      provider: "fcm",
      deviceToken: "AbC_Fid-123",
      environment: "production",
      alertsEnabled: true,
    };
    const register = (body) => post("/v1/push/session/register-device", body);
    expect((await register({ ...input, notificationSecret: "wrong" })).status).toBe(401);
    expect((await register({ ...input, provider: "other" })).status).toBe(400);
    expect((await register({ ...input, deviceToken: " bad" })).status).toBe(400);
    expect((await register({ ...input, environment: "development" })).status).toBe(400);
    expect((await register(input)).status).toBe(200);
    const completion = {
      sessionId,
      notificationSecret: input.notificationSecret,
      threadId: "thread-1",
      result: "completed",
      dedupeKey: "done-1",
    };
    const delivery = await post("/v1/push/session/notify-completion", completion);
    expect(delivery.status).toBe(502);
    expect(await delivery.json()).toMatchObject({
      code: "fcm_delivery_failed",
      error: "fcm_auth_failed",
    });
    // Invalid provider writes did not replace the stored FCM registration.
    expect((await register({ ...input, provider: "other" })).status).toBe(400);
    expect(
      await (await post("/v1/push/session/notify-completion", completion)).json(),
    ).toMatchObject({ code: "fcm_delivery_failed" });
    const legacy = { ...input, deviceToken: "ABCDEF", environment: "development" };
    delete legacy.provider;
    expect((await register(legacy)).status).toBe(200);
    expect(
      await (await post("/v1/push/session/notify-completion", completion)).json(),
    ).toMatchObject({ code: "apns_delivery_failed" });
  },
  20_000,
);

integration(
  "forwards opaque frames and resolves the one-time pairing code",
  async () => {
    await start();
    const session = randomBytes(24).toString("base64url");
    const host = await open(session, "mac", registration());
    const resolved = await post("/v1/pairing/code/resolve", { code: "ABCDE-FGH23" });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ sessionId: session, macDeviceId: "test-mac" });
    const phone = await open(session, "iphone");
    const inbound = nextMessage(host);
    phone.send("opaque-phone-frame");
    expect(await inbound).toBe("opaque-phone-frame");
    const outbound = nextMessage(phone);
    host.send("opaque-host-frame");
    expect(await outbound).toBe("opaque-host-frame");
    expect((await post("/v1/pairing/code/resolve", { code: "INVALID" })).status).toBe(400);
  },
  20_000,
);

integration(
  "keeps host authentication and revocation across a runtime restart",
  async () => {
    await start();
    const session = randomBytes(24).toString("base64url"),
      headers = registration();
    await open(session, "mac", headers);
    await stop();
    await start();
    await expect(
      open(session, "mac", {
        ...headers,
        "x-djl-session-secret": randomBytes(32).toString("hex"),
      }),
    ).rejects.toThrow("401");
    const host = await open(session, "mac", headers);
    expect((await post(`/v1/sessions/${session}/revoke`, {})).status).toBe(401);
    const closed = new Promise((resolve) => host.once("close", (code) => resolve(code)));
    expect(
      (await post(`/v1/sessions/${session}/revoke`, {}, { authorization: `Bearer ${adminToken}` }))
        .status,
    ).toBe(200);
    expect(await closed).toBe(4005);
    await stop();
    await start();
    await expect(open(session, "mac", headers)).rejects.toThrow("403");
  },
  20_000,
);
