// FILE: groupGuestGateways.ts
// Purpose: The desktop's side of inviting people into a Multi agents group. Each guest gets a
//          gateway process of their own, with its own device identity, its own relay session and
//          a scope of exactly one group, so a guest's connection can never reach the owner's own
//          phone session or anything else on this computer. Pure decisions; main.ts runs them.

import * as Path from "node:path";

import type { DesktopGroupGuestInvite, DesktopGroupGuestLink } from "@djl/contracts";

const GUEST_ID_PATTERN = /^[a-z0-9]{8,32}$/;
const GUEST_ROLES = new Set(["viewer", "chat", "agent"]);
/** One gateway process each; matches GROUP_GUEST_LIMIT per group, across a few groups. */
export const MAX_GUEST_GATEWAYS = 24;

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

/**
 * Reads the guest list the renderer sent. Entries that are malformed are dropped, never
 * repaired: the guest id becomes a folder name and the rest becomes the gateway's scope.
 */
export function parseGuestInvites(raw: unknown): DesktopGroupGuestInvite[] {
  if (!Array.isArray(raw)) return [];
  const invites = new Map<string, DesktopGroupGuestInvite>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;
    const guestId = text(source.guestId, 32);
    const groupId = text(source.groupId, 200);
    const threadId = text(source.threadId, 200);
    const groupName = text(source.groupName, 200);
    const name = text(source.name, 40);
    if (!guestId || !GUEST_ID_PATTERN.test(guestId)) continue;
    if (!groupId || !threadId || !groupName || !name) continue;
    if (source.role !== "viewer" && source.role !== "chat" && source.role !== "agent") continue;
    if (!GUEST_ROLES.has(source.role)) continue;
    invites.set(guestId, { guestId, groupId, threadId, groupName, name, role: source.role });
    if (invites.size >= MAX_GUEST_GATEWAYS) break;
  }
  return [...invites.values()];
}

/** The folder that holds one guest's device identity. Deleting it revokes the guest. */
export function guestStateDir(baseDir: string, guestId: string): string {
  if (!GUEST_ID_PATTERN.test(guestId)) throw new Error("Invalid guest id.");
  return Path.join(baseDir, "remote-guests", guestId);
}

const sameScope = (left: DesktopGroupGuestInvite, right: DesktopGroupGuestInvite) =>
  left.groupId === right.groupId &&
  left.threadId === right.threadId &&
  left.groupName === right.groupName &&
  left.name === right.name &&
  left.role === right.role;

/**
 * What to do to get from the running gateways to the wanted guest list. A guest whose role or
 * group changed is restarted (it keeps its identity, so it stays paired); a guest who is gone
 * is stopped and its identity deleted.
 */
export function planGuestSync(
  running: ReadonlyMap<string, DesktopGroupGuestInvite>,
  wanted: readonly DesktopGroupGuestInvite[],
): { start: DesktopGroupGuestInvite[]; restart: DesktopGroupGuestInvite[]; remove: string[] } {
  const wantedIds = new Set(wanted.map((invite) => invite.guestId));
  return {
    start: wanted.filter((invite) => !running.has(invite.guestId)),
    restart: wanted.filter((invite) => {
      const current = running.get(invite.guestId);
      return current !== undefined && !sameScope(current, invite);
    }),
    remove: [...running.keys()].filter((guestId) => !wantedIds.has(guestId)),
  };
}

/**
 * The environment of one guest's gateway process. It is built from scratch on top of the
 * process environment so that nothing of the owner's own gateway carries over by accident.
 */
