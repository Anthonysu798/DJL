import type { AiDetectorEvent } from "@synara/contracts";
import { Effect, Layer, PubSub, Stream } from "effect";

import { ServerConfig } from "../../config";
import { AiDetectorManager, AiDetectorManagerError } from "../AiDetectorManager";
import {
  AiDetectorService,
  AiDetectorServiceError,
  type AiDetectorServiceShape,
} from "../Services/AiDetectorService";

function serviceError(cause: unknown): AiDetectorServiceError {
  return new AiDetectorServiceError({
    code: cause instanceof AiDetectorManagerError ? cause.code : "analysis-failed",
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const events = yield* PubSub.unbounded<AiDetectorEvent>();
  const manager = new AiDetectorManager(config.stateDir, async (state) => {
    const event: AiDetectorEvent = { type: "state.updated", state };
    await Effect.runPromise(PubSub.publish(events, event));
  });
  const run = <A>(promise: () => Promise<A>) =>
    Effect.tryPromise({ try: promise, catch: serviceError });
  return {
    getState: run(() => manager.getState()),
    installModel: ({ language }) => run(() => manager.installModel(language)),
    cancelInstall: ({ language }) => run(() => manager.cancelInstall(language)),
    removeModel: ({ language }) => run(() => manager.removeModel(language)),
    clearCache: run(() => manager.clearCache()),
    analyze: (input) => run(() => manager.analyze(input)),
    events: Stream.fromPubSub(events),
  } satisfies AiDetectorServiceShape;
});

export const AiDetectorServiceLive = Layer.effect(AiDetectorService, make);
