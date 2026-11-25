import { WorkMcpServer } from "../../work/Services/WorkMcpServer";
import { PluginsService } from "../../plugins/PluginsService";
import { Effect, Layer, ServiceMap, Option } from "effect";
import type { ProviderAdapterShape } from "../../provider/Services/ProviderAdapter";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "../../provider/Errors";
import { ServerSettingsService } from "../../serverSettings";
import { applyChatAccount, nativeProfileOptions } from "./profile";
import type { NativeDriverFactory, NativeProvider } from "./types";
import { makeNativeAdapter } from "./adapter";
import { createCodexDriver } from "./codex";
import { transcribeNativeCodexVoice } from "./codexTranscription";
import {
  createClaudeDriverWithBackends,
  createGroupMemberClaudeDriver,
  createLentClaudeDriver,
} from "./claude";
import type { ProviderModelDescriptor } from "@djl/contracts";
import { CodingPlans } from "../../codingPlans/CodingPlans";
import {
  buildClaudeBackendEnv,
  OLLAMA_SLUG_PREFIX,
  ollamaContextWindow,
  ollamaModelMaxContext,
  ollamaPickerModels,
  parseModelBackend,
} from "../../codingPlans/backend";
import {
  LocalModelsService,
  type LocalModelsServiceShape,
} from "../../localModels/LocalModelsService";
import { createCursorDriver } from "./cursor";
import { createGeminiDriver } from "./gemini";
import { createGroupDriverFactory } from "./group/groupDriver";
import { createLentAgents } from "./group/lentAgent";
import { GroupDriverBridge } from "../../groups/Services/GroupDriverBridge";
import { resolveAttachmentPath } from "../../attachmentStore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GroupMemberProvider } from "@djl/contracts";
import { createGrokDriver } from "./grok";
import { createKimiDriver } from "./kimi";
import { createIFlowDriver } from "./iflow";
import { createQwenDriver } from "./qwen";
import { createCopilotDriver } from "./copilot";
import { createPiDriver } from "./pi";
import { createCodeBuddyDriver } from "./codebuddy";
import { createMuseDriver } from "./muse";
import { createClaudeCompatibleDriverFactory } from "./claudeCompatible";
import { createDjlCloudDriverFactory } from "./djlCloud";
import { ServerConfig } from "../../config";
import { VoiceTranscriptionError } from "../../voiceTranscription";

export class NativeCodexAdapter extends ServiceMap.Service<
  NativeCodexAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/CodexAdapter") {}
export class NativeClaudeAdapter extends ServiceMap.Service<
  NativeClaudeAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/ClaudeAdapter") {}
export class NativeCursorAdapter extends ServiceMap.Service<
  NativeCursorAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/CursorAdapter") {}
export class NativeGeminiAdapter extends ServiceMap.Service<
  NativeGeminiAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/GeminiAdapter") {}
export class NativeGrokAdapter extends ServiceMap.Service<
  NativeGrokAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/GrokAdapter") {}

export class NativeKimiAdapter extends ServiceMap.Service<
  NativeKimiAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/KimiAdapter") {}
export class NativeIFlowAdapter extends ServiceMap.Service<
  NativeIFlowAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/IFlowAdapter") {}
export class NativeQwenAdapter extends ServiceMap.Service<
  NativeQwenAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/QwenAdapter") {}
export class NativeCopilotAdapter extends ServiceMap.Service<
  NativeCopilotAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/CopilotAdapter") {}
export class NativeCodeBuddyAdapter extends ServiceMap.Service<
  NativeCodeBuddyAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/CodeBuddyAdapter") {}
export class NativeDjlCloudAdapter extends ServiceMap.Service<
  NativeDjlCloudAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/DjlCloudAdapter") {}
export class NativeGroupAdapter extends ServiceMap.Service<
  NativeGroupAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/GroupAdapter") {}
export class NativePiAdapter extends ServiceMap.Service<
  NativePiAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/PiAdapter") {}
