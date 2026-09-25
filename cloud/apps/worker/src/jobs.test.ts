import { eq } from "drizzle-orm";
import { LedgerService } from "@djl/api/credits";
import { createDatabase, schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { afterAll, describe, expect, it } from "vitest";

import { expireTrials, refoldActiveOrgs, rollupDailyStats } from "./jobs.ts";

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
