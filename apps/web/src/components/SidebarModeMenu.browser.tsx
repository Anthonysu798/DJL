import "../index.css";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { buildThemeCssVariables, resolveThemePack, DEFAULT_THEME_STATE } from "~/theme/theme.logic";
import { SidebarModeMenu } from "./SidebarModeMenu";
import type { SidebarView } from "./Sidebar.logic";

describe("sidebar mode menu", () => {
  it("shows the current mode and selects another view without showing disabled surfaces", async () => {
    const select = vi.fn();
    function Example() {
      const [view, setView] = useState<SidebarView>("studio");
      return (
        <SidebarModeMenu
          views={["studio", "threads"]}
          activeView={view}
          onSelectView={(next) => {
            select(next);
            setView(next);
          }}
        />
      );
    }
    const screen = await render(<Example />);
    await screen.getByRole("button", { name: "Switch workspace view" }).click();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Agent mode" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(page.getByRole("menuitemradio", { name: "Workspace", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText("Work with code and repositories")).toBeVisible();
    await page.getByRole("menuitemradio", { name: "Projects" }).click();
    expect(select).toHaveBeenCalledExactlyOnceWith("threads");
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Switch workspace view" }).click();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Projects" }))
      .toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("button", { name: "Switch workspace view" }))
      .toHaveFocus();
    expect(select).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });
  it("supports keyboard selection and narrow windows", async () => {
    await page.viewport(360, 640);
    const select = vi.fn();
    const screen = await render(
      <SidebarModeMenu
        views={["studio", "threads", "workspace"]}
        activeView="studio"
        onSelectView={select}
      />,
    );
    await screen.getByRole("button", { name: "Switch workspace view" }).click();
    await page.getByRole("menuitemradio", { name: "Agent mode" }).element().focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(select).toHaveBeenCalledExactlyOnceWith("threads");
    await screen.getByRole("button", { name: "Switch workspace view" }).click();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Workspace", exact: true }))
      .toBeVisible();
    const box = page.getByRole("menu").element().getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(360);
    await userEvent.keyboard("{Escape}");
    await screen.unmount();
    await page.viewport(1000, 1000);
  });
});

it("previews the reference-style hover without changing the selected mode", async () => {
  await page.viewport(560, 340);
  const root = document.documentElement;
  const previousStyle = root.style.cssText;
  const previousClass = root.className;
  const select = vi.fn();
  const screen = await render(
    <div className="p-4">
      <SidebarModeMenu views={["studio", "threads"]} activeView="threads" onSelectView={select} />
    </div>,
  );
  try {
    await screen.getByRole("button", { name: "Switch workspace view" }).click();
    await page.getByRole("menuitemradio", { name: "Agent mode" }).hover();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Projects" }))
      .toHaveAttribute("aria-checked", "true");
    expect(select).not.toHaveBeenCalled();
    for (const variant of ["dark", "light"] as const) {
      root.classList.toggle("dark", variant === "dark");
      const { variables } = buildThemeCssVariables(
        resolveThemePack(DEFAULT_THEME_STATE, variant),
        variant,
      );
      for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => {})),
      );
      await page.screenshot({ path: `/tmp/djl-mode-menu-${variant}.png` });
    }
  } finally {
    await screen.unmount();
    root.style.cssText = previousStyle;
    root.className = previousClass;
    await page.viewport(1000, 1000);
  }
});