export class NativeMuseAdapter extends ServiceMap.Service<
  NativeMuseAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/MuseAdapter") {}
export class NativeDoubaoAdapter extends ServiceMap.Service<
  NativeDoubaoAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/DoubaoAdapter") {}
export class NativeDeepSeekAdapter extends ServiceMap.Service<
  NativeDeepSeekAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("djl/native/DeepSeekAdapter") {}

/** Harnesses that are handed the user's connected plugins. */
// Pi reaches them through a DJL extension and DJL Cloud through its own tool loop.
const PLUGIN_PROVIDERS: ReadonlyArray<NativeProvider> = [
  "codex",
  "claudeAgent",
  "cursor",
  "gemini",
  "grok",
  "kimi",
  "iflow",
  "qwen",
  "copilot",
  "codebuddy",
  "pi",
  "muse",
  "doubao",
  "deepseek",
  "djlCloud",
  "group",
];

export const makeConfiguredNativeAdapter = (
  provider: NativeProvider,
  baseFactory: NativeDriverFactory,
  extraModels?: () => Promise<ReadonlyArray<ProviderModelDescriptor>>,
) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const workTools = yield* Effect.serviceOption(WorkMcpServer);
    const plugins = yield* Effect.serviceOption(PluginsService);
    const config = yield* Effect.serviceOption(ServerConfig);
    const factory: NativeDriverFactory = async (input, sink, registration) => {
      if (Option.isNone(plugins) || !PLUGIN_PROVIDERS.includes(provider))
        return baseFactory(input, sink, registration);
      const service = plugins.value;
      // A chat must still start when plugins cannot be loaded; it just runs without them.
      const session = await Effect.runPromise(
        service.registerSession.pipe(
          Effect.tapError((cause) => Effect.logWarning("plugins unavailable for session", cause)),
          Effect.orElseSucceed(() => undefined),
        ),
      );
      if (!session) return baseFactory(input, sink, registration);
      const release = () => void Effect.runPromise(service.unregisterSession(session.bearerToken));
      try {
        const driver = await baseFactory(input, sink, registration, session);
        return {
          ...driver,
          close: () => {
            try {
              driver.close();
            } finally {
              release();
            }
          },
        };
      } catch (error) {
        release();
        throw error;
      }
    };
    const scopedFactory: NativeDriverFactory = async (input, sink) => {
      if (
        !["codex", "claudeAgent", "djlCloud"].includes(provider) ||
        Option.isNone(workTools) ||
        !input.cwd
      )
        return factory(input, sink);
      const tools = workTools.value;
      const registration = await Effect.runPromise(
        tools.registerSession({
          threadId: input.threadId,
          provider,
          requestComputerApproval: async (request, signal) => {
            const answer = await sink.request(
              "command_execution_approval",
              {
                tool: request.tool,
                input: request.arguments,
                computerControl: true,
                foreground: request.foreground,
              },
              signal,
            );
            return typeof answer === "string" ? answer : "decline";
          },
          authorizedRoot: input.cwd,
          ...(Option.isSome(config) ? { attachmentsRoot: config.value.attachmentsDir } : {}),
        }),
      );
      try {
        const driver = await factory(input, sink, registration);
        return {
          ...driver,
          send: async (request) => {
            const computerTurnId = await registration.computer?.begin(
              request.computerControl,
              request.computerActivityHistory === true,
            );
            try {
              await driver.send(request);
            } finally {
              if (computerTurnId) await registration.computer?.end(computerTurnId);
            }
          },
          interrupt: async () => {
            await registration.computer?.end();
            await driver.interrupt();
          },
          close: () => {
            void registration.computer?.end().catch(() => undefined);
            try {
              driver.close();
            } finally {
              void Effect.runPromise(tools.unregisterSession(registration.bearerToken)).catch(
                () => undefined,
              );
            }
          },
        };
      } catch (error) {
        await Effect.runPromise(tools.unregisterSession(registration.bearerToken));
        throw error;
      }
    };
    const adapter = yield* makeNativeAdapter(
      provider,
      scopedFactory,
      async () => nativeProfileOptions(provider, await Effect.runPromise(settings.getSettings)),
      extraModels,
      async (options) =>
        applyChatAccount(provider, options, await Effect.runPromise(settings.getSettings)),
    );
    if (provider !== "codex") return adapter;
    return {
      ...adapter,
      transcribeVoice: (input) =>
        Effect.tryPromise({
          try: async () =>
            transcribeNativeCodexVoice(
              input,
              nativeProfileOptions("codex", await Effect.runPromise(settings.getSettings)),
            ),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: "codex",
              method: "transcribeVoice",
              detail: cause instanceof Error ? cause.message : "Native voice transcription failed.",
              ...(cause instanceof VoiceTranscriptionError ? { cause } : {}),
            }),
        }),
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });

