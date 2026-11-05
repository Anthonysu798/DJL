/** Commerce uses CAD cents, never the AI credit ledger. All functions are pure. */
export const COMMERCE_CURRENCY = "CAD";
export const COMMERCE_MIN_WITHDRAWAL_CENTS = 2_000;
export const COMMERCE_COMMISSION_OBSERVATION_DAYS = 30;
const DAY_MS = 86_400_000;

export type CommerceWithdrawalStatus =
  | "requested"
  | "approved"
  | "payment_pending"
  | "payment_unknown"
  | "paid_test"
  | "rejected";

export const COMMERCE_ACTIVE_WITHDRAWAL_STATUSES = [
  "requested",
  "approved",
  "payment_pending",
  "payment_unknown",
] as const;

/** TEST operation transitions; success additionally requires validated manual result evidence. */
export function commerceWithdrawalPaymentTransition(input: {
  readonly status: CommerceWithdrawalStatus;
  readonly action: "start_payment" | "mark_unknown" | "confirm_payment_success";
  readonly operationId: string;
  readonly existingOperationId: string | null;
}): {
  readonly status: "payment_pending" | "payment_unknown" | "paid_test";
  readonly changed: boolean;
} {
  const { status, action, operationId, existingOperationId } = input;
  if (
    !operationId ||
    !["start_payment", "mark_unknown", "confirm_payment_success"].includes(action)
  )
    throw new RangeError("A stable payment operation and known action are required");
  if (action === "confirm_payment_success") {
    if (!existingOperationId || operationId !== existingOperationId)
      throw new RangeError("The original payment operation is required");
    if (status === "paid_test") return { status, changed: false };
    if (status === "payment_pending" || status === "payment_unknown")
      return { status: "paid_test", changed: true };
    throw new RangeError(
      "An unresolved payment operation is required before confirming its result",
    );
  }
  if (status === "payment_pending" || status === "payment_unknown") {
    if (operationId !== existingOperationId)
      throw new RangeError("Another payment operation is already unresolved");
    if (action === "start_payment") return { status, changed: false };
    return { status: "payment_unknown", changed: status !== "payment_unknown" };
  }
  if (status === "approved" && action === "start_payment" && existingOperationId === null)
    return { status: "payment_pending", changed: true };
  throw new RangeError("An approved withdrawal is required before starting a manual payment");
}

