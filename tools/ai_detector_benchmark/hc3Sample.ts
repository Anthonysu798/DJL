import type { BenchmarkSplitRole } from "./benchmarkInput";

export interface Hc3SourceRow {
  readonly rowIndex: number;
  readonly humanAnswers: readonly string[];
  readonly aiAnswers: readonly string[];
}

export interface Hc3SampleSource {
  readonly dataset: string;
  readonly revision: string;
  readonly config: string;
  readonly language: "en" | "zh-Hans";
  readonly license: string;
  readonly rows: readonly Hc3SourceRow[];
}

export interface Hc3BenchmarkFixture {
  readonly id: string;
  readonly language: "en" | "zh-Hans";
  readonly label: "ai" | "human";
  readonly text: string;
  readonly provenance: string;
  readonly license: string;
  readonly splitRole: BenchmarkSplitRole;
  readonly sourceGroupId: string;
  readonly promptFamily: string;
}

const MIN_FIXTURE_CHARACTERS = 120;
export const HC3_WINDOW_SIZE = 100;

export function expectedHc3SplitRole(rowOffset: number): BenchmarkSplitRole {
  if (
    !Number.isSafeInteger(rowOffset) ||
    rowOffset < 0 ||
    rowOffset > 10_000 ||
    rowOffset % HC3_WINDOW_SIZE !== 0
  ) {
    throw new Error("HC3 row offset must be a multiple of 100 from 0 through 10000.");
  }
  if (rowOffset === 0) return "development";
  if ([100, 200, 300, 400, 500, 600].includes(rowOffset)) return "validation";
  return "locked";
}

export function assertHc3SplitRole(rowOffset: number, splitRole: BenchmarkSplitRole): void {
  const expected = expectedHc3SplitRole(rowOffset);
  if (splitRole !== expected) {
    throw new Error(
      `HC3 row offset ${rowOffset} is reserved for split role ${expected}, not ${splitRole}.`,
    );
  }
}

export function buildHuggingFaceDatasetMetadataUrl(dataset: string): string {
  const [owner, repository, ...rest] = dataset.split("/");
  if (!owner || !repository || rest.length > 0) {
    throw new Error(`Invalid Hugging Face dataset identifier: ${dataset}`);
  }
  return `https://huggingface.co/api/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

export function buildPinnedHuggingFaceDatasetFileUrl(
  dataset: string,
  revision: string,
  config: string,
): string {
  const [owner, repository, ...rest] = dataset.split("/");
  if (!owner || !repository || rest.length > 0) {
    throw new Error(`Invalid Hugging Face dataset identifier: ${dataset}`);
  }
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error(`Invalid Hugging Face dataset revision: ${revision}`);
  }
  if (!config || config.includes("/") || config.includes("\\")) {
    throw new Error(`Invalid Hugging Face dataset configuration: ${config}`);
  }
  return `https://huggingface.co/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/resolve/${revision}/${encodeURIComponent(config)}.jsonl`;
}

export function decodePinnedHc3JsonlRows(
  raw: string,
  offset: number,
  length = HC3_WINDOW_SIZE,
): readonly Hc3SourceRow[] {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0) {
    throw new Error(
      "HC3 JSONL offset must be a non-negative integer and length must be a positive integer.",
    );
  }
  const records = raw.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (records.length < offset + length) {
    throw new Error(`HC3 pinned JSONL ended before the required ${offset + length} rows.`);
  }
  return records.slice(offset, offset + length).map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`HC3 JSONL row ${offset + index} is not valid JSON.`, { cause: error });
    }
    const row = value as
      | { readonly human_answers?: unknown; readonly chatgpt_answers?: unknown }
      | undefined;
    if (
      !row ||
      !Array.isArray(row.human_answers) ||
      !row.human_answers.every((answer) => typeof answer === "string") ||
      !Array.isArray(row.chatgpt_answers) ||
      !row.chatgpt_answers.every((answer) => typeof answer === "string")
    ) {
      throw new Error(`HC3 JSONL row ${offset + index} is malformed.`);
    }
    return {
      rowIndex: offset + index,
      humanAnswers: row.human_answers,
      aiAnswers: row.chatgpt_answers,
    };
  });
}

function firstEligible(answers: readonly string[]): string | undefined {
  return answers
    .map((answer) => answer.trim())
    .find((answer) => answer.length >= MIN_FIXTURE_CHARACTERS);
}

export function selectBalancedHc3Fixtures(
  sources: readonly Hc3SampleSource[],
  pairs: number,
  splitRole: BenchmarkSplitRole,
): readonly Hc3BenchmarkFixture[] {
  if (!Number.isSafeInteger(pairs) || pairs <= 0) {
    throw new Error("HC3 sample size must be a positive integer.");
  }

  const fixtures: Hc3BenchmarkFixture[] = [];
  let selectedPairs = 0;
  const sourceBuckets = sources.map((source) => ({ source, cursor: 0 }));
  while (selectedPairs < pairs) {
    let progressed = false;
    for (const bucket of sourceBuckets) {
      let selected:
        | { readonly row: Hc3SourceRow; readonly human: string; readonly ai: string }
        | undefined;
      while (bucket.cursor < bucket.source.rows.length && !selected) {
        const row = bucket.source.rows[bucket.cursor]!;
        bucket.cursor += 1;
        const human = firstEligible(row.humanAnswers);
        const ai = firstEligible(row.aiAnswers);
        if (human && ai) selected = { row, human, ai };
      }
      if (!selected) continue;
      const { source } = bucket;
      const { row, human, ai } = selected;
      const baseId = `hc3-${source.language}-${source.config}-${row.rowIndex}`;
      const sourceGroupId = `${source.dataset}@${source.revision}:${source.config}:${row.rowIndex}`;
      const provenance = `${source.dataset}@${source.revision} config=${source.config} row=${row.rowIndex}`;
      fixtures.push(
        {
          id: `${baseId}-human`,
          language: source.language,
          label: "human",
          text: human,
          provenance: `${provenance} human answer`,
          license: source.license,
          splitRole,
          sourceGroupId,
          promptFamily: sourceGroupId,
        },
        {
          id: `${baseId}-ai`,
          language: source.language,
          label: "ai",
          text: ai,
          provenance: `${provenance} ChatGPT answer`,
          license: source.license,
          splitRole,
          sourceGroupId,
          promptFamily: sourceGroupId,
        },
      );
      selectedPairs += 1;
      progressed = true;
      if (selectedPairs >= pairs) break;
    }
    if (!progressed) break;
  }

  if (selectedPairs !== pairs) {
    throw new Error(`Expected ${pairs} eligible HC3 paired rows, found ${selectedPairs}.`);
  }
  return fixtures;
}
