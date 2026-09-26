/**
 * The weekly free allowance: the free plan's included credits, granted to a
 * verified-email user's personal org once per Monday-to-Monday UTC week. Any
 * unspent allowance from an earlier week expires first. Idempotent per user
 * and week, so the sign-up hook and the hourly worker job can both call it.
 */
import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { freeWeekStart } from "@djl/domain";

import { DuplicateIdempotencyKeyError, type LedgerService } from "./LedgerService.ts";

const ignoreDuplicate = (error: unknown) => {
  if (!(error instanceof DuplicateIdempotencyKeyError)) throw error;
};

/** Returns whether a grant was written (false when already granted this week). */
export async function grantWeeklyFreeAllowance(
  db: DjlDatabase,
  ledger: LedgerService,
  input: {
    readonly userId: string;
    readonly orgId: string;
    readonly actor: string;
    readonly now?: Date;
  },
): Promise<boolean> {
  const week = freeWeekStart(input.now ?? new Date()).toISOString();
  const plan = await db.query.plans.findFirst({ where: eq(schema.plans.id, "free") });
  const amount = plan?.includedMicrocredits ?? 0n;
  if (amount <= 0n) return false;
  await ledger
    .expire({
      orgId: input.orgId,
      bucket: "free",
      idempotencyKey: `free:expire:${input.userId}:${week}`,
      actor: input.actor,
      reason: "weekly free allowance rollover",
    })
    .catch(ignoreDuplicate);
  try {
    await ledger.grant({
      orgId: input.orgId,
      bucket: "free",
      type: "free_grant",
      amount,
      idempotencyKey: `free:${input.userId}:${week}`,
      actor: input.actor,
      reason: "weekly free allowance",
    });
    return true;
  } catch (error) {
    ignoreDuplicate(error);
    return false;
  }
}
