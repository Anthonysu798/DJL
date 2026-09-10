import { Effect, Deferred, Exit, Layer, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { AutomationRunReactorLive } from "./automation/Layers/AutomationRunReactor";
import { AutomationSchedulerLive } from "./automation/Layers/AutomationScheduler";
import { AutomationRunReactor } from "./automation/Services/AutomationRunReactor";
import { AutomationScheduler } from "./automation/Services/AutomationScheduler";
import {
  AutomationService,
  type AutomationServiceShape,
} from "./automation/Services/AutomationService";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "./orchestration/Services/OrchestrationEngine";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "./orchestration/Services/ProjectionSnapshotQuery";
import {
  AutomationRepository,
  type AutomationRepositoryShape,
} from "./persistence/Services/AutomationRepository";
import { ProviderSessionReaperLive } from "./provider/Layers/ProviderSessionReaper";
import { ProviderSessionReaper } from "./provider/Services/ProviderSessionReaper";
import {
  ProviderSessionDirectory,
  type ProviderSessionDirectoryShape,
} from "./provider/Services/ProviderSessionDirectory";
import { ProviderService, type ProviderServiceShape } from "./provider/Services/ProviderService";
import { makeServerRuntimeStartup } from "./serverRuntimeStartup";

describe("optional server startup workers", () => {
  it("keeps commands available during delayed optional work and cancels workers and subscriptions on shutdown", async () => {
    const stopped = new Set<string>();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const schedulerEntered = yield* Deferred.make<void>();
        const recoveryEntered = yield* Deferred.make<void>();
        const reaperEntered = yield* Deferred.make<void>();
        const subscribed = yield* Deferred.make<void>();
        const pending = (name: string, entered: Deferred.Deferred<void>) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                stopped.add(name);
              }),
            ),
          );
        const automation = {
          reconcileActiveRuns: () => pending("scheduler", schedulerEntered),
          runDueOnce: () => Effect.succeed([]),
          recoverPendingRuns: () => pending("recovery", recoveryEntered),
          streamEvents: Stream.never,
        } as unknown as AutomationServiceShape;
        const engine = {
          streamDomainEvents: Stream.fromEffect(
            Effect.acquireRelease(Deferred.succeed(subscribed, undefined), () =>
              Effect.sync(() => {
                stopped.add("subscription");
              }),
            ).pipe(Effect.andThen(Effect.never)),
          ),
        } as unknown as OrchestrationEngineShape;
        const workers = Layer.mergeAll(
          AutomationSchedulerLive.pipe(
            Layer.provide(
              Layer.succeed(AutomationRepository, {
                getEarliestNextRunAt: () => Effect.succeed(null),
              } as unknown as AutomationRepositoryShape),
            ),
          ),
          AutomationRunReactorLive.pipe(
            Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
          ),
          ProviderSessionReaperLive.pipe(
            Layer.provide(Layer.succeed(ProviderService, {} as ProviderServiceShape)),
            Layer.provide(
              Layer.succeed(ProjectionSnapshotQuery, {} as ProjectionSnapshotQueryShape),
            ),
            Layer.provide(
              Layer.succeed(ProviderSessionDirectory, {
                listBindings: () => pending("reaper", reaperEntered),
              } as unknown as ProviderSessionDirectoryShape),
            ),
          ),
        ).pipe(Layer.provide(Layer.succeed(AutomationService, automation)));

        return yield* Effect.gen(function* () {
          const startup = yield* makeServerRuntimeStartup;
          const scheduler = yield* AutomationScheduler;
          const reactor = yield* AutomationRunReactor;
          const reaper = yield* ProviderSessionReaper;
          const scope = yield* Scope.make("sequential");
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
          // Same optional start sequence as effectServer, after mandatory recovery.
          yield* Scope.provide(scheduler.start(), scope);
          yield* Scope.provide(reactor.start(), scope);
          yield* Scope.provide(reaper.start(), scope);
          yield* startup.markCommandReady;
          const command = yield* startup.enqueueCommand(Effect.succeed("accepted"));
          yield* Deferred.await(schedulerEntered);
          yield* Deferred.await(recoveryEntered);
          yield* Deferred.await(reaperEntered);
          yield* Deferred.await(subscribed);
          expect(stopped.size).toBe(0);
          return command;
        }).pipe(Effect.provide(workers), Effect.scoped);
      }),
    );
    expect(result).toBe("accepted");
    expect([...stopped].toSorted()).toEqual(["reaper", "recovery", "scheduler", "subscription"]);
  }, 5_000);

  it("keeps commands available after optional automation recovery fails", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const recoveryFinished = yield* Deferred.make<void>();
        const layer = AutomationRunReactorLive.pipe(
          Layer.provide(
            Layer.succeed(AutomationService, {
              recoverPendingRuns: () =>
                Effect.die("optional recovery failed").pipe(
                  Effect.ensuring(Deferred.succeed(recoveryFinished, undefined)),
                ),
            } as unknown as AutomationServiceShape),
          ),
          Layer.provide(
            Layer.succeed(OrchestrationEngineService, {
              streamDomainEvents: Stream.never,
            } as unknown as OrchestrationEngineShape),
          ),
        );
        return yield* Effect.gen(function* () {
          const startup = yield* makeServerRuntimeStartup;
          const reactor = yield* AutomationRunReactor;
          yield* reactor.start();
          yield* startup.markCommandReady;
          yield* Deferred.await(recoveryFinished);
          yield* Effect.yieldNow;
          return yield* startup.enqueueCommand(Effect.succeed("accepted"));
        }).pipe(Effect.provide(layer), Effect.scoped);
      }),
    );
    expect(result).toBe("accepted");
  }, 5_000);
});
