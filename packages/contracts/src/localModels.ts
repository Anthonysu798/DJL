// FILE: localModels.ts
// Purpose: Schema-only contracts for desktop local-model runtimes and install jobs.

import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const BoundedDetail = Schema.String.check(Schema.isMaxLength(2_000));
const BoundedUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));
const ModelIdentifier = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));

export const LocalModelRuntime = Schema.Literals(["ollama", "lmstudio"]);
export type LocalModelRuntime = typeof LocalModelRuntime.Type;

export const LocalModelRuntimeState = Schema.Literals([
  "not_installed",
  "stopped",
  "running",
  "update_required",
  "error",
]);
export type LocalModelRuntimeState = typeof LocalModelRuntimeState.Type;

export const LocalModelRuntimeCapabilities = Schema.Struct({
  canStart: Schema.Boolean,
  canInstallModels: Schema.Boolean,
  canCancelInstall: Schema.Boolean,
  canDeleteModels: Schema.Boolean,
});
export type LocalModelRuntimeCapabilities = typeof LocalModelRuntimeCapabilities.Type;

export const LocalModelRuntimeInstallationKind = Schema.Literals([
  "managed",
  "external",
  "service_only",
]);
export type LocalModelRuntimeInstallationKind = typeof LocalModelRuntimeInstallationKind.Type;

export const LocalModelRuntimeStatus = Schema.Struct({
  runtime: LocalModelRuntime,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  state: LocalModelRuntimeState,
  version: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  endpoint: BoundedUrl,
  installerUrl: BoundedUrl,
  installationKind: Schema.NullOr(LocalModelRuntimeInstallationKind),
  estimatedDownloadBytes: NonNegativeInt,
  detail: Schema.NullOr(BoundedDetail),
  capabilities: LocalModelRuntimeCapabilities,
});
export type LocalModelRuntimeStatus = typeof LocalModelRuntimeStatus.Type;

export const LocalModelRecommendationSource = Schema.Struct({
  runtime: LocalModelRuntime,
  modelId: ModelIdentifier,
  estimatedDownloadBytes: NonNegativeInt,
  quantization: Schema.optional(
    TrimmedNonEmptyString.check(
      Schema.isMaxLength(64),
      Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    ),
  ),
});
export type LocalModelRecommendationSource = typeof LocalModelRecommendationSource.Type;

export const LocalModelRecommendation = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  description: BoundedDetail,
  minimumMemoryBytes: NonNegativeInt,
  sources: Schema.Array(LocalModelRecommendationSource).check(Schema.isMaxLength(2)),
});
export type LocalModelRecommendation = typeof LocalModelRecommendation.Type;

export const LocalInstalledModel = Schema.Struct({
  runtime: LocalModelRuntime,
  modelId: ModelIdentifier,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  sizeBytes: NonNegativeInt,
  contextWindowTokens: Schema.NullOr(PositiveInt),
  supportsToolCalls: Schema.NullOr(Schema.Boolean),
});
export type LocalInstalledModel = typeof LocalInstalledModel.Type;

export const LocalModelInstallJobState = Schema.Literals([
  "queued",
  "downloading",
  "completed",
  "failed",
  "cancelled",
]);
export type LocalModelInstallJobState = typeof LocalModelInstallJobState.Type;

export const LocalModelInstallJob = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  runtime: LocalModelRuntime,
  modelId: ModelIdentifier,
  state: LocalModelInstallJobState,
  downloadedBytes: NonNegativeInt,
  totalBytes: Schema.NullOr(NonNegativeInt),
  bytesPerSecond: Schema.NullOr(NonNegativeInt),
  message: Schema.NullOr(BoundedDetail),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type LocalModelInstallJob = typeof LocalModelInstallJob.Type;

export const LocalModelRuntimeInstallJobState = Schema.Literals([
  "downloading",
  "verifying",
  "installing",
  "starting",
  "completed",
  "failed",
]);
export type LocalModelRuntimeInstallJobState = typeof LocalModelRuntimeInstallJobState.Type;

