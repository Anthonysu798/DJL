/**
 * Sign-in paths native clients rely on (session token in `set-auth-token`),
 * per-user email language, and self-service account deletion.
 */
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";

let api: ApiRuntime;
beforeAll(async () => {
  const env = loadApiEnv({
    ...process.env,
    DJL_ENV: "test",
    DJL_MOCK_EXTERNALS: "true",
    SMS_ENABLED: "true",
  });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await api.close();
});

const lastOtp = (email: string) =>
  api
    .outbox!.emails.findLast((m) => m.to === email && m.tag === "otp")!
    .subject.match(/^(\d{6})/)![1]!;

describe("phone verification feedback", () => {
  it("starts real-service mode without Twilio credentials when SMS is disabled", async () => {
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"])
      vi.stubEnv(key, "");
    vi.stubEnv("RESEND_API_KEY", "re_qa_only");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_qa_only");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_qa_only");
    vi.stubEnv("STRIPE_TOPUP_PRICE_ID", "price_qa_only");
    vi.stubEnv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:8333");
    vi.stubEnv("STORAGE_ACCESS_KEY_ID", "qa-only");
    vi.stubEnv("STORAGE_SECRET_ACCESS_KEY", "qa-only");
    let real: ApiRuntime | undefined;
    try {
      real = await startApi({
        env: loadApiEnv({
          ...process.env,
          DJL_ENV: "test",
          DJL_MOCK_EXTERNALS: "false",
          SMS_ENABLED: "false",
        }),
        port: 0,
        host: "127.0.0.1",
      });
      expect((await TestClient.for(real).call("/ready")).status).toBe(200);
      expect(real.outbox).toBeNull();
    } finally {
      await real?.close();
      vi.unstubAllEnvs();
    }
  });
  it("does not expose SMS OTP routes when SMS is disabled", async () => {
    const noSms = await startApi({
      env: loadApiEnv({
        ...process.env,
        DJL_ENV: "test",
        DJL_MOCK_EXTERNALS: "true",
        SMS_ENABLED: "false",
      }),
      port: 0,
      host: "127.0.0.1",
    });
    try {
      const client = TestClient.for(noSms);
      const response = await client.call("/v1/auth/phone-number/send-otp", {
        method: "POST",
        json: { phoneNumber: "+15551234567" },
      });
      expect(response.status).toBe(404);
      expect(noSms.outbox!.sms).toHaveLength(0);
    } finally {
      await noSms.close();
    }
  });
  it("approves the SMS verification only after the correct code is accepted", async () => {
    const client = TestClient.for(api);
    const phoneNumber = `+1555${String(crypto.getRandomValues(new Uint32Array(1))[0]!)
      .slice(0, 7)
      .padStart(7, "0")}`;
    const sent = await client.call("/v1/auth/phone-number/send-otp", {
      method: "POST",
      json: { phoneNumber },
    });
    expect(sent.status).toBe(200);
    const code = api.outbox!.sms.findLast((sms) => sms.phoneNumber === phoneNumber)!.code!;
    const wrong = await client.call("/v1/auth/phone-number/verify", {
      method: "POST",
      json: { phoneNumber, code: code === "000000" ? "111111" : "000000" },
    });
    expect(wrong.status).not.toBe(200);
    expect(api.outbox!.approvedVerifications ?? []).toHaveLength(0);
    const verified = await client.call("/v1/auth/phone-number/verify", {
      method: "POST",
      json: { phoneNumber, code },
    });
    expect(verified.status).toBe(200);
    expect(api.outbox!.approvedVerifications).toEqual([expect.stringMatching(/^mock_sms_/)]);
  });
});

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

describe("free allowance", () => {
  it("grants this week's free allowance as soon as the email is verified", async () => {
    const client = TestClient.for(api);
    await client.signUp(api, "free");
    const plan = await api.db.query.plans.findFirst({ where: eq(schema.plans.id, "free") });
    const credits = (await (await client.call("/v1/credits")).json()) as {
      balances: { free: string };
    };
    expect(BigInt(credits.balances.free)).toBe(plan!.includedMicrocredits);
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

describe("browser clients", () => {
  it("serves Better Auth JSON as application/json so the web client can parse the session", async () => {
    const browser = TestClient.for(api);
    const { email } = await browser.signUp(api, "json-session");
    const res = await browser.call("/v1/auth/get-session");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const body = (await res.json()) as { user?: { email?: string }; session?: unknown };
    expect(body.user?.email).toBe(email);
    expect(body.session).toBeTruthy();
  });

  it("still sets every sign-in cookie while forwarding the JSON body", async () => {
    const browser = TestClient.for(api);
    const { email, password } = await browser.signUp(api, "json-cookies");
    const fresh = new TestClient(browser.base);
    const res = await fresh.call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email, password },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(true);
    expect(((await res.json()) as { user?: { email?: string } }).user?.email).toBe(email);
  });
});

it("recovers a disposable account with an emailed OTP and refuses code reuse", async () => {
  const registered = TestClient.for(api);
  const { email, password } = await registered.signUp(api, "password-recovery");
  const anonymous = new TestClient(registered.base);
  expect(
    (
      await anonymous.call("/v1/auth/email-otp/request-password-reset", {
        method: "POST",
        json: { email },
      })
    ).status,
  ).toBe(200);
  const otp = lastOtp(email),
    nextPassword = `QA-${crypto.randomUUID()}-only`;
  const reset = () =>
    anonymous.call("/v1/auth/email-otp/reset-password", {
      method: "POST",
      json: { email, otp, password: nextPassword },
    });
  expect((await reset()).status).toBe(200);
  expect((await reset()).status).toBeGreaterThanOrEqual(400);
  expect(
    (await anonymous.call("/v1/auth/sign-in/email", { method: "POST", json: { email, password } }))
      .status,
  ).toBe(401);
  expect(
    (
      await anonymous.call("/v1/auth/sign-in/email", {
        method: "POST",
        json: { email, password: nextPassword },
      })
    ).status,
  ).toBe(200);
});
