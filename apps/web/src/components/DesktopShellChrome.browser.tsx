import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { DesktopShellChrome } from "./DesktopShellChrome";
import { DesktopHeaderPortal } from "./DesktopHeaderPortal";
import { SidebarProvider } from "./ui/sidebar";
import "../index.css";

afterEach(cleanup);

describe("Desktop window chrome", () => {
  it("stays anchored to the window outside a translucent sidebar and preserves rail actions", async () => {
    await page.viewport(1280, 800);
    const onHome = vi.fn();
    const root = createRootRoute({
      component: () => (
        <SidebarProvider className="djl-desktop-shell">
          <div id="djl-desktop-chrome" />
          <div
            style={{
              position: "fixed",
              left: 52,
              top: 46,
              width: 238,
              backdropFilter: "blur(8px)",
            }}
          >
            <DesktopShellChrome
              title="Test chat"
              newChatLabel="New chat"
              onNewChat={vi.fn()}
              account={null}
              update={null}
              items={[{ label: "Home", icon: "home", active: true, onClick: onHome }]}
            />
            <DesktopHeaderPortal enabled>
              <button data-testid="thread-controls">Thread controls</button>
            </DesktopHeaderPortal>
          </div>
        </SidebarProvider>
      ),
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    await expect.element(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    const rail = page.getByRole("navigation", { name: "DJL", exact: true }).element();
    expect(rail.getBoundingClientRect().x).toBe(0);
    expect(rail.getBoundingClientRect().y).toBe(46);
    expect(document.querySelector(".djl-desktop-topbar")?.getBoundingClientRect().y).toBe(0);
    await expect.element(page.getByTestId("thread-controls")).toBeVisible();
    expect(
      page.getByTestId("thread-controls").element().closest("#djl-desktop-toolbar"),
    ).not.toBeNull();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    expect(onHome).toHaveBeenCalledOnce();
  });
});
