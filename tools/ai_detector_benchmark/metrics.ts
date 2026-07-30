import type { BenchmarkSplitRole } from "./benchmarkInput";
import {
  assessEvidenceSummary,
  roundEvidencePercentages,
} from "../../apps/server/src/aiDetector/textPipeline";

export type BenchmarkGroundTruth = "ai" | "human";
export type BenchmarkPrediction = BenchmarkGroundTruth | "uncertain";
export type BenchmarkAuthorshipLabel = BenchmarkGroundTruth | "ai-refined";

export interface BenchmarkMetricRow {
  readonly label: BenchmarkGroundTruth;
  readonly prediction: BenchmarkPrediction;
  readonly sourceGroupId?: string | null;
  readonly authorId?: string | null;
}

export interface WeightedScoreRegion {
  readonly start: number;
  readonly end: number;
  readonly score?: number;
}

export interface BenchmarkScoreRow {
  readonly label: BenchmarkGroundTruth;
  readonly score: number | null;
  readonly splitRole?: BenchmarkSplitRole | null;
  readonly eligibleCharacters?: number;
  readonly sourceGroupId?: string | null;
  readonly authorId?: string | null;
}

export interface BenchmarkOutcomeRow {
  readonly label: BenchmarkAuthorshipLabel;
  readonly prediction: BenchmarkPrediction;
}

export interface BenchmarkSelectivePolicyRow {
  readonly label: BenchmarkGroundTruth;
  readonly regions: readonly WeightedScoreRegion[];
  readonly eligibleCharacters: number;
  readonly sourceGroupId?: string | null;
  readonly authorId?: string | null;
}

export interface FixedSelectivePolicy {
  readonly humanThreshold: number;
  readonly aiThreshold: number;
  readonly minimumEligibleCharacters: number;
  readonly minimumAiEligibleCharacters: number;
}

export function weightedMeanRegionScore(regions: readonly WeightedScoreRegion[]): number | null {
  let weightedScore = 0;
  let characters = 0;
  for (const region of regions) {
    const length = Math.max(0, region.end - region.start);
    if (length === 0 || region.score === undefined || !Number.isFinite(region.score)) continue;
    weightedScore += region.score * length;
    characters += length;
  }
  return characters > 0 ? weightedScore / characters : null;
}

export function weightedQuantileRegionScore(
  regions: readonly WeightedScoreRegion[],
  fraction: number,
): number | null {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error("Weighted score quantile must be between 0 and 1.");
  }
  const scored = regions
    .map((region) => ({
      score: region.score,
      length: Math.max(0, region.end - region.start),
    }))
    .filter(
      (region): region is { readonly score: number; readonly length: number } =>
        region.length > 0 &&
        region.score !== undefined &&
        Number.isFinite(region.score) &&
        region.score >= 0 &&
        region.score <= 1,
    )
    .toSorted((left, right) => left.score - right.score);
  const characters = scored.reduce((sum, region) => sum + region.length, 0);
  if (characters === 0) return null;
  const target = characters * fraction;
  let cumulative = 0;
  for (const region of scored) {
    cumulative += region.length;
    if (cumulative > target) return region.score;
  }
  return scored.at(-1)?.score ?? null;
}