export function commerceMoney(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${label} must be non-negative safe integer cents`);
  return value;
}

export function commerceBasisPoints(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000)
    throw new RangeError("commission basis points must be between 0 and 10000");
  return value;
}

/** The caller supplies goods only: taxes and shipping never earn commission. */
export function calculateCommerceCommission(goodsCents: number, basisPoints: number): number {
  commerceMoney(goodsCents, "goods");
  commerceBasisPoints(basisPoints);
  return Number((BigInt(goodsCents) * BigInt(basisPoints)) / 10_000n);
}

/** Refund totals are cumulative; equal totals are an idempotent zero reversal. */
export function commerceRefundCommission(input: {
  readonly goodsCents: number;
  readonly basisPoints: number;
  readonly refundedBeforeCents: number;
  readonly refundedTotalCents: number;
}): { readonly remainingCommissionCents: number; readonly reversalCents: number } {
  const { goodsCents, basisPoints, refundedBeforeCents, refundedTotalCents } = input;
  commerceMoney(goodsCents, "goods");
  commerceMoney(refundedBeforeCents, "previous refund");
  commerceMoney(refundedTotalCents, "total refund");
  if (refundedTotalCents < refundedBeforeCents || refundedTotalCents > goodsCents)
    throw new RangeError("refund total must increase and cannot exceed goods paid");
  const before = calculateCommerceCommission(goodsCents - refundedBeforeCents, basisPoints);
  const remainingCommissionCents = calculateCommerceCommission(
    goodsCents - refundedTotalCents,
    basisPoints,
  );
  return { remainingCommissionCents, reversalCents: before - remainingCommissionCents };
}

function dateMilliseconds(value: Date): number {
  const milliseconds = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(milliseconds)) throw new RangeError("date must be valid");
  return milliseconds;
}

export function commerceCommissionReleaseAt(deliveredAt: Date, returnDays: number): Date {
  commerceMoney(returnDays, "return window days");
  const release = new Date(
    dateMilliseconds(deliveredAt) +
      Math.max(COMMERCE_COMMISSION_OBSERVATION_DAYS, returnDays) * DAY_MS,
  );
  dateMilliseconds(release);
  return release;
}

export function canReleaseCommerceCommission(input: {
  readonly deliveredAt: Date | null;
  readonly returnDays: number;
  readonly now: Date;
  readonly hasOpenCase: boolean;
}): boolean {
  const now = dateMilliseconds(input.now);
  commerceMoney(input.returnDays, "return window days");
  return (
    input.deliveredAt !== null &&
    !input.hasOpenCase &&
    now >= commerceCommissionReleaseAt(input.deliveredAt, input.returnDays).getTime()
  );
}

/** Call under the same DB lock as the first-paid update and referral-graph write. */
export function assertCommerceReferralBinding(
  input: {
    readonly userId: string;
    readonly referrerId: string;
    readonly currentReferrerId: string | null;
    readonly firstPaidAt: Date | null;
  },
  parentOf: ReadonlyMap<string, string | null>,
): void {
  const { userId, referrerId, currentReferrerId, firstPaidAt } = input;
  if (!userId || !referrerId || userId === referrerId)
    throw new RangeError("a user cannot refer themself");
  if (currentReferrerId === referrerId) return;
  if (currentReferrerId !== null) throw new RangeError("the referrer cannot be changed");
  // A full refund does not erase the original first-paid timestamp.
  if (firstPaidAt !== null) throw new RangeError("binding closes after the first paid order");
  const visited = new Set([userId]);
  for (
    let cursor: string | null = referrerId;
    cursor !== null;
    cursor = parentOf.get(cursor) ?? null
  ) {
    if (visited.has(cursor)) throw new RangeError("referral cycles are not allowed");
    visited.add(cursor);
  }
}

/** Deliberately one edge: an ancestor never earns another user's direct reward. */
export function directCommerceReferrer(
  userId: string,
  parentOf: ReadonlyMap<string, string | null>,
): string | null {
  const referrer = parentOf.get(userId) ?? null;
  if (referrer === userId) throw new RangeError("a user cannot refer themself");
  return referrer;
}

export interface CommerceStock {
  readonly onHand: number;
  readonly reserved: number;
}

function assertStock(stock: CommerceStock, quantity: number): void {
  commerceMoney(stock.onHand, "stock");
  commerceMoney(stock.reserved, "reserved stock");
  commerceMoney(quantity, "quantity");
  if (quantity === 0 || stock.reserved > stock.onHand)
    throw new RangeError("invalid stock or quantity");
}

export function reserveCommerceStock(stock: CommerceStock, quantity: number): CommerceStock {
  assertStock(stock, quantity);
  if (quantity > stock.onHand - stock.reserved)
    throw new RangeError("insufficient available stock");
  return { ...stock, reserved: stock.reserved + quantity };
}

export function consumeCommerceStock(stock: CommerceStock, quantity: number): CommerceStock {
  assertStock(stock, quantity);
  if (quantity > stock.reserved) throw new RangeError("insufficient reserved stock");
  return { onHand: stock.onHand - quantity, reserved: stock.reserved - quantity };
}

export function releaseCommerceStock(stock: CommerceStock, quantity: number): CommerceStock {
  assertStock(stock, quantity);
  if (quantity > stock.reserved) throw new RangeError("insufficient reserved stock");
  return { ...stock, reserved: stock.reserved - quantity };
}

export interface CommerceWalletBalance {
  readonly pendingCents: number;
  readonly availableCents: number;
  readonly frozenCents: number;
  readonly paidCents: number;
  readonly recoveryCents: number;
}

export function assertCommerceWalletBalance(balance: CommerceWalletBalance): void {
  for (const field of [
    "pendingCents",
    "availableCents",
    "frozenCents",
    "paidCents",
    "recoveryCents",
  ] as const)
    commerceMoney(balance[field], field);
}

export function freezeCommerceWithdrawal(
  balance: CommerceWalletBalance,
  amountCents: number,
  hasProcessing: boolean,
): CommerceWalletBalance {
  assertCommerceWalletBalance(balance);
  commerceMoney(amountCents);
  if (
    hasProcessing ||
    balance.frozenCents > 0 ||
    balance.recoveryCents > 0 ||
    amountCents < COMMERCE_MIN_WITHDRAWAL_CENTS ||
    amountCents > balance.availableCents
  )
    throw new RangeError("withdrawal is not available");
  return {
    ...balance,
    availableCents: balance.availableCents - amountCents,
    frozenCents: amountCents,
  };
}

/** Only a verified external outcome may be passed by the service. Unknown stays frozen. */
export function settleCommerceWithdrawal(
  balance: CommerceWalletBalance,
  amountCents: number,
  outcome: "paid" | "rejected",
): CommerceWalletBalance {
  assertCommerceWalletBalance(balance);
  commerceMoney(amountCents);
  if (
    amountCents === 0 ||
    amountCents > balance.frozenCents ||
    (outcome !== "paid" && outcome !== "rejected") ||
    (outcome === "paid" && balance.recoveryCents > 0)
  )
    throw new RangeError("invalid withdrawal settlement");
  const result = { ...balance, frozenCents: balance.frozenCents - amountCents };
  if (outcome === "paid")
    return { ...result, paidCents: commerceMoney(balance.paidCents + amountCents) };
  const recovered = Math.min(balance.recoveryCents, amountCents);
  return {
    ...result,
    recoveryCents: balance.recoveryCents - recovered,
    availableCents: commerceMoney(balance.availableCents + (amountCents - recovered)),
  };
}

export function releaseCommerceCommission(
  balance: CommerceWalletBalance,
  amountCents: number,
): CommerceWalletBalance {
  assertCommerceWalletBalance(balance);
  commerceMoney(amountCents);
  if (amountCents > balance.pendingCents) throw new RangeError("insufficient pending commission");
  const recovered = Math.min(balance.recoveryCents, amountCents);
  return {
    ...balance,
    pendingCents: balance.pendingCents - amountCents,
    recoveryCents: balance.recoveryCents - recovered,
    availableCents: commerceMoney(balance.availableCents + (amountCents - recovered)),
  };
}

export function reverseCommerceCommission(
  balance: CommerceWalletBalance,
  amountCents: number,
  origin: "pending" | "released",
): CommerceWalletBalance {
  assertCommerceWalletBalance(balance);
  commerceMoney(amountCents);
  if (origin === "pending") {
    if (amountCents > balance.pendingCents) throw new RangeError("insufficient pending commission");
    return { ...balance, pendingCents: balance.pendingCents - amountCents };
  }
  if (origin !== "released") throw new RangeError("invalid commission origin");
  const available = Math.min(balance.availableCents, amountCents);
  return {
    ...balance,
    availableCents: balance.availableCents - available,
    recoveryCents: commerceMoney(balance.recoveryCents + (amountCents - available)),
  };
}

export interface CommercePosting {
  readonly account: string;
  readonly currency: string;
  readonly amountCents: number;
}

export function assertBalancedCommerceJournal(entries: readonly CommercePosting[]): void {
  if (!entries.length) throw new RangeError("a journal must contain postings");
  const totals = new Map<string, bigint>();
  for (const entry of entries) {
    if (
      !entry.account ||
      !/^[A-Z]{3}$/.test(entry.currency) ||
      !Number.isSafeInteger(entry.amountCents) ||
      entry.amountCents === 0
    )
      throw new RangeError("invalid journal posting");
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0n) + BigInt(entry.amountCents));
  }
  if ([...totals.values()].some((total) => total !== 0n))
    throw new RangeError("journal must balance separately for each currency");
}

export interface CommerceLiveFundsGates {
  readonly enabled: boolean;
  readonly merchantVerified: boolean;
  readonly taxConfigured: boolean;
  readonly paymentChannelApproved: boolean;
  readonly agreementsAccepted: boolean;
  readonly payeeVerified: boolean;
}

export function commerceLiveFundsEnabled(gates: CommerceLiveFundsGates): boolean {
  return (
    gates.enabled === true &&
    gates.merchantVerified === true &&
    gates.taxConfigured === true &&
    gates.paymentChannelApproved === true &&
    gates.agreementsAccepted === true &&
    gates.payeeVerified === true
  );
}
