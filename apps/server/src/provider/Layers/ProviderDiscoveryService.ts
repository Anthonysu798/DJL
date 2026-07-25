import {
  DEFAULT_SERVER_SETTINGS,
  type ProviderComposerCapabilities,
  type ProviderListAgentsResult,
  ProviderGetComposerCapabilitiesInput,
  ProviderListAgentsInput,
  ProviderListCommandsInput,
  ProviderListModelsInput,
  ProviderListPluginsInput,
  ProviderListSkillsInput,
  type ProviderListModelsResult,
  type ProviderListSkillsResult,
  ProviderReadPluginInput,
  OpenCodeListModelProvidersInput,
  OpenCodeRemoveCredentialInput,
  OpenCodeSetApiKeyInput,
  type OpenCodeListModelProvidersResult,
  type ProviderSkillDescriptor,
} from "@synara/contracts";
import { Effect, Layer, Schema, SchemaIssue, Semaphore } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { type ProviderAdapterError, ProviderValidationError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import {
  ProviderDiscoveryService,
  type ProviderDiscoveryServiceShape,
} from "../Services/ProviderDiscoveryService.ts";
import {
  discoverSkillsCatalog,
  filterDisabledSkills,
  mergeSkillsIntoCatalog,
} from "../skillsCatalog.ts";
import { OpenCodeCatalogCache } from "../openCodeCatalogCache.ts";

const MODEL_CATALOG_TTL_MS = 30_000;
const MODEL_CATALOG_BACKGROUND_REFRESH_DELAY_MS = 2_500;
// Start the background refresh just after the service is ready. Cache reads are still served
// synchronously, while the shared single-flight refresh warms one global OpenCode process before
// the user opens Settings or submits their first prompt.
const MODEL_CATALOG_STARTUP_REFRESH_DELAY_MS = 250;
const DEFAULT_OPENCODE_AGENTS: ProviderListAgentsResult = {
  agents: [
    {
      name: "build",
      displayName: "Build",
      description: "The default agent. Executes tools based on configured permissions.",
    },
    {
      name: "plan",
      displayName: "Plan",
      description: "Plan mode. Disallows all edit tools.",
    },
  ],
  source: "djl.default",
  cached: true,
};

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );

const disabledCapabilitiesForProvider = (
  provider: ProviderComposerCapabilities["provider"],
): ProviderComposerCapabilities => ({
  provider,
  supportsSkillMentions: false,
  supportsSkillDiscovery: false,
  supportsNativeSlashCommandDiscovery: false,
  supportsPluginMentions: false,
  supportsPluginDiscovery: false,
  supportsRuntimeModelList: false,
  supportsThreadCompaction: false,
  supportsThreadImport: false,
});