function divide(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

type DependenceRow = {
  readonly label: BenchmarkGroundTruth;
  readonly sourceGroupId?: string | null;
  readonly authorId?: string | null;
};

function clusterAudit(rows: readonly DependenceRow[], key: "sourceGroupId" | "authorId") {
  const counts = new Map<string, number>();
  let missingSamples = 0;
  for (const row of rows) {
    const value = row[key];
    if (!value) {
      missingSamples += 1;
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const sizes = [...counts.values()];
  return {
    samples: rows.length,
    knownSamples: rows.length - missingSamples,
    missingSamples,
    uniqueUnits: counts.size,
    repeatedUnits: sizes.filter((size) => size > 1).length,
    maximumRowsPerUnit: sizes.length > 0 ? Math.max(...sizes) : null,
    complete: rows.length > 0 && missingSamples === 0,
    rowIndependent: rows.length > 0 && missingSamples === 0 && sizes.every((size) => size === 1),
  };
}

export function computeDependenceAudit(rows: readonly DependenceRow[]) {
  const humanRows = rows.filter((row) => row.label === "human");
  const aiRows = rows.filter((row) => row.label === "ai");
  const humanAuthors = clusterAudit(humanRows, "authorId");
  const humanSourceGroups = clusterAudit(humanRows, "sourceGroupId");
  const aiSourceGroups = clusterAudit(aiRows, "sourceGroupId");
  const falsePositiveRateSupported =
    humanAuthors.rowIndependent && humanSourceGroups.rowIndependent;
  const truePositiveRateSupported = aiSourceGroups.rowIndependent;
  return {
    human: {
      authors: humanAuthors,
      sourceGroups: humanSourceGroups,
    },
    ai: {
      sourceGroups: aiSourceGroups,
    },
    formalInference: {
      falsePositiveRateSupported,
      truePositiveRateSupported,
      rowLevelWilsonReleaseSupported: falsePositiveRateSupported && truePositiveRateSupported,
      reason:
        falsePositiveRateSupported && truePositiveRateSupported
          ? null
          : "Row-level Wilson intervals are descriptive only: independent human authors, one human row per source group, and one AI row per source group were not all established. Use author/prompt-disjoint sampling or cluster-robust inference for release claims.",
    },
  };
}

export function wilsonConfidenceInterval(
  successes: number,
  samples: number,
): { readonly lower: number; readonly upper: number } | null {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(samples) ||
    successes < 0 ||
    samples <= 0 ||
    successes > samples
  ) {
    return null;
  }
  const z = 1.959963984540054;
  const estimate = successes / samples;
  const zSquared = z * z;
  const denominator = 1 + zSquared / samples;
  const centre = estimate + zSquared / (2 * samples);
  const margin = z * Math.sqrt((estimate * (1 - estimate) + zSquared / (4 * samples)) / samples);
  return {
    lower: successes === 0 ? 0 : Math.max(0, (centre - margin) / denominator),
    upper: successes === samples ? 1 : Math.min(1, (centre + margin) / denominator),
  };
}

export function computeFixedAiThresholdMetrics(
  rows: readonly BenchmarkScoreRow[],
  threshold: number,
  minimumEligibleCharacters = 0,
) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("The fixed AI threshold must be between 0 and 1.");
  }
  if (!Number.isSafeInteger(minimumEligibleCharacters) || minimumEligibleCharacters < 0) {
    throw new Error("The fixed AI minimum must be a non-negative integer.");
  }
  if (
    minimumEligibleCharacters > 0 &&
    rows.some(
      (row) =>
        !Number.isSafeInteger(row.eligibleCharacters) || (row.eligibleCharacters as number) < 0,
    )
  ) {
    throw new Error("Every row must provide eligible characters when a fixed AI minimum is used.");
  }
  const valid = rows.filter(
    (
      row,
    ): row is {
      readonly label: BenchmarkGroundTruth;
      readonly score: number;
      readonly splitRole?: BenchmarkSplitRole | null;
      readonly eligibleCharacters?: number;
      readonly sourceGroupId?: string | null;
      readonly authorId?: string | null;
    } => row.score !== null && Number.isFinite(row.score) && row.score >= 0 && row.score <= 1,
  );
  const aiSamples = rows.filter((row) => row.label === "ai").length;
  const humanSamples = rows.length - aiSamples;
  const truePositives = valid.filter(
    (row) =>
      row.label === "ai" &&
      (row.eligibleCharacters ?? 0) >= minimumEligibleCharacters &&
      row.score >= threshold,
  ).length;
  const falsePositives = valid.filter(
    (row) =>
      row.label === "human" &&
      (row.eligibleCharacters ?? 0) >= minimumEligibleCharacters &&
      row.score >= threshold,
  ).length;
  const dependenceAudit = computeDependenceAudit(rows);
  return {
    threshold,
    minimumEligibleCharacters,
    samples: rows.length,
    excludedScores: rows.length - valid.length,
    belowMinimumSamples: rows.filter(
      (row) => (row.eligibleCharacters ?? 0) < minimumEligibleCharacters,
    ).length,
    aiSamples,
    humanSamples,
    truePositives,
    falsePositives,
    truePositiveRate: divide(truePositives, aiSamples),
    falsePositiveRate: divide(falsePositives, humanSamples),
    dependenceAudit,
    confidenceIntervals95: {
      method: "Wilson score (row-level; see dependenceAudit before inferential use)",
      truePositiveRate: wilsonConfidenceInterval(truePositives, aiSamples),
      falsePositiveRate: wilsonConfidenceInterval(falsePositives, humanSamples),
    },
  };
}

