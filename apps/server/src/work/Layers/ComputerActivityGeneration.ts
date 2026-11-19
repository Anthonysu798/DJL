import { Effect, Layer } from "effect";
import { ServerSettingsService } from "../../serverSettings";
import { ServerConfig } from "../../config";
import { generateActivityCodexResponsesSummary } from "../activityCodexResponsesGeneration";
import { generateActivityDjlCloudSummary } from "../activityDjlCloudGeneration";
import { desktopComputerCredentials } from "../desktopComputerCredentials";
import {
  ComputerActivityGenerationError,
  ComputerActivitySummaryWorker,
  type ComputerActivitySummaryGenerationResult,
} from "../computerActivitySummarization";
import {
  ComputerActivityGeneration,
  type ComputerActivityGenerationShape,
} from "../Services/ComputerActivityGeneration";

const unavailable = () => new ComputerActivityGenerationError("provider-unavailable");
const failed = () => new ComputerActivityGenerationError("generation-failed");
const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const config = yield* ServerConfig;
  const services = yield* Effect.services<never>();
  const run = Effect.runPromiseWith(services);
  const lifetime = new AbortController();
  const pending = new Set<Promise<void>>();
  let closed = false;
  let worker: ComputerActivitySummaryWorker | undefined;
  // The layer owns concrete provider retirement independently of the worker's
  // deliberately prompt cancellation of arbitrary generation callbacks.
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      closed = true;
      lifetime.abort();
      const closing = worker?.dispose();
      await Promise.all([closing, ...pending]);
    }),
  );
  const generate: ComputerActivityGenerationShape["generate"] = (input) =>
    Effect.gen(function* () {
      if (closed || input.signal.aborted) return yield* Effect.fail(failed());
      const configured = yield* settings.getConfiguredSettings.pipe(
        Effect.catchCause(() => Effect.fail(unavailable())),
      );
      if (closed || input.signal.aborted) return yield* Effect.fail(failed());
      const selection = configured.textGenerationModelSelection;
      if (
        (selection.provider !== "codex" && selection.provider !== "djlCloud") ||
        !configured.providers[selection.provider].enabled
      )
        return yield* Effect.fail(unavailable());
      const options = selection.options ? { ...selection.options } : undefined;
      if (selection.provider === "djlCloud" && options && Object.keys(options).length)
        return yield* Effect.fail(unavailable());
      const homePath =
        selection.provider === "codex" ? configured.providers.codex.homePath : undefined;
      return yield* Effect.callback<
        ComputerActivitySummaryGenerationResult,
        ComputerActivityGenerationError
      >((resume, interruption) => {
        if (closed || input.signal.aborted || interruption.aborted) {
          resume(Effect.fail(failed()));
          return;
        }
        const signal = AbortSignal.any([input.signal, interruption, lifetime.signal]);
        let operation: ReturnType<typeof generateActivityCodexResponsesSummary>;
        try {
          // No yield between admission, concrete invocation and enrollment.
          operation =
            selection.provider === "djlCloud"
              ? generateActivityDjlCloudSummary({
                  evidence: input.evidence,
                  signal,
                  model: selection.model,
                  secretsDir: config.secretsDir,
                })
              : generateActivityCodexResponsesSummary({
                  evidence: input.evidence,
                  signal,
                  model: selection.model,
                  ...(options ? { options } : {}),
                  ...(homePath ? { homePath } : {}),
                  environment: process.env,
                });
        } catch (error) {
          resume(Effect.fail(error instanceof ComputerActivityGenerationError ? error : failed()));
          return;
        }
        const settled = operation.then(
          () => undefined,
          () => undefined,
        );
        pending.add(settled);
        void settled.then(() => pending.delete(settled));
        void operation.then(
          (result) =>
            resume(closed || signal.aborted ? Effect.fail(failed()) : Effect.succeed(result)),
          (error) =>
            resume(
              Effect.fail(error instanceof ComputerActivityGenerationError ? error : failed()),
            ),
        );
        // Individual Effect interruption awaits the same concrete terminal promise.
        return Effect.promise(() => settled);
      });
    });
  if (desktopComputerCredentials.url || desktopComputerCredentials.token) {
    try {
      worker = new ComputerActivitySummaryWorker({
        credentials: desktopComputerCredentials,
        generate: (input) => run(generate(input)),
      });
    } catch {
      // Invalid host authority cannot authorize a poll or fail unrelated startup.
    }
    if (worker) {
      const current = worker;
      // Settings.start runs after layer acquisition; waiting here would deadlock.
      yield* settings.ready.pipe(
        Effect.tap(() => Effect.sync(() => current.start())),
        Effect.catch(() => Effect.void),
        Effect.forkScoped,
      );
    }
  }
  return { generate } satisfies ComputerActivityGenerationShape;
});

export const ComputerActivityGenerationLive = Layer.effect(ComputerActivityGeneration, make);
