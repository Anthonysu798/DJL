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

// Social tools opens from the sidebar's Social section; a chat never floats its own button.
it("does not show a Social tools button inside a chat", async () => {
  const root = createRootRoute({ component: Outlet });
  const chat = createRoute({
    getParentRoute: () => root,
    path: "/$threadId",
    component: () => (
      <main>
        <MarketingChatCards threadId="source-chat" isWorking={false} />
      </main>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([chat]),
    history: createMemoryHistory({ initialEntries: ["/source-chat"] }),
  });
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await expect.element(screen.getByRole("main")).toBeInTheDocument();
  await expect
    .element(screen.getByRole("link", { name: "Social tools", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Social tools", exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
});
