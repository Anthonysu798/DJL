import type {
  LocalModelRecommendation,
  LocalModelRuntimeStatus,
  LocalModelsSnapshot,
} from "@djl/contracts";
import { describe, expect, it } from "vitest";

import { hardwareProfileFixture } from "../../test/localModelsFixture";
import {
  buildLocalModelCardViewModels,
  codingToolsSupport,
  localModelFit,
  setupCardModel,
  setupStepIndex,
} from "./LocalModelHero";

const GIB = 1024 ** 3;

const recommendations = [
  {
    id: "qwen3-1.7b",
    supportsToolCalls: false,
    name: "Qwen3 1.7B",
    description: "Lightweight chat.",
    minimumMemoryBytes: 4 * GIB,
    sources: [{ runtime: "ollama", modelId: "qwen3:1.7b", estimatedDownloadBytes: 1.4 * GIB }],
  },
  {
    id: "granite-4.1-3b",
    supportsToolCalls: true,
    name: "Granite 4.1 3B",
    description: "Compact coding.",
    minimumMemoryBytes: 8 * GIB,
    sources: [{ runtime: "ollama", modelId: "granite4.1:3b", estimatedDownloadBytes: 2.1 * GIB }],
  },
  {
    id: "qwen3.5-2b",
    supportsToolCalls: false,
    name: "Qwen3.5 2B",
    description: "Compact chat.",
    minimumMemoryBytes: 8 * GIB,
    sources: [
      { runtime: "ollama", modelId: "qwen3.5:2b-q4_K_M", estimatedDownloadBytes: 1.9 * GIB },
    ],
  },
  {
    id: "gpt-oss-20b",
    supportsToolCalls: true,
    name: "GPT-OSS 20B",
    description: "Capable coding.",
    minimumMemoryBytes: 16 * GIB,
    sources: [{ runtime: "ollama", modelId: "gpt-oss:20b", estimatedDownloadBytes: 13 * GIB }],
  },
  {
    id: "qwen3-coder-30b",
    supportsToolCalls: true,
    name: "Qwen3 Coder 30B",
    description: "Strongest coding.",
    minimumMemoryBytes: 32 * GIB,
    sources: [{ runtime: "ollama", modelId: "qwen3-coder:30b", estimatedDownloadBytes: 19 * GIB }],
  },
] satisfies LocalModelRecommendation[];

function ollamaStatus(
  state: LocalModelRuntimeStatus["state"] = "not_installed",
): LocalModelRuntimeStatus {
  return {
    runtime: "ollama",
    name: "Ollama",
    state,
    version: state === "not_installed" ? null : "0.12.0",
    endpoint: "http://127.0.0.1:11434",
    installerUrl: "https://ollama.com/download",
    installationKind: state === "not_installed" ? null : "external",
    estimatedDownloadBytes: 300 * 1024 ** 2,
    detail: state === "error" ? "Ollama could not start." : null,
    capabilities: {
      canStart: state === "stopped",
      canInstallModels: state === "running",
      canCancelInstall: state === "running",
      canDeleteModels: state === "running",
    },
  };
}

function snapshot(
  overrides: Partial<LocalModelsSnapshot> = {},
  runtimeState: LocalModelRuntimeStatus["state"] = "not_installed",
): LocalModelsSnapshot {
  return {
    totalMemoryBytes: 8 * GIB,
    hardware: hardwareProfileFixture({ totalMemoryBytes: 8 * GIB }),
    freeDiskBytes: 40 * GIB,
    recommendedModelId: "qwen3.5-2b",
    runtimes: [ollamaStatus(runtimeState)],
    recommendations,
    installedModels: [],
    runtimeInstallJobs: [],
    installJobs: [],
    setupJobs: [],
    ...overrides,
  };
}

