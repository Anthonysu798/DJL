import { describe, expect, it } from "vitest";

import {
  computeClassificationMetrics,
  computeFixedAiThresholdMetrics,
  computeFixedSelectivePolicyMetrics,
  computeOutcomeDistribution,
  computeScoreMetrics,
  fixedSelectivePolicyPrediction,
  weightedMeanRegionScore,
  weightedQuantileRegionScore,
  wilsonConfidenceInterval,
} from "./metrics";

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

  it("computes the weighted evidence quantile used by the document decision", () => {
    const regions = [
      { start: 0, end: 25, score: 0.2 },
      { start: 25, end: 100, score: 0.8 },
      { start: 100, end: 110 },
    ];

    expect(weightedQuantileRegionScore(regions, 0.35)).toBe(0.8);
    expect(weightedQuantileRegionScore(regions, 0.65)).toBe(0.8);
    expect(
      weightedQuantileRegionScore(
        [
          { start: 0, end: 35, score: 0.2 },
          { start: 35, end: 100, score: 0.8 },
        ],
        0.35,
      ),
    ).toBe(0.8);
    expect(weightedQuantileRegionScore([{ start: 0, end: 10 }], 0.35)).toBeNull();
    expect(() => weightedQuantileRegionScore(regions, 1.1)).toThrow(/between 0 and 1/);
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

    expect(metrics).toMatchObject({
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
    expect(metrics.confidenceIntervals95.falsePositiveRate?.lower).toBeCloseTo(0.06149, 5);
    expect(metrics.confidenceIntervals95.falsePositiveRate?.upper).toBeCloseTo(0.79234, 5);
    expect(metrics.confidenceIntervals95.truePositiveRate).toEqual(
      metrics.confidenceIntervals95.falsePositiveRate,
    );
    expect(metrics.confidenceIntervals95.coverage?.lower).toBeCloseTo(0.29999, 5);
    expect(metrics.confidenceIntervals95.coverage?.upper).toBeCloseTo(0.90323, 5);
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
      confidenceIntervals95: {
        falsePositiveRate: null,
        truePositiveRate: null,
        coverage: null,
      },
    });
  });

  it("computes Wilson 95% confidence intervals and rejects invalid counts", () => {
    expect(wilsonConfidenceInterval(0, 100)?.lower).toBe(0);
    expect(wilsonConfidenceInterval(0, 100)?.upper).toBeCloseTo(0.03699, 5);
    expect(wilsonConfidenceInterval(100, 100)?.lower).toBeCloseTo(0.96301, 5);
    expect(wilsonConfidenceInterval(101, 100)).toBeNull();
    expect(wilsonConfidenceInterval(0, 0)).toBeNull();
  });

  it("reports AI-refined outcomes without forcing them into binary accuracy", () => {
    expect(
      computeOutcomeDistribution([
        { label: "ai-refined", prediction: "ai" },
        { label: "ai-refined", prediction: "uncertain" },
        { label: "ai-refined", prediction: "human" },
        { label: "ai-refined", prediction: "uncertain" },
      ]),
    ).toEqual({
      samples: 4,
      predictions: { ai: 1, human: 1, inconclusive: 2 },
      rates: { ai: 0.25, human: 0.25, inconclusive: 0.5 },
    });
    expect(computeOutcomeDistribution([]).rates).toEqual({
      ai: null,
      human: null,
      inconclusive: null,
    });
  });

  it("evaluates a frozen AI threshold without searching the tested split", () => {
    const metrics = computeFixedAiThresholdMetrics(
      [
        { label: "human", score: 0.1, splitRole: "locked", eligibleCharacters: 700 },
        { label: "human", score: 0.8, splitRole: "locked", eligibleCharacters: 700 },
        { label: "ai", score: 0.8, splitRole: "locked", eligibleCharacters: 500 },
        { label: "ai", score: 0.9, splitRole: "locked", eligibleCharacters: 700 },
        { label: "ai", score: null, splitRole: "locked", eligibleCharacters: 700 },
      ],
      0.8,
      600,
    );

    expect(metrics).toMatchObject({
      threshold: 0.8,
      minimumEligibleCharacters: 600,
      samples: 5,
      excludedScores: 1,
      belowMinimumSamples: 1,
      aiSamples: 3,
      humanSamples: 2,
      truePositives: 1,
      falsePositives: 1,
      truePositiveRate: 1 / 3,
      falsePositiveRate: 0.5,
    });
    expect(metrics.confidenceIntervals95.truePositiveRate?.lower).toBeGreaterThan(0);
    expect(() => computeFixedAiThresholdMetrics([], 1.1)).toThrow(/between 0 and 1/);
    expect(() => computeFixedAiThresholdMetrics([{ label: "ai", score: 0.9 }], 0.8, 600)).toThrow(
      /eligible characters/,
    );
  });

  it("evaluates a frozen three-outcome policy without fitting the tested split", () => {
    const metrics = computeFixedSelectivePolicyMetrics(
      [
        {
          label: "human",
          regions: [{ start: 0, end: 500, score: 0.99 }],
          eligibleCharacters: 500,
        },
        {
          label: "human",
          regions: [{ start: 0, end: 700, score: 0.1 }],
          eligibleCharacters: 700,
        },
        {
          label: "ai",
          regions: [{ start: 0, end: 700, score: 0.99 }],
          eligibleCharacters: 700,
        },
        {
          label: "ai",
          regions: [{ start: 0, end: 700, score: 0.5 }],
          eligibleCharacters: 700,
        },
      ],
      {
        humanThreshold: 0.2,
        aiThreshold: 0.98,
        minimumEligibleCharacters: 120,
        minimumAiEligibleCharacters: 600,
      },
    );

    expect(metrics).toMatchObject({
      policy: {
        humanThreshold: 0.2,
        aiThreshold: 0.98,
        minimumEligibleCharacters: 120,
        minimumAiEligibleCharacters: 600,
      },
      samples: 4,
      truePositive: 1,
      trueNegative: 1,
      falsePositive: 0,
      falseNegative: 0,
      inconclusive: 2,
      coverage: 0.5,
      selectiveAccuracy: 1,
    });
    expect(() =>
      computeFixedSelectivePolicyMetrics([], {
        humanThreshold: 0.9,
        aiThreshold: 0.8,
        minimumEligibleCharacters: 120,
        minimumAiEligibleCharacters: 0,
      }),
    ).toThrow(/human < AI/);
    expect(
      fixedSelectivePolicyPrediction(
        {
          regions: [
            { start: 0, end: 400, score: 0.99 },
            { start: 400, end: 500, score: 0.01 },
          ],
          eligibleCharacters: 500,
        },
        {
          humanThreshold: 0.02,
          aiThreshold: 0.98,
          minimumEligibleCharacters: 120,
          minimumAiEligibleCharacters: 600,
        },
      ),
    ).toBe("uncertain");
    expect(
      fixedSelectivePolicyPrediction(
        {
          regions: [{ start: 0, end: 119, score: 0.01 }],
          eligibleCharacters: 119,
        },
        {
          humanThreshold: 0.02,
          aiThreshold: 0.98,
          minimumEligibleCharacters: 120,
          minimumAiEligibleCharacters: 600,
        },
      ),
    ).toBe("uncertain");
  });

  it("uses production character aggregation and largest-remainder rounding for fixed policies", () => {
    const policy = {
      humanThreshold: 0.2,
      aiThreshold: 0.98,
      minimumEligibleCharacters: 120,
      minimumAiEligibleCharacters: 600,
    };

    expect(
      fixedSelectivePolicyPrediction(
        {
          regions: [
            { start: 0, end: 650, score: 0.1 },
            { start: 650, end: 1_000, score: 0.5 },
          ],
          eligibleCharacters: 1_000,
        },
        policy,
      ),
    ).toBe("human");
    expect(
      fixedSelectivePolicyPrediction(
        {
          regions: [
            { start: 0, end: 646, score: 0.1 },
            { start: 646, end: 1_000, score: 0.5 },
          ],
          eligibleCharacters: 1_000,
        },
        policy,
      ),
    ).toBe("human");
    expect(() =>
      fixedSelectivePolicyPrediction(
        {
          regions: [{ start: 0, end: 699, score: 0.1 }],
          eligibleCharacters: 700,
        },
        policy,
      ),
    ).toThrow(/cover 699 characters, expected 700/);
  });

  it("rejects malformed selective-policy region geometry before counting evidence", () => {
    const policy = {
      humanThreshold: 0.2,
      aiThreshold: 0.98,
      minimumEligibleCharacters: 120,
      minimumAiEligibleCharacters: 600,
    };

    expect(() =>
      fixedSelectivePolicyPrediction(
        {
          regions: [
            { start: 0, end: 400, score: 0.1 },
            { start: 300, end: 600, score: 0.1 },
          ],
          eligibleCharacters: 700,
        },
        policy,
      ),
    ).toThrow(/sorted and non-overlapping/);
    expect(() =>
      fixedSelectivePolicyPrediction(
        {
          regions: [{ start: 100, end: 50, score: 0.1 }],
          eligibleCharacters: 0,
        },
        policy,
      ),
    ).toThrow(/increasing safe-integer boundaries/);
    expect(() =>
      fixedSelectivePolicyPrediction(
        {
          regions: [
            { start: 400, end: 700, score: 0.1 },
            { start: 0, end: 400, score: 0.1 },
          ],
          eligibleCharacters: 700,
        },
        policy,
      ),
    ).toThrow(/sorted and non-overlapping/);
  });

  it("rejects invalid selective-policy coordinates, scores, and labels", () => {
    const policy = {
      humanThreshold: 0.2,
      aiThreshold: 0.98,
      minimumEligibleCharacters: 0,
      minimumAiEligibleCharacters: 0,
    };

    expect(() =>
      fixedSelectivePolicyPrediction(
        {
          regions: [{ start: -1, end: 9, score: 0.1 }],
          eligibleCharacters: 10,
        },
        policy,
      ),
    ).toThrow(/safe-integer boundaries/);
    expect(() =>
      fixedSelectivePolicyPrediction(
        {
          regions: [{ start: 0, end: 10.5, score: 0.1 }],
          eligibleCharacters: 10,
        },
        policy,
      ),
    ).toThrow(/safe-integer boundaries/);
    expect(() =>
      fixedSelectivePolicyPrediction(
        {
          regions: [{ start: 0, end: 10 }],
          eligibleCharacters: 10,
        },
        policy,
      ),
    ).toThrow(/finite score between 0 and 1/);
    expect(() =>
      computeFixedSelectivePolicyMetrics(
        [
          {
            label: "other" as "ai",
            regions: [{ start: 0, end: 10, score: 0.1 }],
            eligibleCharacters: 10,
          },
        ],
        policy,
      ),
    ).toThrow(/AI or human ground-truth label/);
  });

  it("reports score separation, calibration, and low false-positive operating points", () => {
    const metrics = computeScoreMetrics([
      { label: "human", score: 0.1 },
      { label: "human", score: 0.2 },
      { label: "ai", score: 0.8 },
      { label: "ai", score: 0.9 },
      { label: "ai", score: null },
    ]);

    expect(metrics).toMatchObject({
      samples: 4,
      excludedScores: 1,
      aiSamples: 2,
      humanSamples: 2,
      auroc: 1,
      averagePrecision: 1,
      scoreDistribution: {
        ai: { minimum: 0.8, median: 0.8, maximum: 0.9 },
        human: { minimum: 0.1, median: 0.1, maximum: 0.2 },
      },
    });
    expect(metrics.brierScore).toBeCloseTo(0.025, 12);
    expect(metrics.operatingPointSearch.mode).toBe("descriptive-only");
    expect(metrics.operatingPoints).toMatchObject([
      {
        targetFalsePositiveRate: 0.001,
        threshold: 0.8,
        falsePositiveRate: 0,
        truePositiveRate: 1,
        falsePositives: 0,
        truePositives: 2,
        targetSupportedAt95Confidence: false,
        evidenceStatus: "independence-not-established",
      },
      {
        targetFalsePositiveRate: 0.01,
        threshold: 0.8,
        falsePositiveRate: 0,
        truePositiveRate: 1,
        falsePositives: 0,
        truePositives: 2,
        targetSupportedAt95Confidence: false,
      },
      {
        targetFalsePositiveRate: 0.05,
        threshold: 0.8,
        falsePositiveRate: 0,
        truePositiveRate: 1,
        falsePositives: 0,
        truePositives: 2,
        targetSupportedAt95Confidence: false,
      },
    ]);
  });

  it("does not report probability calibration for a ranking-only score", () => {
    const metrics = computeScoreMetrics(
      [
        { label: "human", score: 0.1 },
        { label: "ai", score: 0.9 },
      ],
      { probabilitySemantics: false },
    );

    expect(metrics).toMatchObject({
      scoreSemantics: "ranking-statistic",
      auroc: 1,
      averagePrecision: 1,
      brierScore: null,
      expectedCalibrationError: null,
      calibrationBins: [],
      probabilityMetrics: {
        available: false,
      },
    });
  });

  it("supports a low-FPR target only when the confidence interval also clears it", () => {
    const metrics = computeScoreMetrics([
      ...Array.from({ length: 4_000 }, (_, index) => ({
        label: "human" as const,
        score: 0.1,
        authorId: `human-${index}`,
        sourceGroupId: `human-source-${index}`,
      })),
      { label: "ai", score: 0.9, sourceGroupId: "ai-source-1" },
    ]);

    expect(metrics.operatingPoints[0]).toMatchObject({
      targetFalsePositiveRate: 0.001,
      falsePositives: 0,
      targetSupportedAt95Confidence: true,
      evidenceStatus: "supported-at-95-confidence",
    });
  });

  it("does not promote a row-level interval when human prompts repeat across unique authors", () => {
    const metrics = computeScoreMetrics([
      ...Array.from({ length: 4_000 }, (_, index) => ({
        label: "human" as const,
        score: 0.1,
        authorId: `author-${index}`,
        sourceGroupId: "shared-human-prompt",
      })),
      { label: "ai", score: 0.9, sourceGroupId: "ai-prompt-1" },
    ]);

    expect(metrics.dependenceAudit).toMatchObject({
      human: {
        authors: { uniqueUnits: 4_000, rowIndependent: true },
        sourceGroups: { uniqueUnits: 1, repeatedUnits: 1, rowIndependent: false },
      },
      ai: {
        sourceGroups: { uniqueUnits: 1, repeatedUnits: 0, rowIndependent: true },
      },
      formalInference: {
        falsePositiveRateSupported: false,
        truePositiveRateSupported: true,
        rowLevelWilsonReleaseSupported: false,
      },
    });
    expect(metrics.operatingPoints[0]).toMatchObject({
      falsePositiveRate: 0,
      targetSupportedAt95Confidence: false,
      evidenceStatus: "independence-not-established",
    });
  });

  it("does not promote an operating point when AI rows repeat one prompt", () => {
    const metrics = computeScoreMetrics([
      ...Array.from({ length: 4_000 }, (_, index) => ({
        label: "human" as const,
        score: 0.1,
        authorId: `author-${index}`,
        sourceGroupId: `human-prompt-${index}`,
      })),
      { label: "ai", score: 0.9, sourceGroupId: "shared-ai-prompt" },
      { label: "ai", score: 0.8, sourceGroupId: "shared-ai-prompt" },
    ]);

    expect(metrics.dependenceAudit.formalInference).toMatchObject({
      falsePositiveRateSupported: true,
      truePositiveRateSupported: false,
      rowLevelWilsonReleaseSupported: false,
    });
    expect(metrics.operatingPoints[0]).toMatchObject({
      falsePositiveRate: 0,
      truePositiveRate: 1,
      targetSupportedAt95Confidence: false,
      evidenceStatus: "independence-not-established",
    });
  });

  it("handles tied scores without overstating AUROC or average precision", () => {
    const metrics = computeScoreMetrics([
      { label: "human", score: 0.5 },
      { label: "ai", score: 0.5 },
    ]);

    expect(metrics.auroc).toBe(0.5);
    expect(metrics.averagePrecision).toBe(0.5);
    expect(metrics.operatingPoints[1]).toMatchObject({
      threshold: null,
      falsePositiveRate: 0,
      truePositiveRate: 0,
    });
  });

  it("does not claim support when no observed threshold satisfies the FPR target", () => {
    const metrics = computeScoreMetrics([
      ...Array.from({ length: 400 }, () => ({ label: "human" as const, score: 1 })),
      { label: "ai", score: 0.5 },
    ]);

    expect(metrics.operatingPoints[1]).toMatchObject({
      targetFalsePositiveRate: 0.01,
      threshold: null,
      targetSupportedAt95Confidence: false,
    });
  });

  it("never searches operating-point thresholds on a locked split", () => {
    const metrics = computeScoreMetrics([
      { label: "human", score: 0.1, splitRole: "locked" },
      { label: "ai", score: 0.9, splitRole: "locked" },
    ]);

    expect(metrics).toMatchObject({
      samples: 2,
      auroc: 1,
      operatingPointSearch: {
        mode: "disabled-locked",
      },
      operatingPoints: [],
    });
  });
});
