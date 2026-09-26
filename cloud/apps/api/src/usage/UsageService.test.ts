import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { bankExpiresAt, creditsToMicro } from "@djl/domain";
import { afterAll, describe, expect, it } from "vitest";

import { LedgerService } from "../credits/LedgerService.ts";
import { ApiError } from "../http/errors.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { planForOrg } from "./plans.ts";
import { UsageService } from "./UsageService.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
const usage = new UsageService(conn.db);
afterAll(() => conn.close());

async function account(label: string) {
  const ids = await seedOrg(conn.db, label);
  await ledger.grant({
    orgId: ids.orgId,
    bucket: "topup",
    type: "topup",
    amount: creditsToMicro(1000),
    idempotencyKey: `g:${ids.orgId}`,
    actor: "test",
  });
  return ids;
}

async function spend(ids: { userId: string; orgId: string }, amount: bigint) {
  const id = crypto.randomUUID();
  const { windowCaps } = await planForOrg(conn.db, ids.orgId, new Date());
  await ledger.reserve({
    orgId: ids.orgId,
    reservationId: id,
    estimate: amount,
    idempotencyKey: `r:${id}`,
    actor: "test",
    window: { userId: ids.userId, caps: windowCaps, partial: true },
  });
  await ledger.settle({
    orgId: ids.orgId,
    reservationId: id,
    actual: amount,
    idempotencyKey: `r:${id}`,
    actor: "test",
  });
}

async function bank(userId: string, grantedAt = new Date()) {
  const [row] = await conn.db
    .insert(schema.resetBanks)
    .values({
      userId,
      source: "admin",
      grantedBy: "admin:test",
      grantedAt,
      expiresAt: bankExpiresAt(grantedAt),
      idempotencyKey: `test:${crypto.randomUUID()}`,
    })
    .returning();
  return row!;
}

describe("UsageService", () => {
  it("measures settled spend in both windows against the plan caps", async () => {
    const ids = await account("usage-measure");
    await spend(ids, creditsToMicro(3));
    const view = await usage.windows(ids.userId, ids.orgId);
    const { windowCaps } = await planForOrg(conn.db, ids.orgId, new Date());
    expect(view.planId).toBe("free");
    expect(view.windows.fiveHour).toMatchObject({
      used: creditsToMicro(3),
      limit: windowCaps.fiveHour,
    });
    expect(view.windows.week.used).toBe(creditsToMicro(3));
    expect(view.windows.fiveHour.resetsAt).not.toBeNull();
    expect(view.banks).toEqual({ count: 0, nextExpiresAt: null });
  });

  it("redeeming a bank zeroes both windows and starts a new week", async () => {
    const ids = await account("usage-redeem");
    await spend(ids, creditsToMicro(4));
    const granted = await bank(ids.userId);
    const before = await conn.db.query.usageWindows.findFirst({
      where: eq(schema.usageWindows.userId, ids.userId),
    });
    const result = await usage.redeem(ids.userId, ids.orgId, "key-1");
    expect(result.redeemedBankId).toBe(granted.id);
    expect(result.usage.windows.fiveHour).toMatchObject({ used: 0n, resetsAt: null });
    expect(result.usage.windows.week).toMatchObject({ used: 0n, resetsAt: null });
    expect(result.usage.banks.count).toBe(0);
    const after = await conn.db.query.usageWindows.findFirst({
      where: eq(schema.usageWindows.userId, ids.userId),
    });
    expect(after!.weekAnchorAt.getTime()).toBeGreaterThan(before!.weekAnchorAt.getTime());
    expect(after!.floorAt).toEqual(after!.weekAnchorAt);
    // Spend after the redeem counts again.
    await spend(ids, creditsToMicro(1));
    expect((await usage.windows(ids.userId, ids.orgId)).windows.week.used).toBe(creditsToMicro(1));
    const events = await conn.db.query.usageWindowEvents.findMany({
      where: eq(schema.usageWindowEvents.userId, ids.userId),
    });
    expect(events.map((e) => e.kind)).toEqual(["bank_redeemed"]);
  });

  it("redeems the oldest live bank and never an expired or revoked one", async () => {
    const ids = await account("usage-expired");
    await bank(ids.userId, new Date(Date.now() - 91 * 86_400_000));
    const revoked = await bank(ids.userId, new Date(Date.now() - 2 * 86_400_000));
    await conn.db
      .update(schema.resetBanks)
      .set({ revokedAt: new Date() })
      .where(eq(schema.resetBanks.id, revoked.id));
    expect(await usage.banks(ids.userId)).toEqual([]);
    await expect(usage.redeem(ids.userId, ids.orgId, "k")).rejects.toMatchObject({
      status: 409,
      code: "no_reset_bank",
    });

    const newer = await bank(ids.userId, new Date(Date.now() - 1000));
    const older = await bank(ids.userId, new Date(Date.now() - 5000));
    expect((await usage.banks(ids.userId)).map((b) => b.id)).toEqual([older.id, newer.id]);
    expect((await usage.windows(ids.userId, ids.orgId)).banks).toEqual({
      count: 2,
      nextExpiresAt: older.expiresAt,
    });
    expect((await usage.redeem(ids.userId, ids.orgId, "k2")).redeemedBankId).toBe(older.id);
  });

  it("parallel redeems with one idempotency key redeem exactly one bank", async () => {
    const ids = await account("usage-double");
    await bank(ids.userId);
    await bank(ids.userId);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => usage.redeem(ids.userId, ids.orgId, "same-key")),
    );
    expect(new Set(results.map((r) => r.redeemedBankId)).size).toBe(1);
    expect(await usage.banks(ids.userId)).toHaveLength(1);
  });

  it("parallel redeems with different keys never redeem more banks than exist", async () => {
    const ids = await account("usage-race");
    await bank(ids.userId);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => usage.redeem(ids.userId, ids.orgId, `key-${i}`)),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof ApiError &&
        r.reason.code === "no_reset_bank",
    );
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(5);
  });
});
