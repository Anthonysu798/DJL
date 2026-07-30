#!/usr/bin/env bun
// Reproducible local benchmark runner for DJL AI Writing Check.

import { createHash } from "node:crypto";
import os from "node:os";

import type { AiDetectorLanguagePreference } from "@synara/contracts";

import { AiDetectorManager } from "../../apps/server/src/aiDetector/AiDetectorManager";
import {
  getModelManifest,
  modelArtifactFingerprint,
  primaryModelSha256,
  type DetectorModelLanguage,
} from "../../apps/server/src/aiDetector/modelManifest";
import { MIN_ELIGIBLE_CHARACTERS } from "../../apps/server/src/aiDetector/textPipeline";

import {
  assertBenchmarkRunSplitRole,
  parseBenchmarkInput,
  readBenchmarkInput,
  type BenchmarkSplitRole,
} from "./benchmarkInput";
import { legacyProductionPrediction } from "./legacyProfile";
import {
  computeClassificationMetrics,
  computeFixedAiThresholdMetrics,
  computeFixedSelectivePolicyMetrics,
  computeOutcomeDistribution,
  computeScoreMetrics,
  fixedSelectivePolicyPrediction,
  weightedMeanRegionScore,
  weightedQuantileRegionScore,
} from "./metrics";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name} argument.`);
  return value;
}

function optionalNumberArgument(name: string): number | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1.`);
  }
  return value;
}

function optionalIntegerArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function optionalSplitRoleArgument(name: string): BenchmarkSplitRole | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!["development", "validation", "locked"].includes(String(value))) {
    throw new Error(`${name} must be development, validation, or locked.`);
  }
  return value as BenchmarkSplitRole;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

const inputPath = argument("--input");
const stateDir = argument("--state-dir");
const summaryOnly = process.argv.includes("--summary-only");
const fixedAiThreshold = optionalNumberArgument("--fixed-ai-threshold");
const fixedHumanThreshold = optionalNumberArgument("--fixed-human-threshold");
const fixedAiMinimumCharacters = optionalIntegerArgument("--fixed-ai-minimum-characters", 0);
const requiredSplitRole = optionalSplitRoleArgument("--split-role");
if (fixedAiThreshold === null && fixedAiMinimumCharacters !== 0) {
  throw new Error("--fixed-ai-minimum-characters requires --fixed-ai-threshold.");
}
if (fixedHumanThreshold !== null && fixedAiThreshold === null) {
  throw new Error("--fixed-human-threshold requires --fixed-ai-threshold.");
}
if (
  fixedHumanThreshold !== null &&
  fixedAiThreshold !== null &&
  fixedHumanThreshold >= fixedAiThreshold
) {
  throw new Error("--fixed-human-threshold must be lower than --fixed-ai-threshold.");
}
const fixedSelectivePolicy =
  fixedHumanThreshold === null || fixedAiThreshold === null
    ? null
    : {
        humanThreshold: fixedHumanThreshold,
        aiThreshold: fixedAiThreshold,
        minimumEligibleCharacters: MIN_ELIGIBLE_CHARACTERS,
        minimumAiEligibleCharacters: fixedAiMinimumCharacters,
      };
const raw = await readBenchmarkInput(inputPath);
const fixtures = parseBenchmarkInput(raw);
assertBenchmarkRunSplitRole(fixtures, requiredSplitRole);

const manager = new AiDetectorManager(stateDir);
const initialDetectorState = await manager.getState();
const rows: Array<{
  id: string;
  language: "en" | "zh-Hans";
  label: "ai" | "human" | "ai-refined";
  prediction: "ai" | "human" | "uncertain";
  scores: { likelyAi: number; uncertain: number; likelyHuman: number };
  regions: Array<{ start: number; end: number; score?: number }>;
  meanAiProbability: number | null;
  aiEvidenceScore: number | null;
  humanEvidenceScore: number | null;
  legacyPrediction: "ai" | "human" | "uncertain";
  eligibleCharacters: number;
  excludedCharacters: number;
  totalCharacters: number;
  assessment: string;
  confidence: string;
  splitRole: BenchmarkSplitRole | null;
  sourceGroupId: string | null;
  authorId: string | null;
  promptFamily: string | null;
  nativeLanguageCohort: string | null;
  scenario: string | null;
  domain: string | null;
  generator: string | null;
  attackEditing: string | null;
  latencyMs: number;
}> = [];
let peakRssBytes = process.memoryUsage.rss();
const observedPreprocessingVersions = new Set<string>();
const observedSegmentationVersions = new Set<string>();
const observedModelRuns = new Map<
  DetectorModelLanguage,
  {
    model: string;
    revision: string;
    modelSha256: string;
    calibrationVersion: string;
    passages: number;
  }
