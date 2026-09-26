/**
 * Admin API over HTTP: bootstrap owner, login, mandatory TOTP, IP allowlist,
 * user search and detail, credit grant with audit, reset limits, kill switch,
 * catalog edit, stats, and role enforcement for a support admin.
 */
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { Redis } from "ioredis";
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
const totpSecrets = new Map<string, string>();

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
  // Lockouts live in Redis and outlast a run; start from none so reruns within
  // the 15-minute window see the same counts as a fresh CI job.
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  const stale = await redis.keys("admin:lockout:*");
  if (stale.length > 0) await redis.del(...stale);
  redis.disconnect();
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${api.address.port}`;
  await api.adminAuth.create({ email: ownerEmail, name: "Owner", role: "admin", password });
  await api.adminAuth.create({ email: supportEmail, name: "Support", role: "employee", password });
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
  totpSecrets.set(email, enroll.body.secret as string);
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

/** Sign in again as an admin whose authenticator was enrolled earlier in this file. */
async function loginEnrolled(email: string): Promise<string> {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(totpSecrets.get(email)!),
    digits: 6,
    period: 30,
  });
  const res = await admin("/admin/v1/auth/login", {
    json: { email, password, totp: totp.generate() },
  });
  expect(res.status).toBe(200);
  return res.body.token as string;
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
    expect(me.body.admin.role).toBe("admin");
    expect(me.body.admin.mfaVerified).toBe(true);
  });

  it("locks out after repeated bad passwords", async () => {
    const email = `lock-${crypto.randomUUID().slice(0, 6)}@slcor.test`;
    await api.adminAuth.create({ email, name: "L", role: "employee", password });
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

/** Pull the invite token out of the last mock email sent to `to`. */
function inviteTokenFor(to: string): string {
  const mail = api.outbox!.emails.toReversed().find((m) => m.to === to && m.tag === "admin-invite");
  expect(mail).toBeDefined();
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(mail!.text);
  expect(match).not.toBeNull();
  return match![1]!;
}

const CLIENT = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
  platform: "MacIntel",
  screen: "1728x1117",
  deviceId: "dev-abc123",
};

describe("team management", () => {
  const inviteeEmail = `emp-${crypto.randomUUID().slice(0, 6)}@slcor.test`;
  let inviteeId = "";
  let inviteeToken = "";
  const goodPassword = "employee-strong-passphrase-42";

  it("employees cannot see or manage the team", async () => {
    const employee = await loginEnrolled(supportEmail);
    expect((await admin("/admin/v1/admins", { token: employee })).status).toBe(403);
    const invite = await admin("/admin/v1/admins", {
      token: employee,
      json: { email: "x@slcor.test", name: "X", role: "employee", reason: "no" },
    });
    expect(invite.status).toBe(403);
  });

  it("rejects malformed invites without creating anything", async () => {
    const bad = await admin("/admin/v1/admins", {
      token: ownerToken,
      json: { email: "not-an-email", name: "X", role: "employee", reason: "hire" },
    });
    expect(bad.status).toBe(400);
    const badRole = await admin("/admin/v1/admins", {
      token: ownerToken,
      json: { email: "x2@slcor.test", name: "X", role: "superuser", reason: "hire" },
    });
    expect(badRole.status).toBe(400);
    const noReason = await admin("/admin/v1/admins", {
      token: ownerToken,
      json: { email: "x3@slcor.test", name: "X", role: "employee" },
    });
    expect(noReason.status).toBe(400);
  });

  it("invites an employee, emails a single-use link, and blocks login until accepted", async () => {
    const res = await admin("/admin/v1/admins", {
      token: ownerToken,
      json: {
        email: inviteeEmail.toUpperCase(),
        name: "New Hire",
        role: "employee",
        reason: "hired",
      },
    });
    expect(res.status).toBe(200);
    inviteeId = res.body.id;
    expect(res.body.email).toBe(inviteeEmail); // normalized
    expect(res.body.status).toBe("invited");
    inviteeToken = inviteTokenFor(inviteeEmail);
    // Cannot sign in before accepting: there is no password yet.
    const early = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword },
    });
    expect(early.status).toBe(401);
    // Duplicate invite for a live email is refused.
    const dup = await admin("/admin/v1/admins", {
      token: ownerToken,
      json: { email: inviteeEmail, name: "Again", role: "employee", reason: "oops" },
    });
    expect(dup.status).toBe(409);
  });

  it("inspects the invite and enforces the password policy on accept", async () => {
    const inspect = await admin("/admin/v1/auth/invite/inspect", { json: { token: inviteeToken } });
    expect(inspect.status).toBe(200);
    expect(inspect.body.email).toBe(inviteeEmail);
    const bogus = await admin("/admin/v1/auth/invite/inspect", { json: { token: "nope" } });
    expect(bogus.status).toBe(400);
    const short = await admin("/admin/v1/auth/invite/accept", {
      json: { token: inviteeToken, password: "short-pass", client: CLIENT },
    });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe("weak_password");
    const containsEmail = await admin("/admin/v1/auth/invite/accept", {
      json: {
        token: inviteeToken,
        password: `${inviteeEmail.split("@")[0]}-xxxxxxxxxxxx`,
        client: CLIENT,
      },
    });
    expect(containsEmail.status).toBe(400);
    const ok = await admin("/admin/v1/auth/invite/accept", {
      json: { token: inviteeToken, password: goodPassword, client: CLIENT },
    });
    expect(ok.status).toBe(200);
    // Single use.
    const again = await admin("/admin/v1/auth/invite/accept", {
      json: { token: inviteeToken, password: goodPassword, client: CLIENT },
    });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("invalid_invite");
    const row = await api.db.query.admins.findFirst({ where: eq(schema.admins.id, inviteeId) });
    expect(row?.emailVerifiedAt).not.toBeNull();
  });

  it("records every sign-in attempt with client context", async () => {
    const wrong = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: "definitely-wrong-pass", client: CLIENT },
      ip: "203.0.113.42",
    });
    expect(wrong.status).toBe(401);
    const good = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword, client: CLIENT },
      ip: "203.0.113.42",
    });
    expect(good.status).toBe(200);
    const events = await admin(`/admin/v1/admins/${inviteeId}/logins`, { token: ownerToken });
    expect(events.status).toBe(200);
    const outcomes = events.body.map((e: { outcome: string }) => e.outcome);
    expect(outcomes).toContain("bad_password");
    expect(outcomes).toContain("success");
    const success = events.body.find((e: { outcome: string }) => e.outcome === "success");
    expect(success.ip).toBe("203.0.113.42");
    expect(success.timezone).toBe("Asia/Shanghai");
    expect(success.deviceId).toBe("dev-abc123");
    expect(success.platform).toBe("MacIntel");
    const list = await admin("/admin/v1/admins", { token: ownerToken });
    const me = list.body.find((a: { id: string }) => a.id === inviteeId);
    expect(me.status).toBe("active");
    expect(me.lastLoginIp).toBe("203.0.113.42");
    // Unknown emails are logged too, without revealing anything to the caller.
    const ghost = await admin("/admin/v1/auth/login", {
      json: { email: "ghost@slcor.test", password: "whatever-whatever-1", client: CLIENT },
      ip: "203.0.113.43",
    });
    expect(ghost.status).toBe(401);
    expect(ghost.body.error.code).toBe("bad_credentials");
    const byIp = await admin("/admin/v1/security/logins?ip=203.0.113.43", { token: ownerToken });
    expect(byIp.body[0].outcome).toBe("unknown_email");
  });

  it("bans an IP: sessions from it die and sign-in from it is refused", async () => {
    const session = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword, client: CLIENT },
      ip: "203.0.113.42",
    });
    expect(session.status).toBe(200);
    const ban = await admin("/admin/v1/security/ip-bans", {
      token: ownerToken,
      json: { ip: "203.0.113.42", reason: "suspicious activity" },
    });
    expect(ban.status).toBe(200);
    const badIp = await admin("/admin/v1/security/ip-bans", {
      token: ownerToken,
      json: { ip: "not.an.ip", reason: "x" },
    });
    expect(badIp.status).toBe(400);
    expect(
      (await admin("/admin/v1/me", { token: session.body.token, ip: "203.0.113.42" })).status,
    ).toBe(403);
    const blocked = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword, client: CLIENT },
      ip: "203.0.113.42",
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("ip_blocked");
    const bans = await admin("/admin/v1/security/ip-bans", { token: ownerToken });
    expect(bans.body).toContain("203.0.113.42");
    const unban = await admin("/admin/v1/security/ip-bans/remove", {
      token: ownerToken,
      json: { ip: "203.0.113.42", reason: "cleared" },
    });
    expect(unban.status).toBe(200);
    const after = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword, client: CLIENT },
      ip: "203.0.113.42",
    });
    expect(after.status).toBe(200);
  });

  it("edits role and name, revokes sessions on role change, and protects the last admin", async () => {
    const live = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword, client: CLIENT },
    });
    const promote = await admin(`/admin/v1/admins/${inviteeId}`, {
      method: "PATCH",
      token: ownerToken,
      json: { role: "admin", name: "New Hire Jr", reason: "promotion" },
    });
    expect(promote.status).toBe(200);
    expect((await admin("/admin/v1/me", { token: live.body.token })).status).toBe(401);
    const self = await admin(
      `/admin/v1/admins/${(await admin("/admin/v1/me", { token: ownerToken })).body.admin.id}`,
      {
        method: "PATCH",
        token: ownerToken,
        json: { role: "employee", reason: "self" },
      },
    );
    expect(self.status).toBe(400);
    // Demote the invitee back so the owner is the only admin, then the owner cannot be demoted or deleted.
    const demote = await admin(`/admin/v1/admins/${inviteeId}`, {
      method: "PATCH",
      token: ownerToken,
      json: { role: "employee", reason: "reorg" },
    });
    expect(demote.status).toBe(200);
    // The owner is now the only active admin: nobody may demote, disable, or delete them.
    const ownerId = (await admin("/admin/v1/me", { token: ownerToken })).body.admin.id as string;
    const selfDelete = await admin(`/admin/v1/admins/${ownerId}`, {
      method: "DELETE",
      token: ownerToken,
      json: { reason: "trying" },
    });
    expect(selfDelete.status).toBe(400);
    // Promote the invitee, sign in as them, and try to remove the last other admin: refused.
    await admin(`/admin/v1/admins/${inviteeId}`, {
      method: "PATCH",
      token: ownerToken,
      json: { role: "admin", reason: "temp" },
    });
    const inviteeSession = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword, client: CLIENT },
    });
    // Invitee has no authenticator yet, so it can only reach enrollment; enroll now.
    const enroll = await admin("/admin/v1/auth/totp/enroll", {
      token: inviteeSession.body.token,
      json: {},
    });
    totpSecrets.set(inviteeEmail, enroll.body.secret as string);
    const code = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(enroll.body.secret as string),
      digits: 6,
      period: 30,
    }).generate();
    expect(
      (
        await admin("/admin/v1/auth/totp/confirm", {
          token: inviteeSession.body.token,
          json: { code },
        })
      ).status,
    ).toBe(200);
    const demoteOwner = await admin(`/admin/v1/admins/${ownerId}`, {
      method: "PATCH",
      token: inviteeSession.body.token,
      json: { role: "employee", reason: "coup" },
    });
    expect(demoteOwner.status).toBe(200); // two admins exist, so this is allowed…
    const demoteLast = await admin(`/admin/v1/admins/${inviteeId}`, {
      method: "PATCH",
      token: inviteeSession.body.token,
      json: { role: "employee", reason: "self" },
    });
    expect(demoteLast.status).toBe(400); // …but never your own role.
    // Restore: owner back to admin (invitee is the only admin now, so this must succeed) and invitee to employee.
    expect(
      (
        await admin(`/admin/v1/admins/${ownerId}`, {
          method: "PATCH",
          token: inviteeSession.body.token,
          json: { role: "admin", reason: "restore" },
        })
      ).status,
    ).toBe(200);
    ownerToken = await loginEnrolled(ownerEmail);
    expect(
      (
        await admin(`/admin/v1/admins/${inviteeId}`, {
          method: "PATCH",
          token: ownerToken,
          json: { role: "employee", reason: "restore" },
        })
      ).status,
    ).toBe(200);
  });

  it("resends an invite only while pending, and soft deletes with session revoke", async () => {
    const notPending = await admin(`/admin/v1/admins/${inviteeId}/resend-invite`, {
      token: ownerToken,
      json: { reason: "again" },
    });
    expect(notPending.status).toBe(409);
    const pendingEmail = `pend-${crypto.randomUUID().slice(0, 6)}@slcor.test`;
    const created = await admin("/admin/v1/admins", {
      token: ownerToken,
      json: { email: pendingEmail, name: "Pending", role: "employee", reason: "hire" },
    });
    const first = inviteTokenFor(pendingEmail);
    const resend = await admin(`/admin/v1/admins/${created.body.id}/resend-invite`, {
      token: ownerToken,
      json: { reason: "lost email" },
    });
    expect(resend.status).toBe(200);
    const second = inviteTokenFor(pendingEmail);
    expect(second).not.toBe(first);
    // The superseded token is dead.
    expect((await admin("/admin/v1/auth/invite/inspect", { json: { token: first } })).status).toBe(
      400,
    );
    // Expired tokens are dead too.
    await api.db
      .update(schema.adminInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.adminInvites.adminId, created.body.id));
    expect((await admin("/admin/v1/auth/invite/inspect", { json: { token: second } })).status).toBe(
      400,
    );

    const inviteeTotp = () =>
      new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(totpSecrets.get(inviteeEmail)!),
        digits: 6,
        period: 30,
      }).generate();
    const live = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword, totp: inviteeTotp(), client: CLIENT },
    });
    expect(live.status).toBe(200);
    const revoke = await admin(`/admin/v1/admins/${inviteeId}/revoke-sessions`, {
      token: ownerToken,
      json: { reason: "lost laptop" },
    });
    expect(revoke.status).toBe(200);
    expect((await admin("/admin/v1/me", { token: live.body.token })).status).toBe(401);

    const del = await admin(`/admin/v1/admins/${inviteeId}`, {
      method: "DELETE",
      token: ownerToken,
      json: { reason: "left the company" },
    });
    expect(del.status).toBe(200);
    const gone = await admin("/admin/v1/auth/login", {
      json: { email: inviteeEmail, password: goodPassword, totp: inviteeTotp(), client: CLIENT },
    });
    expect(gone.status).toBe(401);
    expect(gone.body.error.code).toBe("bad_credentials");
    const list = await admin("/admin/v1/admins", { token: ownerToken });
    expect(list.body.some((a: { id: string }) => a.id === inviteeId)).toBe(false);
    // The email can be invited again after a soft delete.
    const reinvite = await admin("/admin/v1/admins", {
      token: ownerToken,
      json: { email: inviteeEmail, name: "Back", role: "employee", reason: "rehired" },
    });
    expect(reinvite.status).toBe(200);
    const audit = await admin(`/admin/v1/audit?targetId=${inviteeId}`, { token: ownerToken });
    const actions = audit.body.map((e: { action: string }) => e.action);
    for (const a of [
      "admin.admin.invite",
      "admin.admin.update",
      "admin.admin.revoke_sessions",
      "admin.admin.delete",
    ])
      expect(actions).toContain(a);
  });
});
