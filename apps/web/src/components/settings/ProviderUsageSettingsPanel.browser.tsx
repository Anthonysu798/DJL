import "../../index.css";

import { DEFAULT_SERVER_SETTINGS } from "@djl/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

const AT = "2099-04-08T18:00:00.000Z";
const RESET = "2099-04-09T01:00:00.000Z";

const api = vi.hoisted(() => ({
  cloud: { getStatus: vi.fn() },
  server: { listProviderUsage: vi.fn(), getConfig: vi.fn(), getSettings: vi.fn() },
  cliAccounts: { usage: vi.fn() },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api, readNativeApi: () => api }));

function snapshot(provider: string, usedPercent: number) {
  return {
    provider,
    updatedAt: AT,
    source: "live",
    status: "ok",
    usageLines: [],
    limits: [{ window: "5h", usedPercent, resetsAt: RESET, windowDurationMins: 300 }],
  };
}

async function mount(
  cliAccounts: unknown,
  usage: ReadonlyArray<Record<string, unknown>> = [
    snapshot("claudeAgent", 92),
    snapshot("codex", 40),
  ],
) {
  api.cloud.getStatus.mockResolvedValue({
    signedIn: false,
    apiBaseUrl: "https://api.test",
    checkedAt: AT,
  });
  api.server.listProviderUsage.mockResolvedValue(usage);
  api.server.getConfig.mockResolvedValue({ providers: [] });
  api.server.getSettings.mockResolvedValue({ ...DEFAULT_SERVER_SETTINGS, cliAccounts });
  api.cliAccounts.usage.mockResolvedValue({
    usage: [
      { accountId: "default", provider: "claudeAgent", snapshot: snapshot("claudeAgent", 92) },
      { accountId: "claude-work", provider: "claudeAgent", snapshot: snapshot("claudeAgent", 30) },
    ],
  });
  const { ProviderUsageSettingsPanel } = await import("./ProviderUsageSettingsPanel");
  const root = createRootRoute({ component: () => <ProviderUsageSettingsPanel /> });
  const settings = createRoute({ getParentRoute: () => root, path: "/settings" });
  const router = createRouter({
    routeTree: root.addChildren([settings]),
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <div className="dark bg-background p-6 text-foreground">
        <RouterProvider router={router} />
      </div>
    </QueryClientProvider>,
  );
  return router;
}

afterEach(async () => {
  await cleanup();
  vi.resetAllMocks();
});

it("shows each extra AI account next to its provider and marks the one in use", async () => {
  await mount({
    accounts: [{ id: "claude-work", provider: "claudeAgent", name: "Work", dir: "/tmp/work" }],
    active: { claudeAgent: "claude-work" },
  });
  await expect.element(page.getByText("Claude · Work", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Claude · Main account", { exact: true })).toBeVisible();
  await expect.element(page.getByText("70% left")).toBeVisible();
  expect(page.getByText("In use", { exact: true }).elements()).toHaveLength(1);
  // Codex has no extra accounts, so its card keeps its plain name.
  await expect.element(page.getByText("Codex", { exact: true })).toBeVisible();
});

it("does not ask for account usage when there are no extra accounts", async () => {
  await mount({ accounts: [], active: {} });
  await expect.element(page.getByText("Claude", { exact: true })).toBeVisible();
  expect(page.getByText("In use", { exact: true }).elements()).toHaveLength(0);
  expect(api.cliAccounts.usage).not.toHaveBeenCalled();
});

it("offers a Sign in button instead of a terminal command when an account is signed out", async () => {
  const router = await mount({ accounts: [], active: {} }, [
    {
      provider: "cursor",
      updatedAt: AT,
      source: "cursor",
      status: "needs-auth",
      detail: "Sign in with `cursor-agent login` to see usage.",
      usageLines: [],
      limits: [],
    },
  ]);
  await expect
    .element(page.getByText("Sign in to Cursor to see what you have left."))
    .toBeVisible();
  expect(page.getByText(/cursor-agent login/).elements()).toHaveLength(0);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect
    .poll(() => (router.state.location.search as Record<string, unknown>).section)
    .toBe("accounts");
});
