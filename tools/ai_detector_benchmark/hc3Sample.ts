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
}

const MIN_FIXTURE_CHARACTERS = 120;

export function buildHuggingFaceDatasetMetadataUrl(dataset: string): string {
  const [owner, repository, ...rest] = dataset.split("/");
  if (!owner || !repository || rest.length > 0) {
    throw new Error(`Invalid Hugging Face dataset identifier: ${dataset}`);
  }
  return `https://huggingface.co/api/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

function firstEligible(answers: readonly string[]): string | undefined {
  return answers
    .map((answer) => answer.trim())
    .find((answer) => answer.length >= MIN_FIXTURE_CHARACTERS);
}

export function selectBalancedHc3Fixtures(
  sources: readonly Hc3SampleSource[],
  pairs: number,
): readonly Hc3BenchmarkFixture[] {
  if (!Number.isSafeInteger(pairs) || pairs <= 0) {
    throw new Error("HC3 sample size must be a positive integer.");
  }

  const fixtures: Hc3BenchmarkFixture[] = [];
  let selectedPairs = 0;
  for (const source of sources) {
    for (const row of source.rows) {
      if (selectedPairs >= pairs) break;
      const human = firstEligible(row.humanAnswers);
      const ai = firstEligible(row.aiAnswers);
      if (!human || !ai) continue;

      const baseId = `hc3-${source.language}-${source.config}-${row.rowIndex}`;
      const provenance = `${source.dataset}@${source.revision} config=${source.config} row=${row.rowIndex}`;
      fixtures.push(
        {
          id: `${baseId}-human`,
          language: source.language,
          label: "human",
          text: human,
          provenance: `${provenance} human answer`,
          license: source.license,
        },
        {
          id: `${baseId}-ai`,
          language: source.language,
          label: "ai",
          text: ai,
          provenance: `${provenance} ChatGPT answer`,
          license: source.license,
        },
      );
      selectedPairs += 1;
    }
    if (selectedPairs >= pairs) break;
  }

  if (selectedPairs !== pairs) {
    throw new Error(`Expected ${pairs} eligible HC3 paired rows, found ${selectedPairs}.`);
  }
  return fixtures;
}
