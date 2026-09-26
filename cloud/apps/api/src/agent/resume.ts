/**
 * Re-enqueues task runs that were blocked for lack of credits once their
 * organization has paid credits again (the free allowance is not counted). Runs blocked by a usage window are left to
 * whoever lifts the window (a reset or banked-reset redeem) to enqueue.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { spendable } from "@djl/domain";

import type { LedgerService } from "../credits/LedgerService.ts";

export async function resumeBlockedRuns(deps: {
  readonly db: DjlDatabase;
  readonly ledger: Pick<LedgerService, "balances">;
  readonly enqueue: (runId: string) => Promise<void>;
  /** Only runs blocked at least this long ago (default five minutes). */
  readonly olderThanMs?: number;
}): Promise<number> {
  const cutoff = new Date(Date.now() - (deps.olderThanMs ?? 5 * 60_000));
  const blocked = await deps.db
    .select({ id: schema.runs.id, orgId: schema.runs.orgId })
    .from(schema.runs)
    .where(
      and(
        eq(schema.runs.status, "blocked_on_usage"),
        sql`${schema.runs.error}->>'code' = 'insufficient_credits'`,
        lt(schema.runs.updatedAt, cutoff),
      ),
    )
    .limit(500);
  const funded = new Map<string, boolean>();
  let resumed = 0;
  for (const run of blocked) {
    if (!funded.has(run.orgId))
      funded.set(run.orgId, spendable(await deps.ledger.balances(run.orgId), false) > 0n);
    if (!funded.get(run.orgId)) continue;
    await deps.enqueue(run.id);
    resumed += 1;
  }
  return resumed;
}
