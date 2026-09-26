import { and, eq } from "drizzle-orm";
import { LedgerService } from "@djl/api/credits";
import { createDatabase, schema } from "@djl/db";
import { bankExpiresAt, creditsToMicro, freeWeekStart } from "@djl/domain";
import { afterAll, describe, expect, it } from "vitest";

import {
  bulkGrant,
  expireBanks,
  grantFreeAllowance,
  grantPlanResets,
  pruneBuckets,
  PERSONAL_ORG_METADATA,
} from "./usageJobs.ts";

const conn = createDatabase(process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl", {
  max: 2,
});
const ledger = new LedgerService(conn.db);
const deps = { db: conn.db, ledger };
afterAll(() => conn.close());

async function personalUser(label: string, emailVerified = true) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [user] = await conn.db
    .insert(schema.user)
    .values({ name: label, email: `${label}-${suffix}@test.invalid`, emailVerified })
    .returning();
  const [org] = await conn.db
    .insert(schema.organization)
    .values({
      name: label,
      slug: `${label}-${suffix}`,
      createdAt: new Date(),
      metadata: PERSONAL_ORG_METADATA,
    })
    .returning();
  await conn.db
    .insert(schema.member)
    .values({ organizationId: org!.id, userId: user!.id, role: "owner", createdAt: new Date() });
  return { userId: user!.id, orgId: org!.id };
}

const banksOf = (userId: string) =>
  conn.db.query.resetBanks.findMany({ where: eq(schema.resetBanks.userId, userId) });

describe("usage jobs", () => {
  it("grants plan schedule banks once per period, however often the job runs", async () => {
    const onPlan = await personalUser("sched-on");
    const offPlan = await personalUser("sched-off");
    await conn.db.insert(schema.subscriptions).values({
      orgId: onPlan.orgId,
      planId: "autopilot",
      stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
      status: "active",
      interval: "month",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    });
    await conn.db
      .insert(schema.planResetSchedules)
      .values({ planId: "autopilot", everyDays: 7, banksPerGrant: 2 })
      .onConflictDoUpdate({
        target: schema.planResetSchedules.planId,
        set: { everyDays: 7, banksPerGrant: 2, active: true },
      });
    try {
      const now = new Date("2026-09-26T12:00:00Z");
      await grantPlanResets({ ...deps, now: () => now });
      await grantPlanResets({ ...deps, now: () => new Date(now.getTime() + 3_600_000) });
      const granted = await banksOf(onPlan.userId);
      expect(granted).toHaveLength(2);
      expect(granted.every((b) => b.source === "plan_schedule")).toBe(true);
      expect(await banksOf(offPlan.userId)).toHaveLength(0);
      // The next period grants again.
      await grantPlanResets({ ...deps, now: () => new Date(now.getTime() + 7 * 86_400_000) });
      expect(await banksOf(onPlan.userId)).toHaveLength(4);
    } finally {
      await conn.db
        .delete(schema.planResetSchedules)
        .where(eq(schema.planResetSchedules.planId, "autopilot"));
    }
  });

  it("runs a queued bulk grant once, even when a crashed run is retried", async () => {
    const a = await personalUser("bulk-a");
    const b = await personalUser("bulk-b");
    const [batch] = await conn.db
      .insert(schema.resetGrantBatches)
      .values({
        source: "bulk",
        actor: "admin:test",
        reason: "launch",
        idempotencyKey: `bulk:${crypto.randomUUID()}`,
      })
      .returning();
    await bulkGrant({ ...deps, chunkSize: 1 });
    // Simulate a crash before the batch was marked done.
    await conn.db
      .update(schema.resetGrantBatches)
      .set({ status: "running" })
      .where(eq(schema.resetGrantBatches.id, batch!.id));
    await bulkGrant({ ...deps, chunkSize: 1 });
    await bulkGrant(deps);
    for (const ids of [a, b]) {
      const banks = await banksOf(ids.userId);
      expect(banks.filter((x) => x.batchId === batch!.id)).toHaveLength(1);
    }
    const done = await conn.db.query.resetGrantBatches.findFirst({
      where: eq(schema.resetGrantBatches.id, batch!.id),
    });
    expect(done?.status).toBe("done");
    expect(done?.grantedCount).toBe(
      await conn.db.$count(schema.resetBanks, eq(schema.resetBanks.batchId, batch!.id)),
    );
    const events = await conn.db.query.usageWindowEvents.findMany({
      where: and(
        eq(schema.usageWindowEvents.userId, a.userId),
        eq(schema.usageWindowEvents.kind, "bank_granted"),
      ),
    });
    expect(events).toHaveLength(1);
  });

  it("records expired banks once and prunes old buckets", async () => {
    const ids = await personalUser("expire");
    const grantedAt = new Date(Date.now() - 91 * 86_400_000);
    const [bank] = await conn.db
      .insert(schema.resetBanks)
      .values({
        userId: ids.userId,
        source: "admin",
        grantedBy: "admin:test",
        grantedAt,
        expiresAt: bankExpiresAt(grantedAt),
        idempotencyKey: `t:${crypto.randomUUID()}`,
      })
      .returning();
    expect(await expireBanks(deps)).toBeGreaterThanOrEqual(1);
    await expireBanks(deps);
    const events = await conn.db.query.usageWindowEvents.findMany({
      where: eq(schema.usageWindowEvents.bankId, bank!.id),
    });
    expect(events.map((e) => e.kind)).toEqual(["bank_expired"]);

    await conn.db.insert(schema.usageBuckets).values([
      { userId: ids.userId, bucketStart: new Date(Date.now() - 9 * 86_400_000), spentMicro: 1n },
      { userId: ids.userId, bucketStart: new Date(Date.now() - 86_400_000), spentMicro: 1n },
    ]);
    await pruneBuckets(deps);
    expect(
      await conn.db.$count(schema.usageBuckets, eq(schema.usageBuckets.userId, ids.userId)),
    ).toBe(1);
  });

  it("grants each verified user the weekly free allowance once and expires last week's", async () => {
    const verified = await personalUser("free-yes");
    const unverified = await personalUser("free-no", false);
    const free = await conn.db.query.plans.findFirst({ where: eq(schema.plans.id, "free") });
    await conn.db
      .update(schema.plans)
      .set({ includedMicrocredits: creditsToMicro(20) })
      .where(eq(schema.plans.id, "free"));
    try {
      const monday = freeWeekStart(new Date());
      await grantFreeAllowance({ ...deps, now: () => new Date(monday.getTime() - 3_600_000) });
      await grantFreeAllowance({ ...deps, now: () => new Date(monday.getTime() + 3_600_000) });
      await grantFreeAllowance({ ...deps, now: () => new Date(monday.getTime() + 7_200_000) });
      expect(await ledger.balances(verified.orgId)).toMatchObject({ free: creditsToMicro(20) });
      expect(await ledger.balances(unverified.orgId)).toMatchObject({ free: 0n });
      const entries = await ledger.history(verified.orgId, { limit: 10 });
      expect(entries.map((e) => e.type).toSorted()).toEqual(["expiry", "free_grant", "free_grant"]);
    } finally {
      await conn.db
        .update(schema.plans)
        .set({ includedMicrocredits: free!.includedMicrocredits })
        .where(eq(schema.plans.id, "free"));
    }
  });
});
