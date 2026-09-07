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

  it("exposes native Codex automatic review", async () => {
    const onChange = vi.fn();
    await render(
      <RuntimeUsageControls
        provider="codex"
        runtimeMode="full-access"
        permissionModes={[{ mode: "auto-approval", available: true }]}
        onRuntimeModeChange={onChange}
      />,
    );
    await page.getByRole("button", { name: "Full access", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /Approve for me/ }).click();
    expect(onChange).toHaveBeenCalledWith("auto-approval");
  });

  it("keeps legacy Claude Full access at Ask and offers explicit bypass", async () => {
    const onChange = vi.fn();
    await render(
      <RuntimeUsageControls
        provider="claudeAgent"
        runtimeMode="full-access"
        permissionModes={[
          { mode: "auto-approval", available: true },
          { mode: "bypass-permissions", available: true },
        ]}
        onRuntimeModeChange={onChange}
      />,
    );
    await page.getByRole("button", { name: "Ask for approval", exact: true }).click();
    await expect.element(page.getByText("Auto", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Allow edits", { exact: true })).toBeVisible();
    await page.getByRole("menuitemradio", { name: /Bypass permissions/ }).click();
    expect(onChange).toHaveBeenCalledWith("bypass-permissions");
  });

  it("explains unavailable modes without allowing selection", async () => {
    const onChange = vi.fn();
    await render(
      <RuntimeUsageControls
        provider="claudeAgent"
        runtimeMode="approval-required"
        supportsAutoMode={false}
        permissionModes={[
          { mode: "bypass-permissions", available: false, reason: "Disabled by organization" },
        ]}
        onRuntimeModeChange={onChange}
      />,
    );
    await page.getByRole("button", { name: "Ask for approval", exact: true }).click();
    await expect
      .element(page.getByRole("menuitemradio", { name: /Auto.*This model/ }))
      .toHaveAttribute("aria-disabled", "true");
    await expect.element(page.getByText("Disabled by organization")).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
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
