import { describe, expect, it } from "vitest";

import { isTopEffortSelected, orderEffortLevels, type EffortTraits } from "./effortLadder";

const ids = (levels: ReadonlyArray<{ id: string }>) => levels.map((level) => level.id);
const ladder = (...values: string[]) => values.map((id) => ({ id }));

describe("orderEffortLevels", () => {
  it("puts Gemini 3's High above Low", () => {
    expect(ids(orderEffortLevels(ladder("HIGH", "LOW")))).toEqual(["LOW", "HIGH"]);
  });

  it("treats Gemini 2.5's dynamic budget as the strongest", () => {
    expect(ids(orderEffortLevels(ladder("-1", "512")))).toEqual(["512", "-1"]);
    expect(ids(orderEffortLevels(ladder("-1", "0", "8192")))).toEqual(["0", "8192", "-1"]);
  });

  it("sorts a shuffled CLI list and keeps Ultracode on top", () => {
    expect(
      ids(orderEffortLevels(ladder("high", "ultracode", "low", "max", "xhigh", "medium"))),
    ).toEqual(["low", "medium", "high", "xhigh", "max", "ultracode"]);
    expect(ids(orderEffortLevels(ladder("max", "none", "minimal")))).toEqual([
      "none",
      "minimal",
      "max",
    ]);
  });

  it("keeps the provider's order when a level is unknown", () => {
    expect(ids(orderEffortLevels(ladder("turbo", "low", "deep")))).toEqual([
      "turbo",
      "low",
      "deep",
    ]);
  });
});

const traits = (
  effort: string | null,
  values: string[],
  extra: Partial<EffortTraits> = {},
): EffortTraits => ({
  effortLevels: values.map((value) => ({ value, label: value })),
  promptInjectedValues: [],
  ultrathinkPromptControlled: false,
  effort,
  ...extra,
});

describe("isTopEffortSelected", () => {
  it("is true on Ultracode, and not on Max when Ultracode exists", () => {
    const ladder = ["low", "medium", "high", "xhigh", "max", "ultracode"];
    expect(isTopEffortSelected(traits("ultracode", ladder))).toBe(true);
    expect(isTopEffortSelected(traits("max", ladder))).toBe(false);
  });

  it("is true on the top of a ladder without Ultracode, whatever the provider's order", () => {
    expect(isTopEffortSelected(traits("max", ["low", "medium", "high", "max"]))).toBe(true);
    expect(isTopEffortSelected(traits("HIGH", ["HIGH", "LOW"]))).toBe(true);
    expect(isTopEffortSelected(traits("-1", ["-1", "512", "8192"]))).toBe(true);
    expect(isTopEffortSelected(traits("8192", ["-1", "512", "8192"]))).toBe(false);
  });

  it("ignores the ultrathink prompt word and one-stop ladders", () => {
    const ladder = ["low", "high", "max", "ultrathink"];
    expect(
      isTopEffortSelected(traits("max", ladder, { promptInjectedValues: ["ultrathink"] })),
    ).toBe(true);
    expect(isTopEffortSelected(traits("high", ["high"]))).toBe(false);
    expect(isTopEffortSelected(traits(null, []))).toBe(false);
  });
});
