// FILE: remoteGatewayRuntime.ts
// Purpose: Validate relay configuration and reduce sanitized gateway child messages.

import type { DesktopRemoteGatewayState } from "@synara/contracts";

export interface RemoteGatewayPackageMetadata {
  readonly djlRemoteRelayUrl?: unknown;
}

export function normalizeRemoteRelayUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (!url.hostname) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function resolveRemoteRelayUrl(
  env: NodeJS.ProcessEnv,
  packageMetadata: RemoteGatewayPackageMetadata | null = null,
): string | null {
  const configured =
    normalizeRemoteRelayUrl(env.DJL_REMOTE_RELAY_URL) ??
    normalizeRemoteRelayUrl(env.DJL_RELAY) ??
    normalizeRemoteRelayUrl(packageMetadata?.djlRemoteRelayUrl);
  if (configured) return configured;
  try {
    const api = new URL(env.DJL_CLOUD_API_URL?.trim() || "https://api.slcor.com");
    if (api.username || api.password || api.search || api.hash) return null;
    if (api.protocol === "https:") api.protocol = "wss:";
    else if (api.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname))
      api.protocol = "ws:";
    else return null;
    api.pathname = "/relay";
    return normalizeRemoteRelayUrl(api.toString());
  } catch {
    return null;
  }
}

export function createInitialRemoteGatewayState(input: {
  enabled: boolean;
  relayUrl: string | null;
}): DesktopRemoteGatewayState {
  const base = {
    enabled: input.enabled,
    configured: input.relayUrl !== null,
    pairingPayloadJson: null,
    pairingCode: null,
    pairingExpiresAt: null,
    computerName: null,
    phoneFingerprint: null,
    phoneDeviceKind: null,
  } as const;
  if (!input.enabled) return { ...base, status: "disabled", message: null };
  return {
    ...base,
    status: input.relayUrl ? "starting" : "unavailable",
    message: null,
  };
}

type ChildRecord = Record<string, unknown>;

function objectRecord(value: unknown): ChildRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ChildRecord)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function reduceRemoteGatewayChildMessage(
  state: DesktopRemoteGatewayState,
  rawMessage: unknown,
): DesktopRemoteGatewayState {
  const message = objectRecord(rawMessage);
  if (!message || typeof message.type !== "string") return state;
  if (message.type === "pairing") {
    const payload = objectRecord(message.pairingPayload);
    const expiresAt = payload && typeof payload.expiresAt === "number" ? payload.expiresAt : null;
    if (!payload || !expiresAt) return state;
    return {
      ...state,
      pairingPayloadJson: JSON.stringify(payload),
      pairingCode: nonEmptyString(message.pairingCode),
      pairingExpiresAt: expiresAt,
      computerName: nonEmptyString(payload.displayName),
    };
  }
  if (message.type !== "status") return state;
  const snapshot = objectRecord(message.status);
  if (!snapshot) return state;
  const activeDevice = objectRecord(snapshot.activeDevice);
  const connectionStatus = nonEmptyString(snapshot.connectionStatus);
  const phoneFingerprint = activeDevice ? nonEmptyString(activeDevice.phoneFingerprint) : null;
  const status =
    nonEmptyString(snapshot.state) === "error" ||
    nonEmptyString(snapshot.codexLaunchState) === "error"
      ? "error"
      : phoneFingerprint
        ? "connected"
        : connectionStatus === "connected"
          ? "ready"
          : connectionStatus === "starting"
            ? "starting"
            : "offline";
  const phoneDeviceKind = activeDevice ? nonEmptyString(activeDevice.deviceKind) : null;
  const detail = nonEmptyString(snapshot.lastError);
  // Most status messages only repeat liveness. Preserve identity so main does
  // not broadcast unchanged state to every renderer window.
  if (
    state.status === status &&
    state.phoneFingerprint === phoneFingerprint &&
    state.phoneDeviceKind === phoneDeviceKind &&
    state.message === detail
  )
    return state;
  return {
    ...state,
    status,
    phoneFingerprint,
    phoneDeviceKind,
    message: detail,
  };
}