const make = Effect.gen(function* () {
  const registry = yield* ProviderAdapterRegistry;
  const serverConfig = yield* ServerConfig;
  const serverSettings = yield* ServerSettingsService;
  const openCodeCatalogCache = new OpenCodeCatalogCache(serverConfig.stateDir);
  const openCodeCatalogLock = yield* Semaphore.make(1);
  yield* Effect.tryPromise(() => openCodeCatalogCache.load()).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("DJL model catalog cache could not be loaded", { cause }),
    ),
  );

  const persistProviderCatalog = (result: OpenCodeListModelProvidersResult) =>
    Effect.tryPromise(() => openCodeCatalogCache.setProviders(result, Date.now())).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("DJL model provider cache could not be saved", { cause }),
      ),
    );

  const persistModelCatalog = (result: ProviderListModelsResult) =>
    Effect.tryPromise(() => openCodeCatalogCache.setModels(result, Date.now())).pipe(
      Effect.catch((cause) => Effect.logWarning("DJL model cache could not be saved", { cause })),
    );

  const persistAgentCatalog = (result: ProviderListAgentsResult) =>
    Effect.tryPromise(() => openCodeCatalogCache.setAgents(result, Date.now())).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("DJL model agent cache could not be saved", { cause }),
      ),
    );

  const refreshOpenCodeProviders = (
    adapter: ProviderAdapterShape<ProviderAdapterError>,
    force = false,
  ) =>
    openCodeCatalogLock.withPermit(
      Effect.gen(function* () {
        if (
          !force &&
          openCodeCatalogCache.providersAreFresh(Date.now(), MODEL_CATALOG_TTL_MS) &&
          openCodeCatalogCache.providers
        ) {
          return openCodeCatalogCache.providers;
        }
        if (!adapter.listModelProviders) {
          return yield* new ProviderValidationError({
            operation: "ProviderDiscoveryService.listModelProviders",
            issue: "DJL credential discovery is unavailable.",
          });
        }
        const result = yield* adapter.listModelProviders({});
        yield* persistProviderCatalog(result);
        return result;
      }),
    );

  const refreshOpenCodeModels = (
    adapter: ProviderAdapterShape<ProviderAdapterError>,
    input: ProviderListModelsInput,
    force = false,
  ) =>
    openCodeCatalogLock.withPermit(
      Effect.gen(function* () {
        if (
          !force &&
          openCodeCatalogCache.modelsAreFresh(Date.now(), MODEL_CATALOG_TTL_MS) &&
          openCodeCatalogCache.models
        ) {
          return openCodeCatalogCache.models;
        }
        if (!adapter.listModels) {
          return {
            models: [],
            source: "unsupported",
            cached: false,
          } satisfies ProviderListModelsResult;
        }
        const result = yield* adapter.listModels(input);
        yield* persistModelCatalog(result);
        return result;
      }),
    );

  const refreshOpenCodeAgents = (adapter: ProviderAdapterShape<ProviderAdapterError>) =>
    openCodeCatalogLock.withPermit(
      Effect.gen(function* () {
        if (!adapter.listAgents) {
          return DEFAULT_OPENCODE_AGENTS;
        }
        const result = yield* adapter.listAgents({ provider: "opencode" });
        yield* persistAgentCatalog(result);
        return result;
      }),
    );

  let openCodeCatalogRefreshScheduled = false;
  const scheduleOpenCodeCatalogRefresh = (
    delayMs = MODEL_CATALOG_BACKGROUND_REFRESH_DELAY_MS,
  ): void => {
    if (openCodeCatalogRefreshScheduled) {
      return;
    }
    openCodeCatalogRefreshScheduled = true;
    Effect.runFork(
      Effect.sleep(delayMs).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const adapter = yield* registry.getByProvider("opencode");
            yield* refreshOpenCodeModels(adapter, { provider: "opencode" }, true);
            yield* refreshOpenCodeProviders(adapter, true);
            yield* refreshOpenCodeAgents(adapter);
          }),
        ),
        Effect.catch((cause) =>
          Effect.logWarning("DJL model catalog background refresh failed", { cause }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            openCodeCatalogRefreshScheduled = false;
          }),
        ),
      ),
    );
  };

  const getComposerCapabilities: ProviderDiscoveryServiceShape["getComposerCapabilities"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.getComposerCapabilities",
        schema: ProviderGetComposerCapabilitiesInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      const capabilities = adapter.getComposerCapabilities
        ? yield* adapter.getComposerCapabilities()
        : disabledCapabilitiesForProvider(parsed.provider);
      // The unified Synara skills catalog backs skill discovery for every
      // provider, including ones without native skill support.
      return {
        ...capabilities,
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
      };
    });

  const listSkills: ProviderDiscoveryServiceShape["listSkills"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listSkills",
        schema: ProviderListSkillsInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      const nativeResult: ProviderListSkillsResult | null = adapter.listSkills
        ? yield* adapter
            .listSkills(parsed)
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning(
                  "provider-native skill discovery failed; serving the Synara skills catalog only",
                  { provider: parsed.provider, error },
                ).pipe(Effect.as(null)),
              ),
            )
        : null;
      const catalogSkills = yield* Effect.tryPromise(() =>
        discoverSkillsCatalog({
          cwd: parsed.cwd,
          homeDir: serverConfig.homeDir,
          synaraBaseDir: serverConfig.baseDir,
          provider: parsed.provider,
          ...(parsed.forceReload !== undefined ? { forceReload: parsed.forceReload } : {}),
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("synara skills catalog discovery failed", {
            provider: parsed.provider,
            cause,
          }).pipe(Effect.as([] as ProviderSkillDescriptor[])),
        ),
      );
      const merged = mergeSkillsIntoCatalog({
        native: nativeResult?.skills ?? [],
        catalog: catalogSkills,
      });
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
      );
      return {
        skills: filterDisabledSkills(merged, settings.skills.disabled),
        source: nativeResult?.source ? `${nativeResult.source}+synara.catalog` : "synara.catalog",
        cached: nativeResult?.cached ?? false,
      } satisfies ProviderListSkillsResult;
    });

  const listCommands: ProviderDiscoveryServiceShape["listCommands"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listCommands",
        schema: ProviderListCommandsInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listCommands) {
        return {
          commands: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listCommands(parsed);
    });

  const listPlugins: ProviderDiscoveryServiceShape["listPlugins"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listPlugins",
        schema: ProviderListPluginsInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listPlugins) {
        return {
          marketplaces: [],
          marketplaceLoadErrors: [],
          remoteSyncError: null,
          featuredPluginIds: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listPlugins(parsed);
    });

  const readPlugin: ProviderDiscoveryServiceShape["readPlugin"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.readPlugin",
        schema: ProviderReadPluginInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.readPlugin) {
        return yield* new ProviderValidationError({
          operation: "ProviderDiscoveryService.readPlugin",
          issue: `Plugin discovery is unavailable for provider '${parsed.provider}'.`,
        });
      }
      return yield* adapter.readPlugin(parsed);
    });

  const listModels: ProviderDiscoveryServiceShape["listModels"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listModels",
        schema: ProviderListModelsInput,
        payload: input,
      });
      if (parsed.provider === "opencode") {
        const { cwd: _cwd, forceReload = false, ...globalInput } = parsed;
        if (forceReload) {
          const adapter = yield* registry.getByProvider("opencode");
          return yield* refreshOpenCodeModels(adapter, globalInput, true);
        }
        const cached = openCodeCatalogCache.models;
        if (cached) {
          scheduleOpenCodeCatalogRefresh();
          return cached;
        }
        const adapter = yield* registry.getByProvider("opencode");
        return yield* refreshOpenCodeModels(adapter, globalInput, true);
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listModels) {
        return {
          models: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listModels(parsed);
    });

  const listAgents: ProviderDiscoveryServiceShape["listAgents"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listAgents",
        schema: ProviderListAgentsInput,
        payload: input,
      });
      if (parsed.provider === "opencode") {
        const cached = openCodeCatalogCache.agents;
        scheduleOpenCodeCatalogRefresh();
        return cached ?? DEFAULT_OPENCODE_AGENTS;
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listAgents) {
        return {
          agents: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listAgents(parsed);
    });

  const listModelProviders: ProviderDiscoveryServiceShape["listModelProviders"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listModelProviders",
        schema: OpenCodeListModelProvidersInput,
        payload: input,
      });
      const forceReload = parsed.forceReload ?? false;
      if (forceReload) {
        const adapter = yield* registry.getByProvider("opencode");
        return yield* refreshOpenCodeProviders(adapter, true);
      }
      const cached = openCodeCatalogCache.providers;
      if (cached) {
        scheduleOpenCodeCatalogRefresh();
        return cached;
      }
      const adapter = yield* registry.getByProvider("opencode");
      return yield* refreshOpenCodeProviders(adapter, true);
    });

  const setApiKey: ProviderDiscoveryServiceShape["setApiKey"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.setApiKey",
        schema: OpenCodeSetApiKeyInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider("opencode");
      if (!adapter.setApiKey) {
        return yield* new ProviderValidationError({
          operation: "ProviderDiscoveryService.setApiKey",
          issue: "DJL credential storage is unavailable.",
        });
      }
      const { cwd: _cwd, ...globalInput } = parsed;
      const result = yield* adapter.setApiKey(globalInput);
      openCodeCatalogCache.markStale();
      scheduleOpenCodeCatalogRefresh();
      return result;
    });

  const removeCredential: ProviderDiscoveryServiceShape["removeCredential"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.removeCredential",
        schema: OpenCodeRemoveCredentialInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider("opencode");
      if (!adapter.removeCredential) {
        return yield* new ProviderValidationError({
          operation: "ProviderDiscoveryService.removeCredential",
          issue: "DJL credential removal is unavailable.",
        });
      }
      const { cwd: _cwd, ...globalInput } = parsed;
      const result = yield* adapter.removeCredential(globalInput);
      openCodeCatalogCache.markStale();
      scheduleOpenCodeCatalogRefresh();
      return result;
    });

  // Warm the global DJL catalog after the server layer is ready. This never
  // delays desktop startup, and the shared semaphore lets an early UI request
  // join the same cold-start work instead of launching another OpenCode server.
  scheduleOpenCodeCatalogRefresh(MODEL_CATALOG_STARTUP_REFRESH_DELAY_MS);

  return {
    getComposerCapabilities,
    listCommands,
    listSkills,
    listPlugins,
    readPlugin,
    listModels,
    listAgents,
    listModelProviders,
    setApiKey,
    removeCredential,
  } satisfies ProviderDiscoveryServiceShape;
});

export const ProviderDiscoveryServiceLive = Layer.effect(ProviderDiscoveryService, make);
