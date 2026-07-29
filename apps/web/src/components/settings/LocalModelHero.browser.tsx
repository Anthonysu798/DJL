import "../../index.css";

import type {
  LocalModelRecommendation,
  LocalModelRuntimeStatus,
  LocalModelsSnapshot,
} from "@synara/contracts";
import { createInstance } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nextProvider, initReactI18next } from "react-i18next";

import englishCatalog from "../../i18n/locales/en.json";
import { hardwareProfileFixture } from "../../test/localModelsFixture";
import { LocalModelAlternatives, LocalModelHero } from "./LocalModelHero";

const GIB = 1024 ** 3;
const recommendations = (
  [
    ["qwen3-1.7b", "Qwen3 1.7B", 4, "qwen3:1.7b", 1.4],
    ["granite-4.1-3b", "Granite 4.1 3B", 8, "granite4.1:3b", 2.1],
    ["qwen3.5-2b", "Qwen3.5 2B", 8, "qwen3.5:2b-q4_K_M", 1.9],
    ["gpt-oss-20b", "GPT-OSS 20B", 16, "gpt-oss:20b", 13],
    ["qwen3-coder-30b", "Qwen3 Coder 30B", 32, "qwen3-coder:30b", 19],
  ] as const
).map(
  ([id, name, memory, modelId, download]) =>
    ({
      id,
      // Mirrors the catalog: only the 3B-and-larger tiers are measured tool-capable.
      supportsToolCalls: Number(memory) >= 8 && id !== "qwen3.5-2b",
      name,
      description: `${name} description`,
      minimumMemoryBytes: Number(memory) * GIB,
      sources: [
        {
          runtime: "ollama",
          modelId,
          estimatedDownloadBytes: Number(download) * GIB,
        },
      ],
    }) satisfies LocalModelRecommendation,
);

function ollama(): LocalModelRuntimeStatus {
  return {
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
  };
}

function snapshot(overrides: Partial<LocalModelsSnapshot> = {}): LocalModelsSnapshot {
  return {
    totalMemoryBytes: 8 * GIB,
    hardware: hardwareProfileFixture({ totalMemoryBytes: 8 * GIB }),
    freeDiskBytes: 40 * GIB,
    recommendedModelId: "qwen3.5-2b",
    runtimes: [ollama()],
    recommendations,
    installedModels: [],
    runtimeInstallJobs: [],
    installJobs: [],
    setupJobs: [],
    ...overrides,
  };
}

async function mount(
  value: LocalModelsSnapshot,
  callbacks: {
    onStartSetup?: (recommendationId: string) => void;
    onRetrySetup?: (jobId: string) => void;
    onCancelSetup?: (jobId: string) => void;
    onStartChat?: () => void;
    alternatives?: boolean;
  } = {},
) {
  await page.viewport(620, 720);
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    defaultNS: "common",
    fallbackLng: "en",
    lng: "en",
    interpolation: { escapeValue: false },
    resources: { en: englishCatalog },
  });
  const Component = callbacks.alternatives ? LocalModelAlternatives : LocalModelHero;
  return render(
    <I18nextProvider i18n={i18n}>
      <Component
        snapshot={value}
        actionPending={false}
        onStartSetup={callbacks.onStartSetup ?? (() => undefined)}
        onRetrySetup={callbacks.onRetrySetup ?? (() => undefined)}
        onCancelSetup={callbacks.onCancelSetup ?? (() => undefined)}
        onRuntimeAttention={() => undefined}
        onStartChat={callbacks.onStartChat ?? (() => undefined)}
      />
    </I18nextProvider>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.body.innerHTML = "";
});

