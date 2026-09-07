import "../../index.css";
import type { HarnessTool, ServerSettingsPatch } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { HarnessToolsPanel } from "./HarnessToolsPanel";

const api = vi.hoisted(() => ({
  server: {
    getSettings: vi.fn(async () => ({
      enableAutomaticProviderUpdates: false,
      enableProviderUpdateChecks: true,
    })),
    updateSettings: vi.fn(async (patch: ServerSettingsPatch) => ({
      enableProviderUpdateChecks: true,
      ...patch,
    })),
  },
  harnesses: {
    listTools: vi.fn<() => Promise<{ tools: HarnessTool[] }>>(),
    maintainTool: vi.fn(),
  },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));
const tool = (id: HarnessTool["id"], installed = true): HarnessTool => ({
  id,
  installed,
  currentVersion: installed ? "1.0.0" : null,
  latestVersion: "2.0.0",
  status: installed ? "behind_latest" : "unknown",
  canInstall: !installed,
  canUpdate: installed,
});
async function mount(tools: HarnessTool[]) {
  api.harnesses.listTools.mockResolvedValue({ tools });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <HarnessToolsPanel />
    </QueryClientProvider>,
  );
}
afterEach(async () => {
  await cleanup();
  vi.resetAllMocks();
});
describe("provider tools", () => {
  it("persists automatic updates on the server without starting a manual update", async () => {
    await mount([tool("codex")]);
    const toggle = page.getByRole("switch", { name: "Automatically update provider tools" });
    await expect.element(toggle).not.toBeChecked();
    await toggle.click();
    await expect
      .poll(() => api.server.updateSettings.mock.calls)
      .toEqual([[{ enableAutomaticProviderUpdates: true }]]);
    await expect.element(toggle).toBeChecked();
    expect(api.harnesses.maintainTool).not.toHaveBeenCalled();
  });
  it("distinguishes incompatible OpenCode from an installed current version", async () => {
    await mount([{ ...tool("opencode"), status: "current", compatible: false }]);
    const row = page.getByRole("group", { name: "OpenCode", exact: true });
    await expect.element(row.getByRole("alert")).toHaveTextContent("Incompatible with DJL");
    await expect.element(row.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
    await expect.element(row).not.toHaveTextContent("bundled OpenCode");
  });

  it("shows versions, installs a missing CLI and refreshes status", async () => {
    api.harnesses.maintainTool.mockResolvedValue(tool("opencode"));
    await mount([tool("codex"), tool("claudeAgent"), tool("opencode", false)]);
    const row = page.getByRole("group", { name: "OpenCode", exact: true });
    await expect.element(row).toHaveTextContent("Latest: 2.0.0");
    await row.getByRole("button", { name: "Install", exact: true }).click();
    await expect
      .poll(() => api.harnesses.maintainTool.mock.calls)
      .toEqual([[{ harness: "opencode" }]]);
    await expect.element(row.getByRole("status")).toHaveTextContent("Latest version verified");
    await expect.poll(() => api.harnesses.listTools.mock.calls.length).toBeGreaterThan(1);
  });
  it("updates installed outdated tools sequentially, continues after failure, and skips missing tools", async () => {
    let reject!: (error: Error) => void;
    api.harnesses.maintainTool
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(tool("claudeAgent"));
    await mount([tool("codex"), tool("claudeAgent"), tool("opencode", false)]);
    const all = page.getByRole("button", { name: "Update all", exact: true });
    await expect.element(all).toBeEnabled();
    await all.click();
    await expect.poll(() => api.harnesses.maintainTool.mock.calls.length).toBe(1);
    await expect.element(all).toBeDisabled();
    reject(new Error("Network unavailable"));
    await expect
      .poll(() => api.harnesses.maintainTool.mock.calls)
      .toEqual([[{ harness: "codex" }], [{ harness: "claudeAgent" }]]);
    await expect.element(page.getByRole("alert")).toHaveTextContent("Network unavailable");
    await expect.element(page.getByRole("status")).toHaveTextContent("Latest version verified");
  });
  it("keeps unavailable latest versions explicit and disables Update all", async () => {
    await mount([{ ...tool("codex"), latestVersion: null, status: "unknown" }]);
    await expect
      .element(page.getByRole("group", { name: "Codex", exact: true }))
      .toHaveTextContent("Latest: Unavailable");
    await expect
      .element(page.getByRole("button", { name: "Update all", exact: true }))
      .toBeDisabled();
  });
});
