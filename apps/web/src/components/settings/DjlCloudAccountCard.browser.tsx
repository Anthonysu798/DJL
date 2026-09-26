import type { DesktopBridge } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { DjlCloudAccountCard } from "./DjlCloudAccountCard";

const appSettings = vi.hoisted(() => ({
  settings: { defaultProvider: "opencode" },
  updateSettings: vi.fn(),
}));

const signedOut = {
  signedIn: false,
  apiBaseUrl: "https://api.test",
  checkedAt: "2026-09-12T00:00:00.000Z",
};
const signedIn = {
  signedIn: true,
  apiBaseUrl: "https://api.test",
  email: "me@test.invalid",
  userId: "u1",
  orgId: "o1",
  credits: {
    orgId: "o1",
    balances: { trial: "0", plan: "2000000000", topup: "0" },
    total: "2000000000",
    display: { total: "2000.00", trial: "0.00", plan: "2000.00", topup: "0.00" },
  },
  checkedAt: "2026-09-12T00:00:00.000Z",
};

const api = vi.hoisted(() => ({
  cloud: {
    getStatus: vi.fn(),
    startSignIn: vi.fn(),
    pollSignIn: vi.fn(),
    signOut: vi.fn(),
    startBrowserSignIn: vi.fn(),
    completeBrowserSignIn: vi.fn(),
  },
  server: { refreshProviders: vi.fn(async () => undefined) },
  shell: { openExternal: vi.fn(async () => undefined) },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));
vi.mock("~/appSettings", () => ({ useAppSettings: () => appSettings }));

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DjlCloudAccountCard />
    </QueryClientProvider>,
  );
}

/** Stands in for the preload bridge: lets a test deliver a djl://auth/callback. */
function installDeepLinkBridge() {
  let deliver: ((callback: { code: string; state: string }) => void) | null = null;
  window.desktopBridge = {
    onCloudAuthCallback: (listener: (callback: { code: string; state: string }) => void) => {
      deliver = listener;
      return () => {
        deliver = null;
      };
    },
  } as unknown as DesktopBridge;
  return (callback: { code: string; state: string }) => deliver?.(callback);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.desktopBridge;
});

describe("DjlCloudAccountCard", () => {
  it("runs the device sign-in flow: shows the code, opens the browser, polls, then shows credits", async () => {
    api.cloud.getStatus.mockResolvedValueOnce(signedOut);
    api.cloud.startSignIn.mockResolvedValueOnce({
      deviceCode: "dev-1",
      userCode: "ABCD-EFGH",
      verificationUri: "https://app.test/device",
      verificationUriComplete: "https://app.test/device?user_code=ABCD-EFGH",
      expiresInSeconds: 600,
      intervalSeconds: 3,
    });
    api.cloud.pollSignIn
      .mockResolvedValueOnce({ state: "pending" })
      .mockResolvedValueOnce({ state: "complete", status: signedIn });
    renderCard();
    await expect.element(page.getByText("Not signed in")).toBeVisible();
    await page.getByRole("button", { name: "Use a code instead" }).click();
    await expect.element(page.getByText("ABCD-EFGH")).toBeVisible();
    expect(api.shell.openExternal).toHaveBeenCalledWith(
      "https://app.test/device?user_code=ABCD-EFGH",
    );
    await expect
      .element(page.getByText("Signed in as me@test.invalid"), { timeout: 10_000 })
      .toBeVisible();
    await expect.element(page.getByText("2000.00 credits available")).toBeVisible();
    expect(api.cloud.pollSignIn).toHaveBeenCalledWith({ deviceCode: "dev-1" });
    expect(api.server.refreshProviders).toHaveBeenCalled();
  });

  it("offers Use for new chats and Sign out when signed in", async () => {
    api.cloud.getStatus.mockResolvedValueOnce(signedIn);
    api.cloud.signOut.mockResolvedValueOnce(signedOut);
    renderCard();
    await expect.element(page.getByText("Signed in as me@test.invalid")).toBeVisible();
    await page.getByRole("button", { name: "Use for new chats" }).click();
    expect(appSettings.updateSettings).toHaveBeenCalledWith({ defaultProvider: "djlCloud" });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.element(page.getByText("Not signed in")).toBeVisible();
  });

  it("explains an expired session", async () => {
    api.cloud.getStatus.mockResolvedValueOnce({ ...signedIn, problem: "session_expired" });
    renderCard();
    await expect.element(page.getByText("Your session expired. Sign in again.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Sign in with browser" })).toBeVisible();
  });

  it("signs in through the browser and finishes when the deep link comes back", async () => {
    const deliver = installDeepLinkBridge();
    api.cloud.getStatus.mockResolvedValueOnce(signedOut);
    api.cloud.startBrowserSignIn.mockResolvedValueOnce({
      authorizeUrl: "https://app.test/authorize?state=s1",
      expiresInSeconds: 600,
    });
    api.cloud.completeBrowserSignIn.mockResolvedValueOnce(signedIn);
    renderCard();
    await page.getByRole("button", { name: "Sign in with browser" }).click();
    expect(api.shell.openExternal).toHaveBeenCalledWith("https://app.test/authorize?state=s1");
    await expect
      .element(
        page.getByText("Finish signing in in your browser. DJL continues here automatically."),
      )
      .toBeVisible();
    deliver({ code: "code-1", state: "s1" });
    await expect.element(page.getByText("Signed in as me@test.invalid")).toBeVisible();
    expect(api.cloud.completeBrowserSignIn).toHaveBeenCalledWith({ code: "code-1", state: "s1" });
  });

  it("explains a browser sign-in that the app refused", async () => {
    const deliver = installDeepLinkBridge();
    api.cloud.getStatus.mockResolvedValue(signedOut);
    api.cloud.completeBrowserSignIn.mockRejectedValueOnce(new Error("state mismatch"));
    renderCard();
    await expect.element(page.getByText("Not signed in")).toBeVisible();
    deliver({ code: "code-1", state: "forged" });
    await expect
      .element(page.getByText("Browser sign-in did not complete. Try again or use a code instead."))
      .toBeVisible();
  });
});
