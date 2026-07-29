import type { LocalInstalledModel, LocalModelRuntime } from "@synara/contracts";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const RUNTIME_CONFIG: Record<
  LocalModelRuntime,
  { readonly name: string; readonly baseURL: string }
> = {
  ollama: { name: "Ollama", baseURL: "http://127.0.0.1:11434/v1" },
  lmstudio: { name: "LM Studio", baseURL: "http://127.0.0.1:1234/v1" },
};

function localOutputLimit(contextWindowTokens: number): number {
  return Math.min(8_192, Math.max(1_024, Math.floor(contextWindowTokens / 4)));
}

export function buildOpenCodeLocalProviderConfig(
  current: JsonObject,
  installedModels: ReadonlyArray<LocalInstalledModel>,
  synchronizedRuntimes: ReadonlySet<LocalModelRuntime> = new Set(["ollama", "lmstudio"]),
): JsonObject & { provider: JsonObject } {
  const provider = { ...(isJsonObject(current.provider) ? current.provider : {}) };

  for (const runtime of ["ollama", "lmstudio"] as const) {
    if (!synchronizedRuntimes.has(runtime)) continue;
    const models = installedModels.filter((model) => model.runtime === runtime);
    if (models.length === 0) {
      delete provider[runtime];
      continue;
    }

    const runtimeConfig = RUNTIME_CONFIG[runtime];
    provider[runtime] = {
      name: runtimeConfig.name,
      npm: "@ai-sdk/openai-compatible",
      options: {
        baseURL: runtimeConfig.baseURL,
        apiKey: "local",
      },
      models: Object.fromEntries(
        models.map((model) => [
          model.modelId,
          {
            id: model.modelId,
            name: model.name,
            ...(model.contextWindowTokens
              ? {
                  limit: {
                    context: model.contextWindowTokens,
                    output: localOutputLimit(model.contextWindowTokens),
                  },
                }
              : {}),
            ...(model.supportsToolCalls !== null ? { tool_call: model.supportsToolCalls } : {}),
          },
        ]),
      ),
    };
  }

  return { ...current, provider };
}
