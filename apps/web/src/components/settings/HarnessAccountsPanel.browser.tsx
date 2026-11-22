import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HarnessAccount, HarnessLoginResult, HarnessTool } from "@djl/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { HarnessAccountsPanel } from "./HarnessAccountsPanel";

const appSettings = vi.hoisted(() => ({
  settings: { defaultProvider: "opencode", kimiRegion: "existing" },
  updateSettings: vi.fn(),
}));

const terminalListeners = vi.hoisted(() => new Set<(event: never) => void>());
const api = vi.hoisted(() => ({
  harnesses: {
    listAccounts: vi.fn(async () => ({
      accounts: [{ id: "codex", installed: true, enabled: true, status: "required" }],
    })),
    listLegacyOpenCodeCredentials: vi.fn(async () => ({
      availableProviderIds: ["anthropic"],
      existingProviderIds: ["openai"],
      transferredProviderIds: [],
    })),
    transferLegacyOpenCodeCredentials: vi.fn(async () => ({
      availableProviderIds: [],
      existingProviderIds: ["openai"],
      transferredProviderIds: ["anthropic"],
    })),
    listTools: vi.fn<() => Promise<{ tools: HarnessTool[] }>>(async () => ({ tools: [] })),
    maintainTool: vi.fn<() => Promise<HarnessTool>>(),
    startLogin: vi.fn<() => Promise<HarnessLoginResult>>(),
    endLogin: vi.fn(async () => undefined),
  },
  server: {
    updateSettings: vi.fn(),
    refreshProviders: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => ({
      enableAutomaticProviderUpdates: false,
      enableProviderUpdateChecks: true,
    })),
  },
  terminal: {
    close: vi.fn(async () => undefined),
    onEvent: vi.fn((listener: (event: never) => void) => {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    }),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
  cloud: {
    getStatus: vi.fn(async () => ({
      signedIn: false,
      apiBaseUrl: "https://api.test",
      checkedAt: "2026-09-12T00:00:00.000Z",
    })),
    startSignIn: vi.fn(),
    pollSignIn: vi.fn(),
    signOut: vi.fn(),
    startBrowserSignIn: vi.fn(),
    completeBrowserSignIn: vi.fn(),
  },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));
vi.mock("~/appSettings", () => ({
  useAppSettings: () => appSettings,
}));
vi.mock("../terminal/terminalRuntimeRegistry", () => ({
  terminalRuntimeRegistry: { attach: vi.fn(), dispose: vi.fn() },
  buildTerminalRuntimeKey: (threadId: string) => threadId,
}));

async function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <HarnessAccountsPanel />
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
  terminalListeners.clear();
  appSettings.settings.defaultProvider = "opencode";
  appSettings.settings.kimiRegion = "existing";
});

