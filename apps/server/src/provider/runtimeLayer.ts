import { Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config";
import { ServerSettingsLive } from "../serverSettings";
import { AnalyticsService } from "../telemetry/Services/AnalyticsService";
import { ProviderUnsupportedError } from "./Errors";
import { makeEventNdjsonLogger } from "./Layers/EventNdjsonLogger";
import { makeOpenCodeAdapterLive } from "./Layers/OpenCodeAdapter";
import { ProviderAdapterRegistryLive } from "./Layers/ProviderAdapterRegistry";
import { ProviderDiscoveryServiceLive } from "./Layers/ProviderDiscoveryService";
import { makeProviderServiceLive } from "./Layers/ProviderService";
import { ProviderSessionDirectoryLive } from "./Layers/ProviderSessionDirectory";
import { ProviderAdapterRegistry } from "./Services/ProviderAdapterRegistry";
import { ProviderDiscoveryService } from "./Services/ProviderDiscoveryService";
import { ProviderService } from "./Services/ProviderService";
import { ProviderSessionDirectory } from "./Services/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "../persistence/Layers/ProviderSessionRuntime";
import { WorkMcpServer, WorkMcpServerError } from "../work/Services/WorkMcpServer";
import { WorkMcpServerLive } from "../work/Layers/WorkMcpServer";
import { LocalModelsService } from "../localModels/LocalModelsService";

export function makeServerProviderLayer(): Layer.Layer<
  ProviderService | ProviderDiscoveryService | ProviderAdapterRegistry | ProviderSessionDirectory,
  ProviderUnsupportedError | WorkMcpServerError,
  | SqlClient.SqlClient
  | ServerConfig
  | FileSystem.FileSystem
  | Path.Path
  | AnalyticsService
  | LocalModelsService
  | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const { logProviderEvents, providerEventLogPath } = yield* ServerConfig;
    const nativeEventLogger = logProviderEvents
      ? yield* makeEventNdjsonLogger(providerEventLogPath, {
          stream: "native",
        })
      : undefined;
    const canonicalEventLogger = logProviderEvents
      ? yield* makeEventNdjsonLogger(providerEventLogPath, {
          stream: "canonical",
        })
      : undefined;
    const workMcpServer = yield* WorkMcpServer;
    const localModels = yield* LocalModelsService;
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const openCodeAdapterLayer = makeOpenCodeAdapterLive({
      ...(nativeEventLogger ? { nativeEventLogger } : {}),
      workMcpServer,
      ensureLocalRuntime: localModels.ensureRuntimeForModel,
      localToolSupport: localModels.toolSupportForModel,
      localModelInventory: () => localModels.refresh,
    });
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(openCodeAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    const providerServiceLayer = makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(Layer.provide(adapterRegistryLayer), Layer.provide(providerSessionDirectoryLayer));
    const providerDiscoveryLayer = ProviderDiscoveryServiceLive.pipe(
      Layer.provide(adapterRegistryLayer),
      // Skill toggles live in server settings; the shared ServerSettingsLive
      // layer is memoized so this reuses the instance built at the top level.
      Layer.provide(ServerSettingsLive),
    );
    return Layer.mergeAll(
      providerServiceLayer,
      providerDiscoveryLayer,
      adapterRegistryLayer,
      providerSessionDirectoryLayer,
    );
  }).pipe(Layer.unwrap, Layer.provide(WorkMcpServerLive));
}
