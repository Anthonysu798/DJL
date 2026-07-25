import { describe, expect, it } from "vitest";

import {
  consumeMessageBudget,
  normalizePairingCode,
  parseRelayRoute,
  readRelayRole,
  resolveRelayRegistration,
  validateRegistration,
} from "./policy";

describe("remote relay policy", () => {
  it("accepts only bounded, opaque session routes", () => {
    expect(parseRelayRoute(new URL("https://relay.djl.app/relay/session_1234567890"))).toEqual({
      sessionId: "session_1234567890",
    });
    expect(parseRelayRoute(new URL("https://relay.djl.app/session_1234567890"))).toEqual({
      sessionId: "session_1234567890",
    });
    expect(parseRelayRoute(new URL("https://relay.djl.app/relay/../../admin"))).toBeNull();
    expect(parseRelayRoute(new URL("https://relay.djl.app/relay/short"))).toBeNull();
  });

  it("allows exactly one host role and the compatible phone aliases", () => {
    expect(
      readRelayRole(new Request("https://relay.djl.app", { headers: { "x-role": "mac" } })),
    ).toBe("mac");
    expect(readRelayRole(new Request("https://relay.djl.app?role=iphone"))).toBe("iphone");
    expect(readRelayRole(new Request("https://relay.djl.app?role=mobile"))).toBe("iphone");
    expect(readRelayRole(new Request("https://relay.djl.app?role=admin"))).toBeNull();
  });

  it("normalizes pairing codes without accepting ambiguous characters", () => {
    expect(normalizePairingCode("ABCD-EF23-45")).toBe("ABCDEF2345");
    expect(normalizePairingCode("ABCD0F2345")).toBeNull();
    expect(normalizePairingCode("tiny")).toBeNull();
  });

  it("bounds registration metadata and enforces expiry", () => {
    const registration = validateRegistration(
      {
        macDeviceId: "mac-device-1",
        macIdentityPublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))),
        displayName: "Toni’s Mac",
        trustedPhoneDeviceId: "phone-1",
        trustedPhonePublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(2))),
        pairingCode: "ABCDEF2345",
        pairingVersion: 2,
        pairingExpiresAt: 1_784_376_300_000,
      },
      1_784_376_000_000,
    );

    expect(registration?.pairingCode).toBe("ABCDEF2345");
    expect(validateRegistration({ ...registration, displayName: "x".repeat(161) }, 1)).toBeNull();
    expect(
      validateRegistration(
        { ...registration, pairingExpiresAt: 1_784_375_999_999 },
        1_784_376_000_000,
      ),
    ).toBeNull();
  });

  it("keeps a trusted registration usable after the short pairing window expires", () => {
    const sessionId = "trusted_session_1234567890";
    const pairingNow = 1_784_376_000_000;
    const input = {
      macDeviceId: "mac-device-1",
      macIdentityPublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))),
      displayName: "Toni’s Mac",
      trustedPhoneDeviceId: "phone-1",
      trustedPhonePublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(2))),
      pairingCode: "ABCDEF2345",
      pairingVersion: 2,
      pairingExpiresAt: pairingNow + 300_000,
    };
    const trusted = validateRegistration(input, pairingNow, sessionId);
    expect(trusted).not.toBeNull();

    const reconnectNow = input.pairingExpiresAt + 1;
    expect(resolveRelayRegistration(input, trusted ?? undefined, reconnectNow, sessionId)).toEqual(
      trusted,
    );
    expect(resolveRelayRegistration(input, undefined, reconnectNow, sessionId)).toBeNull();
    expect(
      resolveRelayRegistration(
        input,
        trusted ?? undefined,
        reconnectNow,
        "different_session_1234567890",
      ),
    ).toBeNull();
  });

  it("closes a message budget at the first over-limit frame", () => {
    const first = consumeMessageBudget(undefined, 1_000, 3);
    const second = consumeMessageBudget(first.state, 1_001, 3);
    const third = consumeMessageBudget(second.state, 1_002, 3);
    const fourth = consumeMessageBudget(third.state, 1_003, 3);

    expect(first.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
    expect(consumeMessageBudget(fourth.state, 11_001, 3).allowed).toBe(true);
  });
});
