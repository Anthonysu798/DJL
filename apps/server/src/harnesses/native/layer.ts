import { Effect, Layer, ServiceMap } from "effect";
import type { ProviderAdapterShape } from "../../provider/Services/ProviderAdapter";
import type { ProviderAdapterError } from "../../provider/Errors";
import { ServerSettingsService } from "../../serverSettings";
import { nativeProfileOptions } from "./profile";
import type { NativeDriverFactory, NativeProvider } from "./types";
import { makeNativeAdapter } from "./adapter";
import { createCodexDriver } from "./codex";
import { createClaudeDriver } from "./claude";
import { createCursorDriver } from "./cursor";
import { createGrokDriver } from "./grok";
import { createKimiDriver } from "./kimi";
import { createIFlowDriver } from "./iflow";
import { createQwenDriver } from "./qwen";

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

export const makeConfiguredNativeAdapter = (
  provider: NativeProvider,
  factory: NativeDriverFactory,
) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    return yield* makeNativeAdapter(provider, factory, async () =>
      nativeProfileOptions(provider, await Effect.runPromise(settings.getSettings)),
    );
  });

export const NativeHarnessesLive = Layer.mergeAll(
  Layer.effect(NativeCodexAdapter, makeConfiguredNativeAdapter("codex", createCodexDriver)),
  Layer.effect(NativeClaudeAdapter, makeConfiguredNativeAdapter("claudeAgent", createClaudeDriver)),
  Layer.effect(NativeCursorAdapter, makeConfiguredNativeAdapter("cursor", createCursorDriver)),
  Layer.effect(NativeGrokAdapter, makeConfiguredNativeAdapter("grok", createGrokDriver)),
  Layer.effect(NativeKimiAdapter, makeConfiguredNativeAdapter("kimi", createKimiDriver)),
  Layer.effect(NativeIFlowAdapter, makeConfiguredNativeAdapter("iflow", createIFlowDriver)),
  Layer.effect(NativeQwenAdapter, makeConfiguredNativeAdapter("qwen", createQwenDriver)),
);
