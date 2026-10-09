/**
 * Re-enqueues task runs blocked on usage once they can make progress again:
 * runs blocked for lack of credits once their organization has paid credits
 * (the free allowance is not counted), and runs blocked by a usage window
 * once the user's windows have room again. Lifting a window explicitly (a
 * banked-reset redeem, an admin reset, reset everyone) resumes them at once
 * through resumeWindowBlockedRuns instead of waiting for this sweep.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { blockingWindow, spendable } from "@djl/domain";

import type { LedgerService } from "../credits/LedgerService.ts";
import { UsageService } from "../usage/UsageService.ts";

/** Whether a user's windows, measured against their org's plan, both have room. */
export type WindowsHaveRoom = (userId: string, orgId: string) => Promise<boolean>;

export function windowsHaveRoom(db: DjlDatabase): WindowsHaveRoom {
  const usage = new UsageService(db);
  return async (userId, orgId) =>
    blockingWindow((await usage.windows(userId, orgId)).windows) === null;
}

export async function resumeBlockedRuns(deps: {
  readonly db: DjlDatabase;
  readonly ledger: Pick<LedgerService, "balances">;
  readonly enqueue: (runId: string) => Promise<void>;
  /** Checks window-blocked runs; without it only credit-blocked runs are considered. */
  readonly windowsHaveRoom?: WindowsHaveRoom;
  /** Only runs blocked at least this long ago (default five minutes). */
  readonly olderThanMs?: number;
}): Promise<number> {
  const cutoff = new Date(Date.now() - (deps.olderThanMs ?? 5 * 60_000));
  const codes = deps.windowsHaveRoom
    ? ["insufficient_credits", "usage_window_exhausted"]
    : ["insufficient_credits"];
  const blocked = await deps.db
    .select({
      id: schema.runs.id,
      orgId: schema.runs.orgId,
      userId: schema.runs.userId,
      code: sql<string>`${schema.runs.error}->>'code'`,
    })
    .from(schema.runs)
    .where(
      and(
        eq(schema.runs.status, "blocked_on_usage"),
        inArray(sql`${schema.runs.error}->>'code'`, codes),
        lt(schema.runs.updatedAt, cutoff),
      ),
    )
    .limit(500);
  const funded = new Map<string, boolean>();
  let resumed = 0;
  for (const run of blocked) {
    const ready =
      run.code === "usage_window_exhausted"
        ? await deps.windowsHaveRoom!(run.userId, run.orgId)
        : await orgFunded(run.orgId);
    if (!ready) continue;
    await deps.enqueue(run.id);
    resumed += 1;
  }
  return resumed;

  async function orgFunded(orgId: string): Promise<boolean> {
    if (!funded.has(orgId))
      funded.set(orgId, spendable(await deps.ledger.balances(orgId), false) > 0n);
    return funded.get(orgId)!;
  }
}

/** Lifting a user's windows (`userId`) or everyone's (null) gives their window-blocked runs another go. */
export type ResumeWindowBlockedRuns = (userId: string | null) => Promise<unknown>;

/** Re-enqueues the task runs a usage window blocked, for one user or for everyone. */
export async function resumeWindowBlockedRuns(
  deps: { readonly db: DjlDatabase; readonly enqueue: (runId: string) => Promise<void> },
  userId: string | null,
): Promise<number> {
  const blocked = await deps.db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(
      and(
        eq(schema.runs.status, "blocked_on_usage"),
        sql`${schema.runs.error}->>'code' = 'usage_window_exhausted'`,
        userId ? eq(schema.runs.userId, userId) : undefined,
      ),
    );
  for (const run of blocked) await deps.enqueue(run.id);
  return blocked.length;
}
