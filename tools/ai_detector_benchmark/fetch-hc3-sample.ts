#!/usr/bin/env bun
// Emits a revision-pinned, balanced HC3 JSONL sample without persisting the corpus.

import {
  assertHc3SplitRole,
  buildPinnedHuggingFaceDatasetFileUrl,
  decodePinnedHc3JsonlRows,
  HC3_WINDOW_SIZE,
  selectBalancedHc3Fixtures,
  type Hc3SampleSource,
} from "./hc3Sample";
import { BENCHMARK_SPLIT_ROLES, type BenchmarkSplitRole } from "./benchmarkInput";

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

function rowOffset(): number {
  const index = process.argv.indexOf("--row-offset");
  const raw = index >= 0 ? process.argv[index + 1] : "0";
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000 || parsed % 100 !== 0) {
    throw new Error("--row-offset must be a multiple of 100 from 0 through 10000.");
  }
  return parsed;
}

function splitRole(): BenchmarkSplitRole {
  const index = process.argv.indexOf("--split-role");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!BENCHMARK_SPLIT_ROLES.includes(value as BenchmarkSplitRole)) {
    throw new Error("--split-role must be development, validation, or locked.");
  }
  return value as BenchmarkSplitRole;
}

async function fetchPinnedRowPrefix(
  url: string,
  revision: string,
  requiredRows: number,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HC3 request failed with HTTP ${response.status}.`);
  const resolved = new URL(response.url);
  if (resolved.protocol !== "https:" || !resolved.pathname.includes(`/${revision}/`)) {
    throw new Error(
      `HC3 download did not resolve to pinned revision ${revision}: ${response.url}.`,
    );
  }
  if (!response.body) throw new Error("HC3 download returned no response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let completedRows = 0;
  try {
    while (completedRows < requiredRows) {
      const { value, done } = await reader.read();
      if (done) {
        chunks.push(decoder.decode());
        break;
      }
      const decoded = decoder.decode(value, { stream: true });
      chunks.push(decoded);
      completedRows += decoded.match(/\n/gu)?.length ?? 0;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return chunks.join("");
}

async function fetchSource(spec: DatasetSpec, offset: number): Promise<Hc3SampleSource> {
  const url = buildPinnedHuggingFaceDatasetFileUrl(spec.dataset, spec.revision, spec.config);
  const rows = decodePinnedHc3JsonlRows(
    await fetchPinnedRowPrefix(url, spec.revision, offset + HC3_WINDOW_SIZE),
    offset,
  );
  return { ...spec, rows };
}

const pairs = pairsPerLanguage();
const offset = rowOffset();
const role = splitRole();
assertHc3SplitRole(offset, role);
const sources = await Promise.all(DATASETS.map((spec) => fetchSource(spec, offset)));
const fixtures = (["en", "zh-Hans"] as const).flatMap((language) =>
  selectBalancedHc3Fixtures(
    sources.filter((source) => source.language === language),
    pairs,
    role,
  ),
);
process.stdout.write(`${fixtures.map((fixture) => JSON.stringify(fixture)).join("\n")}\n`);