describe("HarnessAccountsPanel login lifecycle", () => {
  it("saves the Kimi region before allowing sign-in", async () => {
    api.harnesses.listAccounts.mockResolvedValueOnce({
      accounts: [{ id: "kimi", installed: true, enabled: true, status: "required" }],
    });
    let finish!: () => void;
    api.server.updateSettings.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            appSettings.settings.kimiRegion = "global";
            resolve({ providers: { kimi: { region: "global" } } });
          };
        }),
    );
    await mount();
    await page.getByRole("combobox", { name: "Kimi account region" }).selectOptions("global");
    await expect
      .poll(() => api.server.updateSettings.mock.calls)
      .toEqual([[{ providers: { kimi: { region: "global" } } }]]);
    await expect
      .element(page.getByRole("combobox", { name: "Kimi account region" }))
      .toBeDisabled();
    expect(api.harnesses.startLogin).not.toHaveBeenCalled();
    finish();
    await expect.element(page.getByRole("combobox", { name: "Kimi account region" })).toBeEnabled();
    await expect
      .element(page.getByRole("combobox", { name: "Kimi account region" }))
      .toHaveValue("global");
  });
  it("blocks incompatible OpenCode actions while preserving unknown native provider behavior", async () => {
    appSettings.settings.defaultProvider = "claudeAgent";
    api.harnesses.listAccounts.mockResolvedValueOnce({
      accounts: [
        { id: "codex", installed: true, enabled: true, status: "unknown" },
        { id: "opencode", installed: true, enabled: true, status: "incompatible" },
      ],
    });
    await mount();
    await expect
      .element(page.getByRole("button", { name: "Sign in", exact: true }).last())
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Use for new chats", exact: true }).last())
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Sign in", exact: true }).first())
      .toBeEnabled();
    await expect
      .element(page.getByRole("button", { name: "Use for new chats", exact: true }).first())
      .toBeEnabled();
    expect(api.harnesses.startLogin).not.toHaveBeenCalled();
    expect(appSettings.updateSettings).not.toHaveBeenCalled();
  });

  it("cancels pending login on unmount and closes its exact late-arriving terminal", async () => {
    let resolve!: (session: HarnessLoginResult) => void;
    api.harnesses.startLogin.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const screen = await mount();
    const signIn = page.getByRole("button", { name: "Sign in", exact: true }).first();
    await expect.element(signIn).toBeEnabled();
    await signIn.click();
    await expect.poll(() => api.harnesses.startLogin.mock.calls.length).toBe(1);
    await screen.unmount();
    expect(api.harnesses.endLogin).toHaveBeenCalledWith({ harness: "codex" });
    const late = {
      harness: "codex",
      threadId: "late-login",
      terminalId: "default",
      cwd: "/tmp",
    } as const;
    resolve(late);
    await expect.poll(() => api.terminal.close.mock.calls.length).toBe(1);
    expect(api.terminal.close).toHaveBeenCalledWith({ ...late, deleteHistory: true });
  });

  it("does not cancel a newer attempt when an unmounted request later fails", async () => {
    let reject!: (error: Error) => void;
    api.harnesses.startLogin.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const screen = await mount();
    const signIn = page.getByRole("button", { name: "Sign in", exact: true }).first();
    await expect.element(signIn).toBeEnabled();
    await signIn.click();
    await expect.poll(() => api.harnesses.startLogin.mock.calls.length).toBe(1);
    await screen.unmount();
    expect(api.harnesses.endLogin).toHaveBeenCalledTimes(1);
    reject(new Error("Cancelled request"));
    await Promise.resolve();
    await Promise.resolve();
    expect(api.harnesses.endLogin).toHaveBeenCalledTimes(1);
  });

  it("ends a possibly-started login when RPC response delivery fails", async () => {
    api.harnesses.startLogin.mockRejectedValue(new Error("Connection lost"));
    await mount();
    const signIn = page.getByRole("button", { name: "Sign in", exact: true }).first();
    await expect.element(signIn).toBeEnabled();
    await signIn.click();
    await expect.poll(() => api.harnesses.endLogin.mock.calls.length).toBe(1);
    expect(api.harnesses.endLogin).toHaveBeenCalledWith({ harness: "codex" });
  });
});

