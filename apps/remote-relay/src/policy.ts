// FILE: policy.ts
// Purpose: Pure validation and abuse-control policy for the DJL blind relay.

import { DJL_PAIRING_QR_VERSION, DJL_PAIRING_TTL_MS } from "@synara/remote-protocol";

export const MAX_RELAY_MESSAGE_BYTES = 1_048_576;
export const MESSAGE_RATE_WINDOW_MS = 10_000;
export const DEFAULT_MESSAGES_PER_WINDOW = 200;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const PAIRING_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;

export type RelayRole = "mac" | "iphone";

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
