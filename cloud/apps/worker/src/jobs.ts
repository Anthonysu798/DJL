/**
 * Background jobs. Each job is a plain async function over injected services
 * so it can be unit tested without pg-boss. Schedules live in index.ts.
 */
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { LedgerService } from "@djl/api/credits";

import {
  bulkGrant,
  expireBanks,
  grantFreeAllowance,
  grantPlanResets,
  pruneBuckets,
} from "./usageJobs.ts";

export interface JobDeps {
  readonly db: DjlDatabase;
  readonly ledger: LedgerService;
  readonly now?: () => Date;
}

/**
 * Reservations without settlement after 10 minutes are released (which also
 * drops their usage window holds); holds left without a reservation expire.
 */
export async function releaseStaleReservations(
  deps: JobDeps,
): Promise<{ released: number; holdsSwept: number }> {
  const released = await deps.ledger.releaseStaleReservations(10 * 60 * 1000, "system:worker");
  const swept = await deps.db
    .delete(schema.usageHolds)
    .where(lt(schema.usageHolds.expiresAt, deps.now?.() ?? new Date()))
    .returning({ id: schema.usageHolds.id });
  return { released, holdsSwept: swept.length };
}

/** Trial grants past their expiry lose whatever is left in the trial bucket. */
export async function expireTrials(deps: JobDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const due = await deps.db
    .select({ id: schema.trialGrants.id, orgId: schema.trialGrants.orgId })
    .from(schema.trialGrants)
    .where(and(eq(schema.trialGrants.status, "granted"), lt(schema.trialGrants.expiresAt, now)));
  let count = 0;
  for (const row of due) {
    await deps.ledger.expire({
      orgId: row.orgId,
      bucket: "trial",
      idempotencyKey: `trial:expire:${row.id}`,
      actor: "system:worker",
      reason: "trial expired",
    });
    await deps.db
      .update(schema.trialGrants)
      .set({ status: "expired" })
      .where(eq(schema.trialGrants.id, row.id));
    count += 1;
  }
  return count;
}

/** Re-fold balances for orgs with recent ledger activity and repair drift. */
export async function refoldActiveOrgs(
  deps: JobDeps,
  sinceMs = 60 * 60 * 1000,
): Promise<{ checked: number; repaired: number }> {
  const since = new Date((deps.now?.() ?? new Date()).getTime() - sinceMs).toISOString();
  const rows = await deps.db.execute<{ org_id: string }>(
    sql`SELECT DISTINCT org_id FROM credit_ledger WHERE created_at > ${since}::timestamptz`,
  );
  let repaired = 0;
  for (const row of rows) {
    const { before, after } = await deps.ledger.refold(row.org_id);
    if (
      before.trial !== after.trial ||
      before.plan !== after.plan ||
      before.topup !== after.topup
    ) {
      repaired += 1;
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "balance drift repaired",
          orgId: row.org_id,
          before: String(before),
          after: String(after),
        }),
      );
    }
  }
  return { checked: rows.length, repaired };
}

/** Hard-delete accounts whose 30-day grace period ended. Ledger rows are anonymized, never removed. */
export async function purgeDeletedUsers(deps: JobDeps): Promise<number> {
  const cutoff = new Date((deps.now?.() ?? new Date()).getTime() - 30 * 86_400_000);
  const due = await deps.db
    .select({
      id: schema.user.id,
      banReason: schema.user.banReason,
      banExpires: schema.user.banExpires,
    })
    .from(schema.user)
    .where(and(eq(schema.user.banReason, "self_delete"), lt(schema.user.banExpires, cutoff)));
  let count = 0;
  for (const u of due) {
    await deps.db.transaction(async (tx) => {
      await tx
        .update(schema.usageRequests)
        .set({ userId: null })
        .where(eq(schema.usageRequests.userId, u.id));
      await tx.delete(schema.user).where(eq(schema.user.id, u.id)); // cascades sessions, accounts, devices, memberships
    });
    count += 1;
  }
  return count;
}

/** Roll up yesterday's signups, active users, gateway usage, and revenue per country. */
export async function rollupDailyStats(deps: JobDeps, day?: string): Promise<void> {
  const target =
    day ?? new Date((deps.now?.() ?? new Date()).getTime() - 86_400_000).toISOString().slice(0, 10);
  const start = `${target}T00:00:00Z`;
  const end = `${target}T23:59:59.999Z`;
  const [signups] = await deps.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM "user" WHERE created_at >= ${start}::timestamptz AND created_at <= ${end}::timestamptz`,
  );
  const [active] = await deps.db.execute<{ n: number }>(
    sql`SELECT count(DISTINCT user_id)::int AS n FROM usage_requests WHERE created_at >= ${start}::timestamptz AND created_at <= ${end}::timestamptz`,
  );
  const [usage] = await deps.db.execute<{ n: number; settled: string }>(
    sql`SELECT count(*)::int AS n, coalesce(sum(settled_micro),0)::text AS settled FROM usage_requests WHERE created_at >= ${start}::timestamptz AND created_at <= ${end}::timestamptz`,
  );
  const [revenue] = await deps.db.execute<{ cents: number }>(
    sql`SELECT coalesce(sum(amount_paid_usd_cents),0)::int AS cents FROM invoices WHERE created_at >= ${start}::timestamptz AND created_at <= ${end}::timestamptz`,
  );
  await deps.db
    .insert(schema.dailyStats)
    .values({
      day: target,
      country: "*",
      signups: signups?.n ?? 0,
      activeUsers: active?.n ?? 0,
      gatewayRequests: usage?.n ?? 0,
      settledMicro: usage?.settled ?? "0",
      revenueUsdCents: revenue?.cents ?? 0,
    })
    .onConflictDoNothing();
  await deps.db
    .update(schema.dailyStats)
    .set({
      signups: signups?.n ?? 0,
      activeUsers: active?.n ?? 0,
      gatewayRequests: usage?.n ?? 0,
      settledMicro: usage?.settled ?? "0",
      revenueUsdCents: revenue?.cents ?? 0,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.dailyStats.day, target), eq(schema.dailyStats.country, "*")));
}

export const JOBS = {
  "ledger.release-stale": releaseStaleReservations,
  "ledger.expire-trials": expireTrials,
  "ledger.refold": refoldActiveOrgs,
  "users.purge-deleted": purgeDeletedUsers,
  "stats.daily": rollupDailyStats,
  "usage.grantPlanResets": grantPlanResets,
  "usage.bulkGrant": bulkGrant,
  "usage.expireBanks": expireBanks,
  "usage.pruneBuckets": pruneBuckets,
  "usage.grantFreeAllowance": grantFreeAllowance,
} as const;

// Keep isNull referenced for future soft-delete predicates.
void isNull;
