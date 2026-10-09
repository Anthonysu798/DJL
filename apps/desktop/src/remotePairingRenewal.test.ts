import { afterEach, expect, it, vi } from "vitest";
import { createInitialRemoteGatewayState } from "./remoteGatewayRuntime";
import { createRemotePairingRenewal } from "./remotePairingRenewal";
afterEach(() => vi.useRealTimers());
function ready(expiresAt: number) {
  return {
    ...createInitialRemoteGatewayState({ enabled: true, relayUrl: "ws://localhost/relay" }),
    status: "ready" as const,
    pairingExpiresAt: expiresAt,
  };
}
it("renews an unpaired code 30 seconds before expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const refresh = vi.fn(async () => {});
  const renewal = createRemotePairingRenewal(refresh, vi.fn());
  renewal.update(ready(120000));
  await vi.advanceTimersByTimeAsync(89999);
  expect(refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledOnce();
  renewal.stop();
});
it("cancels renewal when a phone connects or access is disabled", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const refresh = vi.fn(async () => {});
  const renewal = createRemotePairingRenewal(refresh, vi.fn());
  renewal.update(ready(120000));
  renewal.update({ ...ready(120000), status: "connected", phoneFingerprint: "phone" });
  await vi.advanceTimersByTimeAsync(120000);
  expect(refresh).not.toHaveBeenCalled();
  renewal.update(ready(240000));
  renewal.update({ ...ready(240000), enabled: false });
  await vi.advanceTimersByTimeAsync(120000);
  expect(refresh).not.toHaveBeenCalled();
  renewal.stop();
});
it("renews expired codes immediately and bounds retries when refresh fails", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const refresh = vi.fn(async () => {
    throw new Error("offline");
  });
  const error = vi.fn();
  const renewal = createRemotePairingRenewal(refresh, error);
  renewal.update(ready(90000));
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(9998);
  expect(refresh).toHaveBeenCalledOnce();
  renewal.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(refresh).toHaveBeenCalledOnce();
});
