// FILE: policy.ts
// Purpose: Pure validation and abuse-control policy for the DJL blind relay.

import { DJL_PAIRING_QR_VERSION, DJL_PAIRING_TTL_MS } from "@djl/remote-protocol";

export const MAX_RELAY_MESSAGE_BYTES = 1_048_576;
export const MESSAGE_RATE_WINDOW_MS = 10_000;
// The gateway coalesces notifications into at most 25 frames/s; 600 per
// 10 s leaves headroom for responses and approvals on top of that.
export const DEFAULT_MESSAGES_PER_WINDOW = 600;
export const MAX_JSON_BODY_BYTES = 16_384;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const PAIRING_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;

export type RelayRole = "mac" | "iphone";

// trusted: proved it is the registration's trusted phone. candidate: proved some other identity
// (a phone that is pairing). anonymous: an older app that sends no identity.
export type PhoneClass = "trusted" | "candidate" | "anonymous";

export interface PhoneIdentity {
  readonly deviceId: string;
  readonly publicKey: string;
}

export interface RelayRoute {
  readonly sessionId: string;
}

export interface RelayRegistration {
  readonly sessionId?: string;
  readonly macDeviceId: string;
  readonly macIdentityPublicKey: string;
  readonly displayName: string;
  readonly trustedPhoneDeviceId: string | null;
  readonly trustedPhonePublicKey: string | null;
  readonly pairingCode: string;
  readonly pairingVersion: number;
  readonly pairingExpiresAt: number;
}

export interface MessageBudgetState {
  readonly windowStartedAt: number;
  readonly count: number;
}

export interface MessageBudgetResult {
  readonly allowed: boolean;
  readonly state: MessageBudgetState;
}

const boundedString = (value: unknown, maximum: number): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
};

export const parseRelayRoute = (url: URL): RelayRoute | null => {
  const path = url.pathname.split("/").filter(Boolean);
  const candidate =
    path.length === 1 ? path[0] : path.length === 2 && path[0] === "relay" ? path[1] : null;
  return candidate && SESSION_ID_PATTERN.test(candidate) ? { sessionId: candidate } : null;
};

export const readRelayRole = (request: Request): RelayRole | null => {
  const url = new URL(request.url);
  const rawRole = request.headers.get("x-role") ?? url.searchParams.get("role") ?? "";
  const role = rawRole.trim().toLowerCase();
  if (role === "mac") return "mac";
  if (role === "iphone" || role === "mobile" || role === "phone") return "iphone";
  return null;
};

export const normalizePairingCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replaceAll("-", "").replaceAll(" ", "");
  return PAIRING_CODE_PATTERN.test(normalized) ? normalized : null;
};

const optionalTrustedPair = (
  phoneDeviceIdValue: unknown,
  phonePublicKeyValue: unknown,
): { phoneDeviceId: string | null; phonePublicKey: string | null } | null => {
  if (phoneDeviceIdValue == null && phonePublicKeyValue == null) {
    return { phoneDeviceId: null, phonePublicKey: null };
  }
  const phoneDeviceId = boundedString(phoneDeviceIdValue, 256);
  const phonePublicKey = boundedString(phonePublicKeyValue, 128);
  if (
    !phoneDeviceId ||
    !DEVICE_ID_PATTERN.test(phoneDeviceId) ||
    !phonePublicKey ||
    !BASE64_KEY_PATTERN.test(phonePublicKey)
  ) {
    return null;
  }
  return { phoneDeviceId, phonePublicKey };
};

export const validateRegistration = (
  value: unknown,
  now = Date.now(),
  sessionId?: string,
): RelayRegistration | null => {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const macDeviceId = boundedString(input.macDeviceId, 256);
  const macIdentityPublicKey = boundedString(input.macIdentityPublicKey, 128);
  const displayName = boundedString(input.displayName, 160);
  const pairingCode = normalizePairingCode(input.pairingCode);
  const pairingVersion = input.pairingVersion;
  const pairingExpiresAt = input.pairingExpiresAt;
  const trustedPair = optionalTrustedPair(input.trustedPhoneDeviceId, input.trustedPhonePublicKey);

  if (
    (sessionId != null && !SESSION_ID_PATTERN.test(sessionId)) ||
    !macDeviceId ||
    !DEVICE_ID_PATTERN.test(macDeviceId) ||
    !macIdentityPublicKey ||
    !BASE64_KEY_PATTERN.test(macIdentityPublicKey) ||
    !displayName ||
    !pairingCode ||
    pairingVersion !== DJL_PAIRING_QR_VERSION ||
    !Number.isSafeInteger(pairingExpiresAt) ||
    Number(pairingExpiresAt) <= now ||
    Number(pairingExpiresAt) > now + DJL_PAIRING_TTL_MS * 2 ||
    !trustedPair
  ) {
    return null;
  }

  return {
    ...(sessionId ? { sessionId } : {}),
    macDeviceId,
    macIdentityPublicKey,
    displayName,
    trustedPhoneDeviceId: trustedPair.phoneDeviceId,
    trustedPhonePublicKey: trustedPair.phonePublicKey,
    pairingCode,
    pairingVersion,
    pairingExpiresAt: Number(pairingExpiresAt),
  };
};

