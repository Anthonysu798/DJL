// FILE: aiDetector.ts
// Purpose: Schema-only contracts for DJL's local AI Writing Check.

import { Schema } from "effect";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

const BoundedMessage = Schema.String.check(Schema.isMaxLength(2_000));
const BoundedVersion = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const Probability = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const Percentage = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

export const AiDetectorLanguagePreference = Schema.Literals(["auto", "en", "zh-Hans"]);
export type AiDetectorLanguagePreference = typeof AiDetectorLanguagePreference.Type;

export const AiDetectorLanguage = Schema.Literals(["en", "zh-Hans", "unsupported"]);
export type AiDetectorLanguage = typeof AiDetectorLanguage.Type;

export const AiDetectorRegionLabel = Schema.Literals([
  "likely-ai",
  "uncertain",
  "likely-human",
  "excluded",
]);
export type AiDetectorRegionLabel = typeof AiDetectorRegionLabel.Type;

export const AiDetectorModelState = Schema.Literals([
  "not-installed",
  "downloading",
  "verifying",
  "ready",
  "error",
]);
export type AiDetectorModelState = typeof AiDetectorModelState.Type;

export const AiDetectorModelStatus = Schema.Struct({
  language: Schema.Literals(["en", "zh-Hans"]),
  displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  state: AiDetectorModelState,
  revision: BoundedVersion,
  license: BoundedVersion,
  sizeBytes: NonNegativeInt,
  downloadedBytes: NonNegativeInt,
  error: Schema.NullOr(BoundedMessage),
});
export type AiDetectorModelStatus = typeof AiDetectorModelStatus.Type;

export const AiDetectorState = Schema.Struct({
  models: Schema.Array(AiDetectorModelStatus).check(Schema.isMaxLength(2)),
  cacheEntries: NonNegativeInt,
  cacheBytes: NonNegativeInt,
});
export type AiDetectorState = typeof AiDetectorState.Type;

export const AiDetectorInstallModelInput = Schema.Struct({
  language: Schema.Literals(["en", "zh-Hans"]),
});
export type AiDetectorInstallModelInput = typeof AiDetectorInstallModelInput.Type;

export const AiDetectorRemoveModelInput = AiDetectorInstallModelInput;
export type AiDetectorRemoveModelInput = typeof AiDetectorRemoveModelInput.Type;

export const AiDetectorCancelInstallInput = AiDetectorInstallModelInput;
export type AiDetectorCancelInstallInput = typeof AiDetectorCancelInstallInput.Type;

export const AiDetectorRegion = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
  label: AiDetectorRegionLabel,
  language: AiDetectorLanguage,
  score: Schema.optional(Probability),
  reason: Schema.optional(BoundedMessage),
});
export type AiDetectorRegion = typeof AiDetectorRegion.Type;

export const AiDetectorModelRun = Schema.Struct({
  language: Schema.Literals(["en", "zh-Hans"]),
  model: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  revision: BoundedVersion,
  modelSha256: Sha256,
  calibrationVersion: BoundedVersion,
  passages: NonNegativeInt,
});
export type AiDetectorModelRun = typeof AiDetectorModelRun.Type;

export const AiDetectorScoreSummary = Schema.Struct({
  likelyAi: Percentage,
  uncertain: Percentage,
  likelyHuman: Percentage,
});
export type AiDetectorScoreSummary = typeof AiDetectorScoreSummary.Type;

export const AiDetectorReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  normalizedText: Schema.String.check(Schema.isMaxLength(500_000)),
  languagePreference: AiDetectorLanguagePreference,
  scores: AiDetectorScoreSummary,
  assessment: Schema.Literals([
    "likely-ai",
    "mixed",
    "likely-human",
    "inconclusive",
    "insufficient",
    "unsupported",
  ]),
  confidence: Schema.Literals(["low", "medium", "high"]),
  eligibleCharacters: NonNegativeInt,
  excludedCharacters: NonNegativeInt,
  totalCharacters: NonNegativeInt,
  regions: Schema.Array(AiDetectorRegion).check(Schema.isMaxLength(20_000)),
  modelRuns: Schema.Array(AiDetectorModelRun).check(Schema.isMaxLength(2)),
  preprocessingVersion: BoundedVersion,
  segmentationVersion: BoundedVersion,
  contentHash: Sha256,
  cacheHit: Schema.Boolean,
  warnings: Schema.Array(BoundedMessage).check(Schema.isMaxLength(32)),
});
export type AiDetectorReport = typeof AiDetectorReport.Type;

export const AiDetectorStage = Schema.Literals([
  "extracting",
  "normalizing",
  "routing",
  "scoring",
  "aggregating",
  "complete",
]);
export type AiDetectorStage = typeof AiDetectorStage.Type;

export const AiDetectorErrorCode = Schema.Literals([
  "invalid-input",
  "unsupported-format",
  "unsafe-document",
  "ocr-required",
  "model-not-installed",
  "model-install-failed",
  "local-only",
  "analysis-failed",
  "cancelled",
]);
export type AiDetectorErrorCode = typeof AiDetectorErrorCode.Type;

export const AiDetectorAnalysisEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("progress"),
    stage: AiDetectorStage,
    completed: NonNegativeInt,
    total: NonNegativeInt,
  }),
  Schema.Struct({ type: Schema.Literal("result"), report: AiDetectorReport }),
  Schema.Struct({
    type: Schema.Literal("error"),
    code: AiDetectorErrorCode,
    message: BoundedMessage,
  }),
]);
export type AiDetectorAnalysisEvent = typeof AiDetectorAnalysisEvent.Type;

export const AiDetectorEvent = Schema.Struct({
  type: Schema.Literal("state.updated"),
  state: AiDetectorState,
});
export type AiDetectorEvent = typeof AiDetectorEvent.Type;
