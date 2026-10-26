import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { startOperationsGateway } from "./gateway.ts";
import type { HostController } from "./ControllerClient.ts";

let api: ApiRuntime;
let control: Awaited<ReturnType<typeof startOperationsGateway>>;
let base: string;
let ownerToken = "",
  employeeToken = "",
  unverifiedToken = "";
let ownerSecret = "";
const send = vi.fn(async (path: string, body?: unknown) =>
  path === "/operations"
    ? { id: (body as { requestId: string }).requestId }
    : {
        host: "Test VPS",
        sampledAt: Date.now() / 1000,
        latest: null,
        history: [],
        services: [],
        alerts: [],
        jobs: [],
        backups: [],
        releases: [],
      },
);
const request = async (path: string, token?: string, body?: unknown) => {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });
  return { status: response.status, body: (await response.json()) as { error?: { code: string } } };
};
beforeAll(async () => {
  const env = loadApiEnv({
    ...process.env,
    DJL_ENV: "test",
    DJL_MOCK_EXTERNALS: "true",
    ADMIN_MFA_REQUIRED: "true",
  });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
  const apiBase = "http://127.0.0.1:" + api.address.port;
  const login = async (role: "admin" | "employee", enroll: boolean) => {
    const email = crypto.randomUUID() + "@operations.test";
    const password = "local-operations-test-password";
    await api.adminAuth.create({ email, name: "Operations fixture", role, password });
    const first = await fetch(apiBase + "/admin/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const token = ((await first.json()) as { token: string }).token;
    if (enroll) {
      const setup = await fetch(apiBase + "/admin/v1/auth/totp/enroll", {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: "{}",
      });
      const secret = ((await setup.json()) as { secret: string }).secret;
      if (role === "admin") ownerSecret = secret;
      const code = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
        digits: 6,
        period: 30,
      }).generate();
      await fetch(apiBase + "/admin/v1/auth/totp/confirm", {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
    }
    return token;
  };
  ownerToken = await login("admin", true);
  employeeToken = await login("employee", true);
  unverifiedToken = await login("admin", false);
  control = await startOperationsGateway({
    env,
    port: 0,
    host: "127.0.0.1",
    controller: { request: send as HostController["request"] },
  });
  if (control.address._tag !== "TcpAddress") throw new Error("Expected TCP gateway");
  base = "http://127.0.0.1:" + control.address.port;
});
afterAll(async () => {
  await control.close();
  await api.close();
});
describe("independent authenticated control gateway", () => {
  it("rejects anonymous, employee and unenrolled sessions", async () => {
    expect((await request("/admin/v1/servers")).status).toBe(401);
    expect((await request("/admin/v1/servers", employeeToken)).status).toBe(403);
    expect((await request("/admin/v1/servers", unverifiedToken)).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it("shares verified sessions and still works after the main API stops", async () => {
    expect((await request("/admin/v1/servers", ownerToken)).status).toBe(200);
    await api.close();
    api = { ...api, close: async () => undefined };
    expect((await request("/admin/v1/servers", ownerToken)).status).toBe(200);
    expect((await request("/ready")).status).toBe(200);
  });
  it("accepts fresh MFA and refuses reusing its code for a second operation", async () => {
    const code = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(ownerSecret),
      digits: 6,
      period: 30,
    }).generate();
    const operation = {
      requestId: crypto.randomUUID(),
      action: "restart",
      target: "admin",
      confirmation: "RESTART ADMIN",
      reason: "Verify fresh step-up authentication",
      totp: code,
    };
    expect((await request("/admin/v1/servers/operations", ownerToken, operation)).status).toBe(200);
    const replay = await request("/admin/v1/servers/operations", ownerToken, {
      ...operation,
      requestId: crypto.randomUUID(),
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error?.code).toBe("code_used");
  });
  it("refuses arbitrary targets and a mutation without a fresh code", async () => {
    expect((await request("/admin/v1/servers/logs?service=other-site", ownerToken)).status).toBe(
      400,
    );
    const result = await request("/admin/v1/servers/operations", ownerToken, {
      requestId: crypto.randomUUID(),
      action: "restart",
      target: "admin",
      confirmation: "RESTART ADMIN",
      reason: "Testing missing fresh proof",
    });
    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe("verification_failed");
  });
});
