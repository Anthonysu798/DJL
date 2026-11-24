import "../../index.css";

import type { LocalModelsSnapshot } from "@djl/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import englishCatalog from "../../i18n/locales/en.json";
import { writeLocalModelsBrowserCache } from "../../lib/localModelsBrowserCache";
import { hardwareProfileFixture } from "../../test/localModelsFixture";
import { LocalModelsSettingsPanel } from "./LocalModelsSettingsPanel";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  getSnapshot: vi.fn(),
  removeModel: vi.fn(),
  openExternal: vi.fn(),
  refresh: vi.fn(),
  startSetup: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("~/env", () => ({ isElectron: true }));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    dialogs: { confirm: mocks.confirm },
    localModels: {
      getSnapshot: mocks.getSnapshot,
      refresh: mocks.refresh,
      installRuntime: vi.fn(),
      startRuntime: vi.fn(),
      installModel: vi.fn(),
      cancelInstall: vi.fn(),
      startSetup: mocks.startSetup,
      retrySetup: vi.fn(),
      cancelSetup: vi.fn(),
      removeModel: mocks.removeModel,
      onEvent: () => () => undefined,
    },
    shell: { openExternal: mocks.openExternal },
    server: { getSettings: mocks.getSettings, updateSettings: mocks.updateSettings },
  }),
}));

