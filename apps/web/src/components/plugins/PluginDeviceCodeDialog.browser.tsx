import "../../index.css";

import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { PluginDeviceCodeDialog } from "./PluginDeviceCodeDialog";

afterEach(() => cleanup());

const props = (overrides: Partial<ComponentProps<typeof PluginDeviceCodeDialog>> = {}) => ({
  appName: "GitHub",
  userCode: "ABCD-1234",
  state: "connecting" as const,
  message: undefined,
  retrying: false,
  onOpenPage: vi.fn(),
  onRetry: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe("PluginDeviceCodeDialog", () => {
  it("shows the code and waits for the approval on GitHub", async () => {
    const handlers = props();
    await render(<PluginDeviceCodeDialog {...handlers} />);
    await expect.element(page.getByTestId("plugin-device-code")).toHaveTextContent("ABCD-1234");
    await expect.element(page.getByText("Waiting for you to approve…")).toBeVisible();
    // No token field: the user never pastes a credential into DJL.
    expect(document.querySelector("input[type=password]")).toBeNull();
    await page.getByRole("button", { name: "Open GitHub" }).click();
    expect(handlers.onOpenPage).toHaveBeenCalledOnce();
  });

  it("turns connected on its own and offers Done", async () => {
    const handlers = props({ state: "connected" });
    await render(<PluginDeviceCodeDialog {...handlers} />);
    await expect
      .element(page.getByText("GitHub is connected. You can use it in new chats."))
      .toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("explains a declined sign-in and lets the user try again", async () => {
    const handlers = props({ state: "error", message: "Sign-in was cancelled." });
    await render(<PluginDeviceCodeDialog {...handlers} />);
    await expect.element(page.getByText("Sign-in was cancelled.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });
});
