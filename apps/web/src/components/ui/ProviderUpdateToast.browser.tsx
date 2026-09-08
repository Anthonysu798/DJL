import "../../index.css";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, toastManager } from "./toast";
import {
  buildThemeCssVariables,
  DEFAULT_THEME_STATE,
  resolveThemePack,
} from "../../theme/theme.logic";

function luminance(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const values = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}

describe("DJL provider-update notification", () => {
  it.each([
    { mode: "dark" as const, width: 1280 },
    { mode: "dark" as const, width: 390 },
    { mode: "light" as const, width: 1024 },
  ])("keeps the $mode popup legible and actionable at $width px", async ({ mode, width }) => {
    await page.viewport(width, 720);
    const html = document.documentElement;
    const previousStyle = html.style.cssText;
    const previousClass = html.className;
    html.classList.toggle("dark", mode === "dark");
    const theme = buildThemeCssVariables(resolveThemePack(DEFAULT_THEME_STATE, mode), mode);
    for (const [key, value] of Object.entries(theme.variables)) html.style.setProperty(key, value);
    const root = createRootRoute({
      component: () => (
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      ),
    });
    const index = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <div>DJL</div>,
    });
    const router = createRouter({
      routeTree: root.addChildren([index]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const screen = await render(<RouterProvider router={router} />);
    const update = vi.fn();
    const review = vi.fn();
    const dismiss = vi.fn();
    const toastId = toastManager.add({
      title: "2 provider updates available",
      description: "Codex and 1 more provider have newer versions available.",
      type: "warning",
      timeout: 0,
      actionProps: { children: "Review updates", onClick: review },
      data: {
        providerUpdate: ["codex", "claudeAgent"],
        onClose: dismiss,
        secondaryActionProps: { children: "Update all", onClick: update },
      },
    });
    try {
      await expect.element(page.getByRole("button", { name: "Update all" })).toBeVisible();
      await document.fonts.ready;
      await vi.waitFor(() => {
        const card = document.querySelector(".djl-provider-update-toast")!;
        const bounds = card.getBoundingClientRect();
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 2);
        expect(getComputedStyle(card.querySelector(".djl-update-heading")!).opacity).toBe("1");
      });
      const button = page.getByRole("button", { name: "Update all" }).element();
      const styles = getComputedStyle(button);
      const ink = luminance(styles.color),
        background = luminance(styles.backgroundColor);
      expect(
        (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({
        element: document.querySelector(".djl-provider-update-toast")!,
        path: `/tmp/djl-provider-update-${mode}-${width}.png`,
      });
      await page.getByRole("button", { name: "Update all" }).click();
      expect(update).toHaveBeenCalledTimes(1);
      await page.getByRole("button", { name: "Review updates" }).click();
      expect(review).toHaveBeenCalledTimes(1);
      await page.getByRole("button", { name: "Dismiss toast" }).click();
      expect(dismiss).toHaveBeenCalledTimes(1);
      await vi.waitFor(() =>
        expect(document.querySelector(".djl-provider-update-toast")).toBeNull(),
      );
    } finally {
      toastManager.close(toastId);
      await screen.unmount();
      html.style.cssText = previousStyle;
      html.className = previousClass;
    }
  });
});
