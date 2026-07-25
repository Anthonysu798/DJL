// FILE: RightDockPaneMenuItems.browser.tsx
// Purpose: Verifies shared right-dock pane menu labels, availability, active state, and selection.
// Layer: Browser UI test

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Button } from "../ui/button";
import { Menu, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { RightDockPaneMenuItems } from "./RightDockPaneMenuItems";

async function mountPaneMenu() {
  const onSelect = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <Menu modal={false}>
      <MenuTrigger render={<Button aria-label="Open panels menu" />}>Panels</MenuTrigger>
      <ComposerPickerMenuPopup align="end" side="bottom" className="w-48 min-w-48">
        <RightDockPaneMenuItems
          items={[
            { kind: "browser", active: true },
            { kind: "diff", disabled: true, detail: "Git repository required" },
          ]}
          onSelect={onSelect}
        />
      </ComposerPickerMenuPopup>
    </Menu>,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    onSelect,
  };
}

describe("RightDockPaneMenuItems", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders canonical labels and explains disabled panes", async () => {
    await using _ = await mountPaneMenu();

    await page.getByLabelText("Open panels menu").click();

    await expect.element(page.getByRole("menuitem", { name: /Browser/u })).toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: /Diff Git repository required/u }))
      .toBeDisabled();
  });

  it("selects enabled panes and marks the active pane", async () => {
    await using menu = await mountPaneMenu();

    await page.getByLabelText("Open panels menu").click();
    const browserItem = page.getByRole("menuitem", { name: /Browser/u });
    await expect.element(browserItem).toHaveAttribute("data-active", "true");
    await browserItem.click();

    expect(menu.onSelect).toHaveBeenCalledWith("browser");
  });
});
