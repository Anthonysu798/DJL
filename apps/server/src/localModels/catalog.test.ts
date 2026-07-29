import type { LocalHardwareAcceleration } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  curatedModelDisplayName,
  nextSmallerRecommendation,
  isCuratedLocalModel,
  LOCAL_MODEL_RECOMMENDATIONS,
  parseParameterCount,
  recommendLocalModel,
  toolCallSupportForParameterSize,
} from "./catalog";
import { usableModelBytes } from "./hardwareProfile";
import { buildOpenCodeLocalProviderConfig } from "./openCodeConfig";

const GIB = 1024 ** 3;

function recommendFor(input: {
  acceleration: LocalHardwareAcceleration;
  totalMemoryBytes: number;
  vramBytes?: number | null;
}) {
  return recommendLocalModel(usableModelBytes(input))?.id;
}

describe("local model catalog", () => {
  it("selects the largest model whose weights fit the budget", () => {
    expect(recommendLocalModel(0)?.id).toBe("qwen3-1.7b");
    expect(recommendLocalModel(2 * GIB)?.id).toBe("qwen3.5-2b");
    expect(recommendLocalModel(5 * GIB)?.id).toBe("qwen2.5-coder-7b");
    expect(recommendLocalModel(14 * GIB)?.id).toBe("gpt-oss-20b");
    expect(recommendLocalModel(21 * GIB)?.id).toBe("qwen3-coder-30b");
  });

  it("gives three machines with the same RAM three different recommendations", () => {
    const totalMemoryBytes = 32 * GIB;
    expect(recommendFor({ acceleration: "apple_unified", totalMemoryBytes })).toBe("gpt-oss-20b");
    expect(recommendFor({ acceleration: "discrete_gpu", totalMemoryBytes, vramBytes: 8 * GIB })).toBe(
      "qwen2.5-coder-7b",
    );
    expect(recommendFor({ acceleration: "cpu_only", totalMemoryBytes })).toBe("qwen2.5-coder-7b");
  });

  it("scales across Apple Silicon memory tiers", () => {
    expect(recommendFor({ acceleration: "apple_unified", totalMemoryBytes: 8 * GIB })).toBe(
      "granite-4.1-3b",
    );
    expect(recommendFor({ acceleration: "apple_unified", totalMemoryBytes: 16 * GIB })).toBe(
      "qwen2.5-coder-7b",
    );
    expect(recommendFor({ acceleration: "apple_unified", totalMemoryBytes: 48 * GIB })).toBe(
      "qwen3-coder-30b",
    );
  });

  it("never recommends a 19 GB model to a CPU-only machine that merely has the RAM", () => {
    expect(recommendFor({ acceleration: "cpu_only", totalMemoryBytes: 64 * GIB })).not.toBe(
      "qwen3-coder-30b",
    );
    expect(recommendFor({ acceleration: "cpu_only", totalMemoryBytes: 8 * GIB })).toBe("qwen3.5-2b");
    expect(recommendFor({ acceleration: "cpu_only", totalMemoryBytes: 16 * GIB })).toBe(
      "granite-4.1-3b",
    );
  });

  it("falls back to the smallest model when nothing fits the budget", () => {
    expect(recommendFor({ acceleration: "cpu_only", totalMemoryBytes: 4 * GIB })).toBe("qwen3-1.7b");
  });

  it("orders the catalog by download size so the fallback is the smallest entry", () => {
    const weights = LOCAL_MODEL_RECOMMENDATIONS.map(
      (recommendation) =>
        recommendation.sources.find(({ runtime }) => runtime === "ollama")?.estimatedDownloadBytes ??
        0,
    );
    expect(weights).toEqual([...weights].toSorted((left, right) => left - right));
  });

  it("fills the 4-7 GB gap that 16 GB Macs and 8 GB VRAM cards land in", () => {
    const tier = LOCAL_MODEL_RECOMMENDATIONS.find(({ id }) => id === "qwen2.5-coder-7b");
    const ollama = tier?.sources.find(({ runtime }) => runtime === "ollama");
    expect(ollama?.modelId).toBe("qwen2.5-coder:7b");
    expect(ollama?.estimatedDownloadBytes).toBeGreaterThan(4 * GIB);
    expect(ollama?.estimatedDownloadBytes).toBeLessThan(7 * GIB);
  });

  it("has an Ollama and LM Studio source for every recommendation", () => {
    for (const recommendation of LOCAL_MODEL_RECOMMENDATIONS) {
      expect(recommendation.sources.map(({ runtime }) => runtime).toSorted()).toEqual([
        "lmstudio",
        "ollama",
      ]);
      for (const source of recommendation.sources) {
        expect(source.estimatedDownloadBytes).toBeGreaterThan(0);
        expect(Number.isInteger(source.estimatedDownloadBytes)).toBe(true);
      }
    }
  });

  it("pins low-memory recommendations to the intended runtime models and Q4 builds", () => {
    const qwen3 = LOCAL_MODEL_RECOMMENDATIONS.find(({ id }) => id === "qwen3-1.7b");
    const qwen35 = LOCAL_MODEL_RECOMMENDATIONS.find(({ id }) => id === "qwen3.5-2b");

    expect(qwen3?.sources).toEqual([
      {
        runtime: "ollama",
        modelId: "qwen3:1.7b",
        estimatedDownloadBytes: Math.round(1.4 * 1024 ** 3),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3-1.7b",
        estimatedDownloadBytes: Math.round(1.4 * 1024 ** 3),
        quantization: "Q4_K_M",
      },
    ]);
    expect(qwen35?.sources).toEqual([
      {
        runtime: "ollama",
        modelId: "qwen3.5:2b-q4_K_M",
        estimatedDownloadBytes: Math.round(1.9 * 1024 ** 3),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3.5-2b",
        estimatedDownloadBytes: Math.round(1.9 * 1024 ** 3),
        quantization: "Q4_K_M",
      },
    ]);
  });

  it("recognizes curated tool-capable runtime model IDs", () => {
    expect(isCuratedLocalModel("ollama", "qwen3:1.7b")).toBe(true);
    expect(isCuratedLocalModel("lmstudio", "qwen/qwen3-1.7b")).toBe(true);
    expect(isCuratedLocalModel("ollama", "qwen3.5:2b-q4_K_M")).toBe(true);
    expect(isCuratedLocalModel("lmstudio", "qwen/qwen3.5-2b")).toBe(true);
    expect(isCuratedLocalModel("lmstudio", "publisher/custom-model")).toBe(false);
  });
});

