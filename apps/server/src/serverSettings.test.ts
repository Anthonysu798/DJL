import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  ServerSettingsPatch,
} from "@djl/contracts";
import { Effect, Fiber, FileSystem, Layer, Logger, Ref, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ServerConfig } from "./config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "djl-settings-test-",
}).pipe(Layer.provide(NodeServices.layer));
const makeTestLayer = Layer.merge(NodeServices.layer, serverConfigLayer);
const testLayer = Layer.merge(makeTestLayer, ServerSettingsLive.pipe(Layer.provide(makeTestLayer)));

const runWithSettings = <A, E>(
  effect: Effect.Effect<A, E, ServerSettingsService | ServerConfig | FileSystem.FileSystem>,
) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>);

describe("ServerSettingsService", () => {
  it("persists serialized Cloud changes without resetting its region or other providers", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const initial = {
          ...DEFAULT_SERVER_SETTINGS,
          providers: {
            ...DEFAULT_SERVER_SETTINGS.providers,
            djlCloud: { enabled: false, region: "asia" },
          },
        };
        yield* fs.makeDirectory(config.stateDir, { recursive: true });
        yield* fs.writeFileString(config.settingsPath, JSON.stringify(initial));
        yield* service.start;
        const patch = Schema.decodeUnknownSync(ServerSettingsPatch)(
          { providers: { djlCloud: { enabled: true } } },
          { onExcessProperty: "error" },
        );
        const enabled = yield* service.updateSettings(patch);
        const region = Schema.decodeUnknownSync(ServerSettingsPatch)(
          { providers: { djlCloud: { region: "global" } } },
          { onExcessProperty: "error" },
        );
        const updated = yield* service.updateSettings(region);
        return {
          enabled,
          updated,
          saved: JSON.parse(yield* fs.readFileString(config.settingsPath)),
        };
      }),
    );
    expect(result.enabled.providers.djlCloud).toEqual({ enabled: true, region: "asia" });
    expect(result.updated.providers.djlCloud).toEqual({ enabled: true, region: "global" });
    expect(result.saved.providers.djlCloud).toEqual({ enabled: true, region: "global" });
    expect(result.updated.providers.codex).toEqual(DEFAULT_SERVER_SETTINGS.providers.codex);
  });
  it("loads defaults when settings file does not exist", async () => {
    const settings = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        yield* service.start;
        return yield* service.getSettings;
      }),
    );

    expect(settings.providers.codex.binaryPath).toBe("codex");
    expect(settings.providers.grok.binaryPath).toBe("grok");
    expect(settings.defaultThreadEnvMode).toBe("local");
    expect(settings.enableProviderUpdateChecks).toBe(true);
    expect(settings.enableAutomaticProviderUpdates).toBe(false);
  });

  it("persists updates and reloads them", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* service.start;

        const updated = yield* service.updateSettings({
          enableAssistantStreaming: true,
          enableProviderUpdateChecks: false,
          enableAutomaticProviderUpdates: true,
          providers: {
            codex: {
              binaryPath: "/usr/local/bin/codex",
              customModels: ["gpt-custom"],
            },
          },
        });
        const raw = yield* fs.readFileString(settingsPath);
        return { updated, parsed: JSON.parse(raw) as unknown };
      }),
    );

    expect(result.updated.enableAssistantStreaming).toBe(true);
    expect(result.updated.enableProviderUpdateChecks).toBe(false);
    expect(result.updated.enableAutomaticProviderUpdates).toBe(true);
    expect(result.updated.providers.codex.binaryPath).toBe("/usr/local/bin/codex");
    expect(result.parsed).toMatchObject({
      enableAssistantStreaming: true,
      enableProviderUpdateChecks: false,
      enableAutomaticProviderUpdates: true,
      providers: {
        codex: {
          binaryPath: "/usr/local/bin/codex",
          customModels: ["gpt-custom"],
        },
      },
    });
  });

  it("resolves text generation selection away from disabled providers", async () => {
    const settings = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        return yield* service.getSettings;
      }).pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            textGenerationModelSelection: {
              provider: "gemini",
              model: DEFAULT_MODEL_BY_PROVIDER.gemini,
            },
            providers: {
              gemini: { enabled: false },
            },
          }),
        ),
      ),
    );

    expect(settings.textGenerationModelSelection.provider).toBe("codex");
    expect(settings.textGenerationModelSelection.model).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });

  it.each(["codex", "opencode"] as const)(
    "keeps configured %s selection even when generic settings use a fallback",
    async (provider) => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* ServerSettingsService;
          return {
            configured: yield* service.getConfiguredSettings,
            generic: yield* service.getSettings,
          };
        }).pipe(
          Effect.provide(
            ServerSettingsService.layerTest({
              textGenerationModelSelection: { provider, model: "selected-fixture-model" },
              providers: { [provider]: { enabled: false } },
            }),
          ),
        ),
      );
      expect(result.configured.textGenerationModelSelection).toEqual({
        provider,
        model: "selected-fixture-model",
      });
      expect(result.configured.providers[provider].enabled).toBe(false);
      expect(result.generic.textGenerationModelSelection.provider).not.toBe(provider);
    },
  );

  it("reads the actual persisted selection after readiness without substituting a disabled provider", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            ...DEFAULT_SERVER_SETTINGS,
            textGenerationModelSelection: { provider: "codex", model: "persisted-fixture-model" },
            providers: {
              ...DEFAULT_SERVER_SETTINGS.providers,
              codex: { ...DEFAULT_SERVER_SETTINGS.providers.codex, enabled: false },
            },
          }),
        );
        const completed = yield* Ref.make(false);
        const reading = yield* service.getConfiguredSettings.pipe(
          Effect.tap(() => Ref.set(completed, true)),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        expect(yield* Ref.get(completed)).toBe(false);
        yield* service.start;
        return { configured: yield* Fiber.join(reading), generic: yield* service.getSettings };
      }),
    );
    expect(result.configured.textGenerationModelSelection).toEqual({
      provider: "codex",
      model: "persisted-fixture-model",
    });
    expect(result.generic.textGenerationModelSelection.provider).not.toBe("codex");
  });

  it("reads a fresh authoritative selection after each settings update", async () => {
    await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        yield* service.start;
        yield* service.updateSettings({
          textGenerationModelSelection: { provider: "codex", model: "first-fixture" },
          providers: { codex: { enabled: false } },
        });
        expect((yield* service.getConfiguredSettings).textGenerationModelSelection).toEqual({
          provider: "codex",
          model: "first-fixture",
        });
        yield* service.updateSettings({
          textGenerationModelSelection: { provider: "opencode", model: "fixture/second" },
          providers: { opencode: { enabled: false } },
        });
        expect((yield* service.getConfiguredSettings).textGenerationModelSelection).toEqual({
          provider: "opencode",
          model: "fixture/second",
        });
      }),
    );
  });

  it("refuses corrupted-load defaults until an explicit complete model selection is persisted", async () => {
    const warnings: unknown[] = [];
    const logger = Logger.make(({ message }) => {
      warnings.push(message);
    });
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(settingsPath, "{synthetic-invalid-json");
        yield* service.start;
        expect((yield* Effect.exit(service.getConfiguredSettings))._tag).toBe("Failure");
        expect((yield* service.getSettings).textGenerationModelSelection).toEqual(
          DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
        );
        yield* service.updateSettings({ enableAssistantStreaming: false });
        expect((yield* Effect.exit(service.getConfiguredSettings))._tag).toBe("Failure");
        yield* service.updateSettings({
          textGenerationModelSelection: { model: "partial-fixture" },
        });
        expect((yield* Effect.exit(service.getConfiguredSettings))._tag).toBe("Failure");
        yield* service.updateSettings({
          textGenerationModelSelection: { provider: "codex", model: "explicit-fixture" },
        });
        return yield* service.getConfiguredSettings;
      }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false }))),
    );
    expect(result.textGenerationModelSelection).toEqual({
      provider: "codex",
      model: "explicit-fixture",
    });
    expect(JSON.stringify(warnings)).toContain("failed to parse settings.json");
  });

  it("preserves existing model canonicalization on the configured read", async () => {
    const settings = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        return yield* service.getConfiguredSettings;
      }).pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            textGenerationModelSelection: { provider: "opencode", model: "deepseek/deepseek-chat" },
          }),
        ),
      ),
    );
    expect(settings.textGenerationModelSelection.model).toBe("deepseek/deepseek-v4-flash");
  });

  it("routes deprecated DeepSeek text generation selections to V4 Flash", async () => {
    const settings = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        return yield* service.getSettings;
      }).pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            textGenerationModelSelection: {
              provider: "opencode",
              model: "deepseek/deepseek-chat",
            },
          }),
        ),
      ),
    );

    expect(settings.textGenerationModelSelection).toMatchObject({
      provider: "opencode",
      model: "deepseek/deepseek-v4-flash",
    });
  });

  it("rewrites deprecated DeepSeek text generation settings on startup", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            ...DEFAULT_SERVER_SETTINGS,
            textGenerationModelSelection: {
              provider: "opencode",
              model: "deepseek/deepseek-reasoner",
            },
          }),
        );
        yield* service.start;
        return {
          settings: yield* service.getSettings,
          persisted: JSON.parse(yield* fs.readFileString(settingsPath)) as unknown,
        };
      }),
    );

    expect(result.settings.textGenerationModelSelection.model).toBe("deepseek/deepseek-v4-flash");
    expect(result.persisted).toMatchObject({
      textGenerationModelSelection: {
        provider: "opencode",
        model: "deepseek/deepseek-v4-flash",
      },
    });
  });
});
