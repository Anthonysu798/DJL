/**
 * Credit units.
 *
 * The ledger stores integer microcredits so token-level prices never need
 * floating point. 1 credit = 1,000,000 microcredits. 1 USD = 100 credits.
 *
 * Example: a model billed at 3 USD per million input tokens costs
 * 300 credits per million tokens, which is exactly 300 microcredits per token.
 */
export type Microcredits = bigint;

export const MICROCREDITS_PER_CREDIT = 1_000_000n;
export const CREDITS_PER_USD = 100n;
export const MICROCREDITS_PER_USD = MICROCREDITS_PER_CREDIT * CREDITS_PER_USD;

export function creditsToMicro(credits: number | bigint): Microcredits {
  return BigInt(credits) * MICROCREDITS_PER_CREDIT;
}

export function usdCentsToMicro(cents: number | bigint): Microcredits {
  return (BigInt(cents) * MICROCREDITS_PER_USD) / 100n;
}

/** Whole credits, rounded down. For display only; the ledger keeps microcredits. */
export function microToCredits(micro: Microcredits): number {
  return Number(micro / MICROCREDITS_PER_CREDIT);
}

/** Credits with two decimals as a string, for invoices and UI. */
export function formatCredits(micro: Microcredits): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / MICROCREDITS_PER_CREDIT;
  const fraction = (abs % MICROCREDITS_PER_CREDIT) / 10_000n; // two decimals
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(2, "0")}`;
}
