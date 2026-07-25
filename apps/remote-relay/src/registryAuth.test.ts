import { buildTrustedSessionResolveTranscript } from "@synara/remote-protocol";
import { describe, expect, it } from "vitest";

import { type TrustedResolveRequest, verifyTrustedResolveRequest } from "./registryAuth";
import type { RelayRegistration } from "./policy";

const toBase64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...value));
};

const copyToArrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

describe("trusted reconnect authentication", () => {
  it("accepts a fresh signature from the phone trusted by that computer", async () => {
    const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const phoneIdentityPublicKey = toBase64(
      await crypto.subtle.exportKey("raw", keyPair.publicKey),
    );
    const now = 1_784_376_000_000;
    const request: TrustedResolveRequest = {
      macDeviceId: "mac-device-1",
      phoneDeviceId: "phone-device-1",
      phoneIdentityPublicKey,
      nonce: "3cbb25f0-896e-4d43-a3fd-b37cf72bb7f6",
      timestamp: now,
      signature: "",
    };
    const transcript = buildTrustedSessionResolveTranscript({
      ...request,
      phoneIdentityPublicKey: new Uint8Array(
        await crypto.subtle.exportKey("raw", keyPair.publicKey),
      ),
    });
    request.signature = toBase64(
      await crypto.subtle.sign("Ed25519", keyPair.privateKey, copyToArrayBuffer(transcript)),
    );

    expect(
      await verifyTrustedResolveRequest({
        request,
        registration: makeRegistration(phoneIdentityPublicKey),
        now,
        nonceAlreadyUsed: false,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects expired, replayed, or device-mismatched requests before lookup", async () => {
    const publicKey = toBase64(new Uint8Array(32).fill(1));
    const request: TrustedResolveRequest = {
      macDeviceId: "mac-device-1",
      phoneDeviceId: "phone-device-1",
      phoneIdentityPublicKey: publicKey,
      nonce: "3cbb25f0-896e-4d43-a3fd-b37cf72bb7f6",
      timestamp: 1_000,
      signature: toBase64(new Uint8Array(64).fill(2)),
    };
    const registration = makeRegistration(publicKey);

    await expect(
      verifyTrustedResolveRequest({ request, registration, now: 92_001, nonceAlreadyUsed: false }),
    ).resolves.toEqual({ ok: false, code: "resolve_request_expired" });
    await expect(
      verifyTrustedResolveRequest({ request, registration, now: 1_000, nonceAlreadyUsed: true }),
    ).resolves.toEqual({ ok: false, code: "resolve_request_replayed" });
    await expect(
      verifyTrustedResolveRequest({
        request: { ...request, phoneDeviceId: "attacker" },
        registration,
        now: 1_000,
        nonceAlreadyUsed: false,
      }),
    ).resolves.toEqual({ ok: false, code: "phone_not_trusted" });
  });
});

const makeRegistration = (phoneIdentityPublicKey: string): RelayRegistration => ({
  sessionId: "session_1234567890",
  macDeviceId: "mac-device-1",
  macIdentityPublicKey: toBase64(new Uint8Array(32).fill(3)),
  displayName: "Toni’s Mac",
  trustedPhoneDeviceId: "phone-device-1",
  trustedPhonePublicKey: phoneIdentityPublicKey,
  pairingCode: "ABCDEF2345",
  pairingVersion: 2,
  pairingExpiresAt: 1_784_376_300_000,
});
