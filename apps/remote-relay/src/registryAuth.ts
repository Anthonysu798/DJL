// FILE: registryAuth.ts
// Purpose: Verifies the phone-signed request used to find a trusted computer's live relay session.

import { buildTrustedSessionResolveTranscript } from "@synara/remote-protocol";

import type { RelayRegistration } from "./policy";

export const TRUSTED_RESOLVE_CLOCK_SKEW_MS = 90_000;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{8,256}$/;

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
  const signatureBytes = decodeBase64(request.signature);
  if (publicKeyBytes?.byteLength !== 32 || signatureBytes?.byteLength !== 64) {
    return { ok: false, code: "invalid_signature" };
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      copyToArrayBuffer(publicKeyBytes),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const transcript = buildTrustedSessionResolveTranscript({
      macDeviceId: request.macDeviceId,
      phoneDeviceId: request.phoneDeviceId,
      phoneIdentityPublicKey: publicKeyBytes,
      nonce: request.nonce,
      timestamp: request.timestamp,
    });
    const verified = await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      copyToArrayBuffer(signatureBytes),
      copyToArrayBuffer(transcript),
    );
    return verified ? { ok: true } : { ok: false, code: "invalid_signature" };
  } catch {
    return { ok: false, code: "invalid_signature" };
  }
};
