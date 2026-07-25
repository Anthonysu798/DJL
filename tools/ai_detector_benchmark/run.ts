#!/usr/bin/env bun
// Reproducible local benchmark runner for DJL AI Writing Check.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";

import type { AiDetectorLanguagePreference } from "@synara/contracts";

import { AiDetectorManager } from "../../apps/server/src/aiDetector/AiDetectorManager";

import { computeClassificationMetrics, weightedMeanRegionScore } from "./metrics";

interface Fixture {
  readonly id: string;
  readonly language: "en" | "zh-Hans";
  readonly label: "ai" | "human";
  readonly text: string;
  readonly provenance: string;
  readonly license: string;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name} argument.`);
  return value;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

const inputPath = argument("--input");
const stateDir = argument("--state-dir");
const raw = await readFile(inputPath, "utf8");
const fixtures = raw
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Fixture);
for (const fixture of fixtures) {
  if (
    !fixture.id ||
    !["en", "zh-Hans"].includes(fixture.language) ||
    !["ai", "human"].includes(fixture.label) ||
    fixture.text.length < 120 ||
    !fixture.provenance ||
    !fixture.license
  ) {
    throw new Error(`Fixture '${fixture.id || "unknown"}' is incomplete or too short.`);
  }
}

const manager = new AiDetectorManager(stateDir);
const rows: Array<{
  id: string;
  language: string;
  label: string;
  prediction: "ai" | "human" | "uncertain";
  scores: { likelyAi: number; uncertain: number; likelyHuman: number };
  meanAiProbability: number | null;
  latencyMs: number;
}> = [];
let peakRssBytes = process.memoryUsage.rss();
for (const fixture of fixtures) {
  const started = performance.now();
  const report = await manager.analyze({
    bytes: new TextEncoder().encode(fixture.text),
    filename: `${fixture.id}.txt`,
    mediaType: "text/plain",
    languagePreference: fixture.language as AiDetectorLanguagePreference,
    signal: new AbortController().signal,
    emit: () => undefined,
  });
  const prediction =
    report.assessment === "likely-ai"
      ? "ai"
      : report.assessment === "likely-human"
        ? "human"
        : "uncertain";
  rows.push({
    id: fixture.id,
    language: fixture.language,
    label: fixture.label,
    prediction,
    scores: report.scores,
    meanAiProbability: weightedMeanRegionScore(report.regions),
    latencyMs: performance.now() - started,
  });
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
}

const latency = rows.map((row) => row.latencyMs);
const counts = Object.fromEntries(
  ["en", "zh-Hans"].map((language) => [
    language,
    {
      samples: rows.filter((row) => row.language === language).length,
      correct: rows.filter((row) => row.language === language && row.prediction === row.label)
        .length,
      uncertain: rows.filter((row) => row.language === language && row.prediction === "uncertain")
        .length,
    },
  ]),
);
const result = {
  schemaVersion: 2,
  warning: fixtures.every((fixture) => fixture.provenance.includes("DJL team"))
    ? "Synthetic smoke fixtures validate the harness only; these results are not an accuracy claim."
    : "This holdout is release evidence for the recorded sources only. It is not a general accuracy claim, and possible training-data overlap must be disclosed.",
  runAt: new Date().toISOString(),
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
  hardware: {
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: os.totalmem(),
  },
  dataset: {
    path: inputPath,
    sha256: createHash("sha256").update(raw).digest("hex"),
    samples: fixtures.length,
    sources: [...new Set(fixtures.map((fixture) => fixture.provenance.split(" row=")[0]))],
    licenses: [...new Set(fixtures.map((fixture) => fixture.license))],
  },
  counts,
  metrics: {
    overall: computeClassificationMetrics(rows),
    byLanguage: Object.fromEntries(
      ["en", "zh-Hans"].map((language) => [
        language,
        computeClassificationMetrics(rows.filter((row) => row.language === language)),
      ]),
    ),
  },
  performance: {
    totalMs: latency.reduce((sum, value) => sum + value, 0),
    medianLatencyMs: percentile(latency, 0.5),
    p95LatencyMs: percentile(latency, 0.95),
    peakRssBytes,
  },
  rows,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
