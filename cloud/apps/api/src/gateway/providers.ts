/**
 * Builds the provider map from environment. With DJL_MOCK_EXTERNALS the
 * gateway gets a deterministic fake provider so local development and tests
 * never touch a paid API.
 */
import {
  createAnthropicAdapter,
  createOpenAiCompatibleAdapter,
  KeyRing,
  type ProviderAdapter,
  type ProviderId,
} from "@djl/providers";

import type { ApiEnv } from "../config/env.ts";
import { createFakeProvider } from "./fakeProvider.ts";

export function buildProviders(
  env: Pick<ApiEnv, "mockExternals">,
  processEnv: NodeJS.ProcessEnv,
  onAlert: (alert: {
    readonly severity: "warn" | "p0";
    readonly title: string;
    readonly body: string;
  }) => void,
): Partial<Record<ProviderId, ProviderAdapter>> {
  if (env.mockExternals) {
    const fake = createFakeProvider();
    return {
      openai: { ...fake, id: "openai" },
      anthropic: { ...fake, id: "anthropic" },
      openrouter: { ...fake, id: "openrouter" },
    };
  }
  const providers: Partial<Record<ProviderId, ProviderAdapter>> = {};
  const switched = (provider: string) =>
    onAlert({
      severity: "p0",
      title: `${provider} primary key rejected`,
      body: "Switched to the fallback key. Rotate the primary now.",
    });
  if (processEnv.OPENAI_API_KEY) {
    providers.openai = createOpenAiCompatibleAdapter({
      id: "openai",
      baseUrl: "https://api.openai.com/v1",
      keys: new KeyRing(processEnv.OPENAI_API_KEY, processEnv.OPENAI_API_KEY_FALLBACK ?? null),
      onKeySwitched: switched,
    });
  }
  if (processEnv.ANTHROPIC_API_KEY) {
    providers.anthropic = createAnthropicAdapter({
      keys: new KeyRing(
        processEnv.ANTHROPIC_API_KEY,
        processEnv.ANTHROPIC_API_KEY_FALLBACK ?? null,
      ),
      onKeySwitched: () => switched("anthropic"),
    });
  }
  if (processEnv.OPENROUTER_API_KEY) {
    providers.openrouter = createOpenAiCompatibleAdapter({
      id: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      keys: new KeyRing(
        processEnv.OPENROUTER_API_KEY,
        processEnv.OPENROUTER_API_KEY_FALLBACK ?? null,
      ),
      extraHeaders: { "HTTP-Referer": "https://slcor.com", "X-Title": "DJL Cloud" },
      onKeySwitched: switched,
    });
  }
  return providers;
}