describe("buildLocalModelCardViewModels", () => {
  it("puts the best fit first and keeps oversized models visible but blocked", () => {
    const cards = buildLocalModelCardViewModels(snapshot());

    expect(cards.map(({ recommendation }) => recommendation.id)).toEqual([
      "qwen3.5-2b",
      "qwen3-1.7b",
      "granite-4.1-3b",
      "gpt-oss-20b",
      "qwen3-coder-30b",
    ]);
    expect(cards.map(({ action }) => action)).toEqual([
      "setup",
      "setup",
      "setup",
      "blocked_memory",
      "blocked_memory",
    ]);
  });

  it.each([
    [6, "qwen3-1.7b", ["qwen3-1.7b"]],
    [8, "qwen3.5-2b", ["qwen3.5-2b", "qwen3-1.7b", "granite-4.1-3b"]],
    [16, "gpt-oss-20b", ["gpt-oss-20b", "qwen3-1.7b", "granite-4.1-3b", "qwen3.5-2b"]],
    [
      32,
      "qwen3-coder-30b",
      ["qwen3-coder-30b", "qwen3-1.7b", "granite-4.1-3b", "qwen3.5-2b", "gpt-oss-20b"],
    ],
  ])("leads with the safe recommendation on a %i GB computer", (memory, bestFit, enabled) => {
    const cards = buildLocalModelCardViewModels(
      snapshot({
        totalMemoryBytes: memory * GIB,
        recommendedModelId: bestFit,
      }),
    );

    expect(cards[0]?.recommendation.id).toBe(bestFit);
    expect(
      cards
        .filter(({ action }) => action === "setup")
        .map(({ recommendation }) => recommendation.id),
    ).toEqual(enabled);
  });

  it("blocks a model that fits in total but not in the memory free right now", () => {
    const cards = buildLocalModelCardViewModels(
      snapshot({ fittingRecommendationIds: ["qwen3-1.7b", "qwen3.5-2b"] }),
    );
    const action = (id: string) =>
      cards.find(({ recommendation }) => recommendation.id === id)?.action;
    expect(action("qwen3.5-2b")).toBe("setup");
    expect(action("qwen3-1.7b")).toBe("setup");
    expect(action("granite-4.1-3b")).toBe("blocked_free_memory");
    // Too large in total still says so.
    expect(action("gpt-oss-20b")).toBe("blocked_memory");
  });

  it("maps Ollama runtime state to the one-click action", () => {
    expect(buildLocalModelCardViewModels(snapshot({}, "not_installed"))[0]?.action).toBe("setup");
    expect(buildLocalModelCardViewModels(snapshot({}, "stopped"))[0]?.action).toBe("start");
    expect(buildLocalModelCardViewModels(snapshot({}, "running"))[0]?.action).toBe("install");
    expect(buildLocalModelCardViewModels(snapshot({}, "update_required"))[0]?.action).toBe(
      "runtime_attention",
    );
  });

  it("derives installed, active, failed, busy, and low-disk card states", () => {
    const installed = buildLocalModelCardViewModels(
      snapshot({
        installedModels: [
          {
            runtime: "ollama",
            modelId: "qwen3.5:2b-q4_K_M",
            name: "Qwen3.5 2B",
            sizeBytes: 1.9 * GIB,
            contextWindowTokens: 32_768,
            supportsToolCalls: true,
          },
        ],
      }),
    );
    expect(installed[0]?.action).toBe("installed");

    const active = buildLocalModelCardViewModels(
      snapshot({
        setupJobs: [
          {
            id: "setup-active",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "downloading_model",
            downloadedBytes: 950,
            totalBytes: 1_900,
            message: "Downloading Qwen3.5 2B…",
            startedAt: "2026-07-27T00:00:00.000Z",
            finishedAt: null,
          },
        ],
      }),
    );
    expect(active[0]).toMatchObject({
      action: "active",
      setupJob: { id: "setup-active" },
      progressPercent: 50,
    });
    expect(active[1]?.action).toBe("blocked_busy");

    const failed = buildLocalModelCardViewModels(
      snapshot({
        setupJobs: [
          {
            id: "setup-failed",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "failed",
            downloadedBytes: 0,
            totalBytes: 1_900,
            message: "Download failed.",
            startedAt: "2026-07-27T00:00:00.000Z",
            finishedAt: "2026-07-27T00:01:00.000Z",
          },
        ],
      }),
    );
    expect(failed[0]).toMatchObject({
      action: "retry",
      setupJob: { id: "setup-failed" },
    });

    const lowDisk = buildLocalModelCardViewModels(snapshot({ freeDiskBytes: 1024 }, "running"));
    expect(lowDisk[0]?.action).toBe("blocked_disk");
    expect(lowDisk[0]?.requiredDiskBytes).toBeGreaterThan(3.8 * GIB);
  });

  it("picks the best match for the chosen task, and keeps an install in progress in front", () => {
    const byTask = snapshot({
      recommendedModelIdsByUseCase: {
        general: "qwen3.5-2b",
        document: "granite-4.1-3b",
        reasoning: "qwen3.5-2b",
        coding: "granite-4.1-3b",
      },
    });
    expect(
      setupCardModel(buildLocalModelCardViewModels(byTask, "general"))?.recommendation.id,
    ).toBe("qwen3.5-2b");
    const coding = buildLocalModelCardViewModels(byTask, "coding");
    expect(coding[0]).toMatchObject({ isBestFit: true, recommendation: { id: "granite-4.1-3b" } });
    expect(setupCardModel(coding)?.recommendation.id).toBe("granite-4.1-3b");

    const installing = buildLocalModelCardViewModels(
      {
        ...byTask,
        setupJobs: [
          {
            id: "setup-active",
            runtime: "ollama",
            recommendationId: "qwen3-1.7b",
            modelId: "qwen3:1.7b",
            state: "verifying",
            downloadedBytes: 0,
            totalBytes: null,
            message: null,
            startedAt: "2026-07-27T00:00:00.000Z",
            finishedAt: null,
          },
        ],
      },
      "coding",
    );
    expect(setupCardModel(installing)?.recommendation.id).toBe("qwen3-1.7b");
  });

  it("maps setup states onto four plain steps", () => {
    expect(
      (["detecting", "installing_runtime", "starting_runtime"] as const).map(setupStepIndex),
    ).toEqual([0, 0, 0]);
    expect(setupStepIndex("downloading_model")).toBe(1);
    expect((["verifying", "synchronizing"] as const).map(setupStepIndex)).toEqual([2, 2]);
    expect(setupStepIndex("ready")).toBe(3);
  });

  it("labels each model by whether it suits this computer", () => {
    const fits = (overrides: Partial<LocalModelsSnapshot>) =>
      Object.fromEntries(
        buildLocalModelCardViewModels(snapshot(overrides, "running")).map((card) => [
          card.recommendation.id,
          localModelFit(card),
        ]),
      );
    expect(fits({ fittingRecommendationIds: ["qwen3-1.7b", "qwen3.5-2b"] })).toEqual({
      "qwen3.5-2b": "runsWell",
      "qwen3-1.7b": "runsWell",
      "granite-4.1-3b": "lowFreeMemory",
      "gpt-oss-20b": "tooBig",
      "qwen3-coder-30b": "tooBig",
    });
    expect(fits({ freeDiskBytes: 1024 })["qwen3.5-2b"]).toBe("lowDisk");
  });
});

describe("codingToolsSupport", () => {
  const base = recommendations[1]!;
  it("needs tool calls and a 64k window for Claude Code and Codex", () => {
    expect(codingToolsSupport({ ...base, contextWindowTokens: 131_072 })).toBe("works");
    expect(codingToolsSupport({ ...base, contextWindowTokens: 65_536 })).toBe("works");
    expect(codingToolsSupport({ ...base, contextWindowTokens: 32_768 })).toBe("tooShort");
    expect(
      codingToolsSupport({ ...base, supportsToolCalls: false, contextWindowTokens: 262_144 }),
    ).toBeNull();
    // Older servers do not send a window yet.
    expect(codingToolsSupport(base)).toBeNull();
  });
});
