import { describe, expect, it } from "vitest";

import {
  isHanDominantBenchmarkText,
  selectBalancedNlpcc2026Fixtures,
  type Nlpcc2026Record,
} from "./nlpcc2026Sample";

const chinese = (suffix: string) =>
  `${"这是一段用于验证公开评测样本筛选逻辑的中文正文。".repeat(8)}${suffix}`;

describe("NLPCC 2026 HWT/LGT/HLT sampler", () => {
  it("filters documented English noise and selects every authorship class deterministically", () => {
    const records: Nlpcc2026Record[] = [
      { id: "testp2-20", text: chinese("人工二"), label: 0 },
      { id: "testp2-10", text: chinese("人工一"), label: 0 },
      { id: "testp2-12", text: chinese("生成"), label: 1 },
      { id: "testp2-14", text: "English refined text ".repeat(20), label: 2 },
      { id: "testp2-13", text: chinese("润色"), label: 2 },
    ];

    const fixtures = selectBalancedNlpcc2026Fixtures(records, 1, "a".repeat(40));
    expect(fixtures.map((fixture) => [fixture.label, fixture.scenario, fixture.id])).toEqual([
      ["human", "human-written", "nlpcc-2026-p2-human-testp2-10"],
      ["ai", "llm-generated", "nlpcc-2026-p2-ai-testp2-12"],
      ["ai-refined", "llm-refined", "nlpcc-2026-p2-ai-refined-testp2-13"],
    ]);
  });

  it("requires enough Han text and rejects invalid sample sizes", () => {
    expect(isHanDominantBenchmarkText(chinese("有效"))).toBe(true);
    expect(isHanDominantBenchmarkText("English only ".repeat(30))).toBe(false);
    expect(() => selectBalancedNlpcc2026Fixtures([], 0, "revision")).toThrow(/1 through 100/);
  });
});
