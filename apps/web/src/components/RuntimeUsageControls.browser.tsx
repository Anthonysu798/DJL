import "../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { initializeI18nInstance, rendererI18n } from "../i18n";
import { RuntimeUsageControls } from "./BranchToolbar";

describe("RuntimeUsageControls permission menu", () => {
  beforeAll(async () => {
    await initializeI18nInstance({
      preference: "en",
      instance: rendererI18n,
      documentElement: document.documentElement,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("opens the OpenCode profiles without crashing", async () => {
    await render(
      <RuntimeUsageControls
        runtimeMode="full-access"
        provider="opencode"
        onRuntimeModeChange={vi.fn()}
      />,
    );

    await page.getByRole("button", { name: "Full access" }).click();

    await expect.element(page.getByText("How should actions be approved?")).toBeVisible();
    await expect.element(page.getByText("Ask for approval", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Approve for me", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Full access", { exact: true }).last()).toBeVisible();
  });
});
