import type { LocalModelRecommendation } from "@synara/contracts";

const GIB = 1024 ** 3;
const estimatedBytes = (gibibytes: number): number => Math.round(gibibytes * GIB);

export const LOCAL_MODEL_RECOMMENDATIONS = [
  {
    id: "qwen3-1.7b",
    name: "Qwen3 1.7B",
    description: "A fast chat model for low-memory computers with 4 GB or more.",
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
    id: "granite-4.1-3b",
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
    id: "qwen3.5-2b",
    name: "Qwen3.5 2B",
    description: "A compact tool-capable chat model tuned for computers with 8 GB of memory.",
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
    id: "gpt-oss-20b",
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
    name: "Qwen3 Coder 30B",
    description: "The strongest curated local coding option, intended for 32 GB systems.",
    minimumMemoryBytes: 32 * GIB,
    sources: [
      { runtime: "ollama", modelId: "qwen3-coder:30b", estimatedDownloadBytes: 19 * GIB },
      { runtime: "lmstudio", modelId: "qwen/qwen3-coder-30b", estimatedDownloadBytes: 19 * GIB },
    ],
  },
] as const satisfies ReadonlyArray<LocalModelRecommendation>;

export function recommendLocalModel(totalMemoryBytes: number): LocalModelRecommendation | null {
  return (
    LOCAL_MODEL_RECOMMENDATIONS.filter(
      (recommendation) => recommendation.minimumMemoryBytes <= totalMemoryBytes,
    ).at(-1) ??
    LOCAL_MODEL_RECOMMENDATIONS[0] ??
    null
  );
}

export function isCuratedLocalModel(runtime: string, modelId: string): boolean {
  return LOCAL_MODEL_RECOMMENDATIONS.some((recommendation) =>
    recommendation.sources.some(
      (source) => source.runtime === runtime && source.modelId === modelId,
    ),
  );
}