function validateFixedSelectivePolicy(policy: FixedSelectivePolicy): void {
  if (
    !Number.isFinite(policy.humanThreshold) ||
    !Number.isFinite(policy.aiThreshold) ||
    policy.humanThreshold < 0 ||
    policy.aiThreshold > 1 ||
    policy.humanThreshold >= policy.aiThreshold
  ) {
    throw new Error("The fixed selective thresholds must satisfy 0 <= human < AI <= 1.");
  }
  if (
    !Number.isSafeInteger(policy.minimumEligibleCharacters) ||
    policy.minimumEligibleCharacters < 0 ||
    !Number.isSafeInteger(policy.minimumAiEligibleCharacters) ||
    policy.minimumAiEligibleCharacters < policy.minimumEligibleCharacters
  ) {
    throw new Error(
      "The fixed evidence minimums must be non-negative integers with AI >= general.",
    );
  }
}

function validateSelectivePolicyRow(row: Omit<BenchmarkSelectivePolicyRow, "label">): void {
  if (!Number.isSafeInteger(row.eligibleCharacters) || row.eligibleCharacters < 0) {
    throw new Error("Every selective-policy row must provide valid eligible characters.");
  }
  if (!Array.isArray(row.regions)) {
    throw new Error("Every selective-policy row must provide scored regions.");
  }

  let coveredCharacters = 0;
  let previousEnd: number | null = null;
  for (const region of row.regions) {
    if (
      !Number.isSafeInteger(region.start) ||
      !Number.isSafeInteger(region.end) ||
      region.start < 0 ||
      region.end <= region.start
    ) {
      throw new Error(
        "Selective-policy regions must have non-negative, increasing safe-integer boundaries.",
      );
    }
    if (previousEnd !== null && region.start < previousEnd) {
      throw new Error("Selective-policy regions must be sorted and non-overlapping.");
    }
    if (
      region.score === undefined ||
      !Number.isFinite(region.score) ||
      region.score < 0 ||
      region.score > 1
    ) {
      throw new Error("Every selective-policy region must have a finite score between 0 and 1.");
    }

    coveredCharacters += region.end - region.start;
    if (!Number.isSafeInteger(coveredCharacters)) {
      throw new Error("Selective-policy region coverage exceeds the safe integer range.");
    }
    previousEnd = region.end;
  }
  if (coveredCharacters !== row.eligibleCharacters) {
    throw new Error(
      `Selective-policy scored regions cover ${coveredCharacters} characters, expected ${row.eligibleCharacters}.`,
    );
  }
}

export function fixedSelectivePolicyPrediction(
  row: Omit<BenchmarkSelectivePolicyRow, "label">,
  policy: FixedSelectivePolicy,
): BenchmarkPrediction {
  validateFixedSelectivePolicy(policy);
  validateSelectivePolicyRow(row);
  if (row.eligibleCharacters < policy.minimumEligibleCharacters) return "uncertain";
  const counts: [number, number, number] = [0, 0, 0];
  for (const region of row.regions) {
    const length = region.end - region.start;
    const score = region.score!;
    if (
      row.eligibleCharacters >= policy.minimumAiEligibleCharacters &&
      score >= policy.aiThreshold
    ) {
      counts[0] += length;
    } else if (score <= policy.humanThreshold) {
      counts[2] += length;
    } else {
      counts[1] += length;
    }
  }
  const assessment = assessEvidenceSummary(
    roundEvidencePercentages(counts),
    row.eligibleCharacters,
  );
  return assessment === "likely-ai" ? "ai" : assessment === "likely-human" ? "human" : "uncertain";
}