>();
let cacheHits = 0;
for (const fixture of fixtures) {
  const started = performance.now();
  const report = await manager.analyze({
    bytes: new TextEncoder().encode(fixture.text),
    filename: `${fixture.id}.txt`,
    mediaType: "text/plain",
    languagePreference: fixture.language as AiDetectorLanguagePreference,
    bypassResultCache: true,
    signal: new AbortController().signal,
    emit: () => undefined,
  });
  if (report.cacheHit) {
    cacheHits += 1;
    throw new Error(
      `Benchmark fixture '${fixture.id}' returned a cached result despite cache bypass.`,
    );
  }
  observedPreprocessingVersions.add(report.preprocessingVersion);
  observedSegmentationVersions.add(report.segmentationVersion);
  for (const modelRun of report.modelRuns) {
    const language = modelRun.language as DetectorModelLanguage;
    const installedState = initialDetectorState.models.find(
      (candidate) => candidate.language === language,
    );
    if (installedState?.state !== "ready") {
      throw new Error(
        `Benchmark cannot use ${language}: the installed artifact did not pass its full checksum verification.`,
      );
    }
    const manifest = getModelManifest(language);
    const expected = {
      model: manifest.id,
      revision: manifest.revision,
      modelSha256: primaryModelSha256(manifest),
      calibrationVersion: manifest.calibrationVersion,
    };
    for (const key of ["model", "revision", "modelSha256", "calibrationVersion"] as const) {
      if (modelRun[key] !== expected[key]) {
        throw new Error(
          `Benchmark fixture '${fixture.id}' reported unexpected ${language} ${key}: ${modelRun[key]}.`,
        );
      }
    }
    const previous = observedModelRuns.get(language);
    if (
      previous &&
      (previous.model !== modelRun.model ||
        previous.revision !== modelRun.revision ||
        previous.modelSha256 !== modelRun.modelSha256 ||
        previous.calibrationVersion !== modelRun.calibrationVersion)
    ) {
      throw new Error(`Benchmark observed inconsistent ${language} model identities.`);
    }
    observedModelRuns.set(language, {
      model: modelRun.model,
      revision: modelRun.revision,
      modelSha256: modelRun.modelSha256,
      calibrationVersion: modelRun.calibrationVersion,
      passages: (previous?.passages ?? 0) + modelRun.passages,
    });
  }
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
    regions: report.regions.flatMap((region) =>
      region.score === undefined
        ? []
        : [{ start: region.start, end: region.end, score: region.score }],
    ),
    meanAiProbability: weightedMeanRegionScore(report.regions),
    aiEvidenceScore: weightedQuantileRegionScore(report.regions, 0.35),
    humanEvidenceScore: weightedQuantileRegionScore(report.regions, 0.65),
    legacyPrediction: legacyProductionPrediction({
      eligibleCharacters: report.eligibleCharacters,
      regions: report.regions,
    }),
    eligibleCharacters: report.eligibleCharacters,
    excludedCharacters: report.excludedCharacters,
    totalCharacters: report.totalCharacters,
    assessment: report.assessment,
    confidence: report.confidence,
    splitRole: fixture.splitRole ?? null,
    sourceGroupId: fixture.sourceGroupId ?? null,
    authorId: fixture.authorId ?? null,
    promptFamily: fixture.promptFamily ?? null,
    nativeLanguageCohort: fixture.nativeLanguageCohort ?? null,
    scenario: fixture.scenario ?? null,
    domain: fixture.domain ?? null,
    generator: fixture.generator ?? null,
    attackEditing: fixture.attackEditing ?? null,
    latencyMs: performance.now() - started,
  });
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
}

