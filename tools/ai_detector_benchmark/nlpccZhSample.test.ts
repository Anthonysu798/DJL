import { describe, expect, it } from "vitest";

import {
  NLPCC_ZH_SCENARIOS,
  nlpccZhScenarioForId,
  selectBalancedNlpccZhFixtures,
} from "./nlpccZhSample";

describe("NLPCC DetectRL-ZH benchmark sample selection", () => {
  it("maps every documented id boundary to its scenario", () => {
    expect([1, 4_001, 5_001, 6_001, 7_001, 8_001, 9_001, 10_001].map(nlpccZhScenarioForId)).toEqual(
      NLPCC_ZH_SCENARIOS,
    );
    expect(() => nlpccZhScenarioForId(11_001)).toThrow(/outside/);
  });

  it("selects deterministic balanced records for every scenario", () => {
    const starts = [1, 4_001, 5_001, 6_001, 7_001, 8_001, 9_001, 10_001];
    const records = starts.flatMap((start) => [
      { id: start, text: `人工样本 ${"内容".repeat(80)}`, label: 0 as const },
      { id: start + 1, text: `机器样本 ${"内容".repeat(80)}`, label: 1 as const },
    ]);
    const fixtures = selectBalancedNlpccZhFixtures(records, 1, "a".repeat(40));

    expect(fixtures).toHaveLength(NLPCC_ZH_SCENARIOS.length * 2);
    expect(fixtures.filter((fixture) => fixture.label === "human")).toHaveLength(8);
    expect(fixtures.filter((fixture) => fixture.label === "ai")).toHaveLength(8);
    expect(fixtures.filter((fixture) => fixture.generator === "DeepSeek-V3")).toHaveLength(8);
    expect(new Set(fixtures.map((fixture) => fixture.scenario))).toEqual(
      new Set(NLPCC_ZH_SCENARIOS),
    );
  });

  it("rejects duplicate source ids before sampling", () => {
    const duplicate = {
      id: 1,
      text: `重复样本 ${"内容".repeat(80)}`,
      label: 0 as const,
    };
    expect(() =>
      selectBalancedNlpccZhFixtures([duplicate, { ...duplicate }], 1, "a".repeat(40)),
    ).toThrow(/duplicate record ids/);
  });
});
