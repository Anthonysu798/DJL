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
);
