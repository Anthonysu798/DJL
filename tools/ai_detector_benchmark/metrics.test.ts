import { describe, expect, it } from "vitest";

import { computeClassificationMetrics, weightedMeanRegionScore } from "./metrics";

describe("AI detector benchmark metrics", () => {
  it("weights raw detector scores by unique region length", () => {
    expect(
      weightedMeanRegionScore([
        { start: 0, end: 25, score: 0.2 },
        { start: 25, end: 100, score: 0.8 },
        { start: 100, end: 110 },
      ]),
    ).toBeCloseTo(0.65, 12);
    expect(weightedMeanRegionScore([{ start: 0, end: 10 }])).toBeNull();
  });

  it("reports conservative classification and false-positive metrics", () => {
    const metrics = computeClassificationMetrics([
      { label: "ai", prediction: "ai" },
      { label: "ai", prediction: "human" },
      { label: "ai", prediction: "uncertain" },
      { label: "human", prediction: "human" },
      { label: "human", prediction: "ai" },
      { label: "human", prediction: "uncertain" },
    ]);

    expect(metrics).toEqual({
      samples: 6,
      aiSamples: 3,
      humanSamples: 3,
      truePositive: 1,
      trueNegative: 1,
      falsePositive: 1,
      falseNegative: 1,
      inconclusive: 2,
      accuracy: 1 / 3,
      falsePositiveRate: 1 / 3,
      truePositiveRate: 1 / 3,
      precision: 1 / 2,
      recall: 1 / 3,
      f1: 0.4,
      coverage: 2 / 3,
      selectiveAccuracy: 1 / 2,
      inconclusiveRate: 1 / 3,
    });
  });

  it("uses null for metrics with no valid denominator", () => {
    expect(computeClassificationMetrics([])).toMatchObject({
      accuracy: null,
      falsePositiveRate: null,
      truePositiveRate: null,
      precision: null,
      recall: null,
      f1: null,
      coverage: null,
      selectiveAccuracy: null,
      inconclusiveRate: null,
    });
  });
});
