import { describe, expect, it } from "vitest";

import { legacyProductionPrediction } from "./legacyProfile";

describe("legacyProductionPrediction", () => {
  it("reconstructs the old English minimum length and thresholds", () => {
    expect(
      legacyProductionPrediction({
        eligibleCharacters: 599,
        regions: [{ start: 0, end: 599, language: "en", score: 1 }],
      }),
    ).toBe("uncertain");
    expect(
      legacyProductionPrediction({
        eligibleCharacters: 600,
        regions: [{ start: 0, end: 600, language: "en", score: 0.985 }],
      }),
    ).toBe("ai");
  });

  it("reconstructs the old Chinese thresholds and minimum report length", () => {
    expect(
      legacyProductionPrediction({
        eligibleCharacters: 119,
        regions: [{ start: 0, end: 119, language: "zh-Hans", score: 1 }],
      }),
    ).toBe("uncertain");
    expect(
      legacyProductionPrediction({
        eligibleCharacters: 120,
        regions: [{ start: 0, end: 120, language: "zh-Hans", score: 0.8 }],
      }),
    ).toBe("ai");
    expect(
      legacyProductionPrediction({
        eligibleCharacters: 120,
        regions: [{ start: 0, end: 120, language: "zh-Hans", score: 0.25 }],
      }),
    ).toBe("human");
  });

  it("uses the exact production percentage rounding at the 65 percent boundary", () => {
    expect(
      legacyProductionPrediction({
        eligibleCharacters: 1_000,
        regions: [
          { start: 0, end: 646, language: "en", score: 0.99 },
          { start: 646, end: 1_000, language: "en", score: 0.5 },
        ],
      }),
    ).toBe("ai");
    expect(
      legacyProductionPrediction({
        eligibleCharacters: 1_000,
        regions: [
          { start: 0, end: 644, language: "en", score: 0.99 },
          { start: 644, end: 1_000, language: "en", score: 0.5 },
        ],
      }),
    ).toBe("uncertain");
  });
});
