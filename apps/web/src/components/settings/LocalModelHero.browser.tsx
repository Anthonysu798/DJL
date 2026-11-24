import "../../index.css";

import type {
  LocalModelRecommendation,
  LocalModelRuntimeStatus,
  LocalModelUseCase,
  LocalModelsSnapshot,
} from "@djl/contracts";
import { createInstance } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nextProvider, initReactI18next } from "react-i18next";

import englishCatalog from "../../i18n/locales/en.json";
import { hardwareProfileFixture } from "../../test/localModelsFixture";
import { LocalModelCatalog, LocalModelSetupCard } from "./LocalModelHero";

const GIB = 1024 ** 3;
const recommendations = (
  [
    ["qwen3-1.7b", "Qwen3 1.7B", 4, "qwen3:1.7b", 1.4],
    ["granite-4.1-3b", "Granite 4.1 3B", 8, "granite4.1:3b", 2.1],
    ["qwen3.5-2b", "Qwen3.5 2B", 8, "qwen3.5:2b-q4_K_M", 1.9],
    ["qwen2.5-coder-7b", "Qwen2.5 Coder 7B", 12, "qwen2.5-coder:7b", 4.7],
    ["gpt-oss-20b", "GPT-OSS 20B", 16, "gpt-oss:20b", 13],
    ["qwen3-coder-30b", "Qwen3 Coder 30B", 32, "qwen3-coder:30b", 19],
  ] as const
).map(
  ([id, name, memory, modelId, download]) =>
    ({
      id,
      contextWindowTokens: id === "qwen2.5-coder-7b" ? 32_768 : 131_072,
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
    onStartSetup?: (recommendationId: string, useCase?: LocalModelUseCase) => void;
    onRetrySetup?: (jobId: string) => void;
    onCancelSetup?: (jobId: string) => void;
    onStartChat?: () => void;
    onUseCaseChange?: (useCase: LocalModelUseCase) => void;
    useCase?: LocalModelUseCase;
    catalog?: boolean;
  } = {},
) {
  await page.viewport(620, 900);
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    defaultNS: "common",
    fallbackLng: "en",
    lng: "en",
    interpolation: { escapeValue: false },
    resources: { en: englishCatalog },
  });
  const actions = {
    actionPending: false,
    onStartSetup: callbacks.onStartSetup ?? (() => undefined),
    onRetrySetup: callbacks.onRetrySetup ?? (() => undefined),
    onCancelSetup: callbacks.onCancelSetup ?? (() => undefined),
    onRuntimeAttention: () => undefined,
    onStartChat: callbacks.onStartChat ?? (() => undefined),
  };
  const useCase = callbacks.useCase ?? "general";
  return render(
    <I18nextProvider i18n={i18n}>
      {callbacks.catalog ? (
        <LocalModelCatalog snapshot={value} useCase={useCase} {...actions} />
      ) : (
        <LocalModelSetupCard
          snapshot={value}
          useCase={useCase}
          onUseCaseChange={callbacks.onUseCaseChange ?? (() => undefined)}
          {...actions}
        />
      )}
    </I18nextProvider>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.body.innerHTML = "";
});

