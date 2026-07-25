import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  buildHandshakeTranscript,
  buildTrustedSessionResolveTranscript,
  DJL_PAIRING_QR_VERSION,
  DJL_SECURE_PROTOCOL_VERSION,
  PairingQrPayload,
  SecureControlMessage,
  secureNonce,
} from "./index";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("DJL remote protocol", () => {
  it("accepts a bounded secure pairing payload", () => {
    const payload = {
      v: DJL_PAIRING_QR_VERSION,
      relay: "wss://relay.djl.app/connect",
      sessionId: "session-123",
      macDeviceId: "mac-1",
      macIdentityPublicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))),
      expiresAt: 1_784_376_000_000,
      displayName: "Toni’s Mac",
    };

    expect(Schema.decodeUnknownSync(PairingQrPayload)(payload)).toEqual(payload);
    expect(() =>
      Schema.decodeUnknownSync(PairingQrPayload)({ ...payload, relay: "ws://relay.djl.app" }),
    ).toThrow();
  });

  it("rejects unknown secure control messages", () => {
    expect(() =>
      Schema.decodeUnknownSync(SecureControlMessage)({ kind: "disableSecurity" }),
    ).toThrow();
  });

  it("keeps the handshake transcript byte-for-byte compatible", () => {
    const transcript = buildHandshakeTranscript({
      sessionId: "session-123",
      protocolVersion: DJL_SECURE_PROTOCOL_VERSION,
      handshakeMode: "qr_bootstrap",
      keyEpoch: 7,
      macDeviceId: "mac-1",
      phoneDeviceId: "phone-1",
      macIdentityPublicKey: new Uint8Array(32).fill(1),
      phoneIdentityPublicKey: new Uint8Array(32).fill(2),
      macEphemeralPublicKey: new Uint8Array(32).fill(3),
      phoneEphemeralPublicKey: new Uint8Array(32).fill(4),
      clientNonce: new Uint8Array(16).fill(5),
      serverNonce: new Uint8Array(16).fill(6),
      expiresAtForTranscript: 1_784_376_000_000,
    });

    expect(toHex(transcript)).toBe(
      "0000000b646a6c2d653265652d76310000000b73657373696f6e2d3132330000000132" +
        "0000000c71725f626f6f7473747261700000000137000000056d61632d310000000770" +
        "686f6e652d310000002001010101010101010101010101010101010101010101010101" +
        "010101010101010000002002020202020202020202020202020202020202020202020202" +
        "020202020202020000002003030303030303030303030303030303030303030303030303" +
        "030303030303030000002004040404040404040404040404040404040404040404040404" +
        "040404040404040000001005050505050505050505050505050505000000100606060606" +
        "06060606060606060606060000000d31373834333736303030303030",
    );
  });

  it("domain-separates the trusted reconnect lookup transcript", () => {
    expect(
      toHex(
        buildTrustedSessionResolveTranscript({
          macDeviceId: "mac-1",
          phoneDeviceId: "phone-1",
          phoneIdentityPublicKey: new Uint8Array(32).fill(7),
          nonce: "nonce-1",
          timestamp: 1_784_376_000_000,
        }),
      ),
    ).toBe(
      "0000001e646a6c2d747275737465642d73657373696f6e2d7265736f6c76652d7631" +
        "000000056d61632d310000000770686f6e652d3100000020070707070707070707070707" +
        "0707070707070707070707070707070707070707000000076e6f6e63652d310000000d" +
        "31373834333736303030303030",
    );
  });

  it("derives direction-separated monotonic AES-GCM nonces", () => {
    expect(toHex(secureNonce("mac", 42))).toBe("01000000000000000000002a");
    expect(toHex(secureNonce("iphone", 42))).toBe("02000000000000000000002a");
    expect(() => secureNonce("mac", -1)).toThrow();
  });
});
