import { describe, expect, it } from "vitest";

import {
  costOfUsage,
  creditPriceFromUsd,
  creditPricePerUnitFromUsdPerMillion,
  estimateReservation,
  estimateTokens,
  type ModelPrice,
} from "./pricing.ts";
import { formatCredits, MICROCREDITS_PER_CREDIT } from "./units.ts";

describe("pricing", () => {
  it("converts USD per million tokens to microcredits per token at 40% margin", () => {
    // $3/M cost → $5/M price → 500 credits/M → 500 microcredits per token
    expect(creditPricePerUnitFromUsdPerMillion(3, 0.4)).toBe(500n);
    // $15/M → $25/M → 2,500 microcredits per token
    expect(creditPricePerUnitFromUsdPerMillion(15, 0.4)).toBe(2500n);
    // zero margin passes cost through
    expect(creditPricePerUnitFromUsdPerMillion(3, 0)).toBe(300n);
  });

  it("rounds up so margin is never undershot", () => {
    // $1/M at 40% → $1.6667/M → 166.67 credits/M → rounds up to 167 microcredits per token
    expect(creditPricePerUnitFromUsdPerMillion(1, 0.4)).toBe(167n);
  });

  it("prices images per unit", () => {
    // $0.04 per image → $0.0667 → 6.67 credits
    expect(formatCredits(creditPriceFromUsd(0.04, 0.4))).toBe("6.66");
    expect(creditPriceFromUsd(0.04, 0.4)).toBe(6_666_700n);
  });

  it("rejects margins outside [0, 1)", () => {
    expect(() => creditPricePerUnitFromUsdPerMillion(1, 1)).toThrow(RangeError);
    expect(() => creditPriceFromUsd(1, -0.1)).toThrow(RangeError);
  });

  const price: ModelPrice = {
    modelId: "test",
    provider: "openai",
    inputPerToken: 500n,
    outputPerToken: 2500n,
    cachedInputPerToken: 50n,
    perImage: 0n,
    perRequest: 0n,
  };

  it("computes usage cost and reservation estimates", () => {
    const cost = costOfUsage(price, {
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 500,
      images: 0,
      requests: 1,
    });
    expect(cost).toBe(500n * 1000n + 2500n * 200n + 50n * 500n);
    const est = estimateReservation(price, { inputTokens: 1000, maxOutputTokens: 4000, images: 0 });
    expect(est).toBe(500n * 1000n + 2500n * 4000n);
    expect(est).toBeGreaterThan(cost);
    expect(est / MICROCREDITS_PER_CREDIT).toBe(10n);
  });

  it("estimates tokens on the high side for English, JSON, and CJK", () => {
    // ~4.5 characters per token in English prose; the estimate assumes 3.
    expect(estimateTokens("The quick brown fox jumps over the lazy dog.")).toBeCloseTo(44 / 3);
    // CJK runs about one token per character or more; the estimate assumes 1.5.
    expect(estimateTokens("你好世界")).toBe(6);
    expect(estimateTokens("a你")).toBeCloseTo(1 / 3 + 1.5);
    expect(estimateTokens("")).toBe(0);
    // Never below the 4-characters-per-token rule it replaced.
    for (const text of ['{"type":"function","name":"lookup"}', "日本語のテキスト", "😀 emoji"])
      expect(estimateTokens(text)).toBeGreaterThan(text.length / 4);
  });
});