describe("LocalModelHero", () => {
  it("presents one recommendation, one button, and the detected hardware", async () => {
    const onStartSetup = vi.fn();
    const screen = await mount(snapshot(), { onStartSetup });

    // The hero is the whole decision: the best-fit model and nothing competing with it.
    await expect.element(page.getByText("Qwen3.5 2B", { exact: true })).toBeVisible();
    for (const other of recommendations.filter(({ id }) => id !== "qwen3.5-2b")) {
      await expect.element(page.getByText(other.name, { exact: true })).not.toBeInTheDocument();
    }
    await expect.element(page.getByText(/Detected:/)).toBeVisible();
    await expect.element(page.getByText("Fast on your hardware")).toBeVisible();

    const buttons = page.getByRole("button");
    expect(await buttons.all()).toHaveLength(1);

    await buttons.first().click();
    expect(onStartSetup).toHaveBeenCalledWith("qwen3.5-2b");

    await screen.unmount();
  });

  it("names the detected GPU when the machine has a discrete card", async () => {
    const screen = await mount(
      snapshot({
        hardware: hardwareProfileFixture({
          acceleration: "discrete_gpu",
          totalMemoryBytes: 32 * GIB,
          vramBytes: 8 * GIB,
          cpuModel: "AMD Ryzen 7",
          gpuName: "NVIDIA GeForce RTX 4060",
        }),
      }),
    );

    await expect.element(page.getByText(/NVIDIA GeForce RTX 4060/)).toBeVisible();
    await screen.unmount();
  });

  it("offers a smaller model when the measured speed disappointed", async () => {
    const onStartSetup = vi.fn();
    const screen = await mount(
      snapshot({
        setupJobs: [
          {
            id: "slow-job",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "ready",
            downloadedBytes: 100,
            totalBytes: 100,
            message: "Qwen3.5 2B is ready at about 9 tokens per second, which is slower than ideal.",
            tokensPerSecond: 9,
            suggestedFallbackId: "qwen3-1.7b",
            startedAt: "2026-07-28T00:00:00.000Z",
            finishedAt: "2026-07-28T00:01:00.000Z",
          },
        ],
      }),
      { onStartSetup },
    );

    await expect.element(page.getByText(/slower than ideal/)).toBeVisible();
    await page.getByRole("button", { name: "Switch to Qwen3 1.7B" }).click();
    // The way out has to actually start the smaller setup, not just describe it.
    expect(onStartSetup).toHaveBeenCalledWith("qwen3-1.7b");

    await screen.unmount();
  });

  it("offers no downgrade when the model runs well", async () => {
    const screen = await mount(
      snapshot({
        setupJobs: [
          {
            id: "fast-job",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "ready",
            downloadedBytes: 100,
            totalBytes: 100,
            message: "Qwen3.5 2B is ready to use in chat at about 92 tokens per second.",
            tokensPerSecond: 92,
            suggestedFallbackId: null,
            startedAt: "2026-07-28T00:00:00.000Z",
            finishedAt: "2026-07-28T00:01:00.000Z",
          },
        ],
      }),
    );

    await expect.element(page.getByRole("button", { name: /Switch to/ })).not.toBeInTheDocument();
    await screen.unmount();
  });

  it("offers a way into chat once the model is installed", async () => {
    const onStartChat = vi.fn();
    const screen = await mount(
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
      { onStartChat },
    );

    // "Ready" with a dead button told the user nothing they could act on.
    await expect.element(page.getByText("Qwen3.5 2B is ready")).toBeVisible();
    await page.getByRole("button", { name: "Start a chat" }).click();
    // Enabled is not enough — the control has to actually go somewhere.
    expect(onStartChat).toHaveBeenCalled();

    await screen.unmount();
  });

  it("lists the models the hero did not choose, without the chosen one", async () => {
    const screen = await mount(snapshot(), { alternatives: true });

    await expect.element(page.getByText("Qwen3.5 2B", { exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByText("Qwen3 1.7B", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Requires 16 GB memory" }))
      .toBeDisabled();

    await screen.unmount();
  });

  it("keeps cancel and retry actions inside the hero in dark mode", async () => {
    document.documentElement.classList.add("dark");
    const onCancelSetup = vi.fn();
    const active = await mount(
      snapshot({
        setupJobs: [
          {
            id: "active-job",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "downloading_model",
            downloadedBytes: 50,
            totalBytes: 100,
            message: "Downloading…",
            startedAt: "2026-07-27T00:00:00.000Z",
            finishedAt: null,
          },
        ],
      }),
      { onCancelSetup },
    );
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(onCancelSetup).toHaveBeenCalledWith("active-job");
    await active.unmount();

    const onRetrySetup = vi.fn();
    const failed = await mount(
      snapshot({
        setupJobs: [
          {
            id: "failed-job",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "failed",
            downloadedBytes: 0,
            totalBytes: 100,
            message: "Download failed.",
            startedAt: "2026-07-27T00:00:00.000Z",
            finishedAt: "2026-07-27T00:01:00.000Z",
          },
        ],
      }),
      { onRetrySetup },
    );
    await page.getByRole("button", { name: "Retry" }).click();
    expect(onRetrySetup).toHaveBeenCalledWith("failed-job");
    await failed.unmount();
  });
});
