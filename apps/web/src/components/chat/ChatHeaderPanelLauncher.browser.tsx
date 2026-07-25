// FILE: ChatHeaderPanelLauncher.browser.tsx
// Purpose: Verifies the top-right Panels launcher remains usable and dispatches pane actions.
// Layer: Browser UI test

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ChatHeaderPanelLauncher } from "./ChatHeader";

async function mountLauncher(props?: { desktopAvailable?: boolean; isGitRepo?: boolean }) {
  const onOpenBrowser = vi.fn();
  const onToggleDiff = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <ChatHeaderPanelLauncher
      browserOpen={false}
      desktopAvailable={props?.desktopAvailable ?? true}
      diffDisabledReason={null}
      diffOpen={false}
      diffToggleShortcutLabel="⌘D"
      diffTotals={{ additions: 0, deletions: 0, fileCount: 0, hasChanges: false }}
      isGitRepo={props?.isGitRepo ?? false}
      onOpenBrowser={onOpenBrowser}
      onToggleDiff={onToggleDiff}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    onOpenBrowser,
    onToggleDiff,
  };
}

describe("ChatHeaderPanelLauncher", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens Browser while unavailable Diff remains scoped to its own row", async () => {
    await using launcher = await mountLauncher({ isGitRepo: false });

    const trigger = page.getByLabelText("Open panels menu");
    await expect.element(trigger).toBeEnabled();
    await trigger.click();
    await expect.element(page.getByRole("menuitem", { name: /Browser/u })).toBeEnabled();
    await expect
      .element(page.getByRole("menuitem", { name: /Diff Git repository required/u }))
      .toBeDisabled();
    await page.getByRole("menuitem", { name: /Browser/u }).click();

    expect(launcher.onOpenBrowser).toHaveBeenCalledTimes(1);
    expect(launcher.onToggleDiff).not.toHaveBeenCalled();
  });

  it("disables Browser outside the desktop app without disabling the launcher", async () => {
    await using _ = await mountLauncher({ desktopAvailable: false, isGitRepo: true });

    const trigger = page.getByLabelText("Open panels menu");
    await expect.element(trigger).toBeEnabled();
    await trigger.click();
    await expect
      .element(page.getByRole("menuitem", { name: /Browser Desktop app required/u }))
      .toBeDisabled();
  });
});
