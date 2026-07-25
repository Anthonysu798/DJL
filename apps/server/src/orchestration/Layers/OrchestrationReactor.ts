import { Cause, Effect, Layer } from "effect";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { StudioOutputReactor } from "../Services/StudioOutputReactor.ts";
import { WorkPreparationQueue } from "../Services/WorkPreparationQueue.ts";
import { MemoryReactor } from "../Services/MemoryReactor.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const studioOutputReactor = yield* StudioOutputReactor;
  const workPreparationQueue = yield* WorkPreparationQueue;
  const memoryReactor = yield* MemoryReactor;

  const start: OrchestrationReactorShape["start"] = Effect.gen(function* () {
    yield* providerRuntimeIngestion.start;
    // Establish every live subscription needed by a newly dispatched command
    // before running any startup recovery work.
    yield* providerCommandReactor.start;
    yield* checkpointReactor.start;
    yield* studioOutputReactor.start;
    yield* memoryReactor.start;

    // Recovery can inspect a large persisted queue and may publish completed
    // preparation jobs. The provider reactor is already subscribed, so run the
    // scan in this lifecycle scope without delaying interactive command readiness.
    yield* Effect.forkScoped(
      workPreparationQueue.start.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("work preparation startup recovery failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    );
  });

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
