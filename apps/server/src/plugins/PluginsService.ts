import {
  findPluginCatalogEntry,
  type PluginAppInput,
  type PluginAppTokenInput,
  type PluginConnectResult,
  type PluginCreateSkillInput,
  type PluginCreateSkillResult,
  type PluginCustomServerInput,
  type PluginIdInput,
  type PluginImportInput,
  type PluginImportResult,
  type PluginMarketplaceInput,
  type PluginMarketplaceResult,
  type PluginSetEnabledInput,
  type PluginSourceInput,
  type PluginsSnapshot,
} from "@djl/contracts";
import { Effect, Layer, Schema, ServiceMap } from "effect";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore";
import { ServerConfig } from "../config";
import { invalidateSkillsCatalogCache, djlSkillsDir } from "../provider/skillsCatalog";
import { createSkill } from "./createSkill";
import { PluginConnections } from "./PluginConnections";
import { PluginGateway, type PluginGatewaySession } from "./PluginGateway";
import { PluginStore } from "./PluginStore";

export class PluginsServiceError extends Schema.TaggedErrorClass<PluginsServiceError>()(
  "PluginsServiceError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface PluginsServiceShape {
  readonly getSnapshot: Effect.Effect<PluginsSnapshot, PluginsServiceError>;
  readonly install: (input: PluginIdInput) => Effect.Effect<PluginsSnapshot, PluginsServiceError>;
  readonly uninstall: (input: PluginIdInput) => Effect.Effect<PluginsSnapshot, PluginsServiceError>;
  readonly setEnabled: (
    input: PluginSetEnabledInput,
  ) => Effect.Effect<PluginsSnapshot, PluginsServiceError>;
  readonly connectApp: (
    input: PluginAppInput,
  ) => Effect.Effect<PluginConnectResult, PluginsServiceError>;
  readonly disconnectApp: (
    input: PluginAppInput,
  ) => Effect.Effect<PluginsSnapshot, PluginsServiceError>;
  readonly addCustomServer: (
    input: PluginCustomServerInput,
  ) => Effect.Effect<PluginsSnapshot, PluginsServiceError>;
  readonly createSkill: (
    input: PluginCreateSkillInput,
  ) => Effect.Effect<PluginCreateSkillResult, PluginsServiceError>;
  readonly saveAppToken: (
    input: PluginAppTokenInput,
  ) => Effect.Effect<PluginsSnapshot, PluginsServiceError>;
  readonly importManifest: (
    input: PluginImportInput,
  ) => Effect.Effect<PluginImportResult, PluginsServiceError>;
  readonly addMarketplace: (
    input: PluginMarketplaceInput,
  ) => Effect.Effect<PluginMarketplaceResult, PluginsServiceError>;
  readonly refreshMarketplace: (
    input: PluginSourceInput,
  ) => Effect.Effect<PluginMarketplaceResult, PluginsServiceError>;
  readonly removeMarketplace: (
    input: PluginSourceInput,
  ) => Effect.Effect<PluginsSnapshot, PluginsServiceError>;
  /** Gateway access for one chat session; undefined when no plugin is usable. */
  readonly registerSession: Effect.Effect<PluginGatewaySession | undefined, PluginsServiceError>;
  readonly unregisterSession: (bearerToken: string) => Effect.Effect<void>;
}

export class PluginsService extends ServiceMap.Service<PluginsService, PluginsServiceShape>()(
  "djl/plugins/PluginsService",
) {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const secretStore = yield* ServerSecretStore;
  // Sign-in happens in the browser, so the server log is the only record of how it ended.
  // Messages carry the plugin and the reason, never a code or a token.
  const runFork = Effect.runForkWith(yield* Effect.services<never>());
  const connections = new PluginConnections({
    get: async (name) => {
      const value = await Effect.runPromise(secretStore.get(name));
      return value ? decoder.decode(value) : null;
    },
    set: (name, value) => Effect.runPromise(secretStore.set(name, encoder.encode(value))),
    remove: (name) => Effect.runPromise(secretStore.remove(name)),
  });
  const skillsDir = djlSkillsDir(config.baseDir);
  const store = new PluginStore(config.stateDir, connections, undefined, skillsDir);
  const gateway = new PluginGateway(
    () => store.gatewayApps(),
    async (params) => {
      try {
        const { pluginId, appId } = await connections.complete(params);
        const name =
          findPluginCatalogEntry(await store.snapshot(), pluginId)?.displayName ?? "The plugin";
        runFork(Effect.logInfo("plugin sign-in finished", { pluginId, appId }));
        return {
          ok: true,
          title: `${name} is connected`,
          detail: "You can close this tab and go back to DJL.",
        };
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        runFork(Effect.logWarning("plugin sign-in failed", { detail }));
        return { ok: false, title: "Sign-in did not finish", detail };
      }
    },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => gateway.close()));
  // Plugins can bring skills; the skill list is cached, so drop the cache once they change.
  const withSkills = <A>(promise: Promise<A>) => promise.finally(invalidateSkillsCatalogCache);
  const run = <A>(operation: string, effect: () => Promise<A>) =>
    Effect.tryPromise({
      try: effect,
      catch: (cause) =>
        new PluginsServiceError({
          operation,
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  return {
    getSnapshot: run("getSnapshot", () => store.snapshot()),
    install: ({ pluginId }) => run("install", () => withSkills(store.install(pluginId))),
    uninstall: ({ pluginId }) => run("uninstall", () => withSkills(store.uninstall(pluginId))),
    setEnabled: ({ pluginId, enabled }) =>
      run("setEnabled", () => store.setEnabled(pluginId, enabled)),
    connectApp: ({ pluginId, appId }) =>
      run("connectApp", async () => {
        const started = await store.connect(pluginId, appId, await gateway.oauthRedirectUri());
        runFork(Effect.logInfo("plugin sign-in started", { pluginId, appId }));
        return { snapshot: await store.snapshot(), ...started };
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("plugin sign-in could not start", { pluginId, detail: error.detail }),
        ),
      ),
    disconnectApp: ({ pluginId, appId }) =>
      run("disconnectApp", () => store.disconnect(pluginId, appId)),
    addCustomServer: (input) => run("addCustomServer", () => store.addCustomServer(input)),
    createSkill: (input) =>
      run("createSkill", async () => {
        const created = await createSkill(skillsDir, input);
        // The skill list is cached for a while; without this the new skill would not show up.
        invalidateSkillsCatalogCache();
        return created;
      }),
    saveAppToken: (input) => run("saveAppToken", () => store.saveAppToken(input)),
    importManifest: ({ manifest }) =>
      run("importManifest", () => withSkills(store.importManifest(manifest))),
    addMarketplace: (input) => run("addMarketplace", () => store.addMarketplace(input)),
    refreshMarketplace: (input) => run("refreshMarketplace", () => store.refreshMarketplace(input)),
    removeMarketplace: (input) =>
      run("removeMarketplace", () => withSkills(store.removeMarketplace(input))),
    registerSession: run("registerSession", () => gateway.registerSession()),
    unregisterSession: (bearerToken) => Effect.sync(() => gateway.unregisterSession(bearerToken)),
  } satisfies PluginsServiceShape;
});

export const PluginsLive = Layer.effect(PluginsService, make);