/**
 * Downloaded Ollama models, listed under a harness when Settings › Local Models has
 * "Use with" switched on for it. Empty outside the desktop app or when Ollama is absent.
 */
const localOllamaModels = (harness: "claudeAgent" | "codex") =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const localModels = yield* Effect.serviceOption(LocalModelsService);
    return async (): Promise<ProviderModelDescriptor[]> => {
      if (Option.isNone(localModels)) return [];
      const current = await Effect.runPromise(settings.getSettings);
      if (!current.localModels.harnesses[harness]) return [];
      const snapshot = await Effect.runPromise(localModels.value.getSnapshot).catch(() => null);
      return ollamaPickerModels(snapshot?.installedModels ?? []);
    };
  });

/** Starts a stopped Ollama before a local-model session, like OpenCode's preflight does. */
const ensureOllamaFor =
  (localModels: Option.Option<LocalModelsServiceShape>) => async (model: string) => {
    if (Option.isNone(localModels))
      throw new Error("Local models are only available in the desktop app");
    await Effect.runPromise(
      localModels.value.ensureRuntimeForModel(`${OLLAMA_SLUG_PREFIX}${model}`),
    );
  };

const NativeClaudeAdapterLive = Layer.effect(
  NativeClaudeAdapter,
  Effect.gen(function* () {
    const plans = yield* Effect.serviceOption(CodingPlans);
    const ensureOllama = ensureOllamaFor(yield* Effect.serviceOption(LocalModelsService));
    const listLocal = yield* localOllamaModels("claudeAgent");
    return yield* makeConfiguredNativeAdapter(
      "claudeAgent",
      createClaudeDriverWithBackends(async (backend) => {
        if (backend.kind === "default") return undefined;
        if (backend.kind === "ollama") {
          await ensureOllama(backend.model);
          const [served, modelMax] = await Promise.all([
            ollamaContextWindow(backend.model),
            ollamaModelMaxContext(backend.model),
          ]);
          return buildClaudeBackendEnv(process.env, backend, undefined, {
            contextTokens: served,
            ollamaWindow: { served, modelMax },
          });
        }
        const key = Option.isSome(plans) ? await plans.value.readKey(backend.plan.id) : null;
        return buildClaudeBackendEnv(process.env, backend, key ?? undefined);
      }),
      async () => [
        ...(Option.isSome(plans) ? await plans.value.connectedModels() : []),
        ...(await listLocal()),
      ],
    );
  }),
);

const NativeCodexAdapterLive = Layer.effect(
  NativeCodexAdapter,
  Effect.gen(function* () {
    const ensureOllama = ensureOllamaFor(yield* Effect.serviceOption(LocalModelsService));
    const listLocal = yield* localOllamaModels("codex");
    return yield* makeConfiguredNativeAdapter(
      "codex",
      async (input, sink, workTools, plugins) => {
        const backend = parseModelBackend(input.modelSelection?.model);
        if (backend.kind === "ollama") await ensureOllama(backend.model);
        return createCodexDriver(input, sink, workTools, plugins);
      },
      listLocal,
    );
  }),
);