type BenchmarkRow = (typeof rows)[number];
type SliceMetadataKey =
  | "splitRole"
  | "nativeLanguageCohort"
  | "domain"
  | "generator"
  | "attackEditing";
const sliceByMetadata = <Result>(
  key: SliceMetadataKey,
  evaluate: (selected: typeof rows) => Result,
): Record<string, Result> =>
  Object.fromEntries(
    [
      ...new Set(
        rows
          .map((row) => row[key])
          .filter((value): value is NonNullable<BenchmarkRow[typeof key]> => value !== null),
      ),
    ].map((value) => [value, evaluate(rows.filter((row) => row[key] === value))]),
  );

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
      aiRefined: rows.filter((row) => row.language === language && row.label === "ai-refined")
        .length,
    },
  ]),
);
const lengthBands = [
  { name: "under-120", minimum: 0, maximum: 119 },
  { name: "120-299", minimum: 120, maximum: 299 },
  { name: "300-599", minimum: 300, maximum: 599 },
  { name: "600-999", minimum: 600, maximum: 999 },
  { name: "1000+", minimum: 1_000, maximum: Number.POSITIVE_INFINITY },
] as const;
const binaryRows = (selected: typeof rows) =>
  selected.flatMap((row) =>
    row.label === "ai" || row.label === "human"
      ? [
          {
            label: row.label,
            prediction: row.prediction,
            sourceGroupId: row.sourceGroupId,
            authorId: row.authorId,
          },
        ]
      : [],
  );
const classificationMetrics = (selected: typeof rows) =>
  computeClassificationMetrics(binaryRows(selected));
const legacyClassificationMetrics = (selected: typeof rows) =>
  computeClassificationMetrics(
    selected.flatMap((row) =>
      row.label === "ai" || row.label === "human"
        ? [
            {
              label: row.label,
              prediction: row.legacyPrediction,
              sourceGroupId: row.sourceGroupId,
              authorId: row.authorId,
            },
          ]
        : [],
    ),
  );
const scoreMetrics = (selected: typeof rows) =>
  computeScoreMetrics(
    selected.flatMap((row) =>
      row.label === "ai" || row.label === "human"
        ? [
            {
              label: row.label,
              score: row.aiEvidenceScore,
              splitRole: row.splitRole,
              sourceGroupId: row.sourceGroupId,
              authorId: row.authorId,
            },
          ]
        : [],
    ),
    { probabilitySemantics: false },
  );
const fixedThresholdMetrics = (selected: typeof rows) =>
  fixedAiThreshold === null
    ? null
    : computeFixedAiThresholdMetrics(
        selected.flatMap((row) =>
          row.label === "ai" || row.label === "human"
            ? [
                {
                  label: row.label,
                  score: row.aiEvidenceScore,
                  splitRole: row.splitRole,
                  eligibleCharacters: row.eligibleCharacters,
                  sourceGroupId: row.sourceGroupId,
                  authorId: row.authorId,
                },
              ]
            : [],
        ),
        fixedAiThreshold,
        fixedAiMinimumCharacters,
      );
const fixedSelectivePolicyMetrics = (selected: typeof rows) =>
  fixedSelectivePolicy === null
    ? null
    : computeFixedSelectivePolicyMetrics(
        selected.flatMap((row) =>
          row.label === "ai" || row.label === "human"
            ? [
                {
                  label: row.label,
                  regions: row.regions,
                  eligibleCharacters: row.eligibleCharacters,
                  sourceGroupId: row.sourceGroupId,
                  authorId: row.authorId,
                },
              ]
            : [],
        ),
        fixedSelectivePolicy,
      );
