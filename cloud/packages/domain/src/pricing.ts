import { MICROCREDITS_PER_USD, type Microcredits } from "./units.ts";

/** Integer division rounding up. Used so a price never undershoots the margin. */
function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * What a provider charges us, in USD micro-dollars (1e-6 USD) per unit, and
 * what we charge users in microcredits per unit after margin.
 *
 * Units: per token for text, per image for image generation, per request
 * for fixed-price calls.
 */
export interface ModelPrice {
  readonly modelId: string;
  readonly provider: "openai" | "anthropic" | "openrouter";
  readonly inputPerToken: Microcredits;
  readonly outputPerToken: Microcredits;
  readonly cachedInputPerToken: Microcredits;
  readonly perImage: Microcredits;
  readonly perRequest: Microcredits;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly images: number;
  readonly requests: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  images: 0,
  requests: 1,
};

/** Convert provider cost in USD per million units to user microcredits per unit at a margin. */
export function creditPricePerUnitFromUsdPerMillion(
  usdPerMillion: number,
  marginFraction: number,
): Microcredits {
  if (!(marginFraction >= 0 && marginFraction < 1)) {
    throw new RangeError(`margin must be in [0, 1): ${marginFraction}`);
  }
  // price = cost / (1 - margin). Work in integer micro-USD to avoid drift.
  const costMicroUsdPerMillion = BigInt(Math.round(usdPerMillion * 1_000_000));
  const marginBasisPoints = BigInt(Math.round(marginFraction * 10_000));
  const priceMicroUsdPerMillion = ceilDiv(
    costMicroUsdPerMillion * 10_000n,
    10_000n - marginBasisPoints,
  );
  // micro-USD per million units → microcredits per unit:
  // microUsd/1e6 units * (MICROCREDITS_PER_USD / 1e6 microUsd per USD)
  return ceilDiv(priceMicroUsdPerMillion * MICROCREDITS_PER_USD, 1_000_000n * 1_000_000n);
}

/** Same conversion for per-image or per-request USD prices. */
export function creditPriceFromUsd(usd: number, marginFraction: number): Microcredits {
  if (!(marginFraction >= 0 && marginFraction < 1)) {
    throw new RangeError(`margin must be in [0, 1): ${marginFraction}`);
  }
  const costMicroUsd = BigInt(Math.round(usd * 1_000_000));
  const marginBasisPoints = BigInt(Math.round(marginFraction * 10_000));
  const priceMicroUsd = ceilDiv(costMicroUsd * 10_000n, 10_000n - marginBasisPoints);
  return ceilDiv(priceMicroUsd * MICROCREDITS_PER_USD, 1_000_000n);
}

/**
 * Token count for text the provider has not metered (a reservation, or a
 * stream that ended before its usage arrived). Deliberately on the high side
 * so it is never cheaper than the provider's own count: 3 ASCII characters
 * per token (JSON and code run denser than prose), and 1.5 tokens per other
 * UTF-16 unit, which covers CJK and emoji. Fractional; round up after summing.
 */
export function estimateTokens(text: string): number {
  let other = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) > 0x7f) other += 1;
  return (text.length - other) / 3 + other * 1.5;
}

/**
 * The most characters one token can plausibly stand for. A request with more
 * text than this per token of context cannot fit the model, however it is
 * tokenized.
 */
export const MAX_CHARS_PER_TOKEN = 8;

export function costOfUsage(price: ModelPrice, usage: Usage): Microcredits {
  return (
    BigInt(usage.inputTokens) * price.inputPerToken +
    BigInt(usage.cachedInputTokens) * price.cachedInputPerToken +
    BigInt(usage.outputTokens) * price.outputPerToken +
    BigInt(usage.images) * price.perImage +
    BigInt(usage.requests) * price.perRequest
  );
}

/**
 * Upper-bound estimate used for reservations before a request starts.
 * Input is known; output is bounded by maxOutputTokens; images by count.
 */
export function estimateReservation(
  price: ModelPrice,
  input: {
    readonly inputTokens: number;
    readonly maxOutputTokens: number;
    readonly images: number;
  },
): Microcredits {
  return costOfUsage(price, {
    inputTokens: input.inputTokens,
    cachedInputTokens: 0,
    outputTokens: input.maxOutputTokens,
    images: input.images,
    requests: 1,
  });
}
