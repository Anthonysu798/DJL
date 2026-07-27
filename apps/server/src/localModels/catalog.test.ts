import { describe, expect, it } from "vitest";

import { isCuratedLocalModel, LOCAL_MODEL_RECOMMENDATIONS, recommendLocalModel } from "./catalog";
import { buildOpenCodeLocalProviderConfig } from "./openCodeConfig";

describe("local model catalog", () => {
  it("selects the strongest recommendation that fits memory", () => {
    expect(recommendLocalModel(4 * 1024 ** 3)?.id).toBe("qwen3-1.7b");
    expect(recommendLocalModel(7 * 1024 ** 3)?.id).toBe("qwen3-1.7b");
    expect(recommendLocalModel(8 * 1024 ** 3)?.id).toBe("qwen3.5-2b");
    expect(recommendLocalModel(15 * 1024 ** 3)?.id).toBe("qwen3.5-2b");
    expect(recommendLocalModel(16 * 1024 ** 3)?.id).toBe("gpt-oss-20b");
    expect(recommendLocalModel(32 * 1024 ** 3)?.id).toBe("qwen3-coder-30b");
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
