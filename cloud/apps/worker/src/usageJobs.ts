/**
 * Usage window and banked reset jobs. Grants run as chunked INSERT … SELECT
 * with per-user idempotency keys, so a crashed or repeated run never grants
 * twice; bank expiry is a read-time filter, and the nightly job only records it.
 */
import { and, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { grantWeeklyFreeAllowance } from "@djl/api/free-allowance";
import { schema, type DjlDatabase } from "@djl/db";
import { BANK_LIFETIME_MS, freeWeekStart, type PlanId } from "@djl/domain";

import type { JobDeps } from "./jobs.ts";

/** Same value as PERSONAL_ORG_METADATA in the API's auth setup. */
export const PERSONAL_ORG_METADATA = JSON.stringify({ kind: "personal" });

const DAY_MS = 86_400_000;
const WORKER = "system:worker";

/** Users on a plan: members of an org on it (see planForOrg in the API). */
function usersOnPlan(planId: PlanId | null): SQL {
  const activeSub = sql`SELECT 1 FROM subscriptions s WHERE s.org_id = m.organization_id AND s.status = 'active'`;
  const liveTrial = sql`SELECT 1 FROM trial_grants t WHERE t.org_id = m.organization_id AND t.status = 'granted' AND t.expires_at > now()`;
  if (planId === null) return sql`SELECT u.id FROM "user" u`;
  if (planId === "free")
    return sql`SELECT u.id FROM "user" u WHERE NOT EXISTS (
      SELECT 1 FROM member m WHERE m.user_id = u.id AND (EXISTS (${activeSub}) OR EXISTS (${liveTrial})))`;
  if (planId === "trial")
    return sql`SELECT DISTINCT m.user_id AS id FROM member m
      WHERE EXISTS (${liveTrial}) AND NOT EXISTS (${activeSub})`;
  return sql`SELECT DISTINCT m.user_id AS id FROM member m
    WHERE EXISTS (${activeSub} AND s.plan_id = ${planId})`;
}

/**
 * Grant `count` banks to every user on `planId` (everyone when null), in
 * chunks keyed by user id. Returns how many banks this run inserted.
 */
async function grantToUsers(
  db: DjlDatabase,
  input: {
    readonly batchId: string;
    readonly source: "bulk" | "plan_schedule";
    readonly planId: PlanId | null;
    readonly count: number;
    readonly keyPrefix: string;
    readonly reason: string | null;
    readonly now: Date;
    readonly chunkSize: number;
  },
): Promise<number> {
  const expiresAt = new Date(input.now.getTime() + BANK_LIFETIME_MS).toISOString();
  const now = input.now.toISOString();
  let after = "00000000-0000-0000-0000-000000000000";
  let granted = 0;
  for (;;) {
    const [row] = await db.execute<{ last: string | null; granted: number }>(sql`
      WITH targets AS (
        SELECT id FROM (${usersOnPlan(input.planId)}) p
        WHERE id > ${after}::uuid ORDER BY id LIMIT ${input.chunkSize}
      ), inserted AS (
        INSERT INTO reset_banks (user_id, source, batch_id, granted_by, reason, granted_at, expires_at, idempotency_key)
        SELECT t.id, ${input.source}, ${input.batchId}::uuid, ${WORKER}, ${input.reason},
               ${now}::timestamptz, ${expiresAt}::timestamptz, ${input.keyPrefix} || t.id || ':' || n
        FROM targets t CROSS JOIN generate_series(1, ${input.count}) n
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id, user_id
      ), events AS (
        INSERT INTO usage_window_events (user_id, kind, bank_id, actor, reason)
        SELECT user_id, 'bank_granted', id, ${WORKER}, ${input.reason} FROM inserted
      )
      SELECT (SELECT id::text FROM targets ORDER BY id DESC LIMIT 1) AS last,
             (SELECT count(*) FROM inserted)::int AS granted`);
    granted += row?.granted ?? 0;
    if (!row?.last) return granted;
    after = row.last;
  }
}

async function finishBatch(db: DjlDatabase, batchId: string) {
  const total = await db.$count(schema.resetBanks, eq(schema.resetBanks.batchId, batchId));
  await db
    .update(schema.resetGrantBatches)
    .set({ status: "done", grantedCount: total, completedAt: new Date() })
    .where(eq(schema.resetGrantBatches.id, batchId));
}

/** Run queued (or interrupted) admin bulk grants: one bank per user. */
export async function bulkGrant(deps: JobDeps & { readonly chunkSize?: number }): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const batches = await deps.db.query.resetGrantBatches.findMany({
    where: and(
      eq(schema.resetGrantBatches.source, "bulk"),
      inArray(schema.resetGrantBatches.status, ["pending", "running"]),
    ),
  });
  let granted = 0;
  for (const batch of batches) {
    await deps.db
      .update(schema.resetGrantBatches)
      .set({ status: "running" })
      .where(eq(schema.resetGrantBatches.id, batch.id));
    granted += await grantToUsers(deps.db, {
      batchId: batch.id,
      source: "bulk",
      planId: batch.planId,
      count: 1,
      keyPrefix: `bulk:${batch.id}:`,
      reason: batch.reason,
      now,
      chunkSize: deps.chunkSize ?? 5000,
    });
    await finishBatch(deps.db, batch.id);
  }
  return granted;
}

