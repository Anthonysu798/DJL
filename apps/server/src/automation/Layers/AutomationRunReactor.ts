import type { OrchestrationEvent, ThreadId } from "@synara/contracts";
import { makeDrainableWorker } from "@synara/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { AutomationService } from "../Services/AutomationService.ts";
import {
  AutomationRunReactor,
  type AutomationRunReactorShape,
} from "../Services/AutomationRunReactor.ts";

// Only events that can change an automation turn's lifecycle should trigger reconciliation.
// Message/activity streams can be token-level noisy, so they stay off this hot path.
const RECONCILE_EVENT_TYPES: ReadonlySet<OrchestrationEvent["type"]> = new Set([
  "thread.turn-diff-completed",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.turn-interrupt-requested",
  "thread.reverted",
  "thread.conversation-rolled-back",
  "thread.session-set",
]);

function reconcileThreadIdOf(event: OrchestrationEvent): ThreadId | null {
  if (!RECONCILE_EVENT_TYPES.has(event.type)) {
    return null;
  }
  const payload = event.payload;
  return "threadId" in payload ? payload.threadId : null;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const automationService = yield* AutomationService;

  const reconcileSafely = (threadId: ThreadId) =>
    automationService.reconcileThread({ threadId }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("automation run reactor failed to reconcile thread", {
          threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const queuedThreadIds = new Set<ThreadId>();
  const worker = yield* makeDrainableWorker((threadId: ThreadId) =>
    reconcileSafely(threadId).pipe(
      Effect.ensuring(Effect.sync(() => queuedThreadIds.delete(threadId))),
    ),
  );
  const enqueueReconcile = (threadId: ThreadId) =>
    Effect.sync(() => {
      if (queuedThreadIds.has(threadId)) {
        return false;
      }
      queuedThreadIds.add(threadId);
      return true;
    }).pipe(
      Effect.flatMap((shouldEnqueue) => (shouldEnqueue ? worker.enqueue(threadId) : Effect.void)),
    );

  const start: AutomationRunReactorShape["start"] = Effect.fn(function* () {
    // Subscribe first so startup recovery never leaves a gap for live events.
    // Reconciliation is idempotent and can run outside the interactive startup
    // path even when a persisted history contains many pending runs.
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        const threadId = reconcileThreadIdOf(event);
        return threadId ? enqueueReconcile(threadId) : Effect.void;
      }),
    );
    yield* Effect.forkScoped(
      automationService.recoverPendingRuns().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("automation run reactor recovery failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies AutomationRunReactorShape;
});

export const AutomationRunReactorLive = Layer.effect(AutomationRunReactor, make);
