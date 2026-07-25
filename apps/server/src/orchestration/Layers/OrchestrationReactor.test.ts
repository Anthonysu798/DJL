import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { StudioOutputReactor } from "../Services/StudioOutputReactor.ts";
import { OrchestrationReactor } from "../Services/OrchestrationReactor.ts";
import { WorkPreparationQueue } from "../Services/WorkPreparationQueue.ts";
import { MemoryReactor } from "../Services/MemoryReactor.ts";
import { makeOrchestrationReactor } from "./OrchestrationReactor.ts";

describe("OrchestrationReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrchestrationReactor, never> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("starts live reactors without waiting for work preparation recovery", async () => {
    const started: string[] = [];

    runtime = ManagedRuntime.make(
      Layer.effect(OrchestrationReactor, makeOrchestrationReactor).pipe(
        Layer.provideMerge(
          Layer.succeed(ProviderRuntimeIngestionService, {
            start: Effect.sync(() => {
              started.push("provider-runtime-ingestion");
            }),
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderCommandReactor, {
            start: Effect.sync(() => {
              started.push("provider-command-reactor");
            }),
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(WorkPreparationQueue, {
            start: Effect.sync(() => {
              started.push("work-preparation-queue");
            }).pipe(Effect.andThen(Effect.never)),
            enqueue: () => Effect.void,
            markDispatched: () => Effect.void,
            resumeNeedsInput: Effect.void,
            streamCompleted: Stream.empty,
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(MemoryReactor, {
            start: Effect.sync(() => {
              started.push("memory-reactor");
            }),
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(CheckpointReactor, {
            start: Effect.sync(() => {
              started.push("checkpoint-reactor");
            }),
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(StudioOutputReactor, {
            captureBaselineBeforeTurn: () => Effect.void,
            cancelPendingTurnBaseline: () => Effect.void,
            start: Effect.sync(() => {
              started.push("studio-output-reactor");
            }),
            drain: Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(OrchestrationReactor));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    expect(started).toEqual([
      "provider-runtime-ingestion",
      "provider-command-reactor",
      "checkpoint-reactor",
      "studio-output-reactor",
      "memory-reactor",
    ]);
    await vi.waitFor(() => {
      expect(started).toContain("work-preparation-queue");
    });

    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