export function computeFixedSelectivePolicyMetrics(
  rows: readonly BenchmarkSelectivePolicyRow[],
  policy: FixedSelectivePolicy,
) {
  validateFixedSelectivePolicy(policy);
  for (const row of rows) {
    if (row.label !== "ai" && row.label !== "human") {
      throw new Error("Every selective-policy row must have an AI or human ground-truth label.");
    }
  }
  const predictions = rows.map((row) => ({
    label: row.label,
    prediction: fixedSelectivePolicyPrediction(row, policy),
    sourceGroupId: row.sourceGroupId,
    authorId: row.authorId,
  }));
  return {
    policy,
    ...computeClassificationMetrics(predictions),
  };
}

function averageRankSumForAi(rows: readonly { label: BenchmarkGroundTruth; score: number }[]) {
  const sorted = rows.toSorted((left, right) => left.score - right.score);
  let aiRankSum = 0;
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && sorted[end]!.score === sorted[start]!.score) end += 1;
    const averageRank = (start + 1 + end) / 2;
    const aiInTie = sorted.slice(start, end).filter((row) => row.label === "ai").length;
    aiRankSum += averageRank * aiInTie;
    start = end;
  }
  return aiRankSum;
}

function operatingPoint(
  rows: readonly {
    label: BenchmarkGroundTruth;
    score: number;
    sourceGroupId?: string | null;
    authorId?: string | null;
  }[],
  targetFalsePositiveRate: number,
  releaseIndependenceEstablished: boolean,
) {
  const aiSamples = rows.filter((row) => row.label === "ai").length;
  const humanSamples = rows.length - aiSamples;
  if (aiSamples === 0 || humanSamples === 0) {
    return {
      targetFalsePositiveRate,
      threshold: null,
      falsePositiveRate: null,
      truePositiveRate: null,
      falsePositives: 0,
      truePositives: 0,
      confidenceIntervals95: {
        method: "Wilson score",
        falsePositiveRate: null,
        truePositiveRate: null,
      },
      targetSupportedAt95Confidence: false,
      evidenceStatus: "insufficient-samples",
    };
  }

  const descendingScores = [...new Set(rows.map((row) => row.score))].toSorted(
    (left, right) => right - left,
  );
  let falsePositives = 0;
  let truePositives = 0;
  let best = {
    threshold: null as number | null,
    falsePositiveRate: 0,
    truePositiveRate: 0,
    falsePositives: 0,
    truePositives: 0,
  };
  for (const threshold of descendingScores) {
    const tied = rows.filter((row) => row.score === threshold);
    falsePositives += tied.filter((row) => row.label === "human").length;
    truePositives += tied.filter((row) => row.label === "ai").length;
    const falsePositiveRate = falsePositives / humanSamples;
    if (falsePositiveRate > targetFalsePositiveRate) break;
    best = {
      threshold,
      falsePositiveRate,
      truePositiveRate: truePositives / aiSamples,
      falsePositives,
      truePositives,
    };
  }
  const falsePositiveRateInterval = wilsonConfidenceInterval(best.falsePositives, humanSamples);
  const targetSupportedAt95Confidence =
    best.threshold !== null &&
    falsePositiveRateInterval !== null &&
    falsePositiveRateInterval.upper <= targetFalsePositiveRate &&
    releaseIndependenceEstablished;
  return {
    targetFalsePositiveRate,
    ...best,
    confidenceIntervals95: {
      method:
        "Wilson score (row-level; release support requires independent human authors and unique human/AI source groups)",
      falsePositiveRate: falsePositiveRateInterval,
      truePositiveRate: wilsonConfidenceInterval(best.truePositives, aiSamples),
    },
    targetSupportedAt95Confidence,
    evidenceStatus: targetSupportedAt95Confidence
      ? "supported-at-95-confidence"
      : !releaseIndependenceEstablished
        ? "independence-not-established"
        : "insufficient-human-samples-or-excess-false-positives",
  };
}