describe("parameter-size tool gating", () => {
  it("reads both the B and M suffixes Ollama reports", () => {
    expect(parseParameterCount("7.6B")).toBeCloseTo(7.6e9, -6);
    expect(parseParameterCount("494.03M")).toBeCloseTo(494.03e6, -3);
    expect(parseParameterCount("3.1B")).toBeCloseTo(3.1e9, -6);
  });

  it("returns null for values it cannot trust", () => {
    expect(parseParameterCount(undefined)).toBeNull();
    expect(parseParameterCount("")).toBeNull();
    expect(parseParameterCount("unknown")).toBeNull();
    expect(parseParameterCount(7.6)).toBeNull();
  });

  it("refuses tool calls for models too small to drive the agent", () => {
    expect(toolCallSupportForParameterSize("494.03M")).toBe(false);
    expect(toolCallSupportForParameterSize("1.2B")).toBe(false);
  });

  it("leaves larger and unknown models undecided rather than guessing", () => {
    expect(toolCallSupportForParameterSize("7.6B")).toBeNull();
    expect(toolCallSupportForParameterSize(undefined)).toBeNull();
  });
});

describe("curated display names", () => {
  it("names curated models the way the catalog does", () => {
    expect(curatedModelDisplayName("ollama", "qwen2.5-coder:7b")).toBe("Qwen2.5 Coder 7B");
    expect(curatedModelDisplayName("lmstudio", "qwen/qwen3-1.7b")).toBe("Qwen3 1.7B");
  });

  it("has no name for models outside the catalog", () => {
    expect(curatedModelDisplayName("ollama", "some-random:8b")).toBeNull();
  });
});

describe("OpenCode local provider config", () => {
  it("preserves unrelated config and projects installed models by runtime", () => {
    const config = buildOpenCodeLocalProviderConfig(
      { theme: "synara", provider: { openai: { name: "OpenAI" } } },
      [
        {
          runtime: "ollama",
          modelId: "granite4.1:3b",
          name: "Granite 4.1 3B",
          sizeBytes: 2_000,
          contextWindowTokens: null,
          supportsToolCalls: true,
        },
      ],
    );

    expect(config.theme).toBe("synara");
    expect(config.provider.openai).toEqual({ name: "OpenAI" });
    const ollama = config.provider.ollama as {
      options: { baseURL: string };
      models: Record<string, { tool_call: boolean }>;
    };
    expect(ollama.options.baseURL).toBe("http://127.0.0.1:11434/v1");
    expect(ollama.models["granite4.1:3b"]?.tool_call).toBe(true);
    expect(config.provider.lmstudio).toBeUndefined();
  });

  it("tells OpenCode a too-small model cannot take tool calls", () => {
    const config = buildOpenCodeLocalProviderConfig({}, [
      {
        runtime: "ollama",
        modelId: "llama3.2:1b",
        name: "llama3.2:1b",
        sizeBytes: 1_200,
        contextWindowTokens: null,
        supportsToolCalls: false,
      },
    ]);

    const ollama = config.provider.ollama as {
      name: string;
      models: Record<string, { tool_call?: boolean }>;
    };
    // Without this, OpenCode's `tool_call ?? true` default hands the agent a model that stalls.
    expect(ollama.models["llama3.2:1b"]?.tool_call).toBe(false);
    expect(ollama.name).toBe("On this computer");
  });

  it("preserves a stopped runtime that was not inventoried", () => {
    const current = {
      provider: {
        lmstudio: { name: "LM Studio (local)", models: { "saved/model": {} } },
      },
    };
    const config = buildOpenCodeLocalProviderConfig(current, [], new Set(["ollama"]));

    expect(config.provider.lmstudio).toEqual(current.provider.lmstudio);
  });
});

describe("downgrade target", () => {
  it("names the next smaller model when one is too slow", () => {
    expect(nextSmallerRecommendation("qwen3-coder-30b")?.id).toBe("gpt-oss-20b");
    expect(nextSmallerRecommendation("gpt-oss-20b")?.id).toBe("qwen2.5-coder-7b");
    expect(nextSmallerRecommendation("qwen2.5-coder-7b")?.id).toBe("granite-4.1-3b");
  });

  it("has nothing smaller than the smallest model", () => {
    expect(nextSmallerRecommendation("qwen3-1.7b")).toBeNull();
  });

  it("returns null for an unknown model", () => {
    expect(nextSmallerRecommendation("not-a-model")).toBeNull();
  });
});
