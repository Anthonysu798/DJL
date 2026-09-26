/**
 * Boots the real API on an ephemeral port against the test database and walks
 * the signup → verify → account → billing → device path over HTTP, the way
 * the desktop and web clients will.
 */
import {
  CloudRedeemBankResponse,
  CloudResetBanksResponse,
  CloudUsageWindowsResponse,
} from "@synara/contracts/cloud";
import { schema } from "@djl/db";
import { bankExpiresAt } from "@djl/domain";
import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "./config/env.ts";
import { startApi, type ApiRuntime } from "./server.ts";

let api: ApiRuntime;
let base: string;
const jar = new Map<string, string>();

function cookieHeader() {
  return Array.from(jar.entries(), ([k, v]) => `${k}=${v}`).join("; ");
}
function storeCookies(res: Response) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const [name, ...rest] = pair!.split("=");
    if (name) jar.set(name.trim(), rest.join("="));
  }
}
let csrfToken: string | null = null;
async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json: jsonBody, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("origin", "http://localhost:3000");
  // Cookie-authenticated mutations on DJL routes need the double-submit token, as in the web app.
  if (rest.method && rest.method !== "GET" && !path.startsWith("/v1/auth/")) {
    csrfToken ??= ((await (await call("/v1/csrf")).json()) as { token: string }).token;
    headers.set("x-csrf-token", csrfToken);
  }
  if (jar.size > 0) headers.set("cookie", cookieHeader());
  let body: BodyInit | null = rest.body ?? null;
  if (jsonBody !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(jsonBody);
  }
  const res = await fetch(`${base}${path}`, { ...rest, headers, body });
  storeCookies(res);
  return res;
}