describe("LocalModelSetupCard", () => {
  it("says what this computer has, the model that suits it, and offers one install", async () => {
    const onStartSetup = vi.fn();
    const screen = await mount(
      snapshot({
        hardware: hardwareProfileFixture({ totalMemoryBytes: 8 * GIB, cpuModel: "Apple M2" }),
      }),
      { onStartSetup },
    );

    await expect.element(page.getByText("Apple M2")).toBeVisible();
    await expect.element(page.getByText("40 GB")).toBeVisible();
    await expect.element(page.getByText("Best match for this computer")).toBeVisible();
    await expect.element(page.getByText("Qwen3.5 2B", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Needs about 8 GB of memory. This computer has 8 GB."))
      .toBeVisible();
    // Ollama is not installed yet, so the card says DJL will take care of it.
    await expect.element(page.getByText(/DJL also installs Ollama/)).toBeVisible();
    // No jargon from the old page.
    await expect.element(page.getByText(/champion/i)).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Install Qwen3.5 2B" }).click();
    expect(onStartSetup).toHaveBeenCalledWith("qwen3.5-2b", "general");

    await screen.unmount();
  });

  it("switches the recommendation with the chosen task", async () => {
    const onUseCaseChange = vi.fn();
    const coding = snapshot({
      recommendedModelIdsByUseCase: {
        general: "qwen3.5-2b",
        document: "qwen3.5-2b",
        reasoning: "qwen3.5-2b",
        coding: "granite-4.1-3b",
      },
    });
    const screen = await mount(coding, { onUseCaseChange, useCase: "coding" });

    await expect
      .element(page.getByRole("radio", { name: "Coding" }))
      .toHaveAttribute("aria-checked", "true");
    await expect.element(page.getByText("Granite 4.1 3B", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Documents" }).click();
    expect(onUseCaseChange).toHaveBeenCalledWith("document");

    await screen.unmount();
  });

  it("names the graphics card when the machine has one", async () => {
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

    await expect.element(page.getByText("NVIDIA GeForce RTX 4060")).toBeVisible();
    await screen.unmount();
  });

  it("shows plain steps while installing and lets the person cancel", async () => {
    document.documentElement.classList.add("dark");
    const onCancelSetup = vi.fn();
    const screen = await mount(
      snapshot({
        setupJobs: [
          {
            id: "active-job",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "downloading_model",
            downloadedBytes: GIB,
            totalBytes: 2 * GIB,
            message: "Downloading…",
            startedAt: "2026-07-27T00:00:00.000Z",
            finishedAt: null,
          },
        ],
      }),
      { onCancelSetup },
    );

    for (const step of ["Get ready", "Download", "Test it on this computer", "Ready"]) {
      await expect.element(page.getByText(step, { exact: true })).toBeVisible();
    }
    await expect.element(page.getByText("1 GB of 2 GB downloaded")).toBeVisible();
    // The task cannot change under a running install.
    await expect.element(page.getByRole("radio", { name: "Coding" })).toBeInTheDocument();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(onCancelSetup).toHaveBeenCalledWith("active-job");

    await screen.unmount();
  });

  it("explains a failed install and offers to try again", async () => {
    const onRetrySetup = vi.fn();
    const screen = await mount(
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

    await expect.element(page.getByRole("alert")).toHaveTextContent("Download failed.");
    await page.getByRole("button", { name: "Try again" }).click();
    expect(onRetrySetup).toHaveBeenCalledWith("failed-job");

    await screen.unmount();
  });

  it("offers a smaller model when the measured speed disappointed", async () => {
    const onStartSetup = vi.fn();
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
        setupJobs: [
          {
            id: "slow-job",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "ready",
            downloadedBytes: 100,
            totalBytes: 100,
            message:
              "Qwen3.5 2B is ready at about 9 tokens per second, which is slower than ideal.",
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
    expect(onStartSetup).toHaveBeenCalledWith("qwen3-1.7b");

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

    await expect.element(page.getByText("Qwen3.5 2B is ready")).toBeVisible();
    await expect.element(page.getByRole("button", { name: /Switch to/ })).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Start a chat" }).click();
    expect(onStartChat).toHaveBeenCalled();

    await screen.unmount();
  });

  it("says why the install is blocked when memory is short right now", async () => {
    const screen = await mount(snapshot({ fittingRecommendationIds: ["qwen3-1.7b"] }));

    await expect.element(page.getByRole("button", { name: "Install Qwen3.5 2B" })).toBeDisabled();
    await expect.element(page.getByText(/Close some apps/)).toBeVisible();

    await screen.unmount();
  });
});

describe("LocalModelCatalog", () => {
  it("labels every other model by whether it suits this computer", async () => {
    const onStartSetup = vi.fn();
    const screen = await mount(snapshot(), { catalog: true, onStartSetup });

    // The setup card already features the best match.
    await expect.element(page.getByText("Qwen3.5 2B", { exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByText("Qwen3 1.7B", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Runs well here").first()).toBeVisible();
    await expect.element(page.getByText("Too large for this computer").first()).toBeVisible();
    // Models that cannot run here get a label, not a dead button.
    expect(await page.getByRole("button").all()).toHaveLength(2);

    await page.getByRole("button", { name: "Install Qwen3 1.7B" }).click();
    expect(onStartSetup).toHaveBeenCalledWith("qwen3-1.7b");

    await screen.unmount();
  });

  it("says which models are long enough for Claude Code and Codex", async () => {
    const screen = await mount(snapshot(), { catalog: true });

    const row = (name: string) =>
      page.getByText(name, { exact: true }).element().closest("[data-fit]")!;
    expect(row("Granite 4.1 3B").textContent).toContain("Works with Claude Code and Codex");
    expect(row("Qwen2.5 Coder 7B").textContent).toContain(
      "Holds only 32k tokens, too few for Claude Code and Codex",
    );
    // Chat-only models already say so; they get no coding-tools note.
    expect(row("Qwen3 1.7B").querySelector("[data-coding-tools]")).toBeNull();

    await screen.unmount();
  });
});
