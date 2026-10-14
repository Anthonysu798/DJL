import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { DesktopWorkspaceTabs } from "./DesktopWorkspaceTabs";
import "../index.css";

describe("Desktop workspace tabs", () => {
  it("opens visited routes, returns to an earlier tab, and closes the active tab", async () => {
    const onNewChat = vi.fn();
    function Shell() {
      const title = useLocation({
        select: (location) => (location.pathname === "/first" ? "First chat" : "Second chat"),
      });
      return (
        <>
          <div style={{ width: 270 }}>
            <DesktopWorkspaceTabs title={title} onNewChat={onNewChat} newChatLabel="New chat" />
          </div>
          <Outlet />
        </>
      );
    }
    const root = createRootRoute({ component: Shell });
    const first = createRoute({
      getParentRoute: () => root,
      path: "/first",
      component: () => <h1>First conversation</h1>,
    });
    const second = createRoute({
      getParentRoute: () => root,
      path: "/second",
      component: () => <h1>Second conversation</h1>,
    });
    const history = createHashHistory();
    history.replace("/first");
    const router = createRouter({ routeTree: root.addChildren([first, second]), history });
    render(<RouterProvider router={router} />);
    await expect.element(page.getByRole("heading", { name: "First conversation" })).toBeVisible();
    history.push("/second");
    await expect.element(page.getByRole("link", { name: "Second chat" })).toBeVisible();
    const selected = page
      .getByRole("link", { name: "Second chat" })
      .element()
      .closest(".djl-desktop-tab")!;
    const strip = selected.parentElement!;
    expect(selected.getBoundingClientRect().right).toBeLessThanOrEqual(
      strip.getBoundingClientRect().right + 1,
    );
    await page.getByRole("link", { name: "First chat" }).click();
    await expect.element(page.getByRole("heading", { name: "First conversation" })).toBeVisible();
    await page.getByRole("button", { name: "Close: First chat" }).click();
    await expect.element(page.getByRole("heading", { name: "Second conversation" })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "First chat" })).not.toBeInTheDocument();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    expect(onNewChat).toHaveBeenCalledOnce();
    history.destroy();
  });
});
