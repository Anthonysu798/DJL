/**
 * A user's usage windows and banked resets: read both windows, list live
 * banks, and redeem the oldest one. Redeeming zeroes both windows and starts
 * a new 7-day week at that moment.
 */
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { PlanId, WindowCaps, WindowsUsage } from "@djl/domain";

import { ApiError } from "../http/errors.ts";
import { planForOrg } from "./plans.ts";
import { measure, resetWindows, windowState } from "./windowStore.ts";

const { resetBanks, usageWindowEvents } = schema;

export interface UsageWindowsView {
  readonly planId: PlanId;
  readonly windows: WindowsUsage;
  readonly banks: { readonly count: number; readonly nextExpiresAt: Date | null };
}

export type ResetBank = Pick<
  typeof resetBanks.$inferSelect,
  "id" | "source" | "grantedAt" | "expiresAt"
>;

/** Banks a user can still redeem: not redeemed, not revoked, not expired. */
export const liveBanks = (userId: string, now: Date) =>
  and(
    eq(resetBanks.userId, userId),
    isNull(resetBanks.redeemedAt),
    isNull(resetBanks.revokedAt),
    gt(resetBanks.expiresAt, now),
  );

export class UsageService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Both windows measured against the caps of the org's plan. */
  async windows(userId: string, orgId: string): Promise<UsageWindowsView> {
    const plan = await planForOrg(this.db, orgId, this.now());
    const [windows, banks] = await Promise.all([
      this.measure(userId, plan.windowCaps),
      this.banks(userId),
    ]);
    return {
      planId: plan.planId,
      windows,
      banks: { count: banks.length, nextExpiresAt: banks[0]?.expiresAt ?? null },
    };
  }

  /** Both windows against the given caps, without locking. */
  async measure(userId: string, caps: WindowCaps): Promise<WindowsUsage> {
    const now = this.now();
    return this.db.transaction(async (tx) =>
      measure(tx, userId, await windowState(tx, userId, false), caps, now),
    );
  }

  /** Live banks, oldest first. Redeeming always uses the oldest. */
  async banks(userId: string): Promise<readonly ResetBank[]> {
    return this.db
      .select({
        id: resetBanks.id,
        source: resetBanks.source,
        grantedAt: resetBanks.grantedAt,
        expiresAt: resetBanks.expiresAt,
      })
      .from(resetBanks)
      .where(liveBanks(userId, this.now()))
      .orderBy(asc(resetBanks.grantedAt));
  }

  /**
   * Redeem the oldest live bank. Retrying with the same key returns the bank
   * that key already redeemed. Throws 409 no_reset_bank when none is left.
   */
  async redeem(userId: string, orgId: string, idempotencyKey: string) {
    const now = this.now();
    const redeemedBankId = await this.db.transaction(async (tx) => {
      // The window row lock serializes redeems for one user.
      await windowState(tx, userId, true);
      const prior = await tx.query.resetBanks.findFirst({
        where: and(
          eq(resetBanks.userId, userId),
          eq(resetBanks.redeemIdempotencyKey, idempotencyKey),
        ),
      });
      if (prior) return prior.id;
      const [bank] = await tx
        .select({ id: resetBanks.id })
        .from(resetBanks)
        .where(liveBanks(userId, now))
        .orderBy(asc(resetBanks.grantedAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!bank) throw new ApiError(409, "no_reset_bank", "You have no banked resets to use.");
      await tx
        .update(resetBanks)
        .set({ redeemedAt: now, redeemIdempotencyKey: idempotencyKey })
        .where(eq(resetBanks.id, bank.id));
      await resetWindows(tx, userId, now, { newWeek: true });
      await tx.insert(usageWindowEvents).values({
        userId,
        kind: "bank_redeemed",
        bankId: bank.id,
        actor: `user:${userId}`,
      });
      return bank.id;
    });
    return { redeemedBankId, usage: await this.windows(userId, orgId) };
  }
}
