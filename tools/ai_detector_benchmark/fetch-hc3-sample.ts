#!/usr/bin/env bun
// Emits a revision-pinned, balanced HC3 JSONL sample without persisting the corpus.

import {
  buildHuggingFaceDatasetMetadataUrl,
  selectBalancedHc3Fixtures,
  type Hc3SampleSource,
  type Hc3SourceRow,
} from "./hc3Sample";

interface DatasetSpec {
  readonly dataset: string;
  readonly revision: string;
  readonly config: string;
  readonly language: "en" | "zh-Hans";
  readonly license: string;
}

const DATASETS: readonly DatasetSpec[] = [
  {
    dataset: "Hello-SimpleAI/HC3",
    revision: "4d0ff18143b5a7e1b1e79beb540c04549d1e59d3",
    config: "wiki_csai",
    language: "en",
    license: "CC-BY-SA-4.0",
  },
  {
    dataset: "Hello-SimpleAI/HC3-Chinese",
    revision: "09a687b8dc164b89e7df95abf15df3b216bc31c2",
    config: "open_qa",
    language: "zh-Hans",
    license: "MIT",
  },
  {
    dataset: "Hello-SimpleAI/HC3-Chinese",
    revision: "09a687b8dc164b89e7df95abf15df3b216bc31c2",
    config: "psychology",
    language: "zh-Hans",
    license: "CC0-1.0",
  },
];

function pairsPerLanguage(): number {
  const index = process.argv.indexOf("--pairs-per-language");
  const raw = index >= 0 ? process.argv[index + 1] : "25";
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("--pairs-per-language must be an integer from 1 through 100.");
  }
  return parsed;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`HC3 request failed with HTTP ${response.status}.`);
  return response.json();
}

async function assertRevision(spec: DatasetSpec): Promise<void> {
  const metadata = (await fetchJson(buildHuggingFaceDatasetMetadataUrl(spec.dataset))) as {
    readonly sha?: unknown;
  };
  if (metadata.sha !== spec.revision) {
    throw new Error(
      `HC3 revision changed for ${spec.dataset}: expected ${spec.revision}, received ${String(metadata.sha)}.`,
    );
  }
}

function decodeRows(value: unknown): readonly Hc3SourceRow[] {
  const rows = (value as { readonly rows?: unknown }).rows;
  if (!Array.isArray(rows)) throw new Error("HC3 rows response is malformed.");
  return rows.map((entry) => {
    const record = entry as { readonly row_idx?: unknown; readonly row?: unknown };
    const row = record.row as
      | { readonly human_answers?: unknown; readonly chatgpt_answers?: unknown }
      | undefined;
    if (
      !Number.isSafeInteger(record.row_idx) ||
      !row ||
      !Array.isArray(row.human_answers) ||
      !row.human_answers.every((answer) => typeof answer === "string") ||
      !Array.isArray(row.chatgpt_answers) ||
      !row.chatgpt_answers.every((answer) => typeof answer === "string")
    ) {
      throw new Error("HC3 row is malformed.");
    }
    return {
      rowIndex: record.row_idx as number,
      humanAnswers: row.human_answers as string[],
      aiAnswers: row.chatgpt_answers as string[],
    };
  });
}

async function fetchSource(spec: DatasetSpec): Promise<Hc3SampleSource> {
  await assertRevision(spec);
  const query = new URLSearchParams({
    dataset: spec.dataset,
    config: spec.config,
    split: "train",
    offset: "0",
    length: "100",
  });
  const rows = decodeRows(
    await fetchJson(`https://datasets-server.huggingface.co/rows?${query.toString()}`),
  );
  return { ...spec, rows };
}

const pairs = pairsPerLanguage();
const sources = await Promise.all(DATASETS.map(fetchSource));
const fixtures = (["en", "zh-Hans"] as const).flatMap((language) =>
  selectBalancedHc3Fixtures(
    sources.filter((source) => source.language === language),
    pairs,
  ),
);
process.stdout.write(`${fixtures.map((fixture) => JSON.stringify(fixture)).join("\n")}\n`);
