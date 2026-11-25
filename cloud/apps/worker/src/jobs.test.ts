import { eq } from "drizzle-orm";
import { LedgerService } from "@djl/api/credits";
import { createDatabase, schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { afterAll, describe, expect, it } from "vitest";

import {
  expireTrials,
  purgeDeletedUsers,
  refoldActiveOrgs,
  releaseStaleReservations,
  rollupDailyStats,
} from "./jobs.ts";

const conn = createDatabase(process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl", {
  max: 2,
});
const ledger = new LedgerService(conn.db);
afterAll(() => conn.close());

async function org(label: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [user] = await conn.db
    .insert(schema.user)
    .values({ name: label, email: `${label}-${suffix}@test.invalid`, emailVerified: true })
    .returning();
  const [o] = await conn.db
    .insert(schema.organization)
    .values({ name: label, slug: `${label}-${suffix}`, createdAt: new Date() })
    .returning();
  return { orgId: o!.id, userId: user!.id };
}

describe("worker jobs", () => {
  it("expires granted trials past their expiry and leaves fresh ones alone", async () => {
    const a = await org("w-exp");
    const b = await org("w-fresh");
    for (const o of [a, b]) {
      await ledger.grant({
        orgId: o.orgId,
        bucket: "trial",
        type: "trial_grant",
        amount: creditsToMicro(200),
        idempotencyKey: `t:${o.orgId}`,
        actor: "test",
      });
    }
    await conn.db.insert(schema.trialGrants).values([
      {
        orgId: a.orgId,
        userId: a.userId,
        phoneHash: `h-${a.orgId}`,
        phoneLineType: "mobile",
        status: "granted",
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        orgId: b.orgId,
        userId: b.userId,
        phoneHash: `h-${b.orgId}`,
        phoneLineType: "mobile",
        status: "granted",
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ]);
    const n = await expireTrials({ db: conn.db, ledger });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await ledger.available(a.orgId)).toBe(0n);
    expect(await ledger.available(b.orgId)).toBe(creditsToMicro(200));
    expect(
      (await conn.db.query.trialGrants.findFirst({ where: eq(schema.trialGrants.orgId, a.orgId) }))
        ?.status,
    ).toBe("expired");
  });

  it("releases an abandoned reservation but never one whose stream is still running", async () => {
    const reserved = async (label: string, holdExpiresAt: Date) => {
      const o = await org(label);
      await ledger.grant({
        orgId: o.orgId,
        bucket: "topup",
        type: "topup",
        amount: creditsToMicro(50),
        idempotencyKey: `t:${o.orgId}`,
        actor: "test",
      });
      const reservationId = crypto.randomUUID();
      // A reservation made 11 minutes ago, with the usage window hold its request took.
      await conn.db.insert(schema.creditLedger).values({
        orgId: o.orgId,
        type: "reservation",
        bucket: "topup",
        amount: -creditsToMicro(20),
        reservationId,
        idempotencyKey: `req:${reservationId}:reserve:topup`,
        actor: "test",
        createdAt: new Date(Date.now() - 11 * 60_000),
      });
      await ledger.refold(o.orgId);
      await conn.db.insert(schema.usageHolds).values({
        id: reservationId,
        userId: o.userId,
        amountMicro: creditsToMicro(20),
        expiresAt: holdExpiresAt,
      });
      return { ...o, reservationId };
    };
    // The running stream reported in a moment ago; the abandoned one stopped 11 minutes ago.
    const running = await reserved("w-running", new Date(Date.now() + 9 * 60_000));
    const abandoned = await reserved("w-abandoned", new Date(Date.now() - 60_000));
    const holdOf = (id: string) =>
      conn.db.query.usageHolds.findFirst({ where: eq(schema.usageHolds.id, id) });

    await releaseStaleReservations({ db: conn.db, ledger });
    expect(await ledger.available(abandoned.orgId)).toBe(creditsToMicro(50));
    expect(await holdOf(abandoned.reservationId)).toBeUndefined();
    expect(await ledger.available(running.orgId)).toBe(creditsToMicro(30));
    expect(await holdOf(running.reservationId)).toBeDefined();

    // The running stream finishes after more than 10 minutes and is charged in full.
    const settled = await ledger.settle({
      orgId: running.orgId,
      reservationId: running.reservationId,
      actual: creditsToMicro(12),
      idempotencyKey: `req:${running.reservationId}`,
      actor: "system:gateway",
    });
    expect(settled.balances.topup).toBe(creditsToMicro(38));
    // Even the abandoned one is charged if its request turns out to have finished.
    const late = await ledger.settle({
      orgId: abandoned.orgId,
      reservationId: abandoned.reservationId,
      actual: creditsToMicro(12),
      idempotencyKey: `req:${abandoned.reservationId}`,
      actor: "system:gateway",
    });
    expect(late.balances.topup).toBe(creditsToMicro(38));
    for (const o of [running, abandoned]) {
      const { before, after } = await ledger.refold(o.orgId);
      expect(before).toEqual(after);
    }
  });

  it("purges self-deleted accounts only after the 30-day grace period", async () => {
    const due = await org("w-purge-due");
    const recent = await org("w-purge-recent");
    // Deletion is a permanent ban (no expiry a sign-in could lift); the timestamp lives in deletedAt.
    const mark = (userId: string, daysAgo: number) =>
      conn.db
        .update(schema.user)
        .set({
          banned: true,
          banReason: "self_delete",
          banExpires: null,
          deletedAt: new Date(Date.now() - daysAgo * 86_400_000),
        })
        .where(eq(schema.user.id, userId));
    await mark(due.userId, 31);
    await mark(recent.userId, 1);

    expect(await purgeDeletedUsers({ db: conn.db, ledger })).toBeGreaterThanOrEqual(1);

    const remaining = async (userId: string) =>
      (await conn.db.select().from(schema.user).where(eq(schema.user.id, userId))).length;
    expect(await remaining(due.userId)).toBe(0);
    expect(await remaining(recent.userId)).toBe(1);
  });

  it("refold repairs a drifted materialized balance", async () => {
    const a = await org("w-drift");
    await ledger.grant({
      orgId: a.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(50),
      idempotencyKey: `t:${a.orgId}`,
      actor: "test",
    });
    await conn.db
      .update(schema.creditBalances)
      .set({ topup: creditsToMicro(999) })
      .where(eq(schema.creditBalances.orgId, a.orgId));
    const { repaired } = await refoldActiveOrgs({ db: conn.db, ledger });
    expect(repaired).toBeGreaterThanOrEqual(1);
    expect(await ledger.available(a.orgId)).toBe(creditsToMicro(50));
  });

  it("rolls up a day of stats idempotently", async () => {
    const day = "2026-01-15";
    await rollupDailyStats({ db: conn.db, ledger }, day);
    await rollupDailyStats({ db: conn.db, ledger }, day);
    const rows = await conn.db.query.dailyStats.findMany({ where: eq(schema.dailyStats.day, day) });
    expect(rows).toHaveLength(1);
  });
});
