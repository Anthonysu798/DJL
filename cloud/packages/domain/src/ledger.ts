import type { Microcredits } from "./units.ts";

/**
 * Append-only credit ledger.
 *
 * Every balance is derived from entries. Nothing ever edits or deletes an
 * entry; corrections are new entries. Buckets are consumed in the order
 * free → trial → plan → topup so the credits that expire soonest are spent
 * first. The weekly free allowance pays only for free-eligible models.
 */
export type Bucket = "free" | "trial" | "plan" | "topup";
export const BUCKET_SPEND_ORDER: readonly Bucket[] = ["free", "trial", "plan", "topup"];
const PAID_SPEND_ORDER: readonly Bucket[] = ["trial", "plan", "topup"];

export function spendOrder(freeEligible: boolean): readonly Bucket[] {
  return freeEligible ? BUCKET_SPEND_ORDER : PAID_SPEND_ORDER;
}

export type LedgerEntryType =
  | "free_grant"
  | "trial_grant"
  | "plan_grant"
  | "topup"
  | "admin_grant"
  | "reservation"
  | "release"
  | "settlement"
  | "refund"
  | "expiry"
  | "anonymize";

export interface LedgerEntry {
  readonly id: string;
  readonly orgId: string;
  readonly type: LedgerEntryType;
  readonly bucket: Bucket;
  /** Signed. Grants are positive; reservations, settlements, expiries negative. */
  readonly amount: Microcredits;
  /** Groups a reservation with its release/settlement. */
  readonly reservationId: string | null;
  /** Client- or system-supplied key; duplicates are rejected at write time. */
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface Balances {
  readonly free: Microcredits;
  readonly trial: Microcredits;
  readonly plan: Microcredits;
  readonly topup: Microcredits;
}

export const ZERO_BALANCES: Balances = { free: 0n, trial: 0n, plan: 0n, topup: 0n };

export function totalAvailable(b: Balances): Microcredits {
  return b.free + b.trial + b.plan + b.topup;
}

/**
 * What the org owes: usage that outran its balance, or credits it had already
 * spent from a top-up that was later refunded or disputed. Debt is a negative
 * topup balance, so the next top-up pays it off before anything else.
 */
export function debtOf(b: Balances): Microcredits {
  return b.topup < 0n ? -b.topup : 0n;
}

/**
 * What a request may spend: the free allowance counts only for free-eligible
 * models, and an org in debt has no paid credits until the debt is cleared.
 */
export function spendable(b: Balances, freeEligible: boolean): Microcredits {
  const paid = debtOf(b) > 0n ? 0n : b.trial + b.plan + b.topup;
  return freeEligible ? b.free + paid : paid;
}

/** Fold entries into per-bucket balances. Reservations count as spent until released. */
export function foldBalances(entries: Iterable<LedgerEntry>): Balances {
  const b = { ...ZERO_BALANCES };
  for (const e of entries) b[e.bucket] += e.amount;
  return b;
}

/**
 * Split a positive debit across buckets in spend order. Returns per-bucket
 * debits (non-negative) and the uncovered remainder if balances are short.
 */
export function allocateDebit(
  balances: Balances,
  amount: Microcredits,
  freeEligible = false,
): { readonly debits: Balances; readonly uncovered: Microcredits } {
  if (amount < 0n) throw new RangeError("debit must be non-negative");
  let remaining = amount;
  const debits = { ...ZERO_BALANCES };
  for (const bucket of spendOrder(freeEligible)) {
    if (remaining === 0n) break;
    const available = balances[bucket] > 0n ? balances[bucket] : 0n;
    const take = available < remaining ? available : remaining;
    debits[bucket] = take;
    remaining -= take;
  }
  return { debits, uncovered: remaining };
}

export type ReserveDecision =
  | { readonly ok: true; readonly entries: readonly Omit<LedgerEntry, "id" | "createdAt">[] }
  | {
      readonly ok: false;
      readonly reason: "insufficient_credits";
      readonly shortfall: Microcredits;
    };

/**
 * Build reservation entries for an estimated cost. Fails closed when the
 * combined balance cannot cover the estimate: no partial reservations. An org
 * in debt can reserve only from its free allowance.
 */
export function reserve(
  input: {
    readonly orgId: string;
    readonly reservationId: string;
    readonly estimate: Microcredits;
    readonly idempotencyKey: string;
    readonly freeEligible?: boolean;
  },
  balances: Balances,
): ReserveDecision {
  const usable = debtOf(balances) > 0n ? { ...ZERO_BALANCES, free: balances.free } : balances;
  const { debits, uncovered } = allocateDebit(usable, input.estimate, input.freeEligible);
  if (uncovered > 0n) return { ok: false, reason: "insufficient_credits", shortfall: uncovered };
  const entries: Omit<LedgerEntry, "id" | "createdAt">[] = [];
  for (const bucket of BUCKET_SPEND_ORDER) {
    if (debits[bucket] === 0n) continue;
    entries.push({
      orgId: input.orgId,
      type: "reservation",
      bucket,
      amount: -debits[bucket],
      reservationId: input.reservationId,
      idempotencyKey: `${input.idempotencyKey}:reserve:${bucket}`,
    });
  }
  return { ok: true, entries };
}

/**
 * Settle a reservation against actual cost.
 *
 * Emits `release` entries that return whatever is still reserved, then
 * `settlement` entries that debit the actual cost using the balances as they
 * were before the reservation. `reservationEntries` are all of the
 * reservation's entries so far: one that was already released (the stale
 * reservation job ran while the request was still in flight) is not released
 * again, but its actual cost is still debited. If actual exceeds what can be
 * covered, the uncovered part is debited from the topup bucket, which goes
 * negative (see `debtOf`), and is reported so the caller can raise it.
 */
export function settle(
  input: {
    readonly orgId: string;
    readonly reservationId: string;
    readonly actual: Microcredits;
    readonly idempotencyKey: string;
    readonly freeEligible?: boolean;
  },
  reservationEntries: readonly LedgerEntry[],
  balancesWithReservation: Balances,
): {
  readonly entries: readonly Omit<LedgerEntry, "id" | "createdAt">[];
  readonly uncovered: Microcredits;
} {
  if (input.actual < 0n) throw new RangeError("actual must be non-negative");
  const reserved = foldBalances(
    reservationEntries.filter(
      (e) =>
        (e.type === "reservation" || e.type === "release") &&
        e.reservationId === input.reservationId,
    ),
  );
  const entries: Omit<LedgerEntry, "id" | "createdAt">[] = [];
  // 1. release what was reserved
  const restored = { ...balancesWithReservation };
  for (const bucket of BUCKET_SPEND_ORDER) {
    const amount = -reserved[bucket];
    if (amount === 0n) continue;
    entries.push({
      orgId: input.orgId,
      type: "release",
      bucket,
      amount,
      reservationId: input.reservationId,
      idempotencyKey: `${input.idempotencyKey}:release:${bucket}`,
    });
    restored[bucket] += amount;
  }
  // 2. debit actual against restored balances
  const { debits, uncovered } = allocateDebit(restored, input.actual, input.freeEligible);
  const owed = { ...debits, topup: debits.topup + uncovered };
  for (const bucket of BUCKET_SPEND_ORDER) {
    if (owed[bucket] === 0n) continue;
    entries.push({
      orgId: input.orgId,
      type: "settlement",
      bucket,
      amount: -owed[bucket],
      reservationId: input.reservationId,
      idempotencyKey: `${input.idempotencyKey}:settle:${bucket}`,
    });
  }
  return { entries, uncovered };
}

/** Release a reservation with no settlement (request failed before any usage). */
export function release(
  input: {
    readonly orgId: string;
    readonly reservationId: string;
    readonly idempotencyKey: string;
  },
  reservationEntries: readonly LedgerEntry[],
): readonly Omit<LedgerEntry, "id" | "createdAt">[] {
  return settle({ ...input, actual: 0n }, reservationEntries, ZERO_BALANCES).entries;
}

/** Expire everything left in a bucket (cycle rollover for plan, day 14 for trial). */
export function expireBucket(
  input: { readonly orgId: string; readonly bucket: Bucket; readonly idempotencyKey: string },
  balances: Balances,
): Omit<LedgerEntry, "id" | "createdAt"> | null {
  const remaining = balances[input.bucket];
  if (remaining <= 0n) return null;
  return {
    orgId: input.orgId,
    type: "expiry",
    bucket: input.bucket,
    amount: -remaining,
    reservationId: null,
    idempotencyKey: input.idempotencyKey,
  };
}

/**
 * How a grant lands when the org is in debt: paid credits clear the debt
 * first (`repay`, credited to the topup bucket where the debt is) and only
 * the `rest` reaches the bucket the grant was meant for. The free allowance
 * never pays debt, and a top-up nets against it by being in the same bucket.
 */
export function splitGrant(
  bucket: Bucket,
  amount: Microcredits,
  balances: Balances,
): { readonly repay: Microcredits; readonly rest: Microcredits } {
  const owed = bucket === "free" || bucket === "topup" ? 0n : debtOf(balances);
  const repay = owed < amount ? owed : amount;
  return { repay, rest: amount - repay };
}

/**
 * Credits to take back now from a top-up of `granted` whose payment has been
 * refunded `refunded` out of `charged` in total (any one currency unit).
 * `alreadyTaken` is what earlier refunds of the same payment took, so partial
 * refunds add up to the refunded share and never to more than was granted.
 */
export function clawbackDue(input: {
  readonly granted: Microcredits;
  readonly alreadyTaken: Microcredits;
  readonly refunded: bigint;
  readonly charged: bigint;
}): Microcredits {
  const { granted, alreadyTaken, refunded, charged } = input;
  if (refunded <= 0n) return 0n;
  const target = charged <= 0n || refunded >= charged ? granted : (granted * refunded) / charged;
  return target > alreadyTaken ? target - alreadyTaken : 0n;
}

/**
 * A top-up is refundable within the window only if no settlement has
 * consumed any of it. "Consumed" is judged bucket-wide: if the topup bucket
 * balance is still >= the top-up amount, nothing from it was spent.
 */
export function topupRefundable(
  topup: LedgerEntry,
  balances: Balances,
  now: Date,
  windowDays = 14,
): boolean {
  if (topup.type !== "topup" || topup.bucket !== "topup") return false;
  const ageMs = now.getTime() - new Date(topup.createdAt).getTime();
  if (ageMs < 0 || ageMs > windowDays * 86_400_000) return false;
  return balances.topup >= topup.amount;
}
