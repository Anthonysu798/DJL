/**
 * Sign-in paths native clients rely on (session token in `set-auth-token`),
 * per-user email language, and self-service account deletion.
 */
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";

let api: ApiRuntime;
beforeAll(async () => {
  const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await api.close();
});

const lastOtp = (email: string) =>
  api
    .outbox!.emails.findLast((m) => m.to === email && m.tag === "otp")!
    .subject.match(/^(\d{6})/)![1]!;

describe("bearer clients", () => {
  it("returns the session token in set-auth-token for email+password and email-code sign-in", async () => {
    const client = TestClient.for(api);
    const { email, password } = await client.signUp(api, "bearer");
    const native = new TestClient(client.base);

    const withPassword = await native.call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email, password },
    });
    expect(withPassword.status).toBe(200);
    const token = withPassword.headers.get("set-auth-token");
    expect(token).toBeTruthy();
    expect((await native.call("/v1/me", { bearer: token! })).status).toBe(200);

    const send = await native.call("/v1/auth/email-otp/send-verification-otp", {
      method: "POST",
      json: { email, type: "sign-in" },
    });
    expect(send.status).toBe(200);
    const withCode = await native.call("/v1/auth/sign-in/email-otp", {
      method: "POST",
      json: { email, otp: lastOtp(email) },
    });
    expect(withCode.status).toBe(200);
    const codeToken = withCode.headers.get("set-auth-token");
    expect(codeToken).toBeTruthy();
    expect((await native.call("/v1/me", { bearer: codeToken! })).status).toBe(200);
  });
});

describe("email language", () => {
  it("sends the verification code in the language chosen at sign-up", async () => {
    const client = TestClient.for(api);
    const email = `zh-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const res = await client.call("/v1/auth/sign-up/email", {
      method: "POST",
      json: { email, password: "correct-horse-battery-staple", name: "Zh", locale: "zh-Hans" },
    });
    expect(res.status).toBe(200);
    const mail = api.outbox!.emails.findLast((m) => m.to === email && m.tag === "otp");
    expect(mail!.subject).toContain("验证码");
  });
});

describe("account deletion", () => {
  it("soft deletes the signed-in account and ends every session", async () => {
    const client = TestClient.for(api);
    const { email, password, userId } = await client.signUp(api, "delete");
    const device = await new TestClient(client.base).call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email, password },
    });
    const deviceToken = device.headers.get("set-auth-token")!;
    const jwt = (
      (await (await client.call("/v1/auth/token", { bearer: deviceToken })).json()) as {
        token: string;
      }
    ).token;

    const deleted = await client.call("/v1/me", { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const row = await api.db.query.user.findFirst({ where: eq(schema.user.id, userId) });
    expect(row).toMatchObject({ banned: true, banReason: "self_delete" });
    const audit = await api.db.query.auditEvents.findFirst({
      where: eq(schema.auditEvents.targetId, userId),
    });
    expect(audit?.action).toBe("user.delete");
    expect((await client.call("/v1/me")).status).toBe(401);
    expect((await client.call("/v1/me", { bearer: deviceToken })).status).toBe(401);
    expect((await client.call("/v1/me", { bearer: jwt })).status).toBe(401);
  });

  it("requires the CSRF token when deleting with a browser cookie", async () => {
    const client = TestClient.for(api);
    await client.signUp(api, "delete-csrf");
    const res = await client.call("/v1/me", { method: "DELETE", csrf: false });
    expect(res.status).toBe(403);
    expect((await client.call("/v1/me")).status).toBe(200);
  });
});
