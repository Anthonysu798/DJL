export const NLPCC_ZH_SCENARIOS = [
  "normal",
  "mixed-attack",
  "paraphrase-attack",
  "perturbation-attack",
  "length-64",
  "length-128",
  "length-256",
  "length-512",
] as const;

export type NlpccZhScenario = (typeof NLPCC_ZH_SCENARIOS)[number];

export interface NlpccZhRecord {
  readonly id: number;
  readonly text: string;
  readonly label: 0 | 1;
}

export interface NlpccZhBenchmarkFixture {
  readonly id: string;
  readonly language: "zh-Hans";
  readonly label: "ai" | "human";
  readonly text: string;
  readonly provenance: string;
  readonly license: string;
  readonly scenario: NlpccZhScenario;
  readonly domain: "creative-writing";
  readonly generator?: "DeepSeek-V3";
}

export function nlpccZhScenarioForId(id: number): NlpccZhScenario {
  if (!Number.isSafeInteger(id) || id < 1 || id > 11_000) {
    throw new Error(`NLPCC sample id is outside the documented test ranges: ${String(id)}`);
  }
  if (id <= 4_000) return "normal";
  if (id <= 5_000) return "mixed-attack";
  if (id <= 6_000) return "paraphrase-attack";
  if (id <= 7_000) return "perturbation-attack";
  if (id <= 8_000) return "length-64";
  if (id <= 9_000) return "length-128";
  if (id <= 10_000) return "length-256";
  return "length-512";
}

export function selectBalancedNlpccZhFixtures(
  records: readonly NlpccZhRecord[],
  perLabel: number,
  provenanceRevision: string,
): readonly NlpccZhBenchmarkFixture[] {
  if (!Number.isSafeInteger(perLabel) || perLabel <= 0 || perLabel > 100) {
    throw new Error("NLPCC sample size must be an integer from 1 through 100.");
  }
  const recordIds = records.map((record) => record.id);
  if (new Set(recordIds).size !== recordIds.length) {
    throw new Error("NLPCC source contains duplicate record ids.");
  }
  const fixtures: NlpccZhBenchmarkFixture[] = [];
  for (const scenario of NLPCC_ZH_SCENARIOS) {
    const inScenario = records
      .filter((record) => nlpccZhScenarioForId(record.id) === scenario)
      .toSorted((left, right) => left.id - right.id);
    for (const numericLabel of [0, 1] as const) {
      const selected = inScenario
        .filter((record) => record.label === numericLabel)
        .slice(0, perLabel);
      if (selected.length !== perLabel) {
        throw new Error(
          `Expected ${perLabel} NLPCC ${scenario} label-${numericLabel} records, found ${selected.length}.`,
        );
      }
      for (const record of selected) {
        const label = numericLabel === 1 ? "ai" : "human";
        fixtures.push({
          id: `nlpcc-zh-${scenario}-${record.id}`,
          language: "zh-Hans",
          label,
          text: record.text,
          provenance: `NLP2CT/NLPCC-2025-Task1@${provenanceRevision} test_with_label.json row=${record.id}`,
          license: "NLPCC-2025 shared-task research-use terms; no SPDX license declared",
          scenario,
          domain: "creative-writing",
          ...(label === "ai" ? { generator: "DeepSeek-V3" as const } : {}),
        });
      }
    }
  }
  return fixtures;
}
