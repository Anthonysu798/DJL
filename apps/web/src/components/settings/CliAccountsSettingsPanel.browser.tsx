import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { CliAccountSummary } from "@djl/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

const reset = new Date(Date.now() + 3 * 3600_000).toISOString();
const accounts: CliAccountSummary[] = [
  {
    id: "default",
    provider: "claudeAgent",
    name: "",
    isDefault: true,
    active: true,
    status: "signedIn",
    email: "me@example.com",
  },
  {
    id: "claude-work",
    provider: "claudeAgent",
    name: "Work",
    isDefault: false,
    active: false,
    status: "signedIn",
    email: "me@work.example",
  },
  {
    id: "default",
    provider: "codex",
    name: "",
    isDefault: true,
    active: true,
    status: "signedOut",
    email: null,
  },
];
const api = vi.hoisted(() => ({
  cliAccounts: {
    list: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    setActive: vi.fn(),
    usage: vi.fn(),
  },
  server: { getConfig: vi.fn() },
  terminal: { open: vi.fn(), close: vi.fn(), onEvent: vi.fn() },
  harnesses: { getProfileAccount: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api, readNativeApi: () => api }));
// The sign-in dialog's terminal screen is xterm; these tests only need its session.
vi.mock("~/components/terminal/terminalRuntimeRegistry", () => ({
  buildTerminalRuntimeKey: (threadId: string, terminalId: string) => `${threadId}:${terminalId}`,
  terminalRuntimeRegistry: { attach: vi.fn(), dispose: vi.fn() },
}));

async function mount() {
  api.cliAccounts.list.mockResolvedValue({ accounts });
  api.cliAccounts.usage.mockResolvedValue({
    usage: [
      {
        accountId: "default",
        provider: "claudeAgent",
        snapshot: {
          provider: "claudeAgent",
          updatedAt: new Date().toISOString(),
          source: "live",
          status: "ok",
          usageLines: [],
          limits: [{ window: "5h", usedPercent: 80, resetsAt: reset, windowDurationMins: 300 }],
        },
      },
      {
        accountId: "claude-work",
        provider: "claudeAgent",
        snapshot: {
          provider: "claudeAgent",
          updatedAt: new Date().toISOString(),
          source: "live",
          status: "ok",
          usageLines: [],
          limits: [{ window: "5h", usedPercent: 10, resetsAt: reset, windowDurationMins: 300 }],
        },
      },
    ],
  });
  const { CliAccountsSettingsPanel } = await import("./CliAccountsSettingsPanel");
  const root = createRootRoute({ component: () => <CliAccountsSettingsPanel /> });
  const settings = createRoute({ getParentRoute: () => root, path: "/settings" });
  const router = createRouter({
    routeTree: root.addChildren([settings]),
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <div className="dark bg-background p-6 text-foreground">
        <RouterProvider router={router} />
      </div>
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

it("shows every account with what it has left and which one new chats use", async () => {
  await mount();
  await expect.element(page.getByText("me@work.example")).toBeVisible();
  await expect.element(page.getByText("Work", { exact: true })).toBeVisible();
  // Claude's main account is in use; Codex's main login still needs a sign-in.
  expect(page.getByText("In use", { exact: true }).elements()).toHaveLength(2);
  await expect.element(page.getByText("Not signed in")).toBeVisible();
  await expect.element(page.getByText("90% left")).toBeVisible();
});

it("switches the account new chats use in one click", async () => {
  api.cliAccounts.setActive.mockResolvedValue({
    accounts: accounts.map((account) =>
      account.provider === "claudeAgent"
        ? { ...account, active: account.id === "claude-work" }
        : account,
    ),
  });
  await mount();
  await page.getByRole("button", { name: "Use for new chats" }).click();
  expect(api.cliAccounts.setActive).toHaveBeenCalledWith({
    provider: "claudeAgent",
    id: "claude-work",
  });
});

it("removes an extra account only after confirming", async () => {
  api.cliAccounts.remove.mockResolvedValue({
    accounts: accounts.filter((a) => a.id !== "claude-work"),
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  await mount();
  const removeButton = page.getByRole("button", { name: "Remove" });
  await removeButton.click();
  expect(api.cliAccounts.remove).not.toHaveBeenCalled();
  await removeButton.click();
  expect(api.cliAccounts.remove).toHaveBeenCalledWith({ id: "claude-work" });
  confirm.mockRestore();
});

it("signs a main account in from its card", async () => {
  let emit: ((event: unknown) => void) | undefined;
  api.server.getConfig.mockResolvedValue({ cwd: "/work", homeDir: "/home/me" });
  api.terminal.onEvent.mockImplementation((listener: (event: unknown) => void) => {
    emit = listener;
    return () => undefined;
  });
  api.terminal.open.mockResolvedValue({ status: "running", headlessQueries: true });
  api.terminal.close.mockResolvedValue(undefined);
  api.shell.openExternal.mockResolvedValue(undefined);
  api.harnesses.getProfileAccount.mockResolvedValue({
    provider: "codex",
    profileId: "default",
    status: "signedOut",
    email: null,
  });
  await mount();
  // Codex's main login is signed out; its Sign in used to go nowhere.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.element(page.getByText("Sign in with Codex")).toBeVisible();
  await vi.waitFor(() =>
    expect(api.terminal.open).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfile: { provider: "codex", profileId: "default", action: "login" },
      }),
    ),
  );
  const { threadId } = api.terminal.open.mock.calls[0]![0] as { threadId: string };
  emit?.({
    type: "output",
    threadId,
    terminalId: "default",
    data: "Open https://auth.openai.com/oauth/authorize?client_id=demo \r\n",
  });
  await page.getByRole("button", { name: "Open sign-in page" }).click();
  expect(api.shell.openExternal).toHaveBeenCalledWith(
    "https://auth.openai.com/oauth/authorize?client_id=demo",
  );
  api.harnesses.getProfileAccount.mockResolvedValue({
    provider: "codex",
    profileId: "default",
    status: "signedIn",
    email: "me@openai.example",
  });
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect.element(page.getByText("Codex is connected")).toBeVisible();
  await expect.element(page.getByText("me@openai.example")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Use this account" })).toBeVisible();
});
