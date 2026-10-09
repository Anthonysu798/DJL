import { and, eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { afterAll, describe, expect, it } from "vitest";

import type { AdminPrincipal } from "../admin/AdminAuth.ts";
import { AdminService } from "../admin/AdminService.ts";
import { LedgerService } from "../credits/LedgerService.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { planForOrg } from "./plans.ts";
import { UsageAdminService } from "./UsageAdminService.ts";
import { UsageService } from "./UsageService.ts";
import { GLOBAL_FLOOR_KEY } from "./windowStore.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
const usage = new UsageService(conn.db);
const alerts: string[] = [];
/** User ids whose window-blocked runs were re-enqueued; null means everyone. */
const resumed: (string | null)[] = [];
const resumeRuns = async (userId: string | null) => void resumed.push(userId);
const revoked: string[] = [];
const usageAdmin = new UsageAdminService({
  db: conn.db,
  usage,
  alerts: { post: async (a) => void alerts.push(a.title) },
  resumeRuns,
});
const admin = new AdminService({
  db: conn.db,
  ledger,
  limiter: createMemoryRateLimiter(),
  gateway: { invalidateCatalog: () => {} },
  trial: { approve: async () => false },
  auth: {} as never,
  revocations: { revoke: async (ids) => void revoked.push(...ids) },
  resumeRuns,
  email: {} as never,
  adminPublicUrl: "http://admin.test",
  version: "test",
});
afterAll(() => conn.close());

const principal = (role: AdminPrincipal["role"]): AdminPrincipal => ({
  adminId: `${role}-${crypto.randomUUID().slice(0, 8)}`,
  email: `${role}@slcor.test`,
  role,
  sessionId: "s",
  mfaVerified: true,
});
const owner = principal("admin");
const support = principal("employee");

async function spender(label: string, spend = creditsToMicro(2)) {
  const ids = await seedOrg(conn.db, label);
  await ledger.grant({
    orgId: ids.orgId,
    bucket: "topup",
    type: "topup",
    amount: creditsToMicro(100),
    idempotencyKey: `g:${ids.orgId}`,
    actor: "test",
  });
  const id = crypto.randomUUID();
  const { windowCaps } = await planForOrg(conn.db, ids.orgId, new Date());
  await ledger.reserve({
    orgId: ids.orgId,
    reservationId: id,
    estimate: spend,
    idempotencyKey: `r:${id}`,
    actor: "test",
    window: { userId: ids.userId, caps: windowCaps, partial: true },
  });
  await ledger.settle({
    orgId: ids.orgId,
    reservationId: id,
    actual: spend,
    idempotencyKey: `r:${id}`,
    actor: "test",
  });
  return ids;
}

const audits = (action: string, targetId: string) =>
  conn.db.query.auditEvents.findMany({
    where: and(eq(schema.auditEvents.action, action), eq(schema.auditEvents.targetId, targetId)),
  });

describe("UsageAdminService", () => {
  it("the per-user admin reset clears both windows and keeps credits and banks", async () => {
    const ids = await spender("uadm-reset");
    await usageAdmin.grantBanks(support, ids.userId, { count: 1, reason: "goodwill" });
    const before = await usage.windows(ids.userId, ids.orgId);
    expect(before.windows.fiveHour.used).toBe(creditsToMicro(2));
    await admin.resetLimits(support, ids.userId, "stuck customer");
    const after = await usage.windows(ids.userId, ids.orgId);
    expect(after.windows.fiveHour.used).toBe(0n);
    expect(after.windows.week.used).toBe(0n);
    expect(after.banks.count).toBe(1);
    expect(resumed).toContain(ids.userId);
    expect(await ledger.available(ids.orgId)).toBe(creditsToMicro(98));
    const events = await conn.db.query.usageWindowEvents.findMany({
      where: eq(schema.usageWindowEvents.userId, ids.userId),
    });
    expect(events.map((e) => e.kind).toSorted()).toEqual(["admin_reset", "bank_granted"]);
  });

  it("revoking a user's sessions also denylists them so their access tokens die now", async () => {
    const ids = await seedOrg(conn.db, "uadm-revoke");
    const now = new Date();
    const sessions = [crypto.randomUUID(), crypto.randomUUID()];
    await conn.db.insert(schema.session).values(
      sessions.map((id) => ({
        id,
        userId: ids.userId,
        token: `tok-${id}`,
        expiresAt: new Date(now.getTime() + 86_400_000),
        createdAt: now,
        updatedAt: now,
      })),
    );
    await admin.revokeSessions(support, ids.userId);
    expect(revoked).toEqual(expect.arrayContaining(sessions));
    expect(
      await conn.db.query.session.findMany({ where: eq(schema.session.userId, ids.userId) }),
    ).toEqual([]);
  });

  it("grants banks with an audited reason and revokes only unredeemed ones", async () => {
    const ids = await seedOrg(conn.db, "uadm-grant");
    await expect(
      usageAdmin.grantBanks(support, ids.userId, { count: 2, reason: " " }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      usageAdmin.grantBanks(support, ids.userId, { count: 11, reason: "too many" }),
    ).rejects.toMatchObject({ status: 400 });
    const granted = await usageAdmin.grantBanks(support, ids.userId, {
      count: 2,
      reason: "outage credit",
    });
    expect(granted).toHaveLength(2);
    expect(await usage.banks(ids.userId)).toHaveLength(2);
    expect(await audits("usage.banks.grant", ids.userId)).toHaveLength(1);

    await usageAdmin.revokeBank(support, granted[0]!.id, "granted by mistake");
    expect(await usage.banks(ids.userId)).toHaveLength(1);
    await expect(usageAdmin.revokeBank(support, granted[0]!.id, "again")).rejects.toMatchObject({
      status: 409,
      code: "bank_not_revocable",
    });
    await usage.redeem(ids.userId, ids.orgId, "k");
    await expect(
      usageAdmin.revokeBank(support, granted[1]!.id, "already used"),
    ).rejects.toMatchObject({ status: 409 });
    expect(await audits("usage.banks.revoke", granted[0]!.id)).toHaveLength(1);
  });

  it("reset everyone needs the admin role and RESET, never touches credits or banks, and is audited", async () => {
    const saved = await conn.db.query.settings.findFirst({
      where: eq(schema.settings.key, GLOBAL_FLOOR_KEY),
    });
    try {
      const a = await spender("uadm-all-a");
      const b = await spender("uadm-all-b", creditsToMicro(3));
      await usageAdmin.grantBanks(owner, a.userId, { count: 1, reason: "keep me" });
      const ledgerRows = async () =>
        (await ledger.history(a.orgId, { limit: 200 })).length +
        (await ledger.history(b.orgId, { limit: 200 })).length;
      const banksBefore = await conn.db.query.resetBanks.findMany({
        where: eq(schema.resetBanks.userId, a.userId),
      });
      const entriesBefore = await ledgerRows();

      await expect(
        usageAdmin.resetAll(support, { confirm: "RESET", reason: "incident" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        usageAdmin.resetAll(owner, { confirm: "reset", reason: "incident" }),
      ).rejects.toMatchObject({ status: 400, code: "confirm_required" });
      await expect(
        usageAdmin.resetAll(owner, { confirm: "RESET", reason: "" }),
      ).rejects.toMatchObject({ status: 400 });

      await usageAdmin.resetAll(owner, { confirm: "RESET", reason: "provider outage refund" });
      for (const ids of [a, b]) {
        const view = await usage.windows(ids.userId, ids.orgId);
        expect(view.windows.fiveHour.used).toBe(0n);
        expect(view.windows.week.used).toBe(0n);
      }
      expect(await ledgerRows()).toBe(entriesBefore);
      expect(await ledger.available(b.orgId)).toBe(creditsToMicro(97));
      expect(
        await conn.db.query.resetBanks.findMany({ where: eq(schema.resetBanks.userId, a.userId) }),
      ).toEqual(banksBefore);
      const resets = await audits("usage.reset_all", GLOBAL_FLOOR_KEY);
      expect(resets.filter((e) => e.actorId === owner.adminId)).toMatchObject([
        { reason: "provider outage refund" },
      ]);
      expect(alerts).toContain("Usage windows reset for everyone");
      expect(resumed).toContain(null);
    } finally {
      await conn.db.delete(schema.settings).where(eq(schema.settings.key, GLOBAL_FLOOR_KEY));
      if (saved) await conn.db.insert(schema.settings).values(saved);
    }
  });

  it("edits plan reset schedules and queues idempotent bulk grants, admin only", async () => {
    await expect(
      usageAdmin.putSchedule(
        support,
        "business",
        { everyDays: 30, banksPerGrant: 1, active: true },
        "x",
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      usageAdmin.putSchedule(
        owner,
        "business",
        { everyDays: 0, banksPerGrant: 1, active: true },
        "x",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await usageAdmin.putSchedule(
      owner,
      "business",
      { everyDays: 30, banksPerGrant: 2, active: true },
      "monthly perk",
    );
    expect(
      (await usageAdmin.schedules(support)).find((s) => s.planId === "business"),
    ).toMatchObject({ everyDays: 30, banksPerGrant: 2, active: true });

    await expect(
      usageAdmin.createBulkGrant(support, { planId: null, reason: "launch", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ status: 403 });
    const key = `launch-${crypto.randomUUID()}`;
    const first = await usageAdmin.createBulkGrant(owner, {
      planId: null,
      reason: "launch week",
      idempotencyKey: key,
    });
    const again = await usageAdmin.createBulkGrant(owner, {
      planId: null,
      reason: "launch week",
      idempotencyKey: key,
    });
    expect(again.id).toBe(first.id);
    expect(first.status).toBe("pending");
    expect((await usageAdmin.batches(support)).some((b) => b.id === first.id)).toBe(true);
    await conn.db.delete(schema.resetGrantBatches).where(eq(schema.resetGrantBatches.id, first.id));
  });
});
