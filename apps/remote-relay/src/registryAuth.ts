// FILE: registryAuth.ts
// Purpose: Verifies the phone-signed request used to find a trusted computer's live relay session.

import {
  buildRelayMacRegistrationTranscript,
  buildRelayPhoneConnectTranscript,
  buildTrustedSessionResolveTranscript,
} from "@djl/remote-protocol";

import type { PhoneIdentity, RelayRegistration } from "./policy";

export const TRUSTED_RESOLVE_CLOCK_SKEW_MS = 90_000;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{8,256}$/;
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

export interface TrustedResolveRequest {
  macDeviceId: string;
  phoneDeviceId: string;
  phoneIdentityPublicKey: string;
  nonce: string;
  timestamp: number;
  signature: string;
}

export type TrustedResolveVerification =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | "invalid_request"
        | "resolve_request_expired"
        | "resolve_request_replayed"
        | "phone_not_trusted"
        | "invalid_signature";
    };

interface VerifyTrustedResolveInput {
  readonly request: TrustedResolveRequest;
  readonly registration: RelayRegistration;
  readonly now?: number;
  readonly nonceAlreadyUsed: boolean;
}

const copyToArrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

const decodeBase64 = (value: string): Uint8Array | null => {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const verifyEd25519 = async (
  publicKeyBytes: Uint8Array,
  signature: string,
  transcript: Uint8Array,
): Promise<boolean> => {
  const signatureBytes = decodeBase64(signature);
  if (publicKeyBytes.byteLength !== 32 || signatureBytes?.byteLength !== 64) return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      copyToArrayBuffer(publicKeyBytes),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      copyToArrayBuffer(signatureBytes),
      copyToArrayBuffer(transcript),
    );
  } catch {
    return false;
  }
};

/** Checks the computer's signature over its own registration for this relay session. */
export const verifyMacRegistrationSignature = async (
  sessionId: string,
  registration: Pick<RelayRegistration, "macDeviceId" | "macIdentityPublicKey">,
  signature: string,
): Promise<boolean> => {
  const publicKeyBytes = decodeBase64(registration.macIdentityPublicKey);
  if (!publicKeyBytes) return false;
  return verifyEd25519(
    publicKeyBytes,
    signature,
    buildRelayMacRegistrationTranscript({
      sessionId,
      macDeviceId: registration.macDeviceId,
      macIdentityPublicKey: publicKeyBytes,
    }),
  );
};

/**
 * Reads the identity a phone proves when it connects. undefined: it sent no identity headers (an
 * older app). null: it sent them but the signature does not verify.
 */
export const verifyPhoneConnectHeaders = async (
  headers: Headers,
  sessionId: string,
): Promise<PhoneIdentity | null | undefined> => {
  const deviceId = headers.get("x-phone-device-id");
  const publicKey = headers.get("x-phone-identity-public-key");
  const signature = headers.get("x-phone-signature");
  if (deviceId === null && publicKey === null && signature === null) return undefined;
  if (
    !deviceId ||
    !IDENTIFIER_PATTERN.test(deviceId) ||
    !publicKey ||
    !BASE64_KEY_PATTERN.test(publicKey) ||
    !signature
  ) {
    return null;
  }
  const publicKeyBytes = decodeBase64(publicKey);
  if (!publicKeyBytes) return null;
  const verified = await verifyEd25519(
    publicKeyBytes,
    signature,
    buildRelayPhoneConnectTranscript({
      sessionId,
      phoneDeviceId: deviceId,
      phoneIdentityPublicKey: publicKeyBytes,
    }),
  );
  return verified ? { deviceId, publicKey } : null;
};

export const verifyTrustedResolveRequest = async ({
  request,
  registration,
  now = Date.now(),
  nonceAlreadyUsed,
}: VerifyTrustedResolveInput): Promise<TrustedResolveVerification> => {
  if (
    !IDENTIFIER_PATTERN.test(request.macDeviceId) ||
    !IDENTIFIER_PATTERN.test(request.phoneDeviceId) ||
    !NONCE_PATTERN.test(request.nonce) ||
    !Number.isSafeInteger(request.timestamp)
  ) {
    return { ok: false, code: "invalid_request" };
  }
  if (Math.abs(now - request.timestamp) > TRUSTED_RESOLVE_CLOCK_SKEW_MS) {
    return { ok: false, code: "resolve_request_expired" };
  }
  if (nonceAlreadyUsed) {
    return { ok: false, code: "resolve_request_replayed" };
  }
  if (
    request.macDeviceId !== registration.macDeviceId ||
    request.phoneDeviceId !== registration.trustedPhoneDeviceId ||
    request.phoneIdentityPublicKey !== registration.trustedPhonePublicKey
  ) {
    return { ok: false, code: "phone_not_trusted" };
  }

  const publicKeyBytes = decodeBase64(request.phoneIdentityPublicKey);
  if (!publicKeyBytes) return { ok: false, code: "invalid_signature" };
  const verified = await verifyEd25519(
    publicKeyBytes,
    request.signature,
    buildTrustedSessionResolveTranscript({
      macDeviceId: request.macDeviceId,
      phoneDeviceId: request.phoneDeviceId,
      phoneIdentityPublicKey: publicKeyBytes,
      nonce: request.nonce,
      timestamp: request.timestamp,
    }),
  );
  return verified ? { ok: true } : { ok: false, code: "invalid_signature" };
};
