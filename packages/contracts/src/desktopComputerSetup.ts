export type DesktopAppSnapPlatform = "macos" | "windows" | "linux" | "other";
export type DesktopAppSnapPermission =
  | "granted"
  | "denied"
  | "not-determined"
  | "restricted"
  | "unknown";
export type DesktopAppSnapStatus =
  | "unsupported"
  | "disabled"
  | "permission-required"
  | "starting"
  | "ready"
  | "error";

export type DesktopAppSnapShortcutModifier = "command" | "control" | "option" | "shift";

export interface DesktopAppSnapKeyChord {
  kind: "key-chord";
  modifier: DesktopAppSnapShortcutModifier;
  /** A physical DOM KeyboardEvent.code, such as `KeyS` or `Space`. */
  key: string;
}

export type DesktopAppSnapShortcut = { kind: "both-option-keys" } | DesktopAppSnapKeyChord;

export interface DesktopAppSnapShortcutAvailability {
  available: boolean;
  reason: string | null;
}

export interface DesktopAppSnapShortcutUpdateResult {
  state: DesktopAppSnapState;
  availability: DesktopAppSnapShortcutAvailability;
}

export type DesktopAppSnapSettingsPane = "accessibility" | "input-monitoring" | "screen-recording";

/** A macOS privacy grant the AppSnap helper can check or request. */
export type DesktopAppSnapPermissionKind = "accessibility" | "inputMonitoring" | "screenRecording";

export type DesktopAppSnapPermissionGuideState = "closed" | "granted";

export interface DesktopAppSnapState {
  platform: DesktopAppSnapPlatform;
  supported: boolean;
  enabled: boolean;
  status: DesktopAppSnapStatus;
  shortcut: DesktopAppSnapShortcut | null;
  /**
   * Only present once a caller asked about Accessibility; the helper reports
   * just the grants it was queried for, so an absent field means "not asked".
   */
  accessibilityPermission?: DesktopAppSnapPermission;
  inputMonitoringPermission: DesktopAppSnapPermission;
  screenRecordingPermission: DesktopAppSnapPermission;
  message: string | null;
  /** Explicit setup failure; unrelated AppSnap capture errors do not set this. */
  permissionSetupErrorCode?:
    | "permission_setup_bundle_unavailable"
    | "permission_setup_registration_unresolved"
    | "permission_setup_identity_mismatch";
  /** Name macOS shows for this build in System Settings permission lists. */
  appDisplayName: string;
}

export interface DesktopAppSnapCapture {
  id: string;
  capturedAt: string;
  name: string;
  mimeType: "image/png";
  sizeBytes: number;
  bytes: Uint8Array;
  sourceAppName: string | null;
  sourceBundleIdentifier: string | null;
  sourceAppIconDataUrl: string | null;
  sourceWindowTitle: string | null;
}

export interface DesktopAppSnapErrorEvent {
  code: string;
  message: string;
  capturedAt: string;
}

export interface DesktopAppSnapWindowEntry {
  windowId: number;
  appName: string | null;
  bundleIdentifier: string | null;
  windowTitle: string | null;
  appIconDataUrl: string | null;
}
