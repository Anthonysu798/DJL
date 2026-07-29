import type { LocalInstalledModel } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import * as localModelsPanel from "./LocalModelsSettingsPanel";
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
  it("derives loaded and maximum context diagnostics for LM Studio", () => {
    const diagnostics = (
      localModelsPanel as typeof localModelsPanel & {
        localModelContextDiagnostics?: (model: LocalInstalledModel) => unknown;
      }
    ).localModelContextDiagnostics;
    const undersized = {
      ...lmStudioInstalledModel,
      contextWindowTokens: 8_192,
      maxContextWindowTokens: 131_072,
      loadedContextWindowTokens: 8_192,
      toolContextWindowReady: false,
      supportsToolCalls: false,
    } satisfies LocalInstalledModel;
    const ready = {
      ...lmStudioInstalledModel,
      contextWindowTokens: 16_384,
      maxContextWindowTokens: 131_072,
      loadedContextWindowTokens: 16_384,
      toolContextWindowReady: true,
    } satisfies LocalInstalledModel;
    const inherentlySmall = {
      ...lmStudioInstalledModel,
      contextWindowTokens: 8_192,
      maxContextWindowTokens: 8_192,
      loadedContextWindowTokens: 8_192,
      toolContextWindowReady: false,
      supportsToolCalls: false,
    } satisfies LocalInstalledModel;

    expect(diagnostics?.(undersized)).toEqual({
      loadedK: 8,
      maximumK: 128,
      requiredK: 16,
      tooSmallForTools: true,
    });
    expect(diagnostics?.(ready)).toEqual({
      loadedK: 16,
      maximumK: 128,
      requiredK: 16,
      tooSmallForTools: false,
    });
    expect(diagnostics?.(inherentlySmall)).toEqual({
      loadedK: 8,
      maximumK: 8,
      requiredK: 16,
      tooSmallForTools: false,
    });
    expect(diagnostics?.(ollamaInstalledModel)).toBeNull();
  });

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
