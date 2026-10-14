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

async function start() {
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
    process.execPath,
    [
      fileURLToPath(new URL("../node_modules/.bin/workerd", import.meta.url)),
      "serve",
      "--experimental",
      `--socket-addr=http=127.0.0.1:${port}`,
      `--directory-path=state=${directory}`,
      fileURLToPath(new URL("config.capnp", import.meta.url)),
    ],
    { env: { ...process.env, RELAY_ADMIN_TOKEN: adminToken }, stdio: "ignore" },
  );
  for (let n = 0; n < 100; n++) {
    if (worker.exitCode !== null) throw new Error("Relay runtime exited before health check");
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
  const exited = new Promise((resolve) => worker.once("exit", resolve));
  worker.kill("SIGTERM");
  await exited;
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