beforeAll(async () => {
  const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${api.address.port}`;
});
afterAll(async () => {
  await api.close();
});

const email = `e2e-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
const password = "correct-horse-battery-staple";

describe("api end to end", () => {
  it("serves health with a trace id and rejects unauthenticated account calls", async () => {
    const health = await call("/health");
    expect(health.status).toBe(200);
    expect(health.headers.get("x-trace-id")).toMatch(/^[0-9a-f]{32}$/);
    const me = await call("/v1/me");
    expect(me.status).toBe(401);
    expect((await me.json()).error.code).toBe("unauthorized");
  });

  it("signs up, verifies email with the OTP from the outbox, and sees a personal org with zero credits", async () => {
    const signup = await call("/v1/auth/sign-up/email", {
      method: "POST",
      json: { email, password, name: "E2E" },
    });
    expect(signup.status).toBe(200);
    const otpMail = api.outbox!.emails.find((m) => m.to === email && m.tag === "otp");
    expect(otpMail).toBeDefined();
    const otp = otpMail!.subject.match(/^(\d{6})/)![1];
    const verify = await call("/v1/auth/email-otp/verify-email", {
      method: "POST",
      json: { email, otp },
    });
    expect(verify.status).toBe(200);

    const me = await call("/v1/me");
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe(email);
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].personal).toBe(true);
    expect(body.role).toBe("owner");

    const credits = await call("/v1/credits");
    expect(credits.status).toBe(200);
    expect((await credits.json()).display.total).toBe("0.00");
  });

  it("refuses org switching to an org the user is not a member of", async () => {
    const res = await call("/v1/credits", { headers: { "x-org-id": crypto.randomUUID() } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("not_a_member");
  });

  it("starts a top-up checkout and refuses a bad amount", async () => {
    const ok = await call("/v1/billing/checkout", {
      method: "POST",
      json: { kind: "topup", usd: 25 },
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).url).toContain("checkout.stripe.test");
    const bad = await call("/v1/billing/checkout", {
      method: "POST",
      json: { kind: "topup", usd: 1 },
    });
    expect(bad.status).toBe(400);
  });

  it("credits arrive through the webhook and show in the ledger", async () => {
    const me = await (await call("/v1/me")).json();
    const orgId = me.activeOrgId as string;
    const payload = JSON.stringify({
      id: `evt_e2e_${orgId}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_e2e_${orgId}`,
          payment_status: "paid",
          amount_total: 2500,
          payment_intent: "pi_e2e",
          metadata: { kind: "topup", orgId, usd: "25" },
        },
      },
    });
    const hook = await fetch(`${base}/v1/webhooks/stripe`, {
      method: "POST",
      headers: { "stripe-signature": "t", "content-type": "application/json" },
      body: payload,
    });
    expect(hook.status).toBe(200);
    const credits = await (await call("/v1/credits")).json();
    expect(credits.display.total).toBe("2500.00");
    const ledger = await (await call("/v1/credits/ledger?limit=5")).json();
    expect(ledger.entries[0].type).toBe("topup");
  });

  it("lists models and streams a chat completion through the gateway, deducting credits", async () => {
    const models = await (await call("/v1/models")).json();
    expect(models.models.length).toBeGreaterThan(0);
    const before = Number((await (await call("/v1/credits")).json()).total);
    const res = await call("/v1/chat/completions", {
      method: "POST",
      json: {
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 50,
        stream: true,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const content = text
      .split("\n\n")
      .filter((b) => b.startsWith("data: {"))
      .map((b) => JSON.parse(b.slice(6)).choices?.[0]?.delta?.content ?? "")
      .join("");
    expect(content).toBe("echo: ping");
    expect(text).toContain("event: djl.usage");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    const after = Number((await (await call("/v1/credits")).json()).total);
    expect(after).toBeLessThan(before);
    const usage = await (await call("/v1/usage")).json();
    expect(usage.recent[0].status).toBe("settled");
    expect(usage.recent[0].model).toBe("gpt-5-mini");
  });

  it("shows both usage windows and redeems a banked reset", async () => {
    const windows = Schema.decodeUnknownSync(CloudUsageWindowsResponse)(
      await (await call("/v1/usage/windows")).json(),
    );
    expect(windows.planId).toBe("free");
    expect(BigInt(windows.windows.fiveHour.used)).toBeGreaterThan(0n);
    expect(windows.banks).toEqual({ count: 0, nextExpiresAt: null });

    const me = await (await call("/v1/me")).json();
    await api.db.insert(schema.resetBanks).values({
      userId: me.user.id,
      source: "admin",
      grantedBy: "admin:e2e",
      expiresAt: bankExpiresAt(new Date()),
      idempotencyKey: `e2e:${crypto.randomUUID()}`,
    });
    const banks = Schema.decodeUnknownSync(CloudResetBanksResponse)(
      await (await call("/v1/usage/banks")).json(),
    );
    expect(banks.banks).toHaveLength(1);

    const bad = await call("/v1/usage/resets/redeem", { method: "POST", json: {} });
    expect(bad.status).toBe(400);
    const redeem = () =>
      call("/v1/usage/resets/redeem", { method: "POST", json: { idempotencyKey: "e2e-1" } });
    const redeemed = Schema.decodeUnknownSync(CloudRedeemBankResponse)(
      await (await redeem()).json(),
    );
    expect(redeemed.redeemedBankId).toBe(banks.banks[0]!.id);
    expect(redeemed.usage.windows.fiveHour.used).toBe("0");
    expect(redeemed.usage.windows.week.used).toBe("0");
    expect((await (await redeem()).json()).redeemedBankId).toBe(redeemed.redeemedBankId);
    const none = await call("/v1/usage/resets/redeem", {
      method: "POST",
      json: { idempotencyKey: "e2e-2" },
    });
    expect(none.status).toBe(409);
    expect((await none.json()).error.code).toBe("no_reset_bank");
  });

  it("aborts the image provider call and refunds the reservation when the client disconnects", async () => {
    const before = (await (await call("/v1/credits")).json()).total;
    const controller = new AbortController();
    const pending = call("/v1/images/generations", {
      method: "POST",
      json: { model: "gpt-image-1", prompt: "hang" },
      signal: controller.signal,
    }).catch(() => null);
    await new Promise((r) => setTimeout(r, 300));
    controller.abort();
    await pending;
    let status: string | undefined;
    for (let i = 0; i < 40 && status !== "failed"; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      const usage = await (await call("/v1/usage")).json();
      status = usage.recent.find(
        (r: { endpoint: string }) => r.endpoint === "images.generations",
      )?.status;
    }
    expect(status).toBe("failed");
    expect((await (await call("/v1/credits")).json()).total).toBe(before);
  });

  it("edits an uploaded image through multipart /v1/images/edits and charges per image", async () => {
    const before = Number((await (await call("/v1/credits")).json()).total);
    const form = new FormData();
    form.set("model", "image.edit");
    form.set("prompt", "make it blue");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    form.set("image", new Blob([png], { type: "image/png" }), "in.png");
    const res = await call("/v1/images/edits", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.usage.images).toBe(1);
    expect(Number((await (await call("/v1/credits")).json()).total)).toBeLessThan(before);

    const missing = new FormData();
    missing.set("model", "image.edit");
    missing.set("prompt", "x");
    const bad = await call("/v1/images/edits", { method: "POST", body: missing });
    expect(bad.status).toBe(400);
  });

  it("registers and lists a device", async () => {
    const created = await call("/v1/devices", {
      method: "POST",
      json: {
        kind: "desktop",
        name: "Mac",
        fingerprint: "fp-1",
        appVersion: "0.5.0",
        platform: "darwin",
      },
    });
    expect(created.status).toBe(201);
    const list = await (await call("/v1/devices")).json();
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0].syncEnabled).toBe(false);
  });

  it("shows no trial yet and refuses a claim without a verified phone", async () => {
    const status = await (await call("/v1/trial")).json();
    expect(status.trial).toBeNull();
    const claim = await call("/v1/trial/claim", {
      method: "POST",
      json: { deviceFingerprint: "fp-1" },
    });
    expect(claim.status).toBe(400);
    expect((await claim.json()).error.code).toBe("phone_required");
  });

  it("completes the OAuth device flow used by desktop and iOS", async () => {
    // The device (no cookies) asks for a code.
    const code = await fetch(`${base}/v1/auth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "djl-desktop", scope: "desktop" }),
    });
    expect(code.status).toBe(200);
    const device = (await code.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      interval: number;
    };
    expect(device.verification_uri).toContain("/device");
    // Unknown client ids are refused.
    const bad = await fetch(`${base}/v1/auth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "evil", scope: "desktop" }),
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    // Polling before approval is pending.
    const pending = await fetch(`${base}/v1/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
        client_id: "djl-desktop",
      }),
    });
    expect(pending.status).toBe(400);
    expect((await pending.json()).error).toBe("authorization_pending");
    // The signed-in browser session first claims the code (GET /device), then approves it.
    const claim = await call(`/v1/auth/device?user_code=${encodeURIComponent(device.user_code)}`);
    expect(claim.status).toBe(200);
    const approve = await call("/v1/auth/device/approve", {
      method: "POST",
      json: { userCode: device.user_code },
    });
    expect(approve.status).toBe(200);
    // Now the device receives a session token and can call the API with it.
    await new Promise((r) => setTimeout(r, (device.interval + 1) * 1000));
    const token = await fetch(`${base}/v1/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
        client_id: "djl-desktop",
      }),
    });
    expect(token.status).toBe(200);
    const granted = (await token.json()) as { access_token: string };
    expect(granted.access_token).toBeTruthy();
    const meViaDevice = await fetch(`${base}/v1/me`, {
      headers: { authorization: `Bearer ${granted.access_token}` },
    });
    expect(meViaDevice.status).toBe(200);
    expect(((await meViaDevice.json()) as { user: { email: string } }).user.email).toBe(email);
  });

  it("signs out and loses access", async () => {
    const out = await call("/v1/auth/sign-out", { method: "POST", json: {} });
    expect(out.status).toBe(200);
    jar.clear();
    expect((await call("/v1/me")).status).toBe(401);
  });
});
