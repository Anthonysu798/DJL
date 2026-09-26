/**
 * Postgres-backed credit ledger. Wraps the pure rules in @djl/domain with the
 * one thing the domain cannot do: serialize concurrent writers per org.
 *
 * Every mutation runs in a transaction that first takes `SELECT ... FOR UPDATE`
 * on the org's credit_balances row, so two reservations for the same org can
 * never both pass the balance check. Balances are updated in the same
 * transaction as the ledger insert; the ledger remains the source of truth and
 * `refold` repairs drift.
 *
 * Reservations for a signed-in user also hold room in their usage windows
 * inside the same transaction (lock order: credit_balances, then
 * usage_windows); settling moves the actual cost into the window buckets.
 */
import { and, asc, eq, gt, sql } from "drizzle-orm";
import {
  allocateDebit,
  expireBucket,
  foldBalances,
  reserve as domainReserve,
  settle as domainSettle,
  totalAvailable,
  ZERO_BALANCES,
  type Balances,
  type Bucket,
  type LedgerEntry,
  type Microcredits,
  type WindowCaps,
} from "@djl/domain";
import { schema, type DjlDatabase } from "@djl/db";

import { holdWindows, settleHold, type Tx } from "../usage/windowStore.ts";

const { creditBalances, creditLedger } = schema;

export class InsufficientCreditsError extends Error {
  readonly _tag = "InsufficientCreditsError";
  constructor(readonly shortfall: Microcredits) {
    super("insufficient_credits");
  }
}

export class DuplicateIdempotencyKeyError extends Error {
  readonly _tag = "DuplicateIdempotencyKeyError";
  constructor(readonly key: string) {
    super(`duplicate idempotency key ${key}`);
  }
}

type NewEntry = Omit<LedgerEntry, "id" | "createdAt"> & {
  readonly actor: string;
  readonly reason?: string | null;
  readonly metadata?: Record<string, unknown> | null;
};

export interface ReserveResult {
  readonly balances: Balances;
  /** What the usage windows hold for this request; null when no window applies. */
  readonly windowHold: Microcredits | null;
}

const balancesOf = (row: typeof creditBalances.$inferSelect): Balances => ({
  free: row.free,
  trial: row.trial,
  plan: row.plan,
  topup: row.topup,
});

