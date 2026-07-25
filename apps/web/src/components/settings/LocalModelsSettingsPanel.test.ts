import type { LocalModelRecommendation, LocalModelsSnapshot } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  installProgressPercent,
  quickSetupViewModel,
  recommendationSourceForRuntime,
} from "./LocalModelsSettingsPanel";

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

describe("LocalModelsSettingsPanel helpers", () => {
  it("resolves the runtime-specific model source", () => {
    expect(recommendationSourceForRuntime(recommendation, "ollama")?.modelId).toBe("granite4.1:3b");
    expect(recommendationSourceForRuntime(recommendation, "lmstudio")?.modelId).toBe(
      "ibm/granite-4.1-3b",
    );
  });

  it("clamps download progress and handles unknown totals", () => {
    expect(installProgressPercent(50, 100)).toBe(50);
    expect(installProgressPercent(120, 100)).toBe(100);
    expect(installProgressPercent(10, null)).toBeNull();
  });

  it("offers one-click setup, blocks low disk, and becomes ready when installed", () => {
    const snapshot: LocalModelsSnapshot = {
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 20 * 1024 ** 3,
      recommendedModelId: recommendation.id,
      runtimes: [
        {
          runtime: "ollama",
          name: "Ollama",
          state: "not_installed",
          version: null,
          endpoint: "http://127.0.0.1:11434",
          installerUrl: "https://ollama.com/download",
          installationKind: null,
          estimatedDownloadBytes: 300 * 1024 ** 2,
          detail: null,
          capabilities: {
            canStart: false,
            canInstallModels: false,
            canCancelInstall: false,
            canDeleteModels: false,
          },
        },
        {
          runtime: "lmstudio",
          name: "LM Studio",
          state: "not_installed",
          version: null,
          endpoint: "http://127.0.0.1:1234/v1",
          installerUrl: "https://lmstudio.ai/download",
          installationKind: null,
          estimatedDownloadBytes: 300 * 1024 ** 2,
          detail: null,
          capabilities: {
            canStart: false,
            canInstallModels: false,
            canCancelInstall: false,
            canDeleteModels: false,
          },
        },
      ],
      recommendations: [recommendation],
      installedModels: [],
      runtimeInstallJobs: [],
      installJobs: [],
      setupJobs: [],
    };

    expect(quickSetupViewModel(snapshot)).toMatchObject({
      action: "setup",
      insufficientDisk: false,
    });
    expect(quickSetupViewModel(snapshot, "lmstudio")).toMatchObject({
      action: "setup",
      insufficientDisk: false,
      runtime: { runtime: "lmstudio" },
      source: { runtime: "lmstudio", modelId: "ibm/granite-4.1-3b" },
    });
    expect(quickSetupViewModel({ ...snapshot, freeDiskBytes: 1_024 })).toMatchObject({
      action: "setup",
      insufficientDisk: true,
    });
    expect(
      quickSetupViewModel({
        ...snapshot,
        installedModels: [
          {
            runtime: "ollama",
            modelId: "granite4.1:3b",
            name: "Granite 4.1 3B",
            sizeBytes: 2 * 1024 ** 3,
            contextWindowTokens: null,
            supportsToolCalls: true,
          },
        ],
      }),
    ).toMatchObject({ action: "ready", insufficientDisk: false });
  });
});
