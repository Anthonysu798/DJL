import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HarnessLoginResult } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { HarnessAccountsPanel } from "./HarnessAccountsPanel";

const appSettings = vi.hoisted(() => ({
  settings: { defaultProvider: "opencode", kimiRegion: "existing" },
  updateSettings: vi.fn(),
}));

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
    listTools: vi.fn(async () => ({ tools: [] })),
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
  terminal: { close: vi.fn(async () => undefined) },
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