function rowToEntry(row: typeof creditLedger.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    orgId: row.orgId,
    type: row.type,
    bucket: row.bucket,
    amount: row.amount,
    reservationId: row.reservationId,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

export class LedgerService {
  constructor(private readonly db: DjlDatabase) {}

  /** Read the materialized balances without locking. */
  async balances(orgId: string): Promise<Balances> {
    const row = await this.db.query.creditBalances.findFirst({
      where: eq(creditBalances.orgId, orgId),
    });
    return row ? balancesOf(row) : ZERO_BALANCES;
  }

  async available(orgId: string): Promise<Microcredits> {
    return totalAvailable(await this.balances(orgId));
  }

  /** Grant credits into a bucket (free, trial, plan, topup, admin). Positive amounts only. */
  async grant(input: {
    readonly orgId: string;
    readonly bucket: Bucket;
    readonly type: "free_grant" | "trial_grant" | "plan_grant" | "topup" | "admin_grant" | "refund";
    readonly amount: Microcredits;
    readonly idempotencyKey: string;
    readonly actor: string;
    readonly reason?: string;
    readonly metadata?: Record<string, unknown>;
  }): Promise<Balances> {
    if (input.amount <= 0n) throw new RangeError("grant amount must be positive");
    return this.db.transaction(async (tx) => {
      const balances = await this.lockBalances(tx, input.orgId);
      await this.insert(tx, [
        {
          orgId: input.orgId,
          type: input.type,
          bucket: input.bucket,
          amount: input.amount,
          reservationId: null,
          idempotencyKey: input.idempotencyKey,
          actor: input.actor,
          reason: input.reason ?? null,
          metadata: input.metadata ?? null,
        },
      ]);
      return this.applyDelta(tx, input.orgId, balances, { [input.bucket]: input.amount });
    });
  }

  /**
   * Reserve an estimated cost. Throws InsufficientCreditsError; never partially
   * reserves credits. With `window`, also holds room in the user's usage
   * windows or throws UsageWindowExhaustedError (see windowStore.holdWindows).
   */
  async reserve(input: {
    readonly orgId: string;
    readonly reservationId: string;
    readonly estimate: Microcredits;
    readonly idempotencyKey: string;
    readonly actor: string;
    /** The model may be paid from the weekly free allowance. */
    readonly freeEligible?: boolean;
    readonly window?: {
      readonly userId: string;
      readonly caps: WindowCaps;
      readonly partial: boolean;
    };
  }): Promise<ReserveResult> {
    return this.db.transaction(async (tx) => {
      const balances = await this.lockBalances(tx, input.orgId);
      const decision = domainReserve(input, balances);
      if (!decision.ok) throw new InsufficientCreditsError(decision.shortfall);
      const windowHold = input.window
        ? await holdWindows(tx, {
            ...input.window,
            reservationId: input.reservationId,
            amount: input.estimate,
            now: new Date(),
          })
        : null;
      await this.insert(
        tx,
        decision.entries.map((e) => ({ ...e, actor: input.actor })),
      );
      const delta = { ...ZERO_BALANCES };
      for (const e of decision.entries) delta[e.bucket] += e.amount;
      return { balances: await this.applyDelta(tx, input.orgId, balances, delta), windowHold };
    });
  }

  /**
   * Settle a reservation with the actual cost. Returns the uncovered amount
   * (non-zero only when the stream was cut at zero balance).
   */
  async settle(input: {
    readonly orgId: string;
    readonly reservationId: string;
    readonly actual: Microcredits;
    readonly idempotencyKey: string;
    readonly actor: string;
    readonly freeEligible?: boolean;
  }): Promise<{ readonly balances: Balances; readonly uncovered: Microcredits }> {
    return this.db.transaction(async (tx) => {
      const balances = await this.lockBalances(tx, input.orgId);
      const reservationRows = await tx
        .select()
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.orgId, input.orgId),
            eq(creditLedger.reservationId, input.reservationId),
          ),
        );
      const reservationEntries = reservationRows.map(rowToEntry);
      if (reservationEntries.some((e) => e.type === "settlement" || e.type === "release")) {
        // Already settled or released: idempotent no-op.
        return { balances, uncovered: 0n };
      }
      const { entries, uncovered } = domainSettle(input, reservationEntries, balances);
      await this.insert(
        tx,
        entries.map((e) => ({ ...e, actor: input.actor })),
      );
      await settleHold(tx, input.reservationId, input.actual, new Date());
      const delta = { ...ZERO_BALANCES };
      for (const e of entries) delta[e.bucket] += e.amount;
      return { balances: await this.applyDelta(tx, input.orgId, balances, delta), uncovered };
    });
  }

  /** Release a reservation that produced no usage. */
  async release(input: {
    readonly orgId: string;
    readonly reservationId: string;
    readonly idempotencyKey: string;
    readonly actor: string;
  }): Promise<Balances> {
    const { balances } = await this.settle({ ...input, actual: 0n });
    return balances;
  }

  /** Expire a whole bucket (plan on rollover, trial at day 14). */
  async expire(input: {
    readonly orgId: string;
    readonly bucket: Bucket;
    readonly idempotencyKey: string;
    readonly actor: string;
    readonly reason?: string;
  }): Promise<Balances> {
    return this.db.transaction(async (tx) => {
      const balances = await this.lockBalances(tx, input.orgId);
      const entry = expireBucket(input, balances);
      if (!entry) return balances;
      await this.insert(tx, [{ ...entry, actor: input.actor, reason: input.reason ?? null }]);
      return this.applyDelta(tx, input.orgId, balances, { [input.bucket]: entry.amount });
    });
  }

  /** Reservations older than `olderThanMs` with no settlement are released (crash recovery). */
  async releaseStaleReservations(olderThanMs: number, actor: string): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const stale = await this.db.execute<{ org_id: string; reservation_id: string }>(sql`
      SELECT DISTINCT org_id, reservation_id FROM credit_ledger r
      WHERE r.type = 'reservation' AND r.created_at < ${cutoff.toISOString()}::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger s
          WHERE s.reservation_id = r.reservation_id AND s.type IN ('settlement','release')
        )`);
    let count = 0;
    for (const row of stale) {
      await this.release({
        orgId: row.org_id,
        reservationId: row.reservation_id,
        idempotencyKey: `stale:${row.reservation_id}`,
        actor,
      });
      count += 1;
    }
    return count;
  }

  /** Recompute balances from the ledger and repair the materialized row. Returns drift. */
  async refold(orgId: string): Promise<{ readonly before: Balances; readonly after: Balances }> {
    return this.db.transaction(async (tx) => {
      const before = await this.lockBalances(tx, orgId);
      const rows = await tx
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.orgId, orgId))
        .orderBy(asc(creditLedger.createdAt));
      const after = foldBalances(rows.map(rowToEntry));
      await tx
        .update(creditBalances)
        .set({ ...after, foldedThrough: new Date() })
        .where(eq(creditBalances.orgId, orgId));
      return { before, after };
    });
  }

  /** Paginated ledger for dashboards, newest first. */
  async history(orgId: string, input: { readonly limit: number; readonly after?: string }) {
    const rows = await this.db.query.creditLedger.findMany({
      where: input.after
        ? and(eq(creditLedger.orgId, orgId), gt(creditLedger.createdAt, new Date(input.after)))
        : eq(creditLedger.orgId, orgId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: Math.min(Math.max(input.limit, 1), 200),
    });
    return rows.map(rowToEntry);
  }

  /** How much of a debit the org could cover right now, for pre-flight UI. */
  async coverage(orgId: string, amount: Microcredits) {
    return allocateDebit(await this.balances(orgId), amount);
  }

  private async lockBalances(tx: Tx, orgId: string): Promise<Balances> {
    await tx
      .insert(creditBalances)
      .values({ orgId })
      .onConflictDoNothing({ target: creditBalances.orgId });
    const [row] = await tx
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.orgId, orgId))
      .for("update");
    if (!row) throw new Error("credit_balances row missing after upsert");
    return balancesOf(row);
  }

  private async insert(tx: Tx, entries: readonly NewEntry[]) {
    if (entries.length === 0) return;
    try {
      await tx.insert(creditLedger).values(
        entries.map((e) => ({
          orgId: e.orgId,
          type: e.type,
          bucket: e.bucket,
          amount: e.amount,
          reservationId: e.reservationId,
          idempotencyKey: e.idempotencyKey,
          actor: e.actor,
          reason: e.reason ?? null,
          metadata: e.metadata ?? null,
        })),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateIdempotencyKeyError(entries.map((e) => e.idempotencyKey).join(","));
      }
      throw error;
    }
  }

  private async applyDelta(
    tx: Tx,
    orgId: string,
    before: Balances,
    delta: Partial<Balances>,
  ): Promise<Balances> {
    const after: Balances = {
      free: before.free + (delta.free ?? 0n),
      trial: before.trial + (delta.trial ?? 0n),
      plan: before.plan + (delta.plan ?? 0n),
      topup: before.topup + (delta.topup ?? 0n),
    };
    await tx.update(creditBalances).set(after).where(eq(creditBalances.orgId, orgId));
    return after;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string; cause?: { code?: string } })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}
