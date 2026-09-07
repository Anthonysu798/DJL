import { describe, expect, it } from "vitest";
import { claudeContextUsage, codexContextUsage } from "./usage";

describe("native context usage", () => {
  it("reports Codex's latest request instead of cumulative processed tokens", () => {
    expect(
      codexContextUsage({
        last: { totalTokens: 12_000 },
        total: { totalTokens: 90_000 },
        modelContextWindow: 200_000,
      }),
    ).toMatchObject({ usedTokens: 12_000, totalProcessedTokens: 90_000, maxTokens: 200_000 });
  });
  it("keeps a reported zero and allows context to shrink after compaction", () => {
    expect(
      codexContextUsage({ last: { totalTokens: 0 }, modelContextWindow: 200_000 })?.usedTokens,
    ).toBe(0);
    expect(
      codexContextUsage({ last: { totalTokens: 5000 }, total: { totalTokens: 500000 } })
        ?.usedTokens,
    ).toBe(5000);
  });
  it("does not fabricate usage when only totals or invalid data are supplied", () => {
    expect(codexContextUsage({ total: { totalTokens: 40000 } })).toBeUndefined();
    expect(codexContextUsage({ last: { totalTokens: -2 } })).toBeUndefined();
    expect(claudeContextUsage(undefined)).toBeUndefined();
  });
  it("includes Claude cache creation and cache reads exactly once", () => {
    expect(
      claudeContextUsage(
        {
          input_tokens: 100,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 900,
          output_tokens: 200,
        },
        1000000,
      ),
    ).toMatchObject({
      usedTokens: 1500,
      inputTokens: 1300,
      cachedInputTokens: 900,
      outputTokens: 200,
      maxTokens: 1000000,
    });
  });
});
