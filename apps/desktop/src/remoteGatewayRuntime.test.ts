import { describe, expect, it } from "vitest";

import {
  createInitialRemoteGatewayState,
  normalizeRemoteRelayUrl,
  reduceRemoteGatewayChildMessage,
  resolveRemoteRelayUrl,
} from "./remoteGatewayRuntime";

describe("remote gateway runtime", () => {
  it("accepts only credential-free WebSocket relay URLs", () => {
    expect(normalizeRemoteRelayUrl(" wss://relay.djl.app/relay/ ")).toBe(
      "wss://relay.djl.app/relay",
    );
    expect(normalizeRemoteRelayUrl("ws://127.0.0.1:8787/relay")).toBe("ws://127.0.0.1:8787/relay");
    expect(normalizeRemoteRelayUrl("https://relay.djl.app/relay")).toBeNull();
    expect(normalizeRemoteRelayUrl("wss://user:secret@relay.djl.app/relay")).toBeNull();
    expect(normalizeRemoteRelayUrl("wss://relay.djl.app/relay?secret=x")).toBeNull();
  });

  it("prefers runtime configuration over packaged metadata", () => {
    expect(
      resolveRemoteRelayUrl(
        { DJL_REMOTE_RELAY_URL: "wss://dev.example/relay" },
        { djlRemoteRelayUrl: "wss://release.example/relay" },
      ),
    ).toBe("wss://dev.example/relay");
  });

  it("starts enabled automatically and reports missing release configuration", () => {
    expect(createInitialRemoteGatewayState({ enabled: true, relayUrl: null })).toMatchObject({
      enabled: true,
      configured: false,
      status: "unavailable",
      message: null,
    });
  });

  it("reduces pairing and authenticated phone status without exposing secrets", () => {
    const initial = createInitialRemoteGatewayState({
      enabled: true,
      relayUrl: "wss://relay.djl.app/relay",
    });
    const paired = reduceRemoteGatewayChildMessage(initial, {
      type: "pairing",
      pairingCode: "ABC-123",
      pairingPayload: {
        v: 2,
        relay: "wss://relay.djl.app/relay",
        sessionId: "session-id",
        macDeviceId: "mac-id",
        macIdentityPublicKey: "public-key",
        expiresAt: 123456,
        displayName: "Toni's Mac",
      },
      relaySessionSecret: "must-not-cross-ipc",
    });
    const connected = reduceRemoteGatewayChildMessage(paired, {
      type: "status",
      status: {
        state: "running",
        connectionStatus: "connected",
        codexLaunchState: "connected",
        activeDevice: { connected: true, phoneFingerprint: "a1b2c3", deviceKind: "iphone" },
      },
    });
    expect(connected).toMatchObject({
      status: "connected",
      pairingCode: "ABC-123",
      computerName: "Toni's Mac",
      phoneFingerprint: "a1b2c3",
      phoneDeviceKind: "iphone",
    });
    expect(JSON.stringify(connected)).not.toContain("must-not-cross-ipc");
  });
});
