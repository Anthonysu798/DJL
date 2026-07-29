import type {
  LocalInstalledModel,
  LocalModelRecommendation,
  LocalModelsSnapshot,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import * as localModelsPanel from "./LocalModelsSettingsPanel";
import {
  installedModelRemovalAction,
  quickSetupViewModel,
  recommendationSourceForRuntime,
} from "./LocalModelsSettingsPanel";
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

const recommendation: LocalModelRecommendation = {
  id: "granite-4.1-3b",
  supportsToolCalls: true,
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

const codingRecommendation: LocalModelRecommendation = {
  id: "qwen2.5-coder-7b",
  supportsToolCalls: true,
  name: "Qwen2.5 Coder 7B",
  description: "Coding specialist.",
  minimumMemoryBytes: 12 * 1024 ** 3,
  sources: [
    {
      runtime: "ollama",
      modelId: "qwen2.5-coder:7b",
      estimatedDownloadBytes: 4.7 * 1024 ** 3,
    },
    {
      runtime: "lmstudio",
      modelId: "qwen/qwen2.5-coder-7b-instruct",
      estimatedDownloadBytes: 5 * 1024 ** 3,
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
  it("offers one-click setup, blocks low disk, and becomes ready when installed", () => {
    const snapshot: LocalModelsSnapshot = {
      totalMemoryBytes: 8 * 1024 ** 3,
      hardware: {
        totalMemoryBytes: 8 * 1024 ** 3,
        cpuModel: "Test CPU",
        cpuCores: 4,
        acceleration: "cpu_only",
        gpuName: null,
        vramBytes: null,
        usableModelBytes: 4 * 1024 ** 3,
      },
      freeDiskBytes: 20 * 1024 ** 3,
      recommendedModelId: recommendation.id,
      recommendedModelIdsByUseCase: {
        general: recommendation.id,
        document: recommendation.id,
        reasoning: recommendation.id,
        coding: codingRecommendation.id,
      },
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
      recommendations: [recommendation, codingRecommendation],
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
    expect(quickSetupViewModel(snapshot, "ollama", "coding")).toMatchObject({
      action: "setup",
      recommendation: { id: codingRecommendation.id },
      source: { runtime: "ollama", modelId: "qwen2.5-coder:7b" },
    });
    expect(
      quickSetupViewModel(
        {
          ...snapshot,
          setupJobs: [
            {
              id: "coding-setup",
              runtime: "ollama",
              useCase: "coding",
              recommendationId: recommendation.id,
              modelId: "granite4.1:3b",
              state: "downloading_model",
              downloadedBytes: 512,
              totalBytes: 1_024,
              message: "Choosing a more compatible local AI…",
              startedAt: "2026-07-28T12:00:00.000Z",
              finishedAt: null,
            },
          ],
        },
        "ollama",
        "coding",
      ),
    ).toMatchObject({
      recommendation: { id: recommendation.id },
      setupJob: { id: "coding-setup", state: "downloading_model" },
      source: { modelId: "granite4.1:3b" },
    });
    expect(
      quickSetupViewModel(
        { ...snapshot, recommendedModelIdsByUseCase: undefined },
        "ollama",
        "coding",
      ),
    ).toMatchObject({ recommendation: { id: recommendation.id } });
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

    expect(
      quickSetupViewModel({
        ...snapshot,
        setupJobs: [
          {
            id: "stale-ready-setup",
            runtime: "ollama",
            useCase: "general",
            recommendationId: recommendation.id,
            modelId: "granite4.1:3b",
            state: "ready",
            downloadedBytes: 2 * 1024 ** 3,
            totalBytes: 2 * 1024 ** 3,
            message: "Ready.",
            startedAt: "2026-07-28T13:00:00.000Z",
            finishedAt: "2026-07-28T13:05:00.000Z",
          },
        ],
      }),
    ).toMatchObject({ action: "setup", setupJob: undefined });

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
        setupJobs: [
          {
            id: "failed-canary-setup",
            runtime: "ollama",
            useCase: "general",
            recommendationId: recommendation.id,
            modelId: "granite4.1:3b",
            state: "failed",
            downloadedBytes: 2 * 1024 ** 3,
            totalBytes: 2 * 1024 ** 3,
            message: "The real inference check failed.",
            startedAt: "2026-07-28T14:00:00.000Z",
            finishedAt: "2026-07-28T14:05:00.000Z",
          },
        ],
      }),
    ).toMatchObject({
      action: "setup",
      setupJob: { id: "failed-canary-setup", state: "failed" },
    });
  });
});
