import type { LocalModelRecommendation } from "@synara/contracts";

const GIB = 1024 ** 3;
const estimatedBytes = (gibibytes: number): number => Math.round(gibibytes * GIB);

export const LOCAL_MODEL_RECOMMENDATIONS = [
  {
    id: "qwen3-1.7b",
    supportsToolCalls: false,
    name: "Qwen3 1.7B",
    description: "A fast chat model for low-memory computers with 4 GB or more. Chat only.",
    minimumMemoryBytes: 4 * GIB,
    sources: [
      { runtime: "ollama", modelId: "qwen3:1.7b", estimatedDownloadBytes: estimatedBytes(1.4) },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3-1.7b",
        estimatedDownloadBytes: estimatedBytes(1.4),
        quantization: "Q4_K_M",
      },
    ],
  },
  {
    id: "qwen3.5-2b",
    supportsToolCalls: false,
    name: "Qwen3.5 2B",
    description: "A compact chat model for computers with 8 GB of memory. Chat only.",
    minimumMemoryBytes: 8 * GIB,
    sources: [
      {
        runtime: "ollama",
        modelId: "qwen3.5:2b-q4_K_M",
        estimatedDownloadBytes: estimatedBytes(1.9),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3.5-2b",
        estimatedDownloadBytes: estimatedBytes(1.9),
        quantization: "Q4_K_M",
      },
    ],
  },
  {
    id: "granite-4.1-3b",
    supportsToolCalls: true,
    name: "Granite 4.1 3B",
    description: "A compact coding model for Macs and PCs with 8 GB of memory.",
    minimumMemoryBytes: 8 * GIB,
    sources: [
      { runtime: "ollama", modelId: "granite4.1:3b", estimatedDownloadBytes: estimatedBytes(2.1) },
      {
        runtime: "lmstudio",
        modelId: "ibm/granite-4.1-3b",
        estimatedDownloadBytes: estimatedBytes(2.3),
      },
    ],
  },
  {
    id: "qwen2.5-coder-7b",
    supportsToolCalls: true,
    name: "Qwen2.5 Coder 7B",
    description: "A capable coding model for 16 GB machines and 8 GB graphics cards.",
    minimumMemoryBytes: 16 * GIB,
    sources: [
      { runtime: "ollama", modelId: "qwen2.5-coder:7b", estimatedDownloadBytes: estimatedBytes(4.36) },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen2.5-coder-7b",
        estimatedDownloadBytes: estimatedBytes(4.36),
        quantization: "Q4_K_M",
      },
    ],
  },
  {
    id: "gpt-oss-20b",
    supportsToolCalls: true,
    name: "GPT-OSS 20B",
    description: "A capable local coding model recommended for systems with 16 GB or more.",
    minimumMemoryBytes: 16 * GIB,
    sources: [
      { runtime: "ollama", modelId: "gpt-oss:20b", estimatedDownloadBytes: 13 * GIB },
      { runtime: "lmstudio", modelId: "openai/gpt-oss-20b", estimatedDownloadBytes: 13 * GIB },
    ],
  },
  {
    id: "qwen3-coder-30b",
    supportsToolCalls: true,
    name: "Qwen3 Coder 30B",
    description: "The strongest curated local coding option, intended for 32 GB systems.",
    minimumMemoryBytes: 32 * GIB,
    sources: [
      { runtime: "ollama", modelId: "qwen3-coder:30b", estimatedDownloadBytes: 19 * GIB },
      { runtime: "lmstudio", modelId: "qwen/qwen3-coder-30b", estimatedDownloadBytes: 19 * GIB },
    ],
  },
] as const satisfies ReadonlyArray<LocalModelRecommendation>;

function ollamaWeightBytes(recommendation: LocalModelRecommendation): number {
  return (
    recommendation.sources.find(({ runtime }) => runtime === "ollama")?.estimatedDownloadBytes ??
    Number.POSITIVE_INFINITY
  );
}
// Selection is driven by the weight budget from the hardware profile, not by installed RAM. A
// machine can hold a model it cannot run quickly, and speed is what users judge a local model on.
export function recommendLocalModel(usableModelBytes: number): LocalModelRecommendation | null {
  // The catalog is ordered by ascending weight, so the last entry that fits is the largest one.
  return (
    LOCAL_MODEL_RECOMMENDATIONS.findLast(
      (recommendation) => ollamaWeightBytes(recommendation) <= usableModelBytes,
    ) ??
    LOCAL_MODEL_RECOMMENDATIONS[0] ??
    null
  );
}

// Anything smaller than this cannot hold a tool-calling loop together well enough to drive the
// agent. Handing such a model tool definitions produces a silent stall, not an error.
const MINIMUM_TOOL_CALL_PARAMETERS = 3e9;

// Ollama reports `details.parameter_size` as a human string that mixes units: "7.6B", "494.03M".
export function parseParameterCount(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^([\d.]+)\s*([BM])$/iu.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return match[2]?.toUpperCase() === "B" ? amount * 1e9 : amount * 1e6;
}

// Returns false only when the model is provably too small. Unknown stays null so DJL never claims
// a capability it has not established either way.
export function toolCallSupportForParameterSize(value: unknown): boolean | null {
  const parameters = parseParameterCount(value);
  if (parameters === null) return null;
  return parameters < MINIMUM_TOOL_CALL_PARAMETERS ? false : null;
}

// The tier one step down from a model that turned out too slow here. The catalog is weight-ascending,
// so "smaller" is simply the preceding entry.
export function nextSmallerRecommendation(
  recommendationId: string,
): LocalModelRecommendation | null {
  const index = LOCAL_MODEL_RECOMMENDATIONS.findIndex(({ id }) => id === recommendationId);
  return index > 0 ? (LOCAL_MODEL_RECOMMENDATIONS[index - 1] ?? null) : null;
}

// Whether a curated tier can actually drive the agent, established by running real tool calls
// against it rather than inferred from its size. Returns null for anything outside the catalog.
export function curatedToolSupport(runtime: string, modelId: string): boolean | null {
  const match = LOCAL_MODEL_RECOMMENDATIONS.find((recommendation) =>
    recommendation.sources.some(
      (source) => source.runtime === runtime && source.modelId === modelId,
    ),
  );
  return match ? match.supportsToolCalls : null;
}

export function curatedModelDisplayName(runtime: string, modelId: string): string | null {
  return (
    LOCAL_MODEL_RECOMMENDATIONS.find((recommendation) =>
      recommendation.sources.some(
        (source) => source.runtime === runtime && source.modelId === modelId,
      ),
    )?.name ?? null
  );
}