/** Hourly: each active plan schedule grants once per `everyDays` period (UTC). */
export async function grantPlanResets(deps: JobDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const schedules = await deps.db.query.planResetSchedules.findMany({
    where: eq(schema.planResetSchedules.active, true),
  });
  let granted = 0;
  for (const schedule of schedules) {
    const period = Math.floor(now.getTime() / (schedule.everyDays * DAY_MS));
    const key = `plan:${schedule.id}:${period}`;
    await deps.db
      .insert(schema.resetGrantBatches)
      .values({
        source: "plan_schedule",
        planId: schedule.planId,
        actor: WORKER,
        reason: `every ${schedule.everyDays} days`,
        status: "running",
        idempotencyKey: key,
      })
      .onConflictDoNothing({ target: schema.resetGrantBatches.idempotencyKey });
    const batch = await deps.db.query.resetGrantBatches.findFirst({
      where: eq(schema.resetGrantBatches.idempotencyKey, key),
    });
    if (!batch || batch.status === "done") continue;
    granted += await grantToUsers(deps.db, {
      batchId: batch.id,
      source: "plan_schedule",
      planId: schedule.planId,
      count: schedule.banksPerGrant,
      keyPrefix: `${key}:`,
      reason: batch.reason,
      now,
      chunkSize: 5000,
    });
    await finishBatch(deps.db, batch.id);
    await deps.db
      .update(schema.planResetSchedules)
      .set({ lastGrantedAt: now })
      .where(eq(schema.planResetSchedules.id, schedule.id));
  }
  return granted;
}

/** Nightly report: record each bank that expired unused. Reads already ignore them. */
export async function expireBanks(deps: JobDeps): Promise<number> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const rows = await deps.db.execute(sql`
    INSERT INTO usage_window_events (user_id, kind, bank_id, actor)
    SELECT b.user_id, 'bank_expired', b.id, ${WORKER} FROM reset_banks b
    WHERE b.expires_at <= ${now}::timestamptz AND b.redeemed_at IS NULL AND b.revoked_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM usage_window_events e WHERE e.bank_id = b.id AND e.kind = 'bank_expired')
    RETURNING id`);
  return rows.length;
}

/** Buckets older than the longest window (a week) plus a day of slack. */
export async function pruneBuckets(deps: JobDeps): Promise<number> {
  const cutoff = new Date((deps.now?.() ?? new Date()).getTime() - 8 * DAY_MS);
  const rows = await deps.db
    .delete(schema.usageBuckets)
    .where(lt(schema.usageBuckets.bucketStart, cutoff))
    .returning({ userId: schema.usageBuckets.userId });
  return rows.length;
}

/**
 * Each verified-email user's personal org gets the weekly free allowance once
 * per week (see grantWeeklyFreeAllowance). Sign-up grants it immediately; this
 * sweep covers the start of every new week.
 */
export async function grantFreeAllowance(deps: JobDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const week = freeWeekStart(now).toISOString();
  let granted = 0;
  for (;;) {
    const due = await deps.db.execute<{ user_id: string; org_id: string }>(sql`
      SELECT u.id AS user_id, o.id AS org_id FROM "user" u
      JOIN member m ON m.user_id = u.id
      JOIN organization o ON o.id = m.organization_id AND o.metadata = ${PERSONAL_ORG_METADATA}
      WHERE u.email_verified AND NOT EXISTS (
        SELECT 1 FROM credit_ledger l WHERE l.idempotency_key = 'free:' || u.id || ':' || ${week})
      LIMIT 500`);
    if (due.length === 0) return granted;
    let wrote = 0;
    for (const { user_id: userId, org_id: orgId } of due)
      if (
        await grantWeeklyFreeAllowance(deps.db, deps.ledger, { userId, orgId, actor: WORKER, now })
      )
        wrote += 1;
    if (wrote === 0) return granted; // no free allowance configured
    granted += wrote;
  }
}