describe("HarnessAccountsPanel guided sign-in", () => {
  const login = { harness: "codex", threadId: "login-1", terminalId: "default", cwd: "/tmp" };
  afterEach(() => {
    api.harnesses.listAccounts.mockResolvedValue({
      accounts: [{ id: "codex", installed: true, enabled: true, status: "required" }],
    });
  });
  const exit = (exitCode: number) => {
    for (const listener of terminalListeners) {
      listener({ ...login, type: "exited", exitCode, exitSignal: null } as never);
    }
  };

  it("opens the guide, notices the account is connected, and closes cleanly", async () => {
    api.harnesses.startLogin.mockResolvedValue(login as HarnessLoginResult);
    await mount();
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await expect.element(page.getByRole("heading", { name: "Sign in to Codex" })).toBeVisible();
    expect(api.harnesses.startLogin).toHaveBeenCalledWith({ harness: "codex" });
    await expect.poll(() => terminalListeners.size).toBe(1);

    api.harnesses.listAccounts.mockResolvedValue({
      accounts: [{ id: "codex", installed: true, enabled: true, status: "ready" }],
    });
    exit(0);
    await expect.element(page.getByRole("heading", { name: "Codex is connected" })).toBeVisible();

    await page.getByRole("dialog").getByRole("button", { name: "Use for new chats" }).click();
    expect(appSettings.updateSettings).toHaveBeenCalledWith({ defaultProvider: "codex" });
    await expect.poll(() => api.harnesses.endLogin.mock.calls).toEqual([[{ harness: "codex" }]]);
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
    // A connected account offers a fresh sign-in, not a first one.
    await expect.element(page.getByRole("button", { name: "Sign in again" })).toBeVisible();
  });

  it("starts the same sign-in again after one that did not finish", async () => {
    api.harnesses.startLogin.mockResolvedValue(login as HarnessLoginResult);
    await mount();
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await expect.poll(() => terminalListeners.size).toBe(1);
    exit(1);
    await expect
      .element(page.getByRole("heading", { name: "Sign-in did not finish" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => api.harnesses.startLogin.mock.calls.length).toBe(2);
    expect(api.harnesses.endLogin).toHaveBeenCalledWith({ harness: "codex" });
    await expect.element(page.getByRole("heading", { name: "Sign in to Codex" })).toBeVisible();
  });

  it("shows each account's state and the one action that fits it", async () => {
    appSettings.settings.defaultProvider = "codex";
    api.harnesses.listAccounts.mockResolvedValueOnce({
      accounts: [
        { id: "codex", installed: true, enabled: true, status: "ready" },
        { id: "claudeAgent", installed: true, enabled: true, status: "ready" },
        { id: "cursor", installed: true, enabled: true, status: "required" },
        { id: "gemini", installed: false, enabled: true, status: "missing" },
        { id: "grok", installed: true, enabled: true, status: "unknown" },
      ],
    });
    await mount();
    await expect.element(page.getByText("Default for new chats")).toBeVisible();
    expect(page.getByRole("button", { name: "Sign in again" }).elements()).toHaveLength(2);
    // Codex is the default already and Cursor is not signed in, so neither offers it.
    expect(page.getByRole("button", { name: "Use for new chats" }).elements()).toHaveLength(2);
    expect(page.getByRole("button", { name: "Sign in", exact: true }).elements()).toHaveLength(2);
    const shots: string | undefined = import.meta.env.VITE_SIGNIN_SCREENSHOT_DIR;
    if (shots) {
      document.documentElement.classList.add("dark");
      document.body.style.background = "#111";
      await page.viewport(1100, 1000);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await page.screenshot({ path: `${shots}/accounts-dark.png` });
      document.documentElement.classList.remove("dark");
      document.body.style.background = "";
    }
  });

  it("offers only the setup guide for an agent that is not installed", async () => {
    api.harnesses.listAccounts.mockResolvedValueOnce({
      accounts: [{ id: "codex", installed: false, enabled: true, status: "missing" }],
    });
    await mount();
    await expect.element(page.getByText("Official CLI not installed")).toBeVisible();
    expect(page.getByRole("button", { name: "Sign in", exact: true }).elements()).toHaveLength(0);
    await expect
      .element(page.getByRole("link", { name: "Setup guide" }).first())
      .toHaveAttribute("href", "https://developers.openai.com/codex/cli/");
  });
});

const missingTool = (id: HarnessTool["id"], canInstall = true): HarnessTool => ({
  id,
  installed: false,
  currentVersion: null,
  latestVersion: "2.0.0",
  status: "unknown",
  canInstall,
  canUpdate: false,
});

describe("HarnessAccountsPanel install and sign in", () => {
  const login = { harness: "codex", threadId: "login-1", terminalId: "default", cwd: "/tmp" };
  // The account check reports the CLI installed only once the install has run.
  const accountsAfterInstall = (installed: () => boolean) =>
    api.harnesses.listAccounts.mockImplementation(async () => ({
      accounts: [
        installed()
          ? ({ id: "codex", installed: true, enabled: true, status: "required" } as const)
          : ({ id: "codex", installed: false, enabled: true, status: "missing" } as const),
      ] satisfies HarnessAccount[],
    }));
  afterEach(() => {
    api.harnesses.listAccounts.mockReset();
    api.harnesses.listAccounts.mockResolvedValue({
      accounts: [{ id: "codex", installed: true, enabled: true, status: "required" }],
    });
    api.harnesses.listTools.mockResolvedValue({ tools: [] });
    api.harnesses.maintainTool.mockReset();
  });

  it("installs a missing CLI from its row and goes straight into its sign-in", async () => {
    let installed = false;
    let finishInstall!: () => void;
    accountsAfterInstall(() => installed);
    api.harnesses.listTools.mockResolvedValue({ tools: [missingTool("codex")] });
    api.harnesses.maintainTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInstall = () => {
            installed = true;
            resolve({ ...missingTool("codex"), installed: true, currentVersion: "2.0.0" });
          };
        }),
    );
    api.harnesses.startLogin.mockResolvedValue(login as HarnessLoginResult);
    await mount();
    await expect
      .element(page.getByRole("link", { name: "Setup guide" }).first())
      .toHaveAttribute("href", "https://developers.openai.com/codex/cli/");
    await page.getByRole("button", { name: "Install and sign in" }).click();

    const installStep = page.getByRole("listitem").filter({ hasText: "Install Codex" });
    await expect.element(installStep).toHaveAttribute("data-state", "loading");
    expect(api.harnesses.maintainTool).toHaveBeenCalledWith({ harness: "codex" });
    expect(api.harnesses.startLogin).not.toHaveBeenCalled();
    const toolChecks = api.harnesses.listTools.mock.calls.length;

    finishInstall();
    await expect.poll(() => api.harnesses.startLogin.mock.calls).toEqual([[{ harness: "codex" }]]);
    await expect.element(installStep).toHaveAttribute("data-state", "done");
    await expect.element(page.getByRole("heading", { name: "Sign in to Codex" })).toBeVisible();
    // Both sections read the installed CLI again, so they agree.
    expect(api.harnesses.listTools.mock.calls.length).toBeGreaterThan(toolChecks);
    expect(api.server.refreshProviders).toHaveBeenCalled();
  });

  it("shows why the install stopped and installs again on request", async () => {
    let installed = false;
    accountsAfterInstall(() => installed);
    api.harnesses.listTools.mockResolvedValue({ tools: [missingTool("codex")] });
    api.harnesses.maintainTool.mockRejectedValueOnce(
      new Error("Installation failed. Check network access."),
    );
    api.harnesses.startLogin.mockResolvedValue(login as HarnessLoginResult);
    await mount();
    await page.getByRole("button", { name: "Install and sign in" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Installation did not finish" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("dialog").getByRole("alert"))
      .toHaveTextContent("Installation failed. Check network access.");
    expect(api.harnesses.startLogin).not.toHaveBeenCalled();

    api.harnesses.maintainTool.mockImplementation(async () => {
      installed = true;
      return { ...missingTool("codex"), installed: true, currentVersion: "2.0.0" };
    });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => api.harnesses.maintainTool.mock.calls.length).toBe(2);
    await expect.poll(() => api.harnesses.startLogin.mock.calls).toEqual([[{ harness: "codex" }]]);
  });

  it("goes on to sign in when the install reported a problem but the CLI is there", async () => {
    let installed = false;
    accountsAfterInstall(() => installed);
    api.harnesses.listTools.mockResolvedValue({ tools: [missingTool("codex")] });
    api.harnesses.maintainTool.mockImplementation(async () => {
      installed = true;
      throw new Error("The CLI is installed, but the latest version could not be verified.");
    });
    api.harnesses.startLogin.mockResolvedValue(login as HarnessLoginResult);
    await mount();
    await page.getByRole("button", { name: "Install and sign in" }).click();
    await expect.poll(() => api.harnesses.startLogin.mock.calls).toEqual([[{ harness: "codex" }]]);
  });

  it("keeps only the setup guide when DJL cannot install the CLI or the agent is off", async () => {
    api.harnesses.listAccounts.mockResolvedValue({
      accounts: [
        { id: "codex", installed: false, enabled: true, status: "missing" },
        { id: "gemini", installed: false, enabled: false, status: "disabled" },
      ],
    });
    api.harnesses.listTools.mockResolvedValue({
      tools: [missingTool("codex", false), missingTool("gemini")],
    });
    await mount();
    await expect.element(page.getByText("Official CLI not installed")).toBeVisible();
    await expect.poll(() => api.harnesses.listTools.mock.calls.length).toBeGreaterThan(0);
    // The tools panel below renders the same list, so its rows show the tools have loaded.
    await expect
      .element(page.getByRole("group", { name: "Gemini CLI", exact: true }))
      .toHaveTextContent("Latest: 2.0.0");
    expect(page.getByRole("button", { name: "Install and sign in" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("link", { name: "Setup guide" }).first()).toBeVisible();
  });
});

it("requires an explicit click to copy saved OpenCode logins", async () => {
  api.harnesses.listAccounts.mockResolvedValueOnce({
    accounts: [{ id: "opencode", installed: true, enabled: true, status: "required" }],
  });
  await mount();
  const transfer = page.getByRole("button", {
    name: "Copy saved DJL logins to OpenCode",
    exact: true,
  });
  await expect.element(transfer).toBeVisible();
  expect(api.harnesses.transferLegacyOpenCodeCredentials).not.toHaveBeenCalled();
  await expect.element(page.getByText("Existing CLI logins kept: openai.")).toBeVisible();
  await transfer.click();
  await expect
    .poll(() => api.harnesses.transferLegacyOpenCodeCredentials.mock.calls.length)
    .toBe(1);
});
