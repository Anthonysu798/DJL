import "../../../index.css";

import type { DesktopRemoteReachabilityState } from "@djl/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { RemoteReachabilityCard } from "./RemoteReachabilityCard";

const initial: DesktopRemoteReachabilityState = {
  keepAwake: "pluggedIn",
  openAtLogin: false,
  openAtLoginSupported: true,
  stayingAwake: true,
  onBattery: false,
};

function installBridge(state: DesktopRemoteReachabilityState) {
  const setReachability = vi.fn(async (change: Partial<DesktopRemoteReachabilityState>) => ({
    ...state,
    ...change,
    stayingAwake: change.keepAwake === "never" ? false : state.stayingAwake,
  }));
  window.desktopBridge = {
    remote: { getReachability: async () => state, setReachability },
  } as unknown as NonNullable<typeof window.desktopBridge>;
  return setReachability;
}

afterEach(async () => {
  await cleanup();
  delete (window as { desktopBridge?: unknown }).desktopBridge;
});

describe("Remote: stay reachable", () => {
  it("shows what the computer is doing and saves each choice", async () => {
    const setReachability = installBridge(initial);
    await render(<RemoteReachabilityCard refreshKey="true:ready" />);
    await expect
      .element(page.getByText("DJL is keeping this computer awake for your phone."))
      .toBeVisible();
    await page.getByRole("combobox", { name: "Keep this computer awake" }).click();
    await page.getByRole("option", { name: "Never" }).click();
    expect(setReachability).toHaveBeenCalledWith({ keepAwake: "never" });
    await expect.element(page.getByText("This computer sleeps as usual.")).toBeVisible();
    await page.getByRole("switch", { name: "Start DJL when I sign in" }).click();
    expect(setReachability).toHaveBeenLastCalledWith({ openAtLogin: true });
    await expect
      .element(page.getByText(/A laptop still sleeps when its lid is closed/))
      .toBeVisible();
  });

  it("explains why start at login is off where it cannot work", async () => {
    installBridge({ ...initial, openAtLoginSupported: false });
    await render(<RemoteReachabilityCard refreshKey="true:ready" />);
    await expect
      .element(page.getByText("Available in the installed app on macOS and Windows."))
      .toBeVisible();
    await expect
      .element(page.getByRole("switch", { name: "Start DJL when I sign in" }))
      .toBeDisabled();
  });

  it("shows nothing on a desktop build without these settings", async () => {
    window.desktopBridge = { remote: {} } as unknown as NonNullable<typeof window.desktopBridge>;
    const screen = await render(<RemoteReachabilityCard refreshKey="true:ready" />);
    expect(screen.container.textContent).toBe("");
  });
});