function scoreDistribution(values: readonly number[]) {
  if (values.length === 0) {
    return {
      minimum: null,
      p05: null,
      p25: null,
      median: null,
      p75: null,
      p95: null,
      maximum: null,
    };
  }
  const sorted = values.toSorted((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted[Math.floor((sorted.length - 1) * fraction)] ?? null;
  return {
    minimum: sorted[0] ?? null,
    p05: percentile(0.05),
    p25: percentile(0.25),
    median: percentile(0.5),
    p75: percentile(0.75),
    p95: percentile(0.95),
    maximum: sorted.at(-1) ?? null,
  };
}

export function computeScoreMetrics(
  rows: readonly BenchmarkScoreRow[],
  options: { readonly probabilitySemantics?: boolean } = {},
) {
  const probabilitySemantics = options.probabilitySemantics ?? true;
  const valid = rows.filter(
    (
      row,
    ): row is {
      readonly label: BenchmarkGroundTruth;
      readonly score: number;
      readonly splitRole?: BenchmarkSplitRole | null;
      readonly sourceGroupId?: string | null;
      readonly authorId?: string | null;
    } => row.score !== null && Number.isFinite(row.score) && row.score >= 0 && row.score <= 1,
  );
  const aiSamples = valid.filter((row) => row.label === "ai").length;
  const humanSamples = valid.length - aiSamples;
  const auroc =
    aiSamples > 0 && humanSamples > 0
      ? (averageRankSumForAi(valid) - (aiSamples * (aiSamples + 1)) / 2) /
        (aiSamples * humanSamples)
      : null;

  let seen = 0;
  let truePositives = 0;
  let averagePrecision = 0;
  const descending = valid.toSorted((left, right) => right.score - left.score);
  for (let start = 0; start < descending.length; ) {
    let end = start + 1;
    while (end < descending.length && descending[end]!.score === descending[start]!.score) end += 1;
    const tiedAi = descending.slice(start, end).filter((row) => row.label === "ai").length;
    seen = end;
    truePositives += tiedAi;
    if (aiSamples > 0 && tiedAi > 0) {
      averagePrecision += (tiedAi / aiSamples) * (truePositives / seen);
    }
    start = end;
  }

  const brierScore =
    probabilitySemantics && valid.length > 0
      ? valid.reduce((sum, row) => sum + (row.score - (row.label === "ai" ? 1 : 0)) ** 2, 0) /
        valid.length
      : null;
  const calibrationBins = probabilitySemantics
    ? Array.from({ length: 10 }, (_, index) => {
        const minimum = index / 10;
        const maximum = (index + 1) / 10;
        const inBin = valid.filter(
          (row) =>
            row.score >= minimum && (index === 9 ? row.score <= maximum : row.score < maximum),
        );
        return {
          minimum,
          maximum,
          samples: inBin.length,
          meanScore:
            inBin.length > 0 ? inBin.reduce((sum, row) => sum + row.score, 0) / inBin.length : null,
          aiRate:
            inBin.length > 0
              ? inBin.filter((row) => row.label === "ai").length / inBin.length
              : null,
        };
      })
    : [];
  const expectedCalibrationError =
    probabilitySemantics && valid.length > 0
      ? calibrationBins.reduce(
          (sum, bin) =>
            sum +
            (bin.samples / valid.length) *
              (bin.meanScore === null || bin.aiRate === null
                ? 0
                : Math.abs(bin.meanScore - bin.aiRate)),
          0,
        )
      : null;
  const includesLockedSplit = rows.some((row) => row.splitRole === "locked");
  const dependenceAudit = computeDependenceAudit(valid);

  return {
    samples: valid.length,
    excludedScores: rows.length - valid.length,
    aiSamples,
    humanSamples,
    dependenceAudit,
    scoreSemantics: probabilitySemantics ? "probability" : "ranking-statistic",
    auroc,
    averagePrecision: aiSamples > 0 ? averagePrecision : null,
    brierScore,
    expectedCalibrationError,
    probabilityMetrics: probabilitySemantics
      ? {
          available: true,
          reason: null,
        }
      : {
          available: false,
          reason:
            "Brier score and calibration error are not defined for this document ranking statistic.",
        },
    scoreDistribution: {
      ai: scoreDistribution(valid.filter((row) => row.label === "ai").map((row) => row.score)),
      human: scoreDistribution(
        valid.filter((row) => row.label === "human").map((row) => row.score),
      ),
    },
    calibrationBins,
    operatingPointSearch: includesLockedSplit
      ? {
          mode: "disabled-locked",
          reason:
            "Operating-point threshold search is disabled because this slice contains locked evaluation samples.",
        }
      : {
          mode: "descriptive-only",
          reason:
            "Thresholds are exploratory descriptions of this non-locked slice and are not release evidence until evaluated on a separate locked split.",
        },
    operatingPoints: includesLockedSplit
      ? []
      : [0.001, 0.01, 0.05].map((target) =>
          operatingPoint(
            valid,
            target,
            dependenceAudit.formalInference.rowLevelWilsonReleaseSupported,
          ),
        ),
  };
}

export function computeOutcomeDistribution(rows: readonly BenchmarkOutcomeRow[]) {
  const predictions = {
    ai: rows.filter((row) => row.prediction === "ai").length,
    human: rows.filter((row) => row.prediction === "human").length,
    inconclusive: rows.filter((row) => row.prediction === "uncertain").length,
  };
  const divideBySamples = (value: number) => (rows.length > 0 ? value / rows.length : null);
  return {
    samples: rows.length,
    predictions,
    rates: {
      ai: divideBySamples(predictions.ai),
      human: divideBySamples(predictions.human),
      inconclusive: divideBySamples(predictions.inconclusive),
    },
  };
}

export function computeClassificationMetrics(rows: readonly BenchmarkMetricRow[]) {
  const aiSamples = rows.filter((row) => row.label === "ai").length;
  const humanSamples = rows.length - aiSamples;
  const truePositive = rows.filter((row) => row.label === "ai" && row.prediction === "ai").length;
  const trueNegative = rows.filter(
    (row) => row.label === "human" && row.prediction === "human",
  ).length;
  const falsePositive = rows.filter(
    (row) => row.label === "human" && row.prediction === "ai",
  ).length;
  const falseNegative = rows.filter(
    (row) => row.label === "ai" && row.prediction === "human",
  ).length;
  const inconclusive = rows.filter((row) => row.prediction === "uncertain").length;
  const covered = rows.length - inconclusive;
  const precision = divide(truePositive, truePositive + falsePositive);
  const recall = divide(truePositive, aiSamples);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  const dependenceAudit = computeDependenceAudit(rows);

  return {
    samples: rows.length,
    aiSamples,
    humanSamples,
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,
    inconclusive,
    accuracy: divide(truePositive + trueNegative, rows.length),
    falsePositiveRate: divide(falsePositive, humanSamples),
    truePositiveRate: recall,
    precision,
    recall,
    f1,
    coverage: divide(covered, rows.length),
    selectiveAccuracy: divide(truePositive + trueNegative, covered),
    inconclusiveRate: divide(inconclusive, rows.length),
    dependenceAudit,
    confidenceIntervals95: {
      method: "Wilson score (row-level; see dependenceAudit before inferential use)",
      falsePositiveRate: wilsonConfidenceInterval(falsePositive, humanSamples),
      truePositiveRate: wilsonConfidenceInterval(truePositive, aiSamples),
      coverage: wilsonConfidenceInterval(covered, rows.length),
    },
  };
}
