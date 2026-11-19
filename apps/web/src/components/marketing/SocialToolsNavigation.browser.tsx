import "../../index.css";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { MarketingChatCards } from "./MarketingChatCards";

vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  loadThreadMarketing: vi.fn(async () => ({ campaigns: [], assets: [] })),
}));

it("opens Social tools as a route and supports browser back to the originating chat", async () => {
  const root = createRootRoute({ component: Outlet });
  const chat = createRoute({
    getParentRoute: () => root,
    path: "/$threadId",
    component: () => <MarketingChatCards threadId="source-chat" isWorking={false} />,
  });
  const social = createRoute({
    getParentRoute: () => root,
    path: "/social/$socialThreadId",
    component: () => <main>Social tools page</main>,
  });
  const router = createRouter({
    routeTree: root.addChildren([chat, social]),
    history: createMemoryHistory({ initialEntries: ["/source-chat"] }),
  });
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.getByRole("link", { name: "Social tools", exact: true }).click();
  await expect.element(screen.getByRole("main")).toHaveTextContent("Social tools page");
  expect(router.state.location.pathname).toBe("/social/source-chat");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  router.history.back();
  await expect
    .element(screen.getByRole("link", { name: "Social tools", exact: true }))
    .toBeVisible();
  await screen.unmount();
});
