import type {
  LocalInstalledModel,
  LocalModelRecommendation,
  LocalModelsSnapshot,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  installedModelRemovalAction,
  isRecommendationBestFit,
  recommendationInstallInputForRuntime,
  recommendationSourceForRuntime,
} from "./LocalModelsSettingsPanel";
import { installProgressPercent } from "./LocalModelCardShelf";

const recommendation: LocalModelRecommendation = {
  id: "granite-4.1-3b",
  name: "Granite 4.1 3B",
  description: "Compact.",
  minimumMemoryBytes: 8 * 1024 ** 3,
  sources: [
    { runtime: "ollama", modelId: "granite4.1:3b", estimatedDownloadBytes: 2 * 1024 ** 3 },
    {
      runtime: "lmstudio",
      modelId: "ibm/granite-4.1-3b",
      estimatedDownloadBytes: 2.2 * 1024 ** 3,
    },
  ],
};

const ollamaInstalledModel = {
  runtime: "ollama",
  modelId: "qwen3.5:2b-q4_K_M",
  name: "Qwen3.5 2B",
  sizeBytes: 2_040_109_466,
  contextWindowTokens: 32_768,
  supportsToolCalls: true,
} satisfies LocalInstalledModel;

const lmStudioInstalledModel = {
  runtime: "lmstudio",
  modelId: "qwen/qwen3.5-2b",
  name: "Qwen3.5 2B (LM Studio)",
  sizeBytes: 2_040_109_466,
  contextWindowTokens: 32_768,
  supportsToolCalls: true,
} satisfies LocalInstalledModel;

describe("LocalModelsSettingsPanel helpers", () => {
  it("creates an exact removal action for Ollama models only", () => {
    expect(installedModelRemovalAction(ollamaInstalledModel)).toEqual({
      type: "remove",
      runtime: "ollama",
      modelId: "qwen3.5:2b-q4_K_M",
    });
    expect(installedModelRemovalAction(lmStudioInstalledModel)).toBeNull();
  });

  it("resolves the runtime-specific model source", () => {
    expect(recommendationSourceForRuntime(recommendation, "ollama")?.modelId).toBe("granite4.1:3b");
    expect(recommendationSourceForRuntime(recommendation, "lmstudio")?.modelId).toBe(
      "ibm/granite-4.1-3b",
    );
  });

  it("marks Qwen3.5 2B as the 8 GB best fit and preserves its LM Studio Q4 install", () => {
    const qwen35 = {
      id: "qwen3.5-2b",
      name: "Qwen3.5 2B",
      description: "A low-memory chat model.",
      minimumMemoryBytes: 8 * 1024 ** 3,
      sources: [
        {
          runtime: "ollama",
          modelId: "qwen3.5:2b-q4_K_M",
          estimatedDownloadBytes: 2_040_109_466,
        },
        {
          runtime: "lmstudio",
          modelId: "qwen/qwen3.5-2b",
          estimatedDownloadBytes: 2_040_109_466,
          quantization: "Q4_K_M",
        },
      ],
    } as const satisfies LocalModelRecommendation;
    const snapshot = {
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 20 * 1024 ** 3,
      recommendedModelId: qwen35.id,
      runtimes: [],
      recommendations: [qwen35],
      installedModels: [],
      runtimeInstallJobs: [],
      installJobs: [],
      setupJobs: [],
    } satisfies LocalModelsSnapshot;

    expect(isRecommendationBestFit(qwen35, snapshot)).toBe(true);
    expect(recommendationInstallInputForRuntime(qwen35, "lmstudio")).toEqual({
      runtime: "lmstudio",
      modelId: "qwen/qwen3.5-2b",
      quantization: "Q4_K_M",
    });
  });

  it("clamps download progress and handles unknown totals", () => {
    expect(installProgressPercent(50, 100)).toBe(50);
    expect(installProgressPercent(120, 100)).toBe(100);
    expect(installProgressPercent(10, null)).toBeNull();
  });
});
