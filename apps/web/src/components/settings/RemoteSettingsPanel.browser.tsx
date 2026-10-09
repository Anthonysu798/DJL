import "../../index.css";
import type { DesktopRemoteGatewayState } from "@synara/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { RemoteSettingsPanel } from "./RemoteSettingsPanel";

const originalBridge = window.desktopBridge;
afterEach(() => {
  vi.restoreAllMocks();
  if (originalBridge) window.desktopBridge = originalBridge;
  else delete window.desktopBridge;
});

function fixture(overrides: Partial<DesktopRemoteGatewayState> = {}) {
  const state: DesktopRemoteGatewayState = {
    status: "ready",
    enabled: true,
    configured: true,
    pairingPayloadJson: JSON.stringify({
      v: 2,
      sessionId: "test-session",
      relay: "wss://relay.example/relay",
    }),
    pairingCode: "ABCDEFGH23",
    pairingExpiresAt: Date.now() + 60_000,
    computerName: "Test Mac",
    phoneFingerprint: null,
    phoneDeviceKind: null,
    message: null,
    ...overrides,
  };
  let listener: ((value: DesktopRemoteGatewayState) => void) | undefined;
  const remote = {
    getState: vi.fn(async () => state),
    onState: vi.fn((callback: (value: DesktopRemoteGatewayState) => void) => {
      listener = callback;
      return vi.fn();
    }),
    setEnabled: vi.fn(async (enabled: boolean) => ({
      ...state,
      enabled,
      status: enabled ? ("ready" as const) : ("disabled" as const),
    })),
    refreshPairing: vi.fn(async () => ({
      ...state,
      enabled: true,
      status: "ready" as const,
      pairingCode: "JKLMNPQR45",
      pairingPayloadJson: '{"sessionId":"new-session"}',
    })),
    resetPairing: vi.fn(async () => state),
  };
  window.desktopBridge = {
    ...originalBridge,
    remote,
    confirm: vi.fn(async () => true),
  } as NonNullable<typeof window.desktopBridge>;
  return {
    remote,
    publish: (next: Partial<DesktopRemoteGatewayState>) => listener?.({ ...state, ...next }),
  };
}

it("guides enabling, generates a QR, refreshes it, and hides pairing data after connecting", async () => {
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const { remote, publish } = fixture({ enabled: false, status: "disabled" });
  const screen = await render(<RemoteSettingsPanel />);
  await expect
    .element(screen.getByText("Turn on remote access above to generate a pairing code."))
    .toBeVisible();
  await screen.getByRole("switch").click();
  await expect
    .element(screen.getByRole("img", { name: "DJL iPhone pairing QR code" }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Copy pairing code" }).click();
  expect(copy).toHaveBeenCalledWith("ABCDEFGH23");
  await expect.element(screen.getByRole("button", { name: "Code copied" })).toBeVisible();
  publish({ enabled: true, status: "ready" });
  await screen.getByRole("button", { name: "Generate new pairing code" }).click();
  expect(remote.refreshPairing).toHaveBeenCalledOnce();
  await expect.element(screen.getByText("JKLMNPQR45")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Copy pairing code" })).toBeVisible();
  await expect.element(screen.getByRole("textbox")).not.toBeInTheDocument();
  // A native state event is authoritative after the action completes.
  publish({ enabled: true, status: "connected", phoneFingerprint: "test-fingerprint" });
  await expect.element(screen.getByText("Your iPhone is connected")).toBeVisible();
  await expect.element(screen.getByRole("img")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("textbox")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Pair another iPhone" }).click();
  expect(remote.resetPairing).toHaveBeenCalledOnce();
});

it("reports unavailable configuration and expired pairing without showing a usable QR", async () => {
  const { publish } = fixture({ configured: false, status: "unavailable" });
  const screen = await render(<RemoteSettingsPanel />);
  await expect
    .element(screen.getByText("Remote access is not configured in this desktop build."))
    .toBeVisible();
  await expect.element(screen.getByRole("switch")).toBeDisabled();
  publish({ configured: true, pairingExpiresAt: Date.now() - 1 });
  await expect
    .element(screen.getByText("This pairing code expired. Generate a new one to continue."))
    .toBeVisible();
  await expect.element(screen.getByRole("img")).not.toBeInTheDocument();
});

it("does not let a slow initial read overwrite a live connected state", async () => {
  const { remote, publish } = fixture();
  let resolve!: (state: DesktopRemoteGatewayState) => void;
  remote.getState.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const screen = await render(<RemoteSettingsPanel />);
  publish({ status: "connected", phoneFingerprint: "test" });
  const stale = await remote.setEnabled(false);
  resolve(stale);
  await expect.element(screen.getByText("Your iPhone is connected")).toBeVisible();
});

it("expires the QR at its deadline without waiting for a polling interval", async () => {
  const { publish } = fixture();
  const screen = await render(<RemoteSettingsPanel />);
  await expect.element(screen.getByRole("img")).toBeVisible();
  publish({ pairingExpiresAt: Date.now() + 150 });
  await expect
    .element(screen.getByText("This pairing code expired. Generate a new one to continue."))
    .toBeVisible();
  await expect.element(screen.getByRole("img")).not.toBeInTheDocument();
});