export function guestGatewayEnv(input: {
  readonly base: NodeJS.ProcessEnv;
  readonly invite: DesktopGroupGuestInvite;
  readonly baseDir: string;
  readonly relayUrl: string;
  readonly backendWsUrl: string;
  readonly desktopVersion: string;
}): NodeJS.ProcessEnv {
  const stateDir = guestStateDir(input.baseDir, input.invite.guestId);
  const { invite } = input;
  return {
    ...input.base,
    ELECTRON_RUN_AS_NODE: "1",
    DJL_RELAY: input.relayUrl,
    // Its own identity, trust record and settings...
    DJL_DEVICE_STATE_DIR: stateDir,
    DJL_DEVICE_STATE_FILE: Path.join(stateDir, "device-state.json"),
    // ...and its own mirror file, or it would adopt the owner's identity from the Keychain.
    DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE: Path.join(stateDir, "identity-mirror.json"),
    DJL_THREAD_RUNTIME_STATE_FILE: Path.join(stateDir, "thread-runtime-settings.json"),
    DJL_ELECTRON_BACKEND_ENDPOINT: input.backendWsUrl,
    DJL_DESKTOP_VERSION: input.desktopVersion,
    DJL_GUEST_SCOPE: JSON.stringify({
      guestId: invite.guestId,
      groupId: invite.groupId,
      threadId: invite.threadId,
      role: invite.role,
      name: invite.name,
    }),
    // The guest sees the group's name when pairing, not this computer's host name.
    DJL_BRIDGE_DISPLAY_NAME: `${invite.groupName} (DJL group)`,
    // A guest's gateway sends no push notifications: their previews would quote other chats.
    DJL_PUSH_SERVICE_URL: "",
    DJL_ELECTRON_BRIDGE_DIAGNOSTICS: "0",
    DJL_DESKTOP_IPC_ENABLED: "0",
    DJL_DESKTOP_IPC_LIVE_SYNC: "0",
    DJL_REMOTE_THREAD_SCOPE_ENABLED: "0",
    DJL_REFRESH_ENABLED: "0",
    DJL_KEEP_MAC_AWAKE: "0",
  };
}

export function initialGuestLink(invite: DesktopGroupGuestInvite): DesktopGroupGuestLink {
  return {
    guestId: invite.guestId,
    groupId: invite.groupId,
    status: "starting",
    pairingCode: null,
    pairingPayloadJson: null,
    pairingExpiresAt: null,
    message: null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Folds one message from a guest's gateway into that guest's link. Also reports whether the
 * guest's device has paired, which decides whether an expired invite code needs renewing.
 */
export function reduceGuestLink(
  link: DesktopGroupGuestLink,
  rawMessage: unknown,
): { link: DesktopGroupGuestLink; paired: boolean | null } {
  const message = record(rawMessage);
  if (!message) return { link, paired: null };
  if (message.type === "pairing") {
    const payload = record(message.pairingPayload);
    const expiresAt = payload && typeof payload.expiresAt === "number" ? payload.expiresAt : null;
    if (!payload || expiresAt === null) return { link, paired: null };
    return {
      link: {
        ...link,
        pairingCode: typeof message.pairingCode === "string" ? message.pairingCode : null,
        pairingPayloadJson: JSON.stringify(payload),
        pairingExpiresAt: expiresAt,
      },
      paired: null,
    };
  }
  if (message.type !== "status") return { link, paired: null };
  const status = record(message.status);
  if (!status) return { link, paired: null };
  const active = record(status.activeDevice);
  const connected = active?.connected === true && typeof active.phoneFingerprint === "string";
  const failed = status.state === "error" || status.codexLaunchState === "error";
  const next: DesktopGroupGuestLink["status"] = failed
    ? "error"
    : connected
      ? "connected"
      : status.connectionStatus === "connected"
        ? "waiting"
        : status.connectionStatus === "starting"
          ? "starting"
          : "offline";
  const detail = typeof status.lastError === "string" && status.lastError ? status.lastError : null;
  const paired = typeof status.phonePaired === "boolean" ? status.phonePaired : null;
  if (link.status === next && link.message === detail) return { link, paired };
  return { link: { ...link, status: next, message: detail }, paired };
}

/** An invite code needs renewing when it ran out and the guest never paired. */
export function guestInviteNeedsRenewal(input: {
  readonly link: DesktopGroupGuestLink;
  readonly paired: boolean;
  readonly now: number;
}): boolean {
  return (
    !input.paired &&
    input.link.status !== "connected" &&
    input.link.pairingExpiresAt !== null &&
    input.link.pairingExpiresAt <= input.now
  );
}