export const resolveRelayRegistration = (
  value: unknown,
  existing: RelayRegistration | undefined,
  now: number,
  sessionId: string,
): RelayRegistration | null => {
  const fresh = validateRegistration(value, now, sessionId);
  if (fresh) return fresh;
  if (existing?.sessionId === sessionId && SESSION_ID_PATTERN.test(sessionId)) {
    return existing;
  }
  return null;
};

/**
 * An in-band update from the computer's socket. It may only restate the identity registered when
 * that socket connected, and it still moves the trusted phone after the pairing window expired.
 */
export const resolveRegistrationUpdate = (
  value: unknown,
  existing: RelayRegistration | undefined,
  now: number,
): RelayRegistration | null => {
  if (!existing?.sessionId || !value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    boundedString(input.macDeviceId, 256) !== existing.macDeviceId ||
    boundedString(input.macIdentityPublicKey, 128) !== existing.macIdentityPublicKey
  ) {
    return null;
  }
  const fresh = validateRegistration(value, now, existing.sessionId);
  if (fresh) return fresh;
  const trustedPair = optionalTrustedPair(input.trustedPhoneDeviceId, input.trustedPhonePublicKey);
  return trustedPair
    ? {
        ...existing,
        trustedPhoneDeviceId: trustedPair.phoneDeviceId,
        trustedPhonePublicKey: trustedPair.phonePublicKey,
      }
    : null;
};

/**
 * The registry pins the first signed identity key per computer. Returns the key to keep pinned,
 * null while nothing is pinned yet, or false when the registration must be refused.
 */
export const resolvePinnedIdentityKey = (
  pinnedIdentityKey: string | undefined,
  macIdentityPublicKey: string,
  signed: boolean,
): string | null | false => {
  if (pinnedIdentityKey) {
    return signed && macIdentityPublicKey === pinnedIdentityKey ? pinnedIdentityKey : false;
  }
  return signed ? macIdentityPublicKey : null;
};

export const classifyPhone = (
  identity: PhoneIdentity | undefined,
  registration: RelayRegistration | undefined,
): PhoneClass => {
  if (!identity) return "anonymous";
  return identity.deviceId === registration?.trustedPhoneDeviceId &&
    identity.publicKey === registration.trustedPhonePublicKey
    ? "trusted"
    : "candidate";
};

/** A phone's class after the registration changed; null when a trusted socket lost that status. */
export const reclassifyPhone = (
  phoneClass: PhoneClass | undefined,
  identity: PhoneIdentity | undefined,
  registration: RelayRegistration,
): PhoneClass | null => {
  const next = classifyPhone(identity, registration);
  if (phoneClass === "trusted") return next === "trusted" ? "trusted" : null;
  return phoneClass === "candidate" ? next : "anonymous";
};

/** Only a phone that proved it is the trusted one may disconnect the trusted phone. */
export const replacesPhone = (newcomer: PhoneClass, existing: PhoneClass | undefined): boolean =>
  newcomer === "trusted" || existing !== "trusted";

const PHONE_HANDSHAKE_KINDS: ReadonlySet<unknown> = new Set([
  "serverHello",
  "secureReady",
  "secureError",
]);

/**
 * Which phone sockets receive a frame from the computer. While a trusted phone is connected, any
 * other socket gets handshake frames only, so a stranger holding the session id sees no ciphertext.
 */
export const phoneRecipients = <Phone extends { readonly phoneClass?: PhoneClass | undefined }>(
  phones: ReadonlyArray<Phone>,
  frameKind: unknown,
): ReadonlyArray<Phone> => {
  if (PHONE_HANDSHAKE_KINDS.has(frameKind)) return phones;
  const trusted = phones.filter((phone) => phone.phoneClass === "trusted");
  return trusted.length > 0 ? trusted : phones;
};

export const parseJsonFrame = (message: string | ArrayBuffer): Record<string, unknown> | null => {
  if (typeof message !== "string") return null;
  try {
    const value = JSON.parse(message);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const readBoundedJson = async <CfHostMetadata, Cf>(
  request: Request<CfHostMetadata, Cf>,
): Promise<Record<string, unknown> | null> => {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) return null;
  // A chunked body declares no length, so count the bytes and stop reading at the cap.
  const reader = request.body?.getReader();
  if (!reader) return null;
  const bytes = new Uint8Array(MAX_JSON_BODY_BYTES);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.byteLength > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    bytes.set(value, length);
    length += value.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const sha256 = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

/** Compares SHA-256 digests, so neither the length nor the position of a mismatch leaks. */
export const constantTimeEqual = async (left: string, right: string): Promise<boolean> => {
  const leftDigest = await sha256(left);
  const rightDigest = await sha256(right);
  let difference = 0;
  for (let index = 0; index < leftDigest.byteLength; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
};

export const consumeMessageBudget = (
  previous: MessageBudgetState | undefined,
  now = Date.now(),
  limit = DEFAULT_MESSAGES_PER_WINDOW,
): MessageBudgetResult => {
  const state =
    !previous || now - previous.windowStartedAt >= MESSAGE_RATE_WINDOW_MS
      ? { windowStartedAt: now, count: 0 }
      : previous;
  const next = { ...state, count: state.count + 1 };
  return { allowed: next.count <= limit, state: next };
};

export const relayMessageByteLength = (message: string | ArrayBuffer): number =>
  typeof message === "string" ? new TextEncoder().encode(message).byteLength : message.byteLength;
