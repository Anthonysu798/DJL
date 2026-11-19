import "../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { CustomModelProviderDialog } from "./CustomModelProviderDialog";

const mocks = vi.hoisted(() => ({
  saveCustomProvider: vi.fn(),
  fetchCustomModels: vi.fn(),
  onSaved: vi.fn(),
  onOpenChange: vi.fn(),
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => ({ provider: mocks }) }));
afterEach(async () => {
  await cleanup();
  vi.resetAllMocks();
});

async function openDialog() {
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <CustomModelProviderDialog open onOpenChange={mocks.onOpenChange} onSaved={mocks.onSaved} />
    </QueryClientProvider>,
  );
}

describe("custom model API dialog", () => {
  it("edits explicitly and fetches using a saved provider without returning its key", async () => {
    const definition = {
      providerId: "saved-relay",
      name: "Saved relay",
      baseUrl: "https://relay.test/v1",
      protocol: "openai-chat" as const,
      models: [{ id: "model", name: "Model" }],
    };
    mocks.fetchCustomModels.mockResolvedValue({ models: [] });
    mocks.saveCustomProvider.mockResolvedValue({ providerId: "saved-relay", connected: true });
    await render(
      <CustomModelProviderDialog
        open
        definition={definition}
        onOpenChange={mocks.onOpenChange}
        onSaved={mocks.onSaved}
      />,
    );
    await page.getByRole("button", { name: "Fetch models", exact: true }).click();
    await expect
      .poll(() => mocks.fetchCustomModels.mock.calls[0]?.[0])
      .toEqual({ providerId: "saved-relay", baseUrl: definition.baseUrl, protocol: "openai-chat" });
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect
      .poll(() => mocks.saveCustomProvider.mock.calls[0]?.[0])
      .toEqual({ ...definition, replaceExisting: true });
  });

  it("validates the endpoint and saves manually entered model IDs without requiring a key", async () => {
    mocks.saveCustomProvider.mockResolvedValue({ providerId: "my-relay", connected: true });
    await openDialog();
    const save = page.getByRole("button", { name: "Create provider", exact: true });
    await expect.element(save).toBeDisabled();
    await page.getByRole("textbox", { name: "Provider ID", exact: true }).fill("my-relay");
    await page.getByRole("textbox", { name: "Display name", exact: true }).fill("My relay");
    await page.getByRole("textbox", { name: "Base URL", exact: true }).fill("file:///bad");
    await expect.element(save).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Base URL", exact: true })
      .fill("http://127.0.0.1:9090/v1");
    await page.getByRole("button", { name: "Add model", exact: true }).click();
    await page.getByRole("textbox", { name: "Model ID", exact: true }).fill("org/model");
    await expect.element(save).toBeEnabled();
    await save.click();
    expect(mocks.saveCustomProvider).toHaveBeenCalled();
    await expect
      .poll(() => mocks.saveCustomProvider.mock.calls[0]?.[0])
      .toEqual({
        providerId: "my-relay",
        name: "My relay",
        baseUrl: "http://127.0.0.1:9090/v1",
        protocol: "openai-chat",
        models: [{ id: "org/model", name: "org/model" }],
      });
    expect(mocks.onSaved).toHaveBeenCalled();
  });

  it("preserves manual models when model discovery fails and displays an actionable error", async () => {
    mocks.fetchCustomModels.mockRejectedValue(new Error("Model discovery returned HTTP 401."));
    await openDialog();
    await page
      .getByRole("textbox", { name: "Base URL", exact: true })
      .fill("https://relay.test/v1");
    await page.getByRole("button", { name: "Add model", exact: true }).click();
    await page.getByRole("textbox", { name: "Model ID", exact: true }).fill("my-model");
    await page.getByRole("button", { name: "Fetch models", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("401");
    await expect
      .element(page.getByRole("textbox", { name: "Model ID", exact: true }))
      .toHaveValue("my-model");
    expect(mocks.saveCustomProvider).not.toHaveBeenCalled();
  });
});
