import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
