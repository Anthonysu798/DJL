import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { DjlAccountEntry } from "./DjlAccountEntry";

const signedOut = {
  signedIn: false,
  apiBaseUrl: "https://api.test",
  checkedAt: "2026-09-12T00:00:00.000Z",
};
const signedIn = {
  signedIn: true,
  apiBaseUrl: "https://api.test",
  email: "me@test.invalid",
  credits: {
    orgId: "o1",
    balances: { trial: "0", plan: "2000000000", topup: "0" },
    total: "2000000000",
    display: { total: "2000.00", trial: "0.00", plan: "2000.00", topup: "0.00" },
  },
  usage: {
    planId: "starter",
    windows: {
      fiveHour: { kind: "five_hour", limit: "100", used: "0", remaining: "100", resetsAt: null },
      week: { kind: "week", limit: "100", used: "0", remaining: "100", resetsAt: null },
    },
    banks: { count: 0, nextExpiresAt: null },
  },
  checkedAt: "2026-09-12T00:00:00.000Z",
};

const api = vi.hoisted(() => ({
  cloud: { getStatus: vi.fn(), signOut: vi.fn() },
  server: { refreshProviders: vi.fn(async () => undefined) },
}));
const tour = vi.hoisted(() => ({ requestFirstRunTourReplay: vi.fn() }));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));
vi.mock("~/appSettings", () => ({
  useAppSettings: () => ({ settings: { defaultProvider: "opencode" }, updateSettings: vi.fn() }),
}));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/onboarding/firstRunTour", () => tour);

function renderRailEntry(platform = "MacIntel") {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  const onSettings = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DjlAccountEntry rail onSettings={onSettings} />
    </QueryClientProvider>,
  );
  return { onSettings, trigger: page.getByTestId("djl-account-entry") };
}

function menuRows() {
  return page
    .getByRole("menuitem")
    .elements()
    .map((item) => item.textContent);
}

beforeEach(() => {
  localStorage.setItem("djl.account.welcome.dismissed", "true");
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("DjlAccountEntry avatar menu", () => {
  it("lists identity, usage, account, settings, tutorial and sign out when signed in", async () => {
    api.cloud.getStatus.mockResolvedValue(signedIn);
    const { onSettings, trigger } = renderRailEntry();

    await expect.element(trigger).toHaveAttribute("aria-label", "me@test.invalid");
    await expect.element(trigger).toHaveAttribute("data-onboarding-target", "tutorial-replay");
    await trigger.click();
    await expect.element(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    expect(menuRows()).toEqual([
      "MEme@test.invalidstarter",
      "Usage2000.00",
      "Your DJL account",
      "Settings⌘,",
      "New user tutorial",
      "Sign out",
    ]);
    // Identity, then account rows, then help, then sign out: each group split by a rule.
    const separators = page.getByRole("separator").elements();
    expect(separators).toHaveLength(3);
    expect(separators[2]?.nextElementSibling?.textContent).toBe("Sign out");
    const settings = page.getByRole("menuitem", { name: "Settings", exact: true });
    await expect.element(settings).toHaveAttribute("data-onboarding-target", "settings");
    // The liquid glass panel: see-through fill with the blur on its own layer behind the text.
    const popup = document.querySelector<HTMLElement>(
      ".djl-desktop-account-menu [data-slot='menu-popup']",
    );
    expect(popup?.classList.contains("liquid-glass")).toBe(true);
    expect(popup && getComputedStyle(popup, "::before").backdropFilter).toContain("blur");
    expect(popup && getComputedStyle(popup).backgroundImage).toContain("gradient");

    await page.getByRole("menuitem", { name: "Usage 2000.00" }).click();
    expect(onSettings).toHaveBeenLastCalledWith("usage");
    await trigger.click();
    await settings.click();
    expect(onSettings).toHaveBeenLastCalledWith();
    await trigger.click();
    await page.getByRole("menuitem", { name: "New user tutorial" }).click();
    expect(tour.requestFirstRunTourReplay).toHaveBeenCalledOnce();
    await trigger.click();
    await page.getByRole("menuitem", { name: "Your DJL account" }).click();
    await expect.element(page.getByText("Signed in as me@test.invalid")).toBeVisible();
    expect(api.cloud.signOut).not.toHaveBeenCalled();
  });

  it("shows the settings shortcut only where the desktop menu registers it", async () => {
    api.cloud.getStatus.mockResolvedValue(signedIn);
    const { trigger } = renderRailEntry("Linux x86_64");

    await trigger.click();
    await expect.element(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    expect(menuRows()).toContain("Settings");
  });

  it("stays a sign-in entry with no sign out row when signed out", async () => {
    api.cloud.getStatus.mockResolvedValue(signedOut);
    const { trigger } = renderRailEntry();

    await expect.element(trigger).toHaveAttribute("aria-label", "Sign in to DJL");
    await trigger.click();
    await expect.element(page.getByRole("menuitem", { name: "New user tutorial" })).toBeVisible();
    expect(menuRows()).toEqual([
      "Sign in to DJLDJL Cloud",
      "Usage",
      "Your DJL account",
      "Settings⌘,",
      "New user tutorial",
    ]);
    // Identity and account rows and help keep their rules; there is no sign-out group.
    expect(page.getByRole("separator").elements()).toHaveLength(2);

    await page.getByRole("menuitem", { name: "Sign in to DJL DJL Cloud" }).click();
    await expect.element(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  });
});
