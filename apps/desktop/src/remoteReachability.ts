// FILE: remoteReachability.ts
// Purpose: Keeps this computer reachable from the paired phone: when to hold it awake, the saved
//          preferences (stay awake, start at login), and whether this launch should stay hidden.
//          Pure decisions plus one small controller, so the main process only wires them up.

import type { DesktopRemoteKeepAwakeMode, DesktopRemoteReachabilityState } from "@djl/contracts";

export const REMOTE_KEEP_AWAKE_MODES = ["never", "pluggedIn", "always"] as const;

/** Passed on Windows so a start-at-login launch can stay in the background. */
export const LOGIN_HIDDEN_ARG = "--djl-start-hidden";

export interface RemoteReachabilityPreferences {
  readonly keepAwake: DesktopRemoteKeepAwakeMode;
  readonly openAtLogin: boolean;
}

export const DEFAULT_REMOTE_REACHABILITY_PREFERENCES: RemoteReachabilityPreferences = {
  // A laptop on battery should still sleep; a computer on power stays reachable.
  keepAwake: "pluggedIn",
  openAtLogin: false,
};

function isKeepAwakeMode(value: unknown): value is DesktopRemoteKeepAwakeMode {
  return REMOTE_KEEP_AWAKE_MODES.includes(value as DesktopRemoteKeepAwakeMode);
}

/** Reads saved preferences; anything missing or malformed falls back to the default. */
export function parseRemoteReachabilityPreferences(raw: unknown): RemoteReachabilityPreferences {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    keepAwake: isKeepAwakeMode(source.keepAwake)
      ? source.keepAwake
      : DEFAULT_REMOTE_REACHABILITY_PREFERENCES.keepAwake,
    openAtLogin: source.openAtLogin === true,
  };
}

/** Applies a renderer's change; unknown fields and wrong types are ignored. */
export function mergeRemoteReachabilityPreferences(
  current: RemoteReachabilityPreferences,
  patch: unknown,
): RemoteReachabilityPreferences {
  const source = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  return {
    keepAwake: isKeepAwakeMode(source.keepAwake) ? source.keepAwake : current.keepAwake,
    openAtLogin: typeof source.openAtLogin === "boolean" ? source.openAtLogin : current.openAtLogin,
  };
}

/**
 * Whether to stop the computer from idle-sleeping right now.
 *
 * A phone can only reach a computer that is awake before it connects, so a paired phone is
 * enough: waiting for a connection would let the computer sleep first. A phone that is connected
 * right now keeps it awake even on battery, because someone is using it.
 */
export function shouldStayAwake(input: {
  readonly mode: DesktopRemoteKeepAwakeMode;
  readonly remoteEnabled: boolean;
  readonly phonePaired: boolean;
  readonly phoneConnected: boolean;
  readonly onBattery: boolean;
}): boolean {
  if (input.mode === "never" || !input.remoteEnabled) return false;
  if (input.phoneConnected) return true;
  if (!input.phonePaired) return false;
  return input.mode === "always" || !input.onBattery;
}

/** The slice of Electron's `powerSaveBlocker` the controller needs. */
export interface PowerSaveBlockerLike {
  start(type: "prevent-app-suspension"): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

/** Holds at most one idle-sleep block, on macOS and Windows alike. */
export function createStayAwakeController(blocker: PowerSaveBlockerLike): {
  set(awake: boolean): boolean;
  isActive(): boolean;
} {
  let id: number | null = null;
  const isActive = () => id !== null && blocker.isStarted(id);
  return {
    isActive,
    set(awake) {
      if (awake && !isActive()) {
        id = blocker.start("prevent-app-suspension");
      } else if (!awake && id !== null) {
        if (blocker.isStarted(id)) blocker.stop(id);
        id = null;
      }
      return isActive();
    },
  };
}

/**
 * The gateway reports whether a phone is paired with each status message. Messages that say
 * nothing about it (pairing codes, older gateways) leave the last known answer in place.
 */
export function phonePairedFromChildMessage(rawMessage: unknown, previous: boolean): boolean {
  if (!rawMessage || typeof rawMessage !== "object") return previous;
  const message = rawMessage as Record<string, unknown>;
  if (message.type !== "status" || !message.status || typeof message.status !== "object")
    return previous;
  const paired = (message.status as Record<string, unknown>).phonePaired;
  return typeof paired === "boolean" ? paired : previous;
}

/** True when the operating system started DJL at login, so the window stays out of the way. */
export function launchedHiddenAtLogin(input: {
  readonly platform: NodeJS.Platform;
  readonly argv: readonly string[];
  readonly wasOpenedAtLogin: boolean;
}): boolean {
  if (input.platform === "darwin") return input.wasOpenedAtLogin;
  if (input.platform === "win32") return input.argv.includes(LOGIN_HIDDEN_ARG);
  return false;
}

/** Start at login works for an installed app on macOS and Windows only. */
export function openAtLoginSupported(input: {
  readonly platform: NodeJS.Platform;
  readonly packaged: boolean;
}): boolean {
  return input.packaged && (input.platform === "darwin" || input.platform === "win32");
}

export function remoteReachabilityState(input: {
  readonly preferences: RemoteReachabilityPreferences;
  readonly openAtLoginSupported: boolean;
  readonly stayingAwake: boolean;
  readonly onBattery: boolean;
}): DesktopRemoteReachabilityState {
  return {
    keepAwake: input.preferences.keepAwake,
    openAtLogin: input.openAtLoginSupported && input.preferences.openAtLogin,
    openAtLoginSupported: input.openAtLoginSupported,
    stayingAwake: input.stayingAwake,
    onBattery: input.onBattery,
  };
}
