// FILE: localModels.ts
// Purpose: Schema-only contracts for desktop local-model runtimes and install jobs.

import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const BoundedDetail = Schema.String.check(Schema.isMaxLength(2_000));
const BoundedUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));
const ModelIdentifier = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));

export const LocalModelRuntime = Schema.Literals(["ollama", "lmstudio"]);
export type LocalModelRuntime = typeof LocalModelRuntime.Type;

export const LocalModelUseCase = Schema.Literals(["general", "document", "reasoning", "coding"]);
export type LocalModelUseCase = typeof LocalModelUseCase.Type;

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

export const LocalHardwareAcceleration = Schema.Literals([
  "apple_unified",
  "discrete_gpu",
  "cpu_only",
]);
export type LocalHardwareAcceleration = typeof LocalHardwareAcceleration.Type;

export const LocalHardwareProfile = Schema.Struct({
  totalMemoryBytes: NonNegativeInt,
  cpuModel: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  cpuCores: NonNegativeInt,
  acceleration: LocalHardwareAcceleration,
  gpuName: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  vramBytes: Schema.NullOr(NonNegativeInt),
  // The byte budget for model weights on this machine, after acceleration and context headroom.
  usableModelBytes: NonNegativeInt,
});
export type LocalHardwareProfile = typeof LocalHardwareProfile.Type;

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
  // Established by running real tool calls against the tier, not inferred from parameter count.
  supportsToolCalls: Schema.Boolean,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  description: BoundedDetail,
  minimumMemoryBytes: NonNegativeInt,
  sources: Schema.Array(LocalModelRecommendationSource).check(Schema.isMaxLength(2)),
});
export type LocalModelRecommendation = typeof LocalModelRecommendation.Type;

const OptionalRecommendationId = Schema.NullOr(
  TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
);

export const LocalModelRecommendationsByUseCase = Schema.Struct({
  general: OptionalRecommendationId,
  document: OptionalRecommendationId,
  reasoning: OptionalRecommendationId,
  coding: OptionalRecommendationId,
});
export type LocalModelRecommendationsByUseCase = typeof LocalModelRecommendationsByUseCase.Type;

export const LocalModelGpu = Schema.Struct({
  // A platform-stable identifier when the operating system exposes one (for example a DXGI LUID).
  id: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  dedicatedMemoryBytes: Schema.NullOr(NonNegativeInt),
  // Optional while older desktop snapshots age out. Null means the GPU cannot report live usage.
  availableMemoryBytes: Schema.optional(Schema.NullOr(NonNegativeInt)),
  // Unified/shared memory must never be added to system RAM a second time.
  memoryType: Schema.optional(Schema.Literals(["dedicated", "shared", "unified", "unknown"])),
  // False means the installed driver/runtime cannot use this accelerator for local inference.
  computeCompatible: Schema.optional(Schema.Boolean),
  // Compatible devices can only share a memory budget when they use the same compute backend.
  computeBackend: Schema.optional(Schema.Literals(["cuda", "vulkan", "metal", "unknown"])),
});
export type LocalModelGpu = typeof LocalModelGpu.Type;

export const LocalModelHardwareProfile = Schema.Struct({
  platform: TrimmedNonEmptyString.check(Schema.isMaxLength(32)),
  totalMemoryBytes: NonNegativeInt,
  availableMemoryBytes: NonNegativeInt,
  cpuLogicalCores: PositiveInt,
  // cpuArchitecture is the physical host architecture. processArchitecture differs under Rosetta.
  cpuArchitecture: TrimmedNonEmptyString.check(Schema.isMaxLength(32)),
  processArchitecture: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(32))),
  runningUnderTranslation: Schema.optional(Schema.Boolean),
  osVersion: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  gpus: Schema.Array(LocalModelGpu).check(Schema.isMaxLength(16)),
  freeDiskBytes: Schema.NullOr(NonNegativeInt),
});
export type LocalModelHardwareProfile = typeof LocalModelHardwareProfile.Type;

export const LocalModelCapabilityProfile = Schema.Struct({
  tier: Schema.Literals(["chat-only", "assisted", "agentic"]),
  runtimeDigest: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  probedAt: IsoDateTime,
  result: Schema.Literals(["passed", "failed", "unknown"]),
  failureReason: Schema.NullOr(BoundedDetail),
});
export type LocalModelCapabilityProfile = typeof LocalModelCapabilityProfile.Type;

export const LocalInstalledModel = Schema.Struct({
  runtime: LocalModelRuntime,
  modelId: ModelIdentifier,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  sizeBytes: NonNegativeInt,
  contextWindowTokens: Schema.NullOr(PositiveInt),
  maxContextWindowTokens: Schema.optional(Schema.NullOr(PositiveInt)),
  loadedContextWindowTokens: Schema.optional(Schema.NullOr(PositiveInt)),
  toolContextWindowReady: Schema.optional(Schema.NullOr(Schema.Boolean)),
  supportsToolCalls: Schema.NullOr(Schema.Boolean),
  capabilityProfile: Schema.optional(LocalModelCapabilityProfile),
  // Measured during setup on this machine; null until a warm-up run has timed the model.
  tokensPerSecond: Schema.optional(Schema.NullOr(NonNegativeInt)),
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
  "verifying",
  "synchronizing",
  "ready",
  "failed",
  "cancelled",
]);
export type LocalModelSetupJobState = typeof LocalModelSetupJobState.Type;

export const LocalModelSetupJob = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  runtime: LocalModelRuntime,
  // Optional while setup jobs created by older desktop builds age out.
  useCase: Schema.optional(LocalModelUseCase),
  recommendationId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  modelId: ModelIdentifier,
  state: LocalModelSetupJobState,
  downloadedBytes: NonNegativeInt,
  totalBytes: Schema.NullOr(NonNegativeInt),
  message: Schema.NullOr(BoundedDetail),
  // Measured on this machine during the verifying step; null when it could not be timed.
  tokensPerSecond: Schema.optional(Schema.NullOr(NonNegativeInt)),
  // Set when the measured speed was disappointing: the next smaller tier to offer instead.
  suggestedFallbackId: Schema.optional(
    Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  ),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type LocalModelSetupJob = typeof LocalModelSetupJob.Type;

export const LocalModelsSnapshot = Schema.Struct({
  totalMemoryBytes: NonNegativeInt,
  hardware: LocalHardwareProfile,
  freeDiskBytes: Schema.NullOr(NonNegativeInt),
  // Optional while v1 browser and desktop caches age out. New server snapshots always include it.
  hardwareProfile: Schema.optional(LocalModelHardwareProfile),
  recommendedModelId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  // Optional while v1 browser and desktop caches age out. The legacy recommendation stays general.
  recommendedModelIdsByUseCase: Schema.optional(LocalModelRecommendationsByUseCase),
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
  useCase: Schema.optional(LocalModelUseCase),
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

export const LocalModelCapabilityCheckInput = Schema.Struct({
  runtime: LocalModelRuntime,
  modelId: ModelIdentifier,
});
export type LocalModelCapabilityCheckInput = typeof LocalModelCapabilityCheckInput.Type;

export const LocalModelEvent = Schema.Struct({
  type: Schema.Literal("snapshot.updated"),
  snapshot: LocalModelsSnapshot,
});
export type LocalModelEvent = typeof LocalModelEvent.Type;
