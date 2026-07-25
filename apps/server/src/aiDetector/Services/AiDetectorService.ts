import type {
  AiDetectorAnalysisEvent,
  AiDetectorCancelInstallInput,
  AiDetectorEvent,
  AiDetectorInstallModelInput,
  AiDetectorLanguagePreference,
  AiDetectorRemoveModelInput,
  AiDetectorReport,
  AiDetectorState,
} from "@synara/contracts";
import { Schema, ServiceMap, type Effect, type Stream } from "effect";

export class AiDetectorServiceError extends Schema.TaggedErrorClass<AiDetectorServiceError>()(
  "AiDetectorServiceError",
  {
    code: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface AiDetectorServiceShape {
  readonly getState: Effect.Effect<AiDetectorState, AiDetectorServiceError>;
  readonly installModel: (
    input: AiDetectorInstallModelInput,
  ) => Effect.Effect<AiDetectorState, AiDetectorServiceError>;
  readonly cancelInstall: (
    input: AiDetectorCancelInstallInput,
  ) => Effect.Effect<AiDetectorState, AiDetectorServiceError>;
  readonly removeModel: (
    input: AiDetectorRemoveModelInput,
  ) => Effect.Effect<AiDetectorState, AiDetectorServiceError>;
  readonly clearCache: Effect.Effect<AiDetectorState, AiDetectorServiceError>;
  readonly analyze: (input: {
    readonly bytes: Uint8Array;
    readonly filename?: string;
    readonly mediaType?: string;
    readonly languagePreference: AiDetectorLanguagePreference;
    readonly signal: AbortSignal;
    readonly emit: (event: AiDetectorAnalysisEvent) => void | Promise<void>;
  }) => Effect.Effect<AiDetectorReport, AiDetectorServiceError>;
  readonly events: Stream.Stream<AiDetectorEvent>;
}

export class AiDetectorService extends ServiceMap.Service<
  AiDetectorService,
  AiDetectorServiceShape
>()("djl/aiDetector/AiDetectorService") {}
