import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AiDetectorAnalysisEvent, AiDetectorReport } from "./aiDetector";

const report = {
  schemaVersion: 1 as const,
  normalizedText: "A sufficiently long sample document.",
  languagePreference: "auto" as const,
  scores: { likelyAi: 25, uncertain: 50, likelyHuman: 25 },
  assessment: "mixed" as const,
  confidence: "low" as const,
  eligibleCharacters: 36,
  excludedCharacters: 0,
  totalCharacters: 36,
  regions: [
    { start: 0, end: 36, label: "uncertain" as const, language: "en" as const, score: 0.5 },
  ],
  modelRuns: [],
  preprocessingVersion: "djl-prose-v1",
  segmentationVersion: "djl-passages-v1",
  contentHash: "a".repeat(64),
  cacheHit: false,
  warnings: [],
};

describe("AI detector contracts", () => {
  it("decodes a complete report and terminal event", () => {
    expect(Schema.decodeUnknownSync(AiDetectorReport)(report)).toEqual(report);
    expect(Schema.decodeUnknownSync(AiDetectorAnalysisEvent)({ type: "result", report })).toEqual({
      type: "result",
      report,
    });
  });

  it("rejects invalid percentages and offsets", () => {
    expect(() =>
      Schema.decodeUnknownSync(AiDetectorReport)({
        ...report,
        scores: { ...report.scores, likelyAi: 101 },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AiDetectorReport)({
        ...report,
        regions: [{ ...report.regions[0], start: -1 }],
      }),
    ).toThrow();
  });
});
