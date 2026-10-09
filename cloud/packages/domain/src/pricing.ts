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
