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
import { LocalModelCardShelf } from "./LocalModelCardShelf";

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
  return render(
    <I18nextProvider i18n={i18n}>
      <LocalModelCardShelf
        snapshot={value}
        actionPending={false}
        onStartSetup={callbacks.onStartSetup ?? (() => undefined)}
        onRetrySetup={callbacks.onRetrySetup ?? (() => undefined)}
        onCancelSetup={callbacks.onCancelSetup ?? (() => undefined)}
        onRuntimeAttention={() => undefined}
      />
    </I18nextProvider>,
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.body.innerHTML = "";
});

describe("LocalModelCardShelf", () => {
  it("shows every curated model, scrolls horizontally, and sends the exact recommendation", async () => {
    const onStartSetup = vi.fn();
    const screen = await mount(snapshot(), { onStartSetup });

    for (const recommendation of recommendations) {
      await expect.element(page.getByText(recommendation.name, { exact: true })).toBeVisible();
    }
    const shelf = page.getByRole("region", { name: "Available local models" });
    await expect.element(shelf).toBeVisible();
    const shelfElement = shelf.element() as HTMLElement;
    expect(shelfElement.scrollWidth).toBeGreaterThan(shelfElement.clientWidth);
    shelfElement.focus();
    expect(document.activeElement).toBe(shelfElement);
    shelfElement.scrollLeft = 200;
    expect(shelfElement.scrollLeft).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Set up Ollama + model" }).first().click();
    expect(onStartSetup).toHaveBeenCalledWith("qwen3.5-2b");
    await expect
      .element(page.getByRole("button", { name: "Requires 16 GB memory" }))
      .toBeDisabled();

    await screen.unmount();
  });

  it("keeps cancel and retry actions inside the selected card in dark mode", async () => {
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