export const LocalModelRuntimeInstallJob = Schema.Struct({
  runtime: LocalModelRuntime,
  state: LocalModelRuntimeInstallJobState,
  downloadedBytes: NonNegativeInt,
  totalBytes: Schema.NullOr(NonNegativeInt),
  message: Schema.NullOr(BoundedDetail),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type LocalModelRuntimeInstallJob = typeof LocalModelRuntimeInstallJob.Type;

export const LocalModelSetupJobState = Schema.Literals([
  "detecting",
  "installing_runtime",
  "starting_runtime",
  "downloading_model",
  "synchronizing",
  "ready",
  "failed",
  "cancelled",
]);
export type LocalModelSetupJobState = typeof LocalModelSetupJobState.Type;

export const LocalModelSetupJob = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  runtime: LocalModelRuntime,
  recommendationId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  modelId: ModelIdentifier,
  state: LocalModelSetupJobState,
  downloadedBytes: NonNegativeInt,
  totalBytes: Schema.NullOr(NonNegativeInt),
  message: Schema.NullOr(BoundedDetail),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type LocalModelSetupJob = typeof LocalModelSetupJob.Type;

export const LocalModelsSnapshot = Schema.Struct({
  totalMemoryBytes: NonNegativeInt,
  freeDiskBytes: Schema.NullOr(NonNegativeInt),
  recommendedModelId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  runtimes: Schema.Array(LocalModelRuntimeStatus).check(Schema.isMaxLength(2)),
  recommendations: Schema.Array(LocalModelRecommendation).check(Schema.isMaxLength(16)),
  installedModels: Schema.Array(LocalInstalledModel).check(Schema.isMaxLength(1_024)),
  runtimeInstallJobs: Schema.Array(LocalModelRuntimeInstallJob).check(Schema.isMaxLength(2)),
  installJobs: Schema.Array(LocalModelInstallJob).check(Schema.isMaxLength(32)),
  setupJobs: Schema.Array(LocalModelSetupJob).check(Schema.isMaxLength(8)),
});
export type LocalModelsSnapshot = typeof LocalModelsSnapshot.Type;

export const LocalModelRuntimeInput = Schema.Struct({ runtime: LocalModelRuntime });
export type LocalModelRuntimeInput = typeof LocalModelRuntimeInput.Type;

export const LocalModelSetupInput = Schema.Struct({
  runtime: Schema.optional(LocalModelRuntime),
  recommendationId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export type LocalModelSetupInput = typeof LocalModelSetupInput.Type;

export const LocalModelSetupJobInput = Schema.Struct({
  jobId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type LocalModelSetupJobInput = typeof LocalModelSetupJobInput.Type;

const OllamaModelId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(256),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/),
);
const LmStudioCatalogModelId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._/-]*$/),
);
const HuggingFaceModelUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(2_048),
  Schema.isPattern(/^https:\/\/huggingface\.co\/[A-Za-z0-9][A-Za-z0-9._/-]*$/),
);
const LmStudioQuantization = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
);

export const OllamaLocalModelInstallInput = Schema.Struct({
  runtime: Schema.Literal("ollama"),
  modelId: OllamaModelId,
});
export const LmStudioLocalModelInstallInput = Schema.Struct({
  runtime: Schema.Literal("lmstudio"),
  modelId: Schema.Union([LmStudioCatalogModelId, HuggingFaceModelUrl]),
  quantization: Schema.optional(LmStudioQuantization),
});
export const LocalModelInstallInput = Schema.Union([
  OllamaLocalModelInstallInput,
  LmStudioLocalModelInstallInput,
]);
export type LocalModelInstallInput = typeof LocalModelInstallInput.Type;

export const LocalModelCancelInstallInput = Schema.Struct({
  jobId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type LocalModelCancelInstallInput = typeof LocalModelCancelInstallInput.Type;

export const OllamaLocalModelRemoveInput = Schema.Struct({
  runtime: Schema.Literal("ollama"),
  modelId: OllamaModelId,
});
export const LmStudioLocalModelRemoveInput = Schema.Struct({
  runtime: Schema.Literal("lmstudio"),
  modelId: ModelIdentifier,
});
export const LocalModelRemoveInput = Schema.Union([
  OllamaLocalModelRemoveInput,
  LmStudioLocalModelRemoveInput,
]);
export type LocalModelRemoveInput = typeof LocalModelRemoveInput.Type;

export const LocalModelEvent = Schema.Struct({
  type: Schema.Literal("snapshot.updated"),
  snapshot: LocalModelsSnapshot,
});
export type LocalModelEvent = typeof LocalModelEvent.Type;
