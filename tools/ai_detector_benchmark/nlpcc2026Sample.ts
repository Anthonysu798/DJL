export const NLPCC_2026_AUTHORSHIP_LABELS = ["human", "ai", "ai-refined"] as const;

export type Nlpcc2026AuthorshipLabel = (typeof NLPCC_2026_AUTHORSHIP_LABELS)[number];

export interface Nlpcc2026Record {
  readonly id: string;
  readonly text: string;
  readonly label: 0 | 1 | 2;
}

export interface Nlpcc2026BenchmarkFixture {
  readonly id: string;
  readonly language: "zh-Hans";
  readonly label: Nlpcc2026AuthorshipLabel;
  readonly text: string;
  readonly provenance: string;
  readonly license: string;
  readonly scenario: "human-written" | "llm-generated" | "llm-refined";
  readonly domain: "multi-domain-ood";
}

function authorshipLabel(label: 0 | 1 | 2): Nlpcc2026AuthorshipLabel {
  if (label === 0) return "human";
  if (label === 1) return "ai";
  return "ai-refined";
}

function scenario(label: 0 | 1 | 2): Nlpcc2026BenchmarkFixture["scenario"] {
  if (label === 0) return "human-written";
  if (label === 1) return "llm-generated";
  return "llm-refined";
}

export function isHanDominantBenchmarkText(text: string): boolean {
  let han = 0;
  let latin = 0;
  for (const character of text) {
    if (/\p{Script=Han}/u.test(character)) han += 1;
    else if (/\p{Script=Latin}/u.test(character)) latin += 1;
  }
  return han >= 120 && han >= latin;
}

export function selectBalancedNlpcc2026Fixtures(
  records: readonly Nlpcc2026Record[],
  perLabel: number,
  provenanceRevision: string,
): readonly Nlpcc2026BenchmarkFixture[] {
  if (!Number.isSafeInteger(perLabel) || perLabel <= 0 || perLabel > 100) {
    throw new Error("NLPCC 2026 sample size must be an integer from 1 through 100.");
  }
  const uniqueIds = new Set(records.map((record) => record.id));
  if (uniqueIds.size !== records.length) {
    throw new Error("NLPCC 2026 records contain duplicate ids.");
  }

  const fixtures: Nlpcc2026BenchmarkFixture[] = [];
  const eligible = records
    .filter((record) => isHanDominantBenchmarkText(record.text))
    .toSorted((left, right) =>
      left.id.localeCompare(right.id, "en", { numeric: true, sensitivity: "base" }),
    );
  for (const numericLabel of [0, 1, 2] as const) {
    const selected = eligible.filter((record) => record.label === numericLabel).slice(0, perLabel);
    if (selected.length !== perLabel) {
      throw new Error(
        `Expected ${perLabel} Han-dominant NLPCC 2026 label-${numericLabel} records, found ${selected.length}.`,
      );
    }
    for (const record of selected) {
      const label = authorshipLabel(numericLabel);
      fixtures.push({
        id: `nlpcc-2026-p2-${label}-${record.id}`,
        language: "zh-Hans",
        label,
        text: record.text,
        provenance: `NLP2CT/NLPCC-2026-Task6-Detection@${provenanceRevision} data/testp2_testing_label.json row=${record.id}`,
        license: "NLPCC-2026 Task 6 shared-task terms; no SPDX license declared",
        scenario: scenario(numericLabel),
        domain: "multi-domain-ood",
      });
    }
  }
  return fixtures;
}
