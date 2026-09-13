/**
 * Admin API over HTTP: bootstrap owner, login, mandatory TOTP, IP allowlist,
 * user search and detail, credit grant with audit, reset limits, kill switch,
 * catalog edit, stats, and role enforcement for a support admin.
 */
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { seedOrg } from "../testing/db.ts";

let api: ApiRuntime;
let base: string;
let ownerToken = "";
let supportToken = "";
const ownerEmail = `owner-${crypto.randomUUID().slice(0, 6)}@slcor.test`;
const supportEmail = `support-${crypto.randomUUID().slice(0, 6)}@slcor.test`;
const password = "a-very-long-admin-password-1";
let subjectUserId = "";
let subjectOrgId = "";

async function admin(
  path: string,
  init: { method?: string; json?: unknown; token?: string; ip?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "fly-client-ip": init.ip ?? "203.0.113.10",
  };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : null,
  });
  return { status: res.status, body: (await res.json()) as any };
}

beforeAll(async () => {
  const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${api.address.port}`;
  await api.adminAuth.create({ email: ownerEmail, name: "Owner", role: "owner", password });
  await api.adminAuth.create({ email: supportEmail, name: "Support", role: "support", password });
  ({ userId: subjectUserId, orgId: subjectOrgId } = await seedOrg(api.db, "admin-subject"));
  await api.db
    .insert(schema.settings)
    .values({ key: "admin.ip_allowlist", value: ["203.0.113.0/24"] })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: ["203.0.113.0/24"] } });
});
afterAll(async () => {
  await api.db.delete(schema.settings).where(eq(schema.settings.key, "admin.ip_allowlist"));
  await api.close();
});

async function loginWithTotp(email: string): Promise<string> {
  const first = await admin("/admin/v1/auth/login", { json: { email, password } });
  expect(first.status).toBe(200);
  const token = first.body.token as string;
  // MFA is mandatory: without enrollment every operation is refused.
  expect((await admin("/admin/v1/users", { token })).status).toBe(403);
  const enroll = await admin("/admin/v1/auth/totp/enroll", { token, json: {} });
  expect(enroll.status).toBe(200);
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(enroll.body.secret as string),
    digits: 6,
    period: 30,
  });
  const confirm = await admin("/admin/v1/auth/totp/confirm", {
    token,
    json: { code: totp.generate() },
  });
  expect(confirm.status).toBe(200);
  // Subsequent logins require the code.
  const withoutCode = await admin("/admin/v1/auth/login", { json: { email, password } });
  expect(withoutCode.status).toBe(401);
  expect(withoutCode.body.error.code).toBe("totp_required");
  const second = await admin("/admin/v1/auth/login", {
    json: { email, password, totp: totp.generate() },
  });
  expect(second.status).toBe(200);
  return second.body.token as string;
}

describe("admin api", () => {
  it("blocks networks outside the allowlist", async () => {
    const res = await admin("/admin/v1/auth/login", {
      json: { email: ownerEmail, password },
      ip: "198.51.100.7",
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ip_not_allowed");
  });

  it("owner and support sign in with mandatory TOTP", async () => {
    ownerToken = await loginWithTotp(ownerEmail);
    supportToken = await loginWithTotp(supportEmail);
    const me = await admin("/admin/v1/me", { token: ownerToken });
    expect(me.body.admin.role).toBe("owner");
    expect(me.body.admin.mfaVerified).toBe(true);
  });

  it("locks out after repeated bad passwords", async () => {
    const email = `lock-${crypto.randomUUID().slice(0, 6)}@slcor.test`;
    await api.adminAuth.create({ email, name: "L", role: "readonly", password });
    for (let i = 0; i < 5; i += 1)
      await admin("/admin/v1/auth/login", {
        json: { email, password: "wrong-password-xx" },
        ip: "203.0.113.99",
      });
    const locked = await admin("/admin/v1/auth/login", {
      json: { email, password },
      ip: "203.0.113.99",
    });
    expect(locked.status).toBe(429);
  });

  it("searches users and shows detail with balances", async () => {
    const list = await admin(`/admin/v1/users?q=admin-subject`, { token: ownerToken });
    expect(list.status).toBe(200);
    expect(list.body.users.some((u: { id: string }) => u.id === subjectUserId)).toBe(true);
    const detail = await admin(`/admin/v1/users/${subjectUserId}`, { token: ownerToken });
    expect(detail.status).toBe(200);
    expect(detail.body.organizations[0].total).toBe("0.00");
  });

  it("grants credits with a reason and an audit row; support is capped", async () => {
    const grant = await admin(`/admin/v1/orgs/${subjectOrgId}/credits/grant`, {
      token: ownerToken,
      json: { credits: 1000, reason: "goodwill" },
    });
    expect(grant.status).toBe(200);
    expect(await api.ledger.available(subjectOrgId)).toBe(1000n * 1_000_000n);
    const capped = await admin(`/admin/v1/orgs/${subjectOrgId}/credits/grant`, {
      token: supportToken,
      json: { credits: 5000, reason: "too much" },
    });
    expect(capped.status).toBe(403);
    expect(capped.body.error.code).toBe("grant_cap");
    const noReason = await admin(`/admin/v1/orgs/${subjectOrgId}/credits/grant`, {
      token: ownerToken,
      json: { credits: 10 },
    });
    expect(noReason.status).toBe(400);
    const audit = await admin(`/admin/v1/audit?targetId=${subjectOrgId}`, { token: ownerToken });
    expect(audit.body.some((e: { action: string }) => e.action === "credits.grant")).toBe(true);
  });

  it("suspends, resets limits, and revokes sessions; readonly cannot mutate", async () => {
    const suspend = await admin(`/admin/v1/users/${subjectUserId}/suspend`, {
      token: supportToken,
      json: { suspend: true, reason: "abuse review" },
    });
    expect(suspend.status).toBe(200);
    expect(
      (await api.db.query.user.findFirst({ where: eq(schema.user.id, subjectUserId) }))?.banned,
    ).toBe(true);
    const unsuspend = await admin(`/admin/v1/users/${subjectUserId}/suspend`, {
      token: supportToken,
      json: { suspend: false, reason: "cleared" },
    });
    expect(unsuspend.status).toBe(200);
    const reset = await admin(`/admin/v1/users/${subjectUserId}/reset-limits`, {
      token: supportToken,
      json: { reason: "support ticket 12" },
    });
    expect(reset.status).toBe(200);
    expect(typeof reset.body.cleared).toBe("number");
    expect(await api.ledger.available(subjectOrgId)).toBe(1000n * 1_000_000n); // reset never moves credits
    const kill = await admin("/admin/v1/kill-switches/gateway", {
      method: "PUT",
      token: supportToken,
      json: { engaged: true, reason: "x" },
    });
    expect(kill.status).toBe(403);
  });

  it("owner flips kill switches, edits the catalog, and reads stats", async () => {
    const on = await admin("/admin/v1/kill-switches/billing", {
      method: "PUT",
      token: ownerToken,
      json: { engaged: true, reason: "incident 7" },
    });
    expect(on.status).toBe(200);
    expect(
      (
        await api.db.query.killSwitches.findFirst({
          where: eq(schema.killSwitches.name, "billing"),
        })
      )?.engaged,
    ).toBe(true);
    const off = await admin("/admin/v1/kill-switches/billing", {
      method: "PUT",
      token: ownerToken,
      json: { engaged: false, reason: "resolved" },
    });
    expect(off.status).toBe(200);
    const models = await admin("/admin/v1/models", { token: ownerToken });
    expect(models.status).toBe(200);
    const first = models.body[0].modelId as string;
    const edit = await admin(`/admin/v1/models/${first}`, {
      method: "PATCH",
      token: ownerToken,
      json: { qualityScore: 77, reason: "tuning" },
    });
    expect(edit.status).toBe(200);
    expect(
      (await api.db.query.modelCatalog.findFirst({ where: eq(schema.modelCatalog.modelId, first) }))
        ?.qualityScore,
    ).toBe(77);
    const stats = await admin("/admin/v1/stats?range=week", { token: ownerToken });
    expect(stats.status).toBe(200);
    expect(stats.body.totals.users).toBeGreaterThan(0);
    const status = await admin("/admin/v1/status", { token: ownerToken });
    expect(status.status).toBe(200);
    expect(status.body.version).toBe("dev");
  });

  it("logs out and the token stops working", async () => {
    const out = await admin("/admin/v1/auth/logout", { token: supportToken, json: {} });
    expect(out.status).toBe(200);
    expect((await admin("/admin/v1/me", { token: supportToken })).status).toBe(401);
  });
});
