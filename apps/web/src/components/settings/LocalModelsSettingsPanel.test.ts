import type { LocalInstalledModel } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { installedModelRemovalAction } from "./LocalModelsSettingsPanel";
import { installProgressPercent } from "./LocalModelHero";

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

  it("clamps download progress and handles unknown totals", () => {
    expect(installProgressPercent(50, 100)).toBe(50);
    expect(installProgressPercent(120, 100)).toBe(100);
    expect(installProgressPercent(10, null)).toBeNull();
  });
});
