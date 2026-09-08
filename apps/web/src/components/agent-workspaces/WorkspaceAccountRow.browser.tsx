import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { WorkspaceAccountRow, RefreshWorkspaceAccounts } from "./WorkspaceAccountRow";

const api = vi.hoisted(() => ({ harnesses: { getProfileAccount: vi.fn() } }));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));
afterEach(async () => {
  await cleanup();
  vi.resetAllMocks();
});
async function mount(client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <RefreshWorkspaceAccounts />
      <WorkspaceAccountRow
        profile={{ id: "work", provider: "codex", name: "Work account" }}
        providerLabel="Codex"
        used={1}
        onEdit={() => {}}
      />
      <WorkspaceAccountRow
        profile={{ id: "personal", provider: "claudeAgent", name: "Personal Claude" }}
        providerLabel="Claude Code"
        used={3}
        onEdit={() => {}}
      />
    </QueryClientProvider>,
  );
}
describe("workspace CLI account badges", () => {
  it("shows the correct email and green/red login state independently for each profile", async () => {
    api.harnesses.getProfileAccount.mockImplementation(async ({ provider, profileId }) => ({
      provider,
      profileId,
      status: profileId === "work" ? "signedIn" : "signedOut",
      email: profileId === "work" ? "work@example.com" : null,
    }));
    await mount();
    await expect.element(page.getByText("work@example.com", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("img", { name: "Signed in", exact: true }))
      .toHaveClass("bg-emerald-400");
    await expect
      .element(page.getByRole("img", { name: "Not signed in", exact: true }))
      .toHaveClass("bg-red-400");
    expect(api.harnesses.getProfileAccount).toHaveBeenCalledWith({
      provider: "codex",
      profileId: "work",
    });
    expect(api.harnesses.getProfileAccount).toHaveBeenCalledWith({
      provider: "claudeAgent",
      profileId: "personal",
    });
  });
  it("reuses cached CLI identities when returning to Workspaces", async () => {
    api.harnesses.getProfileAccount.mockImplementation(async ({ provider, profileId }) => ({
      provider,
      profileId,
      status: "signedIn",
      email: `${profileId}@example.com`,
    }));
    const client = new QueryClient();
    const screen = await mount(client);
    await expect.element(page.getByText("personal@example.com", { exact: true })).toBeVisible();
    expect(api.harnesses.getProfileAccount).toHaveBeenCalledTimes(2);
    await screen.unmount();
    await mount(client);
    await expect.element(page.getByText("personal@example.com", { exact: true })).toBeVisible();
    expect(api.harnesses.getProfileAccount).toHaveBeenCalledTimes(2);
  });
  it("refreshes a completed login and removes the previous email after logout", async () => {
    let loggedIn = true;
    api.harnesses.getProfileAccount.mockImplementation(async ({ provider, profileId }) => ({
      provider,
      profileId,
      status: loggedIn ? "signedIn" : "signedOut",
      email: loggedIn ? `${profileId}@example.com` : null,
    }));
    await mount();
    await expect.element(page.getByText("personal@example.com", { exact: true })).toBeVisible();
    loggedIn = false;
    await page.getByRole("button", { name: "Refresh account status", exact: true }).click();
    await expect
      .element(page.getByText("personal@example.com", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("img", { name: "Not signed in", exact: true }).first())
      .toHaveClass("bg-red-400");
  });
  it("shows an explicit fallback when the CLI supplies no email or cannot be checked", async () => {
    api.harnesses.getProfileAccount.mockImplementation(async ({ provider, profileId }) => {
      if (profileId === "personal") throw new Error("Offline");
      return { provider, profileId, status: "signedIn", email: null };
    });
    await mount();
    await expect.element(page.getByText("Email unavailable", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("img", { name: "Could not verify account", exact: true }))
      .toHaveClass("bg-red-400");
  });
});