const fixedSelectiveOutcomeDistribution = (selected: typeof rows) =>
  fixedSelectivePolicy === null
    ? null
    : computeOutcomeDistribution(
        selected.map((row) => ({
          label: row.label,
          prediction: fixedSelectivePolicyPrediction(
            {
              regions: row.regions,
              eligibleCharacters: row.eligibleCharacters,
              sourceGroupId: row.sourceGroupId,
              authorId: row.authorId,
            },
            fixedSelectivePolicy,
          ),
        })),
      );
const outcomeDistribution = (selected: typeof rows) => computeOutcomeDistribution(selected);
function singleObservedVersion(values: ReadonlySet<string>, name: string): string | null {
  if (values.size > 1) {
    throw new Error(`Benchmark observed multiple ${name} versions: ${[...values].join(", ")}.`);
  }
  return [...values][0] ?? null;
}
const observedLanguages = [...observedModelRuns.keys()].toSorted();
const result = {
  schemaVersion: 8,
  warning: fixtures.every((fixture) => fixture.id.includes("synthetic"))
    ? "Synthetic smoke fixtures validate the harness only; these results are not an accuracy claim."
    : "This run is evidence for the recorded sources only. It is not a general accuracy claim, and possible training-data overlap must be disclosed.",
  runAt: new Date().toISOString(),
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
  hardware: {
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: os.totalmem(),
  },
  pipeline: {
    resultCacheMode: "bypass",
    cacheHits,
    preprocessingVersion: singleObservedVersion(observedPreprocessingVersions, "preprocessing"),
    segmentationVersion: singleObservedVersion(observedSegmentationVersions, "segmentation"),
    modelRuns: observedLanguages.map((language) => ({
      language,
      ...observedModelRuns.get(language)!,
      artifactIntegrityVerified: true,
    })),
    models: observedLanguages.map((language) => {
      const manifest = getModelManifest(language);
      return {
        language,
        id: manifest.id,
        revision: manifest.revision,
        license: manifest.license,
        licenseUrl: manifest.licenseUrl,
        artifactFingerprint: modelArtifactFingerprint(manifest),
        primaryModelSha256: primaryModelSha256(manifest),
        calibrationVersion: manifest.calibrationVersion,
        calibrationBands: manifest.calibrationBands,
        output: manifest.output,
        files: manifest.files.map(({ path, sizeBytes, sha256 }) => ({
          path,
          sizeBytes,
          sha256,
        })),
      };
    }),
  },
  dataset: {
    path: inputPath,
    sha256: createHash("sha256").update(raw).digest("hex"),
    samples: fixtures.length,
    sources: [
      ...new Set(
        fixtures.map((fixture) => fixture.provenance.split(/\s+(?:row|group)=/u)[0] ?? ""),
      ),
    ],
    licenses: [...new Set(fixtures.map((fixture) => fixture.license))],
    splitRoles: Object.fromEntries(
      ["development", "validation", "locked", "unspecified"].map((splitRole) => [
        splitRole,
        fixtures.filter((fixture) => (fixture.splitRole ?? "unspecified") === splitRole).length,
      ]),
    ),
    requiredSplitRole,
  },
  counts,
  metricNotes: {
    binary:
      "Classification and score metrics include only human and AI ground truth. AI-refined samples are reported separately as outcome distributions.",
    aiRefined:
      "AI-refined is not forced into a correct binary target because the product reports writing-style evidence, not author identity.",
    operatingPoints:
      "Operating-point thresholds are descriptive-only on non-locked slices. Any slice containing a locked sample disables threshold search; locked data may only evaluate a policy frozen elsewhere.",
    dependence:
      "Wilson intervals are row-level descriptions. Each metric's dependenceAudit prevents release-support claims unless human authors are independent and both human and AI rows have one row per source group; repeated or unknown clusters require cluster-robust inference.",
  },
  metrics: {
    overall: classificationMetrics(rows),
    byLanguage: Object.fromEntries(
      ["en", "zh-Hans"].map((language) => [
        language,
        classificationMetrics(rows.filter((row) => row.language === language)),
      ]),
    ),
    byLengthBand: Object.fromEntries(
      lengthBands.map((band) => [
        band.name,
        classificationMetrics(
          rows.filter(
            (row) =>
              row.eligibleCharacters >= band.minimum && row.eligibleCharacters <= band.maximum,
          ),
        ),
      ]),
    ),
    byScenario: Object.fromEntries(
      [...new Set(rows.map((row) => row.scenario).filter((value) => value !== null))].map(
        (scenario) => [
          scenario,
          classificationMetrics(rows.filter((row) => row.scenario === scenario)),
        ],
      ),
    ),
    byDomain: sliceByMetadata("domain", classificationMetrics),
    byGenerator: sliceByMetadata("generator", classificationMetrics),
    byNativeLanguageCohort: sliceByMetadata("nativeLanguageCohort", classificationMetrics),
    bySplitRole: sliceByMetadata("splitRole", classificationMetrics),
    byAttackEditing: sliceByMetadata("attackEditing", classificationMetrics),
  },
  outcomeDistributions: {
    overall: outcomeDistribution(rows),
    byLabel: Object.fromEntries(
      ["human", "ai", "ai-refined"].map((label) => [
        label,
        outcomeDistribution(rows.filter((row) => row.label === label)),
      ]),
    ),
    byLanguage: Object.fromEntries(
      ["en", "zh-Hans"].map((language) => [
        language,
        outcomeDistribution(rows.filter((row) => row.language === language)),
      ]),
    ),
    byLengthBand: Object.fromEntries(
      lengthBands.map((band) => [
        band.name,
        outcomeDistribution(
          rows.filter(
            (row) =>
              row.eligibleCharacters >= band.minimum && row.eligibleCharacters <= band.maximum,
          ),
        ),
      ]),
    ),
    byScenario: Object.fromEntries(
      [...new Set(rows.map((row) => row.scenario).filter((value) => value !== null))].map(
        (scenario) => [
          scenario,
          outcomeDistribution(rows.filter((row) => row.scenario === scenario)),
        ],
      ),
    ),
    byDomain: sliceByMetadata("domain", outcomeDistribution),
    byGenerator: sliceByMetadata("generator", outcomeDistribution),
    byNativeLanguageCohort: sliceByMetadata("nativeLanguageCohort", outcomeDistribution),
    bySplitRole: sliceByMetadata("splitRole", outcomeDistribution),
    byAttackEditing: sliceByMetadata("attackEditing", outcomeDistribution),
  },
  comparisonProfiles: {
    legacyPreLengthBands: {
      description:
        "Reconstructed pre-length-band production policy: English 0.35/0.985 with a 600-character AI minimum; Simplified Chinese 0.25/0.8; both require 120 characters.",
      overall: legacyClassificationMetrics(rows),
      byLanguage: Object.fromEntries(
        ["en", "zh-Hans"].map((language) => [
          language,
          legacyClassificationMetrics(rows.filter((row) => row.language === language)),
        ]),
      ),
      byLengthBand: Object.fromEntries(
        lengthBands.map((band) => [
          band.name,
          legacyClassificationMetrics(
            rows.filter(
              (row) =>
                row.eligibleCharacters >= band.minimum && row.eligibleCharacters <= band.maximum,
            ),
          ),
        ]),
      ),
      byScenario: Object.fromEntries(
        [...new Set(rows.map((row) => row.scenario).filter((value) => value !== null))].map(
          (scenario) => [
            scenario,
            legacyClassificationMetrics(rows.filter((row) => row.scenario === scenario)),
          ],
        ),
      ),
    },
  },
  scoreMetrics: {
    basis:
      "The score is a length-weighted 35th-percentile ranking statistic. It approximates the unrounded 65% evidence boundary but is not the production decision at percentage-rounding edges; classification metrics use the exact production report.",
    overall: scoreMetrics(rows),
    byLanguage: Object.fromEntries(
      ["en", "zh-Hans"].map((language) => [
        language,
        scoreMetrics(rows.filter((row) => row.language === language)),
      ]),
    ),
    byLengthBand: Object.fromEntries(
      lengthBands.map((band) => [
        band.name,
        scoreMetrics(
          rows.filter(
            (row) =>
              row.eligibleCharacters >= band.minimum && row.eligibleCharacters <= band.maximum,
          ),
        ),
      ]),
    ),
    byScenario: Object.fromEntries(
      [...new Set(rows.map((row) => row.scenario).filter((value) => value !== null))].map(
        (scenario) => [scenario, scoreMetrics(rows.filter((row) => row.scenario === scenario))],
      ),
    ),
    byDomain: sliceByMetadata("domain", scoreMetrics),
    byGenerator: sliceByMetadata("generator", scoreMetrics),
    byNativeLanguageCohort: sliceByMetadata("nativeLanguageCohort", scoreMetrics),
    bySplitRole: sliceByMetadata("splitRole", scoreMetrics),
    byAttackEditing: sliceByMetadata("attackEditing", scoreMetrics),
    byLanguageAndLengthBand: Object.fromEntries(
      ["en", "zh-Hans"].map((language) => [
        language,
        Object.fromEntries(
          lengthBands.map((band) => [
            band.name,
            scoreMetrics(
              rows.filter(
                (row) =>
                  row.language === language &&
                  row.eligibleCharacters >= band.minimum &&
                  row.eligibleCharacters <= band.maximum,
              ),
            ),
          ]),
        ),
      ]),
    ),
    fixedAiThreshold:
      fixedAiThreshold === null
        ? null
        : {
            thresholdSelection:
              "This supplied threshold is evaluated against the 35th-percentile ranking statistic only. It was not selected on this split, but it is not an exact production document decision; use fixedSelectivePolicy for a deployable three-outcome policy.",
            overall: fixedThresholdMetrics(rows),
            byLanguage: Object.fromEntries(
              ["en", "zh-Hans"].map((language) => [
                language,
                fixedThresholdMetrics(rows.filter((row) => row.language === language)),
              ]),
            ),
            byLengthBand: Object.fromEntries(
              lengthBands.map((band) => [
                band.name,
                fixedThresholdMetrics(
                  rows.filter(
                    (row) =>
                      row.eligibleCharacters >= band.minimum &&
                      row.eligibleCharacters <= band.maximum,
                  ),
                ),
              ]),
            ),
            byGenerator: sliceByMetadata("generator", fixedThresholdMetrics),
            bySplitRole: sliceByMetadata("splitRole", fixedThresholdMetrics),
          },
    fixedSelectivePolicy:
      fixedSelectivePolicy === null
        ? null
        : {
            thresholdSelection:
              "This human threshold, AI threshold, and minimum AI evidence length were supplied before the run. Raw scored regions are classified, character-weighted, and largest-remainder rounded with the same decision helpers as production; the values were not selected or adjusted from this split.",
            overall: fixedSelectivePolicyMetrics(rows),
            byLanguage: Object.fromEntries(
              ["en", "zh-Hans"].map((language) => [
                language,
                fixedSelectivePolicyMetrics(rows.filter((row) => row.language === language)),
              ]),
            ),
            byLengthBand: Object.fromEntries(
              lengthBands.map((band) => [
                band.name,
                fixedSelectivePolicyMetrics(
                  rows.filter(
                    (row) =>
                      row.eligibleCharacters >= band.minimum &&
                      row.eligibleCharacters <= band.maximum,
                  ),
                ),
              ]),
            ),
            byGenerator: sliceByMetadata("generator", fixedSelectivePolicyMetrics),
            bySplitRole: sliceByMetadata("splitRole", fixedSelectivePolicyMetrics),
            outcomesByLabel: Object.fromEntries(
              ["human", "ai", "ai-refined"].map((label) => [
                label,
                fixedSelectiveOutcomeDistribution(rows.filter((row) => row.label === label)),
              ]),
            ),
          },
  },
  performance: {
    totalMs: latency.reduce((sum, value) => sum + value, 0),
    medianLatencyMs: percentile(latency, 0.5),
    p95LatencyMs: percentile(latency, 0.95),
    peakRssBytes,
  },
  rowsOmitted: summaryOnly,
  rows: summaryOnly ? [] : rows,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
