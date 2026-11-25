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
import {
  DesktopWorkspaceTabs,
  nextWorkspaceTabs,
  replaceActiveDesktopTabOnNextNavigation,
} from "./DesktopWorkspaceTabs";
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

  it("keeps one tab when the Work / Code switch swaps the draft", async () => {
    function Shell() {
      const title = useLocation({ select: (location) => `Draft ${location.pathname}` });
      return (
        <div style={{ width: 600 }}>
          <DesktopWorkspaceTabs title={title} onNewChat={() => {}} newChatLabel="New chat" />
          <Outlet />
        </div>
      );
    }
    const root = createRootRoute({ component: Shell });
    const routes = ["/a", "/b", "/c"].map((path) =>
      createRoute({ getParentRoute: () => root, path, component: () => <h1>{path}</h1> }),
    );
    const history = createHashHistory();
    history.replace("/a");
    const router = createRouter({ routeTree: root.addChildren(routes), history });
    render(<RouterProvider router={router} />);
    await expect.element(page.getByRole("link", { name: "Draft /a" })).toBeVisible();
    for (const path of ["/b", "/c"]) {
      replaceActiveDesktopTabOnNextNavigation();
      history.push(path);
      await expect.element(page.getByRole("link", { name: `Draft ${path}` })).toBeVisible();
    }
    expect(page.getByRole("link").elements()).toHaveLength(1);
    // A plain navigation afterwards opens its own tab again.
    history.push("/a");
    await expect.element(page.getByRole("link", { name: "Draft /a" })).toBeVisible();
    expect(page.getByRole("link").elements()).toHaveLength(2);
    history.destroy();
  });
});

const tab = (path: string) => ({ path, href: path, title: path, provider: null });

describe("nextWorkspaceTabs", () => {
  it("adds, refreshes in place, or takes over the replaced tab", () => {
    expect(nextWorkspaceTabs([tab("/a")], tab("/b"), null).map((t) => t.path)).toEqual([
      "/a",
      "/b",
    ]);
    expect(nextWorkspaceTabs([tab("/a"), tab("/b")], tab("/c"), "/a").map((t) => t.path)).toEqual([
      "/c",
      "/b",
    ]);
    expect(nextWorkspaceTabs([tab("/a"), tab("/b")], tab("/b"), "/a").map((t) => t.path)).toEqual([
      "/a",
      "/b",
    ]);
  });
});
