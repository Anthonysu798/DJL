import type { TerminalEvent } from "@djl/contracts";
import "../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { page } from "vitest/browser";
import AgentWorkspacesView from "./AgentWorkspacesView";
import { useAgentWorkspaceStore } from "~/agentWorkspaceStore";
import { PROFILE_ACCOUNT_QUERY_KEY } from "./WorkspaceAccountRow";
const backend = vi.hoisted(() => ({
  signedIn: false,
  appAccounts: [] as Array<{
    id: string;
    provider: "codex" | "claudeAgent";
    name: string;
    isDefault: boolean;
    active: boolean;
    status: "signedIn" | "signedOut";
    email: string | null;
  }>,
  addAccount: vi.fn(),
  listeners: new Set<(event: TerminalEvent) => void>(),
  openExternal: vi.fn(async () => {}),
  pickFolder: vi.fn(),
  open: vi.fn(),
  close: vi.fn(async () => {}),
}));
vi.mock("~/components/SidebarHeaderNavigationControls", () => ({
  SidebarHeaderNavigationControls: () => null,
}));
vi.mock("~/nativeApi", () => {
  const api = {
    dialogs: { pickFolder: backend.pickFolder },
    shell: { openExternal: backend.openExternal },
    server: { getConfig: async () => ({ cwd: "/tmp", homeDir: "/tmp" }) },
    cliAccounts: {
      list: async () => ({ accounts: backend.appAccounts }),
      add: backend.addAccount,
    },
    harnesses: {
      getProfileAccount: async (input: { provider: string; profileId: string }) => ({
        ...input,
        status: backend.signedIn ? "signedIn" : "signedOut",
        email: backend.signedIn ? `${input.profileId}@example.com` : null,
      }),
    },
    terminal: {
      open: backend.open,
      close: backend.close,
      resize: async () => {},
      write: async () => {},
      ackOutput: async () => {},
      onEvent: (listener: (event: TerminalEvent) => void) => {
        backend.listeners.add(listener);
        return () => backend.listeners.delete(listener);
      },
    },
  };
  return { ensureNativeApi: () => api, readNativeApi: () => api };
});
vi.mock("~/wsTransportEvents", () => ({ addWsTransportStateListener: () => () => {} }));
beforeEach(() => {
  backend.signedIn = false;
  backend.appAccounts = [
    {
      id: "default",
      provider: "codex",
      name: "",
      isDefault: true,
      active: true,
      status: "signedIn",
      email: "me@example.com",
    },
    {
      id: "default",
      provider: "claudeAgent",
      name: "",
      isDefault: true,
      active: true,
      status: "signedOut",
      email: null,
    },
  ];
  backend.addAccount.mockImplementation(async (input: { provider: "codex"; name: string }) => {
    const account = {
      id: "codex-abc123",
      provider: input.provider,
      name: input.name,
      isDefault: false,
      active: false,
      status: "signedOut" as const,
      email: null,
    };
    backend.appAccounts = [...backend.appAccounts, account];
    return account;
  });
  backend.open.mockImplementation(async (input) => ({
    ...input,
    pid: 1,
    status: "running",
    history: "",
    screen: input.screenSnapshot ? "Finish signing in in your browser" : undefined,
    headlessQueries: true,
    exitCode: null,
    exitSignal: null,
    updatedAt: "now",
  }));
  useAgentWorkspaceStore.setState({
    profiles: [],
    activeId: "demo",
    selectedProfileId: null,
    workspaces: [
      { id: "demo", name: "Demo", cwd: "/tmp", projectId: null, layout: "grid", panes: [] },
    ],
  });
});
afterEach(async () => {
  await cleanup();
  backend.listeners.clear();
  vi.clearAllMocks();
});
async function mount() {
  // Desktop width, where the sidebar shows the account list.
  await page.viewport(1440, 900);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <AgentWorkspacesView projectId={null} />
    </QueryClientProvider>,
  );
  return { client, screen };
}
describe("simple workspace onboarding", () => {
  it.each(["/tmp/My Project", "C:\\Work\\My Project"])(
    "uses the native picker result and a sensible default name: %s",
    async (folder) => {
      backend.pickFolder.mockResolvedValue(folder);
      await mount();
      await page.getByRole("button", { name: "New workspace", exact: true }).first().click();
      await page.getByRole("button", { name: "Choose working folder", exact: true }).click();
      await expect
        .element(page.getByRole("textbox", { name: "Working folder", exact: true }))
        .toHaveValue(folder);
      await expect
        .element(page.getByRole("textbox", { name: "Name", exact: true }))
        .toHaveValue("My Project");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      expect(useAgentWorkspaceStore.getState().workspaces.at(-1)).toMatchObject({
        name: "My Project",
        cwd: folder,
        projectId: null,
      });
    },
  );
  it("keeps manually entered values when native selection is cancelled", async () => {
    backend.pickFolder.mockResolvedValue(null);
    await mount();
    await page.getByRole("button", { name: "New workspace", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("My custom label");
    await page.getByRole("textbox", { name: "Working folder", exact: true }).fill("/tmp/existing");
    await page.getByRole("button", { name: "Choose working folder", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Name", exact: true }))
      .toHaveValue("My custom label");
    await expect
      .element(page.getByRole("textbox", { name: "Working folder", exact: true }))
      .toHaveValue("/tmp/existing");
  });
  it("adds a Codex account to Settings, signs it in, and selects it without adding a pane", async () => {
    const { client } = await mount();
    await page.getByRole("button", { name: "Add account", exact: true }).first().click();
    await page.getByRole("button", { name: "Sign in with Codex", exact: true }).click();
    await vi.waitFor(() => expect(backend.open).toHaveBeenCalled());
    expect(backend.addAccount).toHaveBeenCalledWith({ provider: "codex", name: "Codex 2" });
    expect(useAgentWorkspaceStore.getState().profiles).toHaveLength(0);
    expect(backend.open).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfile: { provider: "codex", profileId: "codex-abc123", action: "login" },
      }),
    );
    const input = backend.open.mock.calls[0]![0];
    const url = "https://auth.openai.com/oauth/authorize?state=fixture";
    for (const listener of backend.listeners)
      listener({
        type: "output",
        threadId: input.threadId,
        terminalId: input.terminalId,
        createdAt: "now",
        data: `${url}\n`,
        byteLength: url.length + 1,
      });
    await page.getByRole("button", { name: "Open sign-in page", exact: true }).click();
    expect(backend.openExternal).toHaveBeenCalledWith(url);
    backend.signedIn = true;
    await client.invalidateQueries({ queryKey: PROFILE_ACCOUNT_QUERY_KEY });
    const useAccount = page.getByRole("button", { name: "Use this account", exact: true });
    await expect.element(useAccount).toBeEnabled();
    await useAccount.click();
    await vi.waitFor(() =>
      expect(useAgentWorkspaceStore.getState().selectedProfileId).toBe("codex-abc123"),
    );
    expect(useAgentWorkspaceStore.getState().workspaces[0]!.panes).toHaveLength(0);
    expect(backend.close).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: expect.stringMatching(/^profile-login-/),
        deleteHistory: true,
      }),
    );
    await page.getByRole("button", { name: "New terminal", exact: true }).first().click();
    await expect
      .element(page.getByRole("combobox", { name: "Account profile", exact: true }))
      .toHaveTextContent("Codex · Codex 2");
  });

  it("starts the normal Codex sign-in in one click, with no new login", async () => {
    await mount();
    await expect.element(page.getByText("me@example.com").first()).toBeVisible();
    await page.getByRole("button", { name: /Start Codex/ }).click();
    expect(useAgentWorkspaceStore.getState().workspaces[0]!.panes).toEqual([
      expect.objectContaining({ profileId: "default-codex", action: "run" }),
    ]);
    await vi.waitFor(() =>
      expect(backend.open).toHaveBeenCalledWith(
        expect.objectContaining({
          agentProfile: { provider: "codex", profileId: "default", action: "run" },
        }),
      ),
    );
    // A signed-out normal sign-in is not offered as a one-click start.
    expect(page.getByRole("button", { name: /Start Claude Code/ }).elements()).toHaveLength(0);
  });
});