const MAX_PASTED_SKILL_CHARS = 24_000;

const NativeGroupAdapterLive = Layer.effect(
  NativeGroupAdapter,
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const bridge = yield* GroupDriverBridge;
    const config = yield* ServerConfig;
    // Members run the plain drivers: DJL's work tools are registered per thread, and every
    // member shares the group's thread.
    const childFactories = {
      codex: createCodexDriver,
      claudeAgent: createGroupMemberClaudeDriver,
      cursor: createCursorDriver,
      gemini: createGeminiDriver,
      grok: createGrokDriver,
      kimi: createKimiDriver,
      iflow: createIFlowDriver,
      qwen: createQwenDriver,
      codebuddy: createCodeBuddyDriver,
      pi: createPiDriver,
    };
    const childOptions = async (provider: GroupMemberProvider) =>
      nativeProfileOptions(provider, await Effect.runPromise(settings.getSettings));
    bridge.attachLentAgents(
      createLentAgents({
        childFactories: { claudeAgent: createLentClaudeDriver },
        childOptions,
        workRoot: join(config.stateDir, "lent-agents"),
      }),
    );
    return yield* makeConfiguredNativeAdapter(
      "group",
      createGroupDriverFactory({
        bridge: () => bridge.current(),
        childFactories,
        childOptions,
        resolveAttachment: (attachment) =>
          resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment }),
        readSkill: async (path) =>
          (await readFile(path, "utf8")).trim().slice(0, MAX_PASTED_SKILL_CHARS),
      }),
    );
  }),
);

export const NativeHarnessesLive = Layer.mergeAll(
  NativeGroupAdapterLive,
  NativeCodexAdapterLive,
  NativeClaudeAdapterLive,
  Layer.effect(NativeCursorAdapter, makeConfiguredNativeAdapter("cursor", createCursorDriver)),
  Layer.effect(NativeGeminiAdapter, makeConfiguredNativeAdapter("gemini", createGeminiDriver)),
  Layer.effect(NativeGrokAdapter, makeConfiguredNativeAdapter("grok", createGrokDriver)),
  Layer.effect(NativeKimiAdapter, makeConfiguredNativeAdapter("kimi", createKimiDriver)),
  Layer.effect(NativeIFlowAdapter, makeConfiguredNativeAdapter("iflow", createIFlowDriver)),
  Layer.effect(NativeQwenAdapter, makeConfiguredNativeAdapter("qwen", createQwenDriver)),
  Layer.effect(NativeCopilotAdapter, makeConfiguredNativeAdapter("copilot", createCopilotDriver)),
  Layer.effect(
    NativeCodeBuddyAdapter,
    makeConfiguredNativeAdapter("codebuddy", createCodeBuddyDriver),
  ),
  Layer.effect(NativePiAdapter, makeConfiguredNativeAdapter("pi", createPiDriver)),
  Layer.effect(NativeMuseAdapter, makeConfiguredNativeAdapter("muse", createMuseDriver)),
  Layer.effect(
    NativeDoubaoAdapter,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return yield* makeConfiguredNativeAdapter(
        "doubao",
        createClaudeCompatibleDriverFactory({ provider: "doubao", secretsDir: config.secretsDir }),
      );
    }),
  ),
  Layer.effect(
    NativeDeepSeekAdapter,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return yield* makeConfiguredNativeAdapter(
        "deepseek",
        createClaudeCompatibleDriverFactory({
          provider: "deepseek",
          secretsDir: config.secretsDir,
        }),
      );
    }),
  ),
  Layer.effect(
    NativeDjlCloudAdapter,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return yield* makeConfiguredNativeAdapter(
        "djlCloud",
        createDjlCloudDriverFactory({ secretsDir: config.secretsDir }),
      );
    }),
  ),
);
