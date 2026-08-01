import type {
  LocalModelCancelInstallInput,
  LocalModelCapabilityCheckInput,
  LocalModelEvent,
  LocalModelInstallInput,
  LocalModelInstallJob,
  LocalModelRemoveInput,
  LocalModelRuntimeInput,
  LocalModelSetupInput,
  LocalModelSetupJob,
  LocalModelSetupJobInput,
  LocalModelsSnapshot,
} from "@synara/contracts";
import { Schema, ServiceMap, type Effect, type Stream } from "effect";

export class LocalModelsServiceError extends Schema.TaggedErrorClass<LocalModelsServiceError>()(
  "LocalModelsServiceError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface LocalModelsServiceShape {
  readonly getSnapshot: Effect.Effect<LocalModelsSnapshot, LocalModelsServiceError>;
  readonly refresh: Effect.Effect<LocalModelsSnapshot, LocalModelsServiceError>;
  readonly installRuntime: (
    input: LocalModelRuntimeInput,
  ) => Effect.Effect<LocalModelsSnapshot, LocalModelsServiceError>;
  readonly startRuntime: (
    input: LocalModelRuntimeInput,
  ) => Effect.Effect<LocalModelsSnapshot, LocalModelsServiceError>;
  readonly installModel: (
    input: LocalModelInstallInput,
  ) => Effect.Effect<LocalModelInstallJob, LocalModelsServiceError>;
  readonly cancelInstall: (
    input: LocalModelCancelInstallInput,
  ) => Effect.Effect<LocalModelInstallJob, LocalModelsServiceError>;
  readonly startSetup: (
    input: LocalModelSetupInput,
  ) => Effect.Effect<LocalModelSetupJob, LocalModelsServiceError>;
  readonly retrySetup: (
    input: LocalModelSetupJobInput,
  ) => Effect.Effect<LocalModelSetupJob, LocalModelsServiceError>;
  readonly cancelSetup: (
    input: LocalModelSetupJobInput,
  ) => Effect.Effect<LocalModelSetupJob, LocalModelsServiceError>;
  readonly ensureRuntimeForModel: (
    modelSlug: string,
  ) => Effect.Effect<void, LocalModelsServiceError>;
  readonly toolSupportForModel: (
    modelSlug: string,
  ) => Effect.Effect<boolean | null, LocalModelsServiceError>;
  readonly removeModel: (
    input: LocalModelRemoveInput,
  ) => Effect.Effect<LocalModelsSnapshot, LocalModelsServiceError>;
  readonly rerunCapabilityCheck: (
    input: LocalModelCapabilityCheckInput,
  ) => Effect.Effect<LocalModelsSnapshot, LocalModelsServiceError>;
  readonly events: Stream.Stream<LocalModelEvent>;
}

export class LocalModelsService extends ServiceMap.Service<
  LocalModelsService,
  LocalModelsServiceShape
>()("djl/localModels/LocalModelsService") {}