const installedSnapshot = {
  totalMemoryBytes: 16 * 1024 ** 3,
  hardware: hardwareProfileFixture({ totalMemoryBytes: 16 * 1024 ** 3 }),
  freeDiskBytes: 40 * 1024 ** 3,
  recommendedModelId: null,
  runtimes: [
    {
      runtime: "ollama",
      name: "Ollama",
      state: "running",
      version: "0.12.0",
      endpoint: "http://127.0.0.1:11434",
      installerUrl: "https://ollama.com/download",
      installationKind: "managed",
      estimatedDownloadBytes: 0,
      detail: null,
      capabilities: {
        canStart: false,
        canInstallModels: true,
        canCancelInstall: true,
        canDeleteModels: true,
      },
    },
    {
      runtime: "lmstudio",
      name: "LM Studio",
      state: "running",
      version: "0.4.0",
      endpoint: "http://127.0.0.1:1234",
      installerUrl: "https://lmstudio.ai",
      installationKind: "external",
      estimatedDownloadBytes: 0,
      detail: null,
      capabilities: {
        canStart: false,
        canInstallModels: true,
        canCancelInstall: false,
        canDeleteModels: false,
      },
    },
  ],
  recommendations: [],
  installedModels: [
    {
      runtime: "ollama",
      modelId: "qwen3.5:2b-q4_K_M",
      name: "Qwen3.5 2B",
      sizeBytes: 2_040_109_466,
      contextWindowTokens: 32_768,
      supportsToolCalls: true,
    },
    {
      runtime: "lmstudio",
      modelId: "qwen/qwen3.5-2b",
      name: "Qwen3.5 2B (LM Studio)",
      sizeBytes: 2_040_109_466,
      contextWindowTokens: 32_768,
      supportsToolCalls: true,
    },
  ],
  runtimeInstallJobs: [],
  installJobs: [],
  setupJobs: [],
} satisfies LocalModelsSnapshot;

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mount(snapshot: LocalModelsSnapshot = installedSnapshot) {
  writeLocalModelsBrowserCache(snapshot);
  mocks.getSnapshot.mockResolvedValue(snapshot);
  mocks.removeModel.mockResolvedValue(snapshot);
  mocks.refresh.mockResolvedValue(snapshot);
  let harnesses = { claudeAgent: true, codex: true, opencode: true };
  mocks.getSettings.mockImplementation(async () => ({ localModels: { harnesses } }));
  mocks.updateSettings.mockImplementation(
    async (patch: { localModels: { harnesses: Partial<typeof harnesses> } }) => {
      harnesses = { ...harnesses, ...patch.localModels.harnesses };
      return { localModels: { harnesses } };
    },
  );
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    defaultNS: "common",
    fallbackLng: "en",
    lng: "en",
    interpolation: { escapeValue: false },
    resources: { en: englishCatalog },
  });
  return render(
    <QueryClientProvider client={queryClient()}>
      <I18nextProvider i18n={i18n}>
        <LocalModelsSettingsPanel />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  await cleanup();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("LocalModelsSettingsPanel installed models", () => {
  it("keeps installed models and their text actions visible outside Advanced", async () => {
    await mount();

    await expect.element(page.getByRole("heading", { name: "On this computer" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Delete Qwen3.5 2B", exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Delete", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Manage in LM Studio" })).toBeVisible();
  });

  it("explains when an external LM Studio context is too small for tools", async () => {
    const undersizedSnapshot = {
      ...installedSnapshot,
      installedModels: installedSnapshot.installedModels.map((model) =>
        model.runtime === "lmstudio"
          ? {
              ...model,
              modelId: "ibm/granite-4.1-3b",
              name: "Granite 4.1 3B",
              contextWindowTokens: 8_192,
              maxContextWindowTokens: 131_072,
              loadedContextWindowTokens: 8_192,
              toolContextWindowReady: false,
              supportsToolCalls: false,
            }
          : model,
      ),
    } satisfies LocalModelsSnapshot;

    await mount(undersizedSnapshot);

    await expect
      .element(page.getByText("Loaded context: 8K / model maximum: 128K", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "Chat only at the current 8K context. Reload the model with at least 16K to use tools.",
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  it("shows the verified context for a managed LM Studio model", async () => {
    const readySnapshot = {
      ...installedSnapshot,
      runtimes: installedSnapshot.runtimes.map((runtime) =>
        runtime.runtime === "lmstudio"
          ? { ...runtime, installationKind: "managed" as const }
          : runtime,
      ),
      installedModels: installedSnapshot.installedModels.map((model) =>
        model.runtime === "lmstudio"
          ? {
              ...model,
              modelId: "ibm/granite-4.1-3b",
              name: "Granite 4.1 3B",
              contextWindowTokens: 16_384,
              maxContextWindowTokens: 131_072,
              loadedContextWindowTokens: 16_384,
              toolContextWindowReady: true,
              supportsToolCalls: true,
            }
          : model,
      ),
    } satisfies LocalModelsSnapshot;

    await mount(readySnapshot);

    await expect
      .element(page.getByText("Loaded context: 16K / model maximum: 128K", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Installed", { exact: true }).first()).toBeVisible();
  });

  it("does not remove an Ollama model when deletion confirmation is cancelled", async () => {
    mocks.confirm.mockResolvedValue(false);
    await mount();

    await page.getByRole("button", { name: "Delete Qwen3.5 2B", exact: true }).click();

    expect(mocks.confirm).toHaveBeenCalledWith("Delete Qwen3.5 2B from Ollama?");
    expect(mocks.removeModel).not.toHaveBeenCalled();
  });

  it("keeps deletion unavailable while Ollama is stopped", async () => {
    const stoppedSnapshot = {
      ...installedSnapshot,
      runtimes: installedSnapshot.runtimes.map((runtime) =>
        runtime.runtime === "ollama"
          ? {
              ...runtime,
              state: "stopped" as const,
              capabilities: { ...runtime.capabilities, canDeleteModels: false },
            }
          : runtime,
      ),
    } satisfies LocalModelsSnapshot;

    await mount(stoppedSnapshot);

    const deleteButton = page.getByRole("button", {
      name: "Delete Qwen3.5 2B",
      exact: true,
    });
    await expect.element(deleteButton).toBeDisabled();
    await expect.element(page.getByText("Start Ollama first", { exact: true })).toBeVisible();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.removeModel).not.toHaveBeenCalled();
  });

  it("removes the exact Ollama model after deletion confirmation", async () => {
    mocks.confirm.mockResolvedValue(true);
    await mount();

    await page.getByRole("button", { name: "Delete Qwen3.5 2B", exact: true }).click();

    expect(mocks.removeModel).toHaveBeenCalledWith({
      runtime: "ollama",
      modelId: "qwen3.5:2b-q4_K_M",
    });
  });

  it("shows deletion pending state and prevents a duplicate removal", async () => {
    mocks.confirm.mockResolvedValue(true);
    let completeRemoval: ((value: LocalModelsSnapshot) => void) | undefined;
    await mount();
    mocks.removeModel.mockImplementation(
      () =>
        new Promise<LocalModelsSnapshot>((resolve) => {
          completeRemoval = resolve;
        }),
    );

    await page.getByRole("button", { name: "Delete Qwen3.5 2B", exact: true }).click();

    await vi.waitFor(() => expect(mocks.removeModel).toHaveBeenCalledOnce());
    const deleting = page.getByRole("button", { name: "Delete Qwen3.5 2B", exact: true });
    await expect.element(deleting).toBeDisabled();
    await expect.element(page.getByText("Deleting…", { exact: true })).toBeVisible();
    expect(mocks.removeModel).toHaveBeenCalledOnce();

    completeRemoval?.(installedSnapshot);
  });

  it("does not duplicate the installed-model manager inside Advanced", async () => {
    await mount();

    await page.getByRole("button", { name: "Advanced" }).click();

    await expect
      .element(page.getByText("Manage installed models", { exact: true }))
      .not.toBeInTheDocument();
  });

  it("switches local models on or off for one harness at a time", async () => {
    await mount();
    const claude = page.getByRole("switch", { name: "Use local models with Claude Code" });
    const codex = page.getByRole("switch", { name: "Use local models with Codex" });
    const openCode = page.getByRole("switch", { name: "Use local models with OpenCode" });
    await expect.element(claude).toBeChecked();
    await expect.element(codex).toBeChecked();
    await expect.element(openCode).toBeChecked();

    await codex.click();
    await expect
      .poll(() => mocks.updateSettings.mock.calls[0]?.[0])
      .toEqual({ localModels: { harnesses: { codex: false } } });
    await expect.element(codex).not.toBeChecked();
    await expect.element(claude).toBeChecked();
    expect(mocks.refresh).not.toHaveBeenCalled();

    await openCode.click();
    await expect
      .poll(() => mocks.updateSettings.mock.calls[1]?.[0])
      .toEqual({ localModels: { harnesses: { opencode: false } } });
    // OpenCode reads a managed config file, so its switch also rewrites that file.
    await expect.poll(() => mocks.refresh.mock.calls.length).toBe(1);
  });
});

describe("LocalModelsSettingsPanel Ollama setup", () => {
  const recommendation = {
    id: "qwen3.5-2b",
    name: "Qwen3.5 2B",
    description: "Small and fast",
    supportsToolCalls: false,
    minimumMemoryBytes: 4 * 1024 ** 3,
    sources: [
      { runtime: "ollama", modelId: "qwen3.5:2b-q4_K_M", estimatedDownloadBytes: 2 * 1024 ** 3 },
    ],
  };
  const withOllama = (state: "not_installed" | "stopped" | "running") =>
    ({
      ...installedSnapshot,
      recommendedModelId: "qwen3.5-2b",
      recommendations: [recommendation],
      installedModels: [],
      runtimes: installedSnapshot.runtimes.map((runtime) =>
        runtime.runtime === "ollama" ? { ...runtime, state } : runtime,
      ),
    }) as unknown as LocalModelsSnapshot;

  it.each([
    ["not_installed", /DJL also installs Ollama/],
    ["stopped", /DJL starts Ollama/],
    ["running", null],
  ] as const)("leads with one install button when Ollama is %s", async (state, hint) => {
    await mount(withOllama(state));
    if (hint) await expect.element(page.getByText(hint)).toBeVisible();
    const action = page.getByRole("button", { name: "Install Qwen3.5 2B", exact: true });
    await expect.element(action).toBeVisible();
    await action.click();
    // One setup job installs Ollama when needed (OllamaInstaller), starts it, and pulls the model.
    await expect
      .poll(() => mocks.startSetup.mock.calls[0]?.[0])
      .toEqual({ recommendationId: "qwen3.5-2b", useCase: "general" });
  });
});
