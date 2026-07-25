export type BenchmarkGroundTruth = "ai" | "human";
export type BenchmarkPrediction = BenchmarkGroundTruth | "uncertain";

export interface BenchmarkMetricRow {
  readonly label: BenchmarkGroundTruth;
  readonly prediction: BenchmarkPrediction;
}

export interface WeightedScoreRegion {
  readonly start: number;
  readonly end: number;
  readonly score?: number;
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

function divide(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
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
  };
}
