import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { OpenCodeModelsSettingsPanel } from "./OpenCodeModelsSettingsPanel";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  provider: {
    listModelProviders: vi.fn(),
    listModels: vi.fn(),
    setApiKey: vi.fn(),
    removeCredential: vi.fn(),
  },
  sendMessage: vi.fn(),
}));
vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({ provider: mocks.provider, sendMessage: mocks.sendMessage }),
}));
vi.mock("~/appSettings", () => ({
  useAppSettings: () => ({
    settings: { textGenerationProvider: "opencode", textGenerationModel: "oauth/model-one" },
    updateSettings: mocks.updateSettings,
  }),
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));

afterEach(async () => {
  await cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

describe("shared CLI model providers", () => {
  it("shows OAuth models and refresh testing without an API key editor or model request", async () => {
    localStorage.clear();
    mocks.provider.listModelProviders.mockResolvedValue({
      providers: [
        {
          id: "oauth",
          name: "OAuth provider",
          connected: true,
          supportsApiKey: false,
          hasStoredCredential: false,
          modelCount: 2,
        },
      ],
      configuredProviderCount: 1,
      modelCount: 2,
    });
    mocks.provider.listModels.mockResolvedValue({
      models: [
        { slug: "oauth/model-one", name: "Model One", upstreamProviderId: "oauth" },
        { slug: "oauth/model-two", name: "Model Two", upstreamProviderId: "oauth" },
      ],
    });
    await render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <OpenCodeModelsSettingsPanel />
      </QueryClientProvider>,
    );
    await page.getByRole("button", { name: "OAuth provider" }).click();
    await expect
      .element(
        page.getByText("OpenCode uses the same login as your installed OpenCode CLI.", {
          exact: false,
        }),
      )
      .toBeVisible();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await expect
      .element(page.getByRole("button", { name: "Replace", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Disconnect", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText("oauth/model-two", { exact: true })).toBeVisible();
    const modelRequests = mocks.provider.listModels.mock.calls.length;
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect
      .poll(() => mocks.provider.listModels.mock.calls.length)
      .toBeGreaterThan(modelRequests);
    expect(mocks.provider.listModels).toHaveBeenLastCalledWith({
      provider: "opencode",
      forceReload: true,
    });
    expect(mocks.provider.setApiKey).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    const select = page.getByRole("combobox");
    await expect.element(select).toBeEnabled();
    await select.click();
    await page.getByRole("option", { name: "Model Two", exact: true }).click();
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      textGenerationProvider: "opencode",
      textGenerationModel: "oauth/model-two",
    });
  });
});
