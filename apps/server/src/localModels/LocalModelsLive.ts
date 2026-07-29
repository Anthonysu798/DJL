import type { LocalModelEvent, LocalModelsSnapshot } from "@synara/contracts";
import { Duration, Effect, Layer, PubSub, Schedule, Stream } from "effect";

import { ServerConfig } from "../config";
import { LocalModelManager, LocalModelManagerError } from "./LocalModelManager";
import { LocalModelSnapshotCache } from "./localModelSnapshotCache";
import {
  LocalModelsService,
  LocalModelsServiceError,
  type LocalModelsServiceShape,
} from "./LocalModelsService";

function serviceError(operation: string, cause: unknown): LocalModelsServiceError {
  return new LocalModelsServiceError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const events = yield* PubSub.unbounded<LocalModelEvent>();
  const snapshotCache = new LocalModelSnapshotCache(config.stateDir);
  let lastSnapshot = yield* Effect.tryPromise(() => snapshotCache.load()).pipe(
    Effect.orElseSucceed(() => null),
  );
  let lastSnapshotFingerprint = "";
  let refreshPromise: Promise<LocalModelsSnapshot> | null = null;
  const publishSnapshot = async (snapshot: LocalModelsSnapshot) => {
    lastSnapshot = snapshot;
    await snapshotCache.save(snapshot).catch(() => undefined);
    const fingerprint = JSON.stringify(snapshot);
    if (fingerprint === lastSnapshotFingerprint) return;
    lastSnapshotFingerprint = fingerprint;
    const event: LocalModelEvent = { type: "snapshot.updated", snapshot };
    await Effect.runPromise(PubSub.publish(events, event));
  };
  const manager = new LocalModelManager({
    stateDir: config.stateDir,
    managedOpenCodeRootDir: config.managedOpenCodeRootDir,
    onSnapshot: publishSnapshot,
  });
  const refreshManager = () => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = manager.refresh().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  };

  const run = <A>(operation: string, effect: () => Promise<A>) =>
    Effect.tryPromise({
      try: effect,
      catch: (cause) =>
        serviceError(cause instanceof LocalModelManagerError ? cause.operation : operation, cause),
    });

  const desktopOnly = <A>(operation: string, effect: () => Promise<A>) =>
    config.mode === "desktop"
      ? run(operation, effect)
      : Effect.fail(
          serviceError(
            operation,
            new Error("Local model management is available in the desktop app."),
          ),
        );

  if (config.mode === "desktop") {
    // Bring an already-installed Ollama up once at launch, before the polling loop. A stopped
    // runtime reports no models, so without this the user's local models are missing from the
    // picker until they discover the start button in settings. Forked so a slow or failed start
    // never delays startup.
    yield* run("startInstalledRuntimes", () => manager.startInstalledRuntimes()).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkScoped,
    );
    yield* run("backgroundRefresh", refreshManager).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.repeat(Schedule.spaced(Duration.seconds(15))),
      Effect.forkScoped,
    );
  }

  return {
    getSnapshot: desktopOnly("getSnapshot", async () => {
      if (lastSnapshot) return lastSnapshot;
      return refreshManager();
    }),
    refresh: desktopOnly("refresh", refreshManager),
    installRuntime: ({ runtime }) =>
      desktopOnly("installRuntime", () => manager.installRuntime(runtime)),
    startRuntime: ({ runtime }) => desktopOnly("startRuntime", () => manager.startRuntime(runtime)),
    installModel: (input) => desktopOnly("installModel", () => manager.installModel(input)),
    cancelInstall: ({ jobId }) => desktopOnly("cancelInstall", () => manager.cancelInstall(jobId)),
    startSetup: (input) => desktopOnly("startSetup", () => manager.startSetup(input)),
    retrySetup: ({ jobId }) => desktopOnly("retrySetup", () => manager.retrySetup(jobId)),
    cancelSetup: ({ jobId }) => desktopOnly("cancelSetup", () => manager.cancelSetup(jobId)),
    ensureRuntimeForModel: (modelSlug) =>
      desktopOnly("ensureRuntimeForModel", () => manager.ensureRuntimeForModel(modelSlug)),
    // Not desktopOnly: a hosted-only build has no local models, and "unknown" is the right answer
    // there rather than an error that would block starting a perfectly normal session.
    toolSupportForModel: (modelSlug) =>
      config.mode === "desktop"
        ? run("toolSupportForModel", () => manager.toolSupportForModel(modelSlug))
        : Effect.succeed(null),
    removeModel: (input) => desktopOnly("removeModel", () => manager.removeModel(input)),
    events: Stream.fromPubSub(events),
  } satisfies LocalModelsServiceShape;
});

export const LocalModelsLive = Layer.effect(LocalModelsService, make);
