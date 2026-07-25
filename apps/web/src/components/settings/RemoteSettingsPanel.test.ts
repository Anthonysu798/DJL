import { describe, expect, it } from "vitest";

import englishCatalog from "~/i18n/locales/en.json";
import { encodeManualPairingPayload } from "./RemoteSettingsPanel";

describe("encodeManualPairingPayload", () => {
  it("keeps the full QR payload self-contained for a first-time manual pairing", () => {
    const payload = JSON.stringify({
      v: 2,
      relay: "wss://relay.example/relay",
      sessionId: "session-id",
      macDeviceId: "mac-id",
      macIdentityPublicKey: "public-key",
      expiresAt: 1_900_000_000_000,
    });

    const encoded = encodeManualPairingPayload(payload);
    const base64 = encoded
      .replace(/^RMX1:/, "")
      .replaceAll("-", "+")
      .replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

    expect(encoded).toMatch(/^RMX1:[A-Za-z0-9_-]+$/);
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
      ),
    ).toBe(payload);
  });

  it("ships user-facing copy for every remote bridge state", () => {
    const remote = englishCatalog.settings.remote;

    expect(remote.access.title).toBe("iPhone remote access");
    expect(remote.pairing.title).toBe("Pair your iPhone");
    expect(Object.keys(remote.status).sort()).toEqual([
      "connected",
      "disabled",
      "error",
      "offline",
      "ready",
      "starting",
      "unavailable",
    ]);
  });
});
