// FILE: main.ts
// Purpose: Starts the Electron shell, backend process, native menus, IPC bridges, and updater.
// Layer: Desktop main process
// Depends on: Electron, backend startup helpers, browser manager, and update runtime.

import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
// Electron-only builtin that sees app.asar as a real file instead of a virtual
// directory — required to stat the archive itself for swap detection.
import * as OriginalFS from "original-fs";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  protocol,
  session,
  shell,
  systemPreferences,
} from "electron";
import type {
  BrowserWindowConstructorOptions,
  FileFilter,
  IpcMainEvent,
  MenuItemConstructorOptions,
} from "electron";
import * as Effect from "effect/Effect";
import type {
  DesktopRemoteGatewayState,
  DesktopTheme,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@synara/contracts";
import { autoUpdater, BaseUpdater, CancellationToken } from "electron-updater";

import type { ContextMenuItem } from "@synara/contracts";
import { APP_BASE_NAME, resolveAppDisplayName } from "@synara/shared/branding";
import { getMacTrafficLightPosition } from "@synara/shared/desktopChrome";
import {
  SYNARA_DESKTOP_ENTRY_URL,
  SYNARA_DESKTOP_SCHEME,
  SYNARA_DESKTOP_UPDATE_CHANNEL,
  synaraBundleId,
} from "@synara/shared/desktopIdentity";
import { resolveDesktopDjlHome, resolveDjlHome } from "@synara/shared/djlStoragePaths";
import { NetService } from "@synara/shared/Net";
import { RotatingFileSink } from "@synara/shared/logging";
import { acquireSharedStateLock } from "@synara/shared/sharedStateLock";
import { ensureStaticSnapshot, findAsarArchivePath } from "@synara/shared/staticSnapshot";
import { isBackendReadinessAborted, waitForHttpReady } from "./backendReadiness";
import { resolveBackendNodeArgs } from "./backendNodeOptions";
import { resolveBundledOpenCodePath } from "./bundledOpenCode";
import {
  bundleSignatureFromStats,
  isBundleStable,
  isBundleSwapped,
  isWatchableBundlePath,
  type BundleSignature,
} from "./bundleSwapDetection";
import { waitForBackendStartupReady } from "./backendStartupReadiness";
import { showDesktopConfirmDialog } from "./confirmDialog";
import { buildDisabledUpdatesDialog, buildUpdateResultDialog } from "./desktopDialogs";
import { desktopT, getDesktopI18n, initializeDesktopI18n } from "./desktopI18n";
import { DESKTOP_LOCALE_IPC_CHANNELS, parseLocalePreferenceForIpc } from "./desktopLocaleIpc";
import {
  readDesktopLocalePreference,
  resolveDesktopLocalePreferencePath,
  writeDesktopLocalePreference,
} from "./desktopLocalePreference";
import { buildDesktopMenuTemplate, rebuildDesktopMenu } from "./desktopMenu";
import {
  LSREGISTER_PATH,
  parseLastLaunchVersion,
  resolveLaunchVersionRecordPath,
  resolveMacAppBundlePath,
  serializeLaunchVersionRecord,
  shouldRefreshIconCache,
} from "./macIconCacheRefresh";
import { collectMacUpdateDiagnostics } from "./macUpdateDiagnostics";
import { openInitialBackendWindow } from "./initialBackendWindowOpen";
import { shouldAllowMediaPermissionRequest } from "./mediaPermissions";
import { resolveNotificationIconAssetName } from "./notificationIcon";
import {
  installResumableUpdateDownloader,
  type ResumableDownloaderTarget,
} from "./resumableUpdateDownload";
import { hardenElectronUpdater } from "./electronUpdaterSecurity";
import { ServerListeningDetector } from "./serverListeningDetector";
import { syncShellEnvironment } from "./syncShellEnvironment";
import {
  type DownloadProgressSample,
  getAutoUpdateDisabledReason,
  getDownloadStallTimeoutMessage,
  hasDownloadProgressAdvanced,
  isExpectedStalledDownloadCancellationError,
  isUpdateVersionNewer,
  shouldBroadcastDownloadProgress,
  shouldCheckForUpdatesOnForeground,
} from "./updateState";
import { registerDesktopVoiceTranscriptionHandler } from "./voiceTranscription";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnInstallRestartFailure,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "./updateMachine";
import {
  PendingUpdateCacheClearQueue,
  resolveElectronUpdaterCacheDirName,
  resolveElectronUpdaterLegacyZipPath,
  resolveElectronUpdaterPendingCacheDir,
} from "./updatePendingCache";
import {
  clearInstallMarker,
  createUpdateInstallMarker,
  markInstallHandoffSync,
  readInstallMarker,
  resolveInstallMarkerOutcome,
  writeInstallMarker,
  type UpdateInstallMarker,
} from "./updateInstallMarker";
import { buildGitHubReleasesPageUrl, resolveGitHubUpdateSource } from "./githubUpdateFeed";
import { isArm64HostRunningIntelBuild, resolveDesktopRuntimeInfo } from "./runtimeArch";
import { DesktopBrowserManager } from "./browserManager";
import {
  BROWSER_IPC_CHANNELS,
  registerBrowserIpcHandlers,
  sendBrowserCopyLink,
  sendBrowserAnnotationEvent,
  sendBrowserState,
} from "./browserIpc";
import {
  BrowserUsePipeServer,
  SYNARA_BROWSER_USE_PIPE_ENV,
  SYNARA_BROWSER_USE_PIPE_PATH,
} from "./browserUsePipeServer";
import {
  DESKTOP_WS_URL_CHANNEL,
  normalizeDesktopWsUrl,
  resolveDesktopWsUrlFromEnv,
} from "./desktopWsBridge";
import { DESKTOP_BUILD_INFO_CHANNEL } from "./desktopBuildInfo";
import {
  repairBrowserProfileFromBridgeManifest,
  resolveDesktopAppDataBase,
  resolveDesktopUserDataPath,
} from "./desktopUserDataProfile";
import { isBrokenPipeError } from "./desktopProcessErrors";
import {
  acknowledgeSynaraStorageSnapshot,
  readSynaraStorageSnapshot,
  resolveDjlStorageSnapshotReadPath,
  STORAGE_MIGRATION_IPC_CHANNELS,
} from "./desktopStorageMigration";
import { REMOTE_GATEWAY_IPC_CHANNELS } from "./remoteGatewayIpc";
import {
  createInitialRemoteGatewayState,
  reduceRemoteGatewayChildMessage,
  resolveRemoteRelayUrl,
  type RemoteGatewayPackageMetadata,
} from "./remoteGatewayRuntime";

// Capture the real archive identity before any explicit app.asar lookup. Static
// snapshotting and the runtime watcher both use this same generation as their
// baseline, so a replacement during startup cannot silently become "normal."
const startupBundleIdentity = captureStartupBundleIdentity();

syncShellEnvironment();

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const SAVE_FILE_CHANNEL = "desktop:save-file";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const PRINT_PDF_CHANNEL = "desktop:print-pdf";
const OPEN_PATH_CHANNEL = "desktop:open-path";
const SHOW_IN_FOLDER_CHANNEL = "desktop:show-in-folder";
const CLIPBOARD_WRITE_IMAGE_CHANNEL = "desktop:clipboard-write-image";
const MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH = 16 * 1024 * 1024;
const WINDOW_MINIMIZE_CHANNEL = "desktop:window-minimize";
const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = "desktop:window-toggle-maximize";
const WINDOW_CLOSE_CHANNEL = "desktop:window-close";
const WINDOW_GET_STATE_CHANNEL = "desktop:window-get-state";
const WINDOW_STATE_CHANNEL = "desktop:window-state";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const ZOOM_FACTOR_CHANNEL = "desktop:zoom-factor";
const ZOOM_FACTOR_CHANGED_CHANNEL = "desktop:zoom-factor-changed";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const NOTIFICATIONS_IS_SUPPORTED_CHANNEL = "desktop:notifications-is-supported";
const NOTIFICATIONS_SHOW_CHANNEL = "desktop:notifications-show";
const REMOTE_GATEWAY_PREFERENCES_FILE = "remote-gateway-preferences.json";
const REMOTE_GATEWAY_RESTART_BASE_DELAY_MS = 1_000;
const REMOTE_GATEWAY_RESTART_MAX_DELAY_MS = 30_000;
const REMOTE_GATEWAY_STOP_TIMEOUT_MS = 5_000;
const BASE_DIR = resolveDesktopDjlHome(
  process.env,
  OS.homedir(),
  process.env.LOCALAPPDATA,
  process.platform,
);
const STATE_DIR = Path.join(BASE_DIR, "userdata");
const DESKTOP_SCHEME = SYNARA_DESKTOP_SCHEME;
const ROOT_DIR = Path.resolve(__dirname, "../../..");
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const configuredDesktopDisplayName = process.env.SYNARA_DESKTOP_DISPLAY_NAME?.trim();
const APP_DISPLAY_NAME =
  isDevelopment && configuredDesktopDisplayName && configuredDesktopDisplayName.length <= 64
    ? configuredDesktopDisplayName
    : resolveAppDisplayName(isDevelopment);
const APP_USER_MODEL_ID = synaraBundleId(isDevelopment);
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;
const LOG_DIR = Path.join(STATE_DIR, "logs");
const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_MAX_FILES = 10;
const APP_RUN_ID = Crypto.randomBytes(6).toString("hex");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS = 30 * 1000;
const AUTO_UPDATE_CHECK_TIMEOUT_MS = 45 * 1000;
const AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS = 60 * 1000;
// Upper bound on how long we wait for electron-updater to release a cancelled
// download before allowing a retry, so a wedged updater promise can't block updates.
const AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS = 20 * 1000;
const AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS = 2 * 60 * 1000;
// How long we give quitAndInstall() to actually quit/relaunch the app before we
// conclude the OS installer never started (unsigned/quarantined build, read-only
// install dir, blocked NSIS run) and surface the manual-download fallback.
const AUTO_UPDATE_INSTALL_WATCHDOG_MS = 15 * 1000;
const AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS = 2_800;
const UPDATE_INSTALL_MARKER_FILE_NAME = "pending-update-install.json";
const BACKEND_FORCE_KILL_DELAY_MS = 8_000;
const BACKEND_SHUTDOWN_TIMEOUT_MS = 10_000;
const BACKEND_MAX_OLD_SPACE_ENV_KEYS = ["SYNARA_BACKEND_MAX_OLD_SPACE_MB"] as const;
const DESKTOP_UPDATE_ALLOW_PRERELEASE = false;
const BROWSER_PERF_SAMPLE_INTERVAL_MS = 5_000;
const DESKTOP_MENU_ZOOM_FACTOR_STEP = 1.1;
const DESKTOP_MENU_MIN_ZOOM_FACTOR = 0.25;
const DESKTOP_MENU_MAX_ZOOM_FACTOR = 5;
const SYNARA_BROWSER_LABEL = "Synara browser";
const browserPerfLoggingEnabled = process.env.SYNARA_BROWSER_PERF === "1";

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess.ChildProcess | null = null;
let sharedStateLock: Awaited<ReturnType<typeof acquireSharedStateLock>> | null = null;
let remoteGatewayProcess: ChildProcess.ChildProcess | null = null;
let remoteGatewayRelayUrl: string | null = null;
let remoteGatewayEnabled = true;
let remoteGatewayIntentionalStop = false;
let remoteGatewayRestartAttempt = 0;
let remoteGatewayRestartTimer: ReturnType<typeof setTimeout> | null = null;
let remoteGatewayState: DesktopRemoteGatewayState = createInitialRemoteGatewayState({
  enabled: true,
  relayUrl: null,
});
let backendPort = 0;
let backendAuthToken = "";
let backendHttpUrl = "";
let backendWsUrl = "";
let backendReadinessAbortController: AbortController | null = null;
let backendInitialWindowOpenInFlight: Promise<void> | null = null;
let backendListeningDetector: ServerListeningDetector | null = null;
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;
let isUpdaterInstallPreparing = false;
let isUpdaterQuitAndInstallInFlight = false;
let desktopShutdownPromise: Promise<void> | null = null;
let desktopShutdownComplete = false;
let desktopProtocolRegistered = false;
let aboutCommitHashCache: string | null | undefined;
let appUpdateYmlCache: Record<string, string> | null | undefined;
let desktopLogSink: RotatingFileSink | null = null;
let backendLogSink: RotatingFileSink | null = null;
let restoreStdIoCapture: (() => void) | null = null;
let unreadBackgroundNotificationCount = 0;
let browserPerfInterval: ReturnType<typeof setInterval> | null = null;
const browserManager = new DesktopBrowserManager();
let browserUsePipeServer: BrowserUsePipeServer | null = null;
let configuredGitHubUpdateSource: ReturnType<typeof resolveGitHubUpdateSource> = null;
let configuredUpdaterCacheDirName: string | null = null;

browserManager.subscribe((state) => {
  sendBrowserState(mainWindow?.webContents, state);
});

browserManager.subscribeCopyLink((event) => {
  sendBrowserCopyLink(mainWindow?.webContents, event);
});

browserManager.subscribeAnnotations((event) => {
  sendBrowserAnnotationEvent(mainWindow?.webContents, event);
});

function startBrowserPerformanceLogging(): void {
  if (browserPerfInterval || !browserPerfLoggingEnabled) {
    return;
  }

  browserPerfInterval = setInterval(() => {
    const snapshot = browserManager.getPerformanceSnapshot();
    const trackedProcessIds = new Set(snapshot.trackedProcessIds);
    const processMetrics = app
      .getAppMetrics()
      .filter((metric) => trackedProcessIds.has(metric.pid))
      .map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        cpu: Number(metric.cpu.percentCPUUsage.toFixed(1)),
        memMb: Math.round(metric.memory.workingSetSize / 1024),
        name: metric.name,
      }));

    console.info(`[${SYNARA_BROWSER_LABEL} perf]`, {
      ...snapshot.counters,
      trackedProcessIds: snapshot.trackedProcessIds,
      processes: processMetrics,
    });
  }, BROWSER_PERF_SAMPLE_INTERVAL_MS);
  browserPerfInterval.unref();
}

async function ensureBrowserUsePipeServer(): Promise<void> {
  if (browserUsePipeServer) {
    return;
  }
  const server = new BrowserUsePipeServer(browserManager, {
    requestOpenPanel: () => {
      mainWindow?.webContents.send(BROWSER_IPC_CHANNELS.requestOpenPanel);
    },
  });
  await server.start();
  browserUsePipeServer = server;
  console.info("[DJL browser] Registered in-app browser backend", {
    type: "iab",
    pipePath: SYNARA_BROWSER_USE_PIPE_PATH,
  });
}

let destructiveMenuIconCache: Electron.NativeImage | null | undefined;
const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation: app.runningUnderARM64Translation === true,
});
const initialUpdateState = (): DesktopUpdateState =>
  createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo);

function logTimestamp(): string {
  return new Date().toISOString();
}

function logScope(scope: string): string {
  return `${scope} run=${APP_RUN_ID}`;
}

function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function writeDesktopLogHeader(message: string): void {
  if (!desktopLogSink) return;
  desktopLogSink.write(`[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`);
}

function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
  if (!backendLogSink) return;
  const normalizedDetails = sanitizeLogValue(details);
  backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${normalizedDetails} ----\n`,
  );
}

function safeConsoleError(...args: Parameters<typeof console.error>): void {
  try {
    console.error(...args);
  } catch (error: unknown) {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  return parsedUrl.toString();
}

function getSafeDocumentPreviewUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return null;
  }

  let parsedUrl: URL;
  let backendUrl: URL;
  try {
    backendUrl = new URL(backendHttpUrl);
    parsedUrl = new URL(rawUrl, backendUrl);
  } catch {
    return null;
  }

  if (
    parsedUrl.origin !== backendUrl.origin ||
    parsedUrl.username.length > 0 ||
    parsedUrl.password.length > 0 ||
    (!parsedUrl.pathname.startsWith("/api/work/document-previews/") &&
      parsedUrl.pathname !== "/api/local-image")
  ) {
    return null;
  }

  return parsedUrl.toString();
}

function getSafeTheme(rawTheme: unknown): DesktopTheme | null {
  if (rawTheme === "light" || rawTheme === "dark" || rawTheme === "system") {
    return rawTheme;
  }

  return null;
}

function getDesktopWindowState(window: BrowserWindow): {
  isMaximized: boolean;
  isFullscreen: boolean;
} {
  return {
    isMaximized: window.isMaximized(),
    isFullscreen: window.isFullScreen(),
  };
}

function emitDesktopWindowState(window: BrowserWindow | null = mainWindow): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(WINDOW_STATE_CHANNEL, getDesktopWindowState(window));
}

function isSaveFileInput(input: unknown): input is {
  defaultFilename: string;
  contents: string;
  filters?: FileFilter[];
} {
  if (!input || typeof input !== "object") {
    return false;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.defaultFilename !== "string" || record.defaultFilename.trim().length === 0) {
    return false;
  }
  if (typeof record.contents !== "string") {
    return false;
  }
  if (record.filters === undefined) {
    return true;
  }
  if (!Array.isArray(record.filters)) {
    return false;
  }
  return record.filters.every((filter) => {
    if (!filter || typeof filter !== "object") return false;
    const filterRecord = filter as Record<string, unknown>;
    return (
      typeof filterRecord.name === "string" &&
      Array.isArray(filterRecord.extensions) &&
      filterRecord.extensions.every((extension) => typeof extension === "string")
    );
  });
}

async function waitForBackendHttpReady(
  baseUrl: string,
  options?: Parameters<typeof waitForHttpReady>[1],
): Promise<void> {
  cancelBackendReadinessWait();
  const controller = new AbortController();
  backendReadinessAbortController = controller;

  try {
    await waitForHttpReady(baseUrl, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    if (backendReadinessAbortController === controller) {
      backendReadinessAbortController = null;
    }
  }
}

function cancelBackendReadinessWait(): void {
  backendReadinessAbortController?.abort();
  backendReadinessAbortController = null;
}

async function reserveBackendEndpoint(reason: string): Promise<void> {
  backendPort = await Effect.service(NetService).pipe(
    Effect.flatMap((net) => net.reserveLoopbackPort()),
    Effect.provide(NetService.layer),
    Effect.runPromise,
  );
  backendHttpUrl = `http://127.0.0.1:${backendPort}`;
  backendWsUrl = `ws://127.0.0.1:${backendPort}/?token=${encodeURIComponent(backendAuthToken)}`;
  process.env.SYNARA_DESKTOP_WS_URL = backendWsUrl;
  writeDesktopLogHeader(`${reason} resolved backend endpoint port=${backendPort}`);
}

async function waitForBackendWindowReady(baseUrl: string): Promise<"listening" | "http"> {
  return await waitForBackendStartupReady({
    listeningPromise: backendListeningDetector?.promise ?? null,
    waitForHttpReady: () =>
      waitForBackendHttpReady(baseUrl, {
        path: "/health",
        timeoutMs: 60_000,
        isReady: async (response) => {
          if (!response.ok) {
            return false;
          }
          try {
            const payload = (await response.json()) as {
              startupReady?: unknown;
            };
            return payload.startupReady === true;
          } catch {
            return false;
          }
        },
      }),
    cancelHttpWait: cancelBackendReadinessWait,
  });
}

function ensureInitialBackendWindowOpen(baseUrl: string): void {
  openInitialBackendWindow({
    isDevelopment,
    baseUrl,
    hasExistingWindow: () => (mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null) !== null,
    createWindow: () => {
      mainWindow = createWindow();
    },
    getReadinessInFlight: () => backendInitialWindowOpenInFlight,
    setReadinessInFlight: (promise) => {
      backendInitialWindowOpenInFlight = promise;
    },
    waitForBackendWindowReady,
    writeLog: writeDesktopLogHeader,
    isReadinessAborted: isBackendReadinessAborted,
    formatErrorMessage,
    warn: (message, error) => {
      console.warn(message, error);
    },
  });
}

function writeDesktopStreamChunk(
  streamName: "stdout" | "stderr",
  chunk: unknown,
  encoding: BufferEncoding | undefined,
): void {
  if (!desktopLogSink) return;
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), typeof chunk === "string" ? encoding : undefined);
  desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName)}] `);
  desktopLogSink.write(buffer);
  if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
    desktopLogSink.write("\n");
  }
}

function installStdIoCapture(): void {
  if (!app.isPackaged || desktopLogSink === null || restoreStdIoCapture !== null) {
    return;
  }

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const patchWrite =
    (streamName: "stdout" | "stderr", originalWrite: typeof process.stdout.write) =>
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
      writeDesktopStreamChunk(streamName, chunk, encoding);
      if (typeof encodingOrCallback === "function") {
        return originalWrite(chunk, encodingOrCallback);
      }
      if (callback !== undefined) {
        return originalWrite(chunk, encoding, callback);
      }
      if (encoding !== undefined) {
        return originalWrite(chunk, encoding);
      }
      return originalWrite(chunk);
    };

  process.stdout.write = patchWrite("stdout", originalStdoutWrite);
  process.stderr.write = patchWrite("stderr", originalStderrWrite);

  restoreStdIoCapture = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    restoreStdIoCapture = null;
  };
}

function initializePackagedLogging(): void {
  if (!app.isPackaged) return;
  try {
    desktopLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "desktop-main.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    backendLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "server-child.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    installStdIoCapture();
    writeDesktopLogHeader(`runtime log capture enabled logDir=${LOG_DIR}`);
  } catch (error) {
    // Logging setup should never block app startup.
    console.error("[desktop] failed to initialize packaged logging", error);
  }
}

function captureBackendOutput(child: ChildProcess.ChildProcess): void {
  const attachStream = (stream: NodeJS.ReadableStream | null | undefined): void => {
    stream?.on("data", (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      backendLogSink?.write(buffer);
      backendListeningDetector?.push(buffer);
    });
  };

  attachStream(child.stdout);
  attachStream(child.stderr);
}

initializePackagedLogging();

function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
  if (process.platform !== "darwin") return undefined;
  if (destructiveMenuIconCache !== undefined) {
    return destructiveMenuIconCache ?? undefined;
  }
  try {
    const icon = nativeImage.createFromNamedImage("trash").resize({
      width: 14,
      height: 14,
    });
    if (icon.isEmpty()) {
      destructiveMenuIconCache = null;
      return undefined;
    }
    icon.setTemplateImage(true);
    destructiveMenuIconCache = icon;
    return icon;
  } catch {
    destructiveMenuIconCache = null;
    return undefined;
  }
}
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updaterConfigured = false;
let updateState: DesktopUpdateState = initialUpdateState();
let updateBackgroundedAtMs: number | null = null;
let updateBackgroundBlurTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let updateDownloadStallTimer: ReturnType<typeof setTimeout> | null = null;
let updateInstallWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
let automaticUpdateActivitySuppressed = false;
let updateDownloadCancellationToken: CancellationToken | null = null;
let rejectUpdateDownloadStall: ((error: Error) => void) | null = null;
let lastUpdateDownloadProgressSample: DownloadProgressSample | null = null;
let stalledDownloadCancellationSuppressionsRemaining = 0;
let stalledDownloadCancellationSuppressionExpiresAtMs = 0;
const pendingUpdateCacheClearQueue = new PendingUpdateCacheClearQueue();

function resolveUpdaterErrorContext(): DesktopUpdateErrorContext {
  if (isUpdaterInstallPreparing || isUpdaterQuitAndInstallInFlight) return "install";
  if (updateDownloadInFlight) return "download";
  if (updateCheckInFlight) return "check";
  return updateState.errorContext;
}

function clearUpdaterInstallInFlightAfterError(): void {
  if (!isUpdaterInstallPreparing && !isUpdaterQuitAndInstallInFlight) {
    return;
  }
  isUpdaterInstallPreparing = false;
  isUpdaterQuitAndInstallInFlight = false;
  isQuitting = false;
}

function clearUpdateInstallWatchdogTimer(): void {
  if (updateInstallWatchdogTimer) {
    clearTimeout(updateInstallWatchdogTimer);
    updateInstallWatchdogTimer = null;
  }
}

function getUpdateInstallMarkerPath(): string {
  return Path.join(app.getPath("userData"), UPDATE_INSTALL_MARKER_FILE_NAME);
}

function recordInstallMarkerFailure(nowIso: string): number {
  const result = readInstallMarker(getUpdateInstallMarkerPath());
  if (result.status !== "valid") {
    console.error(
      `[desktop-updater] Could not record durable install failure: marker is ${result.status}${result.status === "invalid" ? ` (${result.error})` : ""}.`,
    );
    return Math.max(1, updateState.installFailureCount + 1);
  }
  if (result.marker.phase === "failed") {
    return result.marker.consecutiveFailures;
  }
  const failedMarker: UpdateInstallMarker = {
    ...result.marker,
    phase: "failed",
    consecutiveFailures: result.marker.consecutiveFailures + 1,
    lastFailureAt: nowIso,
  };
  try {
    writeInstallMarker(getUpdateInstallMarkerPath(), failedMarker);
  } catch (error) {
    console.error(
      `[desktop-updater] Failed to persist install failure marker: ${formatErrorMessage(error)}`,
    );
  }
  return failedMarker.consecutiveFailures;
}

async function logMacUpdateDiagnostics(context: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const diagnostics = await Promise.race([
      collectMacUpdateDiagnostics(APP_USER_MODEL_ID),
      new Promise<string>((resolve) => {
        timeout = setTimeout(
          () => resolve("Diagnostic collection timed out."),
          AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS,
        );
      }),
    ]);
    if (diagnostics) {
      console.info(`[desktop-updater] diagnostics (${context})\n${diagnostics}`);
    }
  } catch (error) {
    console.info(
      `[desktop-updater] diagnostics (${context}) unavailable: ${formatErrorMessage(error)}`,
    );
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

// quitAndInstall() is a fire-and-forget void call with no success signal: when
// the OS installer silently fails the app never quits and the user is left with
// no feedback (the "update doesn't work for some people" report). If the process
// is still alive after the watchdog window, recover and surface an actionable
// install failure so the UI can offer the manual-download fallback.
function armInstallWatchdog(): void {
  clearUpdateInstallWatchdogTimer();
  updateInstallWatchdogTimer = setTimeout(() => {
    updateInstallWatchdogTimer = null;
    if (!isUpdaterQuitAndInstallInFlight) {
      return;
    }
    clearUpdaterInstallInFlightAfterError();
    // The backend was already stopped before quitAndInstall(); since the app is
    // not actually quitting, bring it back so the recovered app is functional
    // (renderer reconnects) instead of a zombie window with a dead backend.
    startBackend();
    // Polling was stopped before the install attempt; resume it so background
    // update checks keep running after this recovery.
    scheduleUpdatePoll();
    const consecutiveFailures = recordInstallMarkerFailure(new Date().toISOString());
    setUpdateState({
      ...reduceDesktopUpdateStateOnInstallFailure(
        updateState,
        "The update couldn’t be installed automatically.",
      ),
      installFailureCount: consecutiveFailures,
    });
    console.error(
      "[desktop-updater] quitAndInstall did not exit the app within the watchdog window; surfacing manual-download fallback.",
    );
  }, AUTO_UPDATE_INSTALL_WATCHDOG_MS);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function resolveAppRoot(): string {
  if (!app.isPackaged) {
    return ROOT_DIR;
  }
  return app.getAppPath();
}

/**
 * Read the baked-in app-update.yml config (if applicable). The file ships inside
 * the package and never changes at runtime, so the parsed result is cached to keep
 * repeated callers off the synchronous-FS path on the main thread.
 */
function readAppUpdateYml(): Record<string, string> | null {
  if (appUpdateYmlCache !== undefined) {
    return appUpdateYmlCache;
  }
  appUpdateYmlCache = parseAppUpdateYml();
  return appUpdateYmlCache;
}

function parseAppUpdateYml(): Record<string, string> | null {
  try {
    // electron-updater reads from process.resourcesPath in packaged builds,
    // or dev-app-update.yml via app.getAppPath() in dev.
    const ymlPath = app.isPackaged
      ? Path.join(process.resourcesPath, "app-update.yml")
      : Path.join(app.getAppPath(), "dev-app-update.yml");
    const raw = FS.readFileSync(ymlPath, "utf-8");
    // The YAML is simple key-value pairs — avoid pulling in a YAML parser by
    // doing a line-based parse (fields: provider, owner, repo, releaseType, …).
    const entries: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match?.[1] && match[2]) entries[match[1]] = match[2].trim();
    }
    return entries.provider ? entries : null;
  } catch {
    return null;
  }
}

function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!COMMIT_HASH_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase();
}

function resolveEmbeddedCommitHash(): string | null {
  const packageJsonPath = Path.join(resolveAppRoot(), "package.json");
  if (!FS.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const raw = FS.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { synaraCommitHash?: unknown };
    return normalizeCommitHash(parsed.synaraCommitHash);
  } catch {
    return null;
  }
}

function resolveAboutCommitHash(): string | null {
  if (aboutCommitHashCache !== undefined) {
    return aboutCommitHashCache;
  }

  const envCommitHash = normalizeCommitHash(process.env.SYNARA_COMMIT_HASH);
  if (envCommitHash) {
    aboutCommitHashCache = envCommitHash;
    return aboutCommitHashCache;
  }

  // Only packaged builds are required to expose commit metadata.
  if (!app.isPackaged) {
    aboutCommitHashCache = null;
    return aboutCommitHashCache;
  }

  aboutCommitHashCache = resolveEmbeddedCommitHash();

  return aboutCommitHashCache;
}

function resolveDiagnosticVersion(): string {
  if (app.isPackaged) {
    return app.getVersion();
  }
  try {
    const raw = FS.readFileSync(Path.join(ROOT_DIR, "apps", "desktop", "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // The renderer build still exposes APP_VERSION if a development checkout is incomplete.
  }
  return app.getVersion();
}

function resolveBackendEntry(): string {
  return Path.join(resolveAppRoot(), "apps/server/dist/index.mjs");
}

function resolveBackendCwd(): string {
  if (!app.isPackaged) {
    return resolveAppRoot();
  }
  return OS.homedir();
}

function resolveDesktopStaticDir(): string | null {
  const appRoot = resolveAppRoot();
  const candidates = [
    Path.join(appRoot, "apps/server/dist/client"),
    Path.join(appRoot, "apps/web/dist"),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(Path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

interface ServedStaticRoot {
  readonly dir: string;
  /** True when serving a real-disk snapshot instead of reading through the asar. */
  readonly snapshotted: boolean;
}

interface BundleIdentity {
  readonly path: string;
  readonly signature: BundleSignature | null;
}

class BundleChangedDuringStartupError extends Error {
  readonly bundlePath: string;
  readonly baseline: BundleSignature | null;
  readonly current: BundleSignature | null;

  constructor(input: {
    bundlePath: string;
    baseline: BundleSignature | null;
    current: BundleSignature | null;
  }) {
    super("The packaged application changed while its static assets were being prepared.");
    this.name = "BundleChangedDuringStartupError";
    this.bundlePath = input.bundlePath;
    this.baseline = input.baseline;
    this.current = input.current;
  }
}

let servedStaticRootCache: ServedStaticRoot | null | undefined;

// Serving static assets straight out of app.asar is vulnerable to the archive
// being replaced beneath the running app (Electron caches the header per process,
// so every later read returns bytes from the wrong offsets). Extract the client
// to a per-archive snapshot on real disk and serve that instead — both for the
// synara:// protocol here and, via SYNARA_STATIC_DIR, for the backend's HTTP static
// route. Memoized so one app run serves one coherent asset generation.
function resolveServedStaticRoot(): ServedStaticRoot | null {
  if (servedStaticRootCache === undefined) {
    servedStaticRootCache = computeServedStaticRoot();
  }
  return servedStaticRootCache;
}

function computeServedStaticRoot(): ServedStaticRoot | null {
  const sourceDir = resolveDesktopStaticDir();
  if (!sourceDir) {
    return null;
  }
  const archivePath = findAsarArchivePath(sourceDir);
  if (!archivePath) {
    // Plain-directory client (dev, unpacked build): real files already survive swaps.
    return { dir: sourceDir, snapshotted: false };
  }
  const startupArchiveSignature =
    startupBundleIdentity && Path.resolve(startupBundleIdentity.path) === Path.resolve(archivePath)
      ? startupBundleIdentity.signature
      : undefined;
  if (startupArchiveSignature === null) {
    throw new BundleChangedDuringStartupError({
      bundlePath: archivePath,
      baseline: null,
      current: readBundleSignature(archivePath),
    });
  }
  const archiveSignature = startupArchiveSignature ?? readBundleSignature(archivePath);
  if (!archiveSignature) {
    return { dir: sourceDir, snapshotted: false };
  }
  const startedAtMs = Date.now();
  let snapshot: ReturnType<typeof ensureStaticSnapshot>;
  try {
    snapshot = ensureStaticSnapshot({
      sourceDir,
      cacheRoot: Path.join(app.getPath("userData"), "static-snapshots"),
      signature: `${archiveSignature.size}-${archiveSignature.mtimeMs}-${archiveSignature.inode}`,
    });
  } catch (error) {
    const currentArchiveSignature = readBundleSignature(archivePath);
    if (!isBundleStable(archiveSignature, currentArchiveSignature)) {
      throw new BundleChangedDuringStartupError({
        bundlePath: archivePath,
        baseline: archiveSignature,
        current: currentArchiveSignature,
      });
    }
    console.warn(
      "[desktop] Failed to snapshot static assets; serving from the archive",
      formatErrorMessage(error),
    );
    return { dir: sourceDir, snapshotted: false };
  }

  const currentArchiveSignature = readBundleSignature(archivePath);
  if (!isBundleStable(archiveSignature, currentArchiveSignature)) {
    // A newly-created snapshot may contain reads from both archive generations.
    // Never leave it behind for a future launch to reuse.
    if (!snapshot.reused) {
      try {
        FS.rmSync(snapshot.dir, { recursive: true, force: true });
      } catch {
        // The signature changes the snapshot key, so failed cleanup is disk waste
        // rather than a path the replacement generation can accidentally reuse.
      }
    }
    throw new BundleChangedDuringStartupError({
      bundlePath: archivePath,
      baseline: archiveSignature,
      current: currentArchiveSignature,
    });
  }

  writeDesktopLogHeader(
    `static snapshot ${snapshot.reused ? "reused" : "created"} dir=${snapshot.dir} in ${Date.now() - startedAtMs}ms`,
  );
  return { dir: snapshot.dir, snapshotted: true };
}

function resolveDesktopStaticPath(staticRoot: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname);
  const normalizedPath = Path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (normalizedPath.includes("..")) {
    return Path.join(staticRoot, "index.html");
  }

  const requestedPath = normalizedPath.length > 0 ? normalizedPath : "index.html";
  const resolvedPath = Path.join(staticRoot, requestedPath);

  if (Path.extname(resolvedPath)) {
    return resolvedPath;
  }

  const nestedIndex = Path.join(resolvedPath, "index.html");
  if (FS.existsSync(nestedIndex)) {
    return nestedIndex;
  }

  return Path.join(staticRoot, "index.html");
}

function isStaticAssetRequest(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return Path.extname(url.pathname).length > 0;
  } catch {
    return false;
  }
}

function handleFatalStartupError(stage: string, error: unknown): void {
  const message = formatErrorMessage(error);
  const detail =
    error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`);
  console.error(`[desktop] fatal startup error (${stage})`, error);
  if (!isQuitting) {
    isQuitting = true;
    dialog.showErrorBox(`${APP_BASE_NAME} failed to start`, `Stage: ${stage}\n${message}${detail}`);
  }
  stopBackend();
  restoreStdIoCapture?.();
  app.quit();
}

function registerDesktopProtocol(): void {
  if (isDevelopment || desktopProtocolRegistered) return;

  // An unreadable first observation cannot be replaced by a later baseline:
  // Electron may already hold the header for the generation that disappeared.
  if (startupBundleIdentity && !startupBundleIdentity.signature) {
    throw new BundleChangedDuringStartupError({
      bundlePath: startupBundleIdentity.path,
      baseline: null,
      current: readBundleSignature(startupBundleIdentity.path),
    });
  }

  const staticRoot = resolveServedStaticRoot()?.dir ?? null;
  if (!staticRoot) {
    throw new Error(
      "Desktop static bundle missing. Build apps/server (with bundled client) first.",
    );
  }

  const staticRootResolved = Path.resolve(staticRoot);
  const staticRootPrefix = `${staticRootResolved}${Path.sep}`;
  const fallbackIndex = Path.join(staticRootResolved, "index.html");

  protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
    try {
      const candidate = resolveDesktopStaticPath(staticRootResolved, request.url);
      const resolvedCandidate = Path.resolve(candidate);
      const isInRoot =
        resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix);
      const isAssetRequest = isStaticAssetRequest(request.url);

      if (!isInRoot || !FS.existsSync(resolvedCandidate)) {
        if (isAssetRequest) {
          callback({ error: -6 });
          return;
        }
        callback({ path: fallbackIndex });
        return;
      }

      callback({ path: resolvedCandidate });
    } catch {
      callback({ path: fallbackIndex });
    }
  });

  desktopProtocolRegistered = true;
}

function dispatchMenuAction(action: string): void {
  const existingWindow =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  const targetWindow = existingWindow ?? createWindow();
  if (!existingWindow) {
    mainWindow = targetWindow;
  }

  const send = () => {
    if (targetWindow.isDestroyed()) return;
    targetWindow.webContents.send(MENU_ACTION_CHANNEL, action);
    if (!targetWindow.isVisible()) {
      targetWindow.show();
    }
    targetWindow.focus();
  };

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function resolveMenuTargetWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function sendDesktopZoomFactor(webContents: Electron.WebContents): void {
  if (webContents.isDestroyed()) return;
  webContents.send(ZOOM_FACTOR_CHANGED_CHANNEL, webContents.getZoomFactor());
}

function attachDesktopZoomFactorSync(window: BrowserWindow): void {
  const notify = () => sendDesktopZoomFactor(window.webContents);
  window.webContents.on("zoom-changed", notify);
  window.webContents.on("did-finish-load", notify);
}

function resetWindowZoomFromMenu(): void {
  resolveMenuTargetWindow()?.webContents.setZoomFactor(1);
}

function adjustWindowZoomFromMenu(multiplier: number): void {
  const webContents = resolveMenuTargetWindow()?.webContents;
  if (!webContents) return;
  const nextZoomFactor = Math.min(
    DESKTOP_MENU_MAX_ZOOM_FACTOR,
    Math.max(DESKTOP_MENU_MIN_ZOOM_FACTOR, webContents.getZoomFactor() * multiplier),
  );
  webContents.setZoomFactor(nextZoomFactor);
}

// A configured app-update.yml (or the mock-updates flag) is the prerequisite for any
// auto-update activity; centralized so the menu and the enable check stay in lockstep.
function hasConfiguredUpdateFeed(): boolean {
  return readAppUpdateYml() !== null || Boolean(process.env.SYNARA_DESKTOP_MOCK_UPDATES);
}

function resolveAutoUpdateDisabledReason(): string | null {
  return getAutoUpdateDisabledReason({
    isDevelopment,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    disabledByEnv: process.env.SYNARA_DISABLE_AUTO_UPDATE === "1",
    hasUpdateFeedConfig: hasConfiguredUpdateFeed(),
  });
}

function handleCheckForUpdatesMenuClick(): void {
  const disabledReason = resolveAutoUpdateDisabledReason();
  if (disabledReason) {
    console.info("[desktop-updater] Manual update check requested, but updates are disabled.");
    void dialog.showMessageBox(buildDisabledUpdatesDialog(desktopT, disabledReason));
    return;
  }

  if (!BrowserWindow.getAllWindows().length) {
    mainWindow = createWindow();
  }
  void checkForUpdatesFromMenu();
}

async function checkForUpdatesFromMenu(): Promise<void> {
  await checkForUpdates("menu");

  const presentation = buildUpdateResultDialog(desktopT, updateState, APP_BASE_NAME);
  if (presentation) void dialog.showMessageBox(presentation);
}

function configureApplicationMenu(): void {
  rebuildDesktopMenu({
    template: buildDesktopMenuTemplate({
      platform: process.platform,
      appName: app.name,
      t: getDesktopI18n().t,
      dispatch: dispatchMenuAction,
      checkForUpdates: handleCheckForUpdatesMenuClick,
      resetZoom: resetWindowZoomFromMenu,
      zoomIn: () => adjustWindowZoomFromMenu(DESKTOP_MENU_ZOOM_FACTOR_STEP),
      zoomOut: () => adjustWindowZoomFromMenu(1 / DESKTOP_MENU_ZOOM_FACTOR_STEP),
    }),
    build: (template) => Menu.buildFromTemplate(template),
    set: (menu) => Menu.setApplicationMenu(menu),
  });
}

function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    Path.join(__dirname, "../resources", fileName),
    Path.join(__dirname, "../prod-resources", fileName),
    Path.join(process.resourcesPath, "resources", fileName),
    Path.join(process.resourcesPath, fileName),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveIconPath(ext: "ico" | "icns" | "png"): string | null {
  return resolveResourcePath(`icon.${ext}`);
}

function resolveNotificationIconPath(): string | null {
  const assetName = resolveNotificationIconAssetName(process.platform);
  if (!assetName) {
    return null;
  }
  const iconPath = resolveResourcePath(assetName);
  if (iconPath) {
    return iconPath;
  }
  if (process.platform === "win32") {
    return resolveIconPath("ico");
  }
  return null;
}

// Keep the app badge aligned with desktop notifications that arrive off-focus.
function syncUnreadNotificationBadge(): void {
  app.setBadgeCount(unreadBackgroundNotificationCount);
}

// Count minimized, hidden, or unfocused windows as background notification targets.
function isMainWindowForeground(window: BrowserWindow | null): boolean {
  if (!window) {
    return false;
  }
  return window.isVisible() && !window.isMinimized() && window.isFocused();
}

function incrementUnreadNotificationBadge(): void {
  unreadBackgroundNotificationCount = Math.min(unreadBackgroundNotificationCount + 1, 99);
  syncUnreadNotificationBadge();
}

function clearUnreadNotificationBadge(): void {
  if (unreadBackgroundNotificationCount === 0) {
    return;
  }
  unreadBackgroundNotificationCount = 0;
  syncUnreadNotificationBadge();
}

// Reuse the existing desktop window when the app is launched again so users
// don't end up with multiple packaged instances racing the same local state.
function focusMainWindow(): void {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

// Show a native OS notification and refocus the app window when the alert is clicked.
function showDesktopNotification(input: {
  title: string;
  body?: string;
  silent?: boolean;
  threadId?: string;
}): boolean {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const threadId = typeof input.threadId === "string" ? input.threadId.trim() : "";
  if (title.length === 0 || !Notification.isSupported()) {
    return false;
  }

  const iconPath = resolveNotificationIconPath();
  const notification = new Notification({
    title,
    body,
    silent: input.silent === true,
    ...(iconPath ? { icon: iconPath } : {}),
  });
  if (!isMainWindowForeground(mainWindow)) {
    incrementUnreadNotificationBadge();
  }

  notification.on("click", () => {
    clearUnreadNotificationBadge();
    focusMainWindow();
    if (!mainWindow) {
      return;
    }
    if (threadId.length > 0) {
      mainWindow.webContents.send(MENU_ACTION_CHANNEL, `notification-open-thread:${threadId}`);
    }
  });

  notification.show();
  return true;
}

/**
 * Resolve the Electron userData directory path.
 *
 * Electron derives the default userData path from `productName` in
 * package.json. We override it to a stable lowercase DJL profile name.
 */
function resolveUserDataPath(): string {
  const configuredPath =
    process.env.DJL_DESKTOP_USER_DATA_DIR?.trim() ??
    process.env.SYNARA_DESKTOP_USER_DATA_DIR?.trim();
  if (configuredPath) {
    if (!Path.isAbsolute(configuredPath)) {
      throw new Error("DJL_DESKTOP_USER_DATA_DIR must be an absolute path.");
    }
    return Path.resolve(configuredPath);
  }
  const appDataBase = resolveDesktopAppDataBase();
  return resolveDesktopUserDataPath({ appDataBase, isDevelopment });
}

function repairBrowserProfileBeforeElectronReady(userDataPath: string): void {
  const browserProfileRepair = repairBrowserProfileFromBridgeManifest(userDataPath);
  if (browserProfileRepair.status === "repaired") {
    console.info("[desktop] Completed DJL browser profile bridge repair", {
      sourcePath: browserProfileRepair.sourcePath,
      targetPath: browserProfileRepair.targetPath,
      copiedEntries: browserProfileRepair.copiedEntries,
    });
  } else if (browserProfileRepair.status === "repair-failed") {
    console.warn("[desktop] Failed to complete DJL browser profile bridge repair", {
      sourcePath: browserProfileRepair.sourcePath,
      targetPath: browserProfileRepair.targetPath,
      error: browserProfileRepair.error,
    });
  }
}

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  const commitHash = resolveAboutCommitHash();
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    version: commitHash ?? "unknown",
    copyright: `© ${new Date().getFullYear()} Emanuele Di Pietro`,
  });

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }
}

// The packaged bundle icon is a solid, pre-rounded ICNS so Tahoe does not reinterpret
// the mark as Icon Composer glass. Older macOS gets the same literal rounded artwork as
// a runtime dock override because it does not apply the modern system mask itself.
function applyLegacyMacDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }
  const darwinMajor = Number.parseInt(OS.release().split(".")[0] ?? "", 10);
  if (!Number.isFinite(darwinMajor) || darwinMajor >= 25) {
    return;
  }
  const iconPath = resolveResourcePath("dock-icon.png");
  if (!iconPath) {
    return;
  }
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    return;
  }
  app.dock.setIcon(image);
}

function readLaunchVersionRecordContents(): string | null {
  try {
    return FS.readFileSync(resolveLaunchVersionRecordPath(app.getPath("userData")), "utf8");
  } catch {
    // No prior record (fresh profile) or an unreadable file.
    return null;
  }
}

function persistLastLaunchVersion(version: string): void {
  const recordPath = resolveLaunchVersionRecordPath(app.getPath("userData"));
  try {
    // The userData directory is not guaranteed to exist this early on a clean
    // first launch, so ensure it before writing or the record silently fails to
    // persist and the refresh re-runs on every launch.
    FS.mkdirSync(Path.dirname(recordPath), { recursive: true });
    FS.writeFileSync(recordPath, serializeLaunchVersionRecord(version));
  } catch (error) {
    console.warn("[desktop] Failed to persist last launch version", error);
  }
}

// macOS keeps an aggressive Launch Services / IconServices cache keyed by bundle
// path + identifier. electron-updater swaps the bundle in place, so after an
// update the refreshed icon.icns is already on disk while the dock and Finder
// keep painting the previous icon — most visibly on Tahoe, where we no longer
// apply a runtime dock icon (see applyLegacyMacDockIcon). When the version
// changes across launches, force Launch Services to re-read the bundle so the
// new icon shows on every surface. Best-effort: never blocks startup.
function refreshMacIconCacheOnVersionChange(): void {
  if (process.platform !== "darwin" || !app.isPackaged) {
    return;
  }

  const currentVersion = app.getVersion();
  const previousVersion = parseLastLaunchVersion(readLaunchVersionRecordContents());
  if (!shouldRefreshIconCache(previousVersion, currentVersion)) {
    return;
  }

  // Record the new version before refreshing so a failed re-registration is not
  // retried on every launch; the icon then heals on the next version bump
  // instead of spawning lsregister each time.
  persistLastLaunchVersion(currentVersion);

  const bundlePath = resolveMacAppBundlePath(process.execPath, process.platform);
  if (!bundlePath || !FS.existsSync(LSREGISTER_PATH)) {
    return;
  }

  // Bump the bundle mtime so Launch Services notices the swap, then re-register
  // it. The codesign signature covers Contents, not the bundle directory mtime,
  // so this is signature-safe; the bundle may be read-only for this user, in
  // which case the re-registration below still nudges the cache.
  try {
    const now = new Date();
    FS.utimesSync(bundlePath, now, now);
  } catch {
    // Read-only bundle: fall through to lsregister.
  }

  const child = ChildProcess.spawn(LSREGISTER_PATH, ["-f", bundlePath], { stdio: "ignore" });
  child.unref();
  child.once("error", (error) => {
    console.warn("[desktop] Failed to refresh macOS icon cache after update", error);
  });
  child.once("exit", (code) => {
    console.info(
      `[desktop] Refreshed macOS icon registration after update ${previousVersion ?? "(none)"} -> ${currentVersion} (lsregister exit ${code ?? "unknown"}).`,
    );
  });
}

// How often the bundle-swap watcher stats app.asar. A stat is cheap; the cost of
// missing a swap is every subsequent asar read returning bytes from the wrong
// file (invisible icons, corrupted lazy-loaded route chunks), so poll briskly.
const BUNDLE_SWAP_POLL_INTERVAL_MS = 15_000;

let bundleSwapPollTimer: NodeJS.Timeout | null = null;
let bundleSwapPromptOpen = false;

function readBundleSignature(bundlePath: string): BundleSignature | null {
  try {
    return bundleSignatureFromStats(OriginalFS.statSync(bundlePath));
  } catch {
    return null;
  }
}

function captureStartupBundleIdentity(): BundleIdentity | null {
  if (!app.isPackaged) {
    return null;
  }
  const bundlePath = app.getAppPath();
  if (!isWatchableBundlePath(bundlePath)) {
    return null;
  }
  return { path: bundlePath, signature: readBundleSignature(bundlePath) };
}

function restartAfterStartupBundleSwap(error: BundleChangedDuringStartupError): void {
  const baselineSize = error.baseline?.size ?? "unreadable";
  const currentSize = error.current?.size ?? "unreadable";
  writeDesktopLogHeader(
    `bundle changed during startup path=${error.bundlePath} size=${baselineSize}->${currentSize}`,
  );
  console.warn("[desktop] Packaged application changed during startup; restarting", error);

  void dialog
    .showMessageBox({
      type: "warning",
      title: desktopT("dialog.bundleChangedTitle", { appName: APP_BASE_NAME }),
      message: desktopT("dialog.bundleChangedMessage", { appName: APP_BASE_NAME }),
      detail: desktopT("dialog.bundleChangedDetail", { appName: APP_BASE_NAME }),
      buttons: [desktopT("dialog.restartApp", { appName: APP_BASE_NAME })],
      defaultId: 0,
    })
    .catch(() => undefined)
    .then(() => {
      app.relaunch();
      requestGracefulAppQuit("startup-bundle-swap");
    });
}

// Electron caches the asar header per process, so once app.asar changes on disk
// (updater retry racing a relaunch, a reinstall, a build copied over the bundle)
// every archive read in this process — the synara:// protocol, the backend's static
// files, lazily-loaded renderer chunks — resolves to stale offsets and silently
// returns the wrong bytes. Detect the swap and offer a restart; continuing is
// never safe.
function startBundleSwapWatcher(): void {
  if (!app.isPackaged || bundleSwapPollTimer) {
    return;
  }
  const bundlePath = app.getAppPath();
  if (!isWatchableBundlePath(bundlePath)) {
    return;
  }
  let baseline =
    startupBundleIdentity && Path.resolve(startupBundleIdentity.path) === Path.resolve(bundlePath)
      ? (startupBundleIdentity.signature ?? readBundleSignature(bundlePath))
      : readBundleSignature(bundlePath);
  if (!baseline) {
    return;
  }

  bundleSwapPollTimer = setInterval(() => {
    // The updater owns the quit/relaunch during its own install handoff, and a
    // quitting app is about to re-read the new archive anyway.
    if (isQuitting || isUpdaterInstallPreparing || bundleSwapPromptOpen) {
      return;
    }
    const current = readBundleSignature(bundlePath);
    if (!baseline || !isBundleSwapped(baseline, current)) {
      return;
    }
    writeDesktopLogHeader(
      `bundle swap detected path=${bundlePath} size=${baseline.size}->${current?.size ?? "unknown"}`,
    );
    // Re-arm on the new identity so declining the restart still catches the
    // next replacement instead of re-prompting for the same one.
    baseline = current;
    bundleSwapPromptOpen = true;
    void dialog
      .showMessageBox({
        type: "warning",
        title: desktopT("dialog.bundleReplacedTitle", { appName: APP_BASE_NAME }),
        message: desktopT("dialog.bundleReplacedMessage", { appName: APP_BASE_NAME }),
        detail: desktopT("dialog.bundleReplacedDetail", { appName: APP_BASE_NAME }),
        buttons: [desktopT("dialog.restartNow"), desktopT("dialog.later")],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        bundleSwapPromptOpen = false;
        if (response === 0) {
          app.relaunch();
          requestGracefulAppQuit("bundle-swap-restart");
        }
      })
      .catch(() => {
        bundleSwapPromptOpen = false;
      });
  }, BUNDLE_SWAP_POLL_INTERVAL_MS);
  bundleSwapPollTimer.unref();
}

function clearUpdatePollTimer(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

// Starts the periodic background update check. Used by configureAutoUpdater and
// by the install watchdog recovery so polling resumes after a silent install
// failure instead of staying off until the next app restart.
function scheduleUpdatePoll(): void {
  if (updatePollTimer || automaticUpdateActivitySuppressed) {
    return;
  }
  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref();
}

function isExplicitUpdateCheckReason(reason: string): boolean {
  return reason === "menu" || reason === "renderer";
}

function emitUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
  }
}

function setUpdateState(patch: Partial<DesktopUpdateState>): void {
  updateState = { ...updateState, ...patch };
  emitUpdateState();
}

function shouldEnableAutoUpdates(): boolean {
  return resolveAutoUpdateDisabledReason() === null;
}

function isKnownUpdateVersionNewer(version: string | null | undefined): boolean {
  return typeof version === "string" && isUpdateVersionNewer(app.getVersion(), version);
}

function getUpdaterCachePathArgs(): {
  cacheDirName: string | null;
  platform: NodeJS.Platform;
  homeDir: string;
  localAppData: string | null;
  xdgCacheHome: string | null;
} {
  return {
    cacheDirName: configuredUpdaterCacheDirName,
    platform: process.platform,
    homeDir: OS.homedir(),
    localAppData: process.env.LOCALAPPDATA ?? null,
    xdgCacheHome: process.env.XDG_CACHE_HOME ?? null,
  };
}

function getPendingUpdateCacheDir(): string | null {
  return resolveElectronUpdaterPendingCacheDir(getUpdaterCachePathArgs());
}

function clearLegacyUpdaterZipAfterVerifiedInstall(): void {
  const legacyZipPath = resolveElectronUpdaterLegacyZipPath(getUpdaterCachePathArgs());
  if (!legacyZipPath) {
    return;
  }
  try {
    FS.rmSync(legacyZipPath, { force: true });
    console.info("[desktop-updater] Cleared legacy top-level update.zip after verified install.");
  } catch (error) {
    console.warn(
      `[desktop-updater] Failed to clear legacy top-level update.zip: ${formatErrorMessage(error)}`,
    );
  }
}

function quarantineInstallMarker(reason: string): void {
  console.warn(`[desktop-updater] Discarding update install marker (${reason}).`);
  try {
    clearInstallMarker(getUpdateInstallMarkerPath());
  } catch (error) {
    console.warn(
      `[desktop-updater] Failed to delete quarantined update install marker: ${formatErrorMessage(error)}`,
    );
  }
}

function processInstallMarkerOnStartup(): void {
  const filePath = getUpdateInstallMarkerPath();
  const readResult = readInstallMarker(filePath);
  if (readResult.status === "missing") {
    return;
  }
  if (readResult.status === "invalid") {
    quarantineInstallMarker(`invalid or unreadable: ${readResult.error}`);
    return;
  }

  const marker = readResult.marker;
  const nowIso = new Date().toISOString();
  const outcome = resolveInstallMarkerOutcome(marker, app.getVersion(), nowIso);
  if (outcome === "success") {
    console.info(
      `[desktop-updater] Update to ${marker.toVersion} installed successfully (from ${marker.fromVersion})`,
    );
    try {
      clearInstallMarker(filePath);
    } catch (error) {
      console.warn(
        `[desktop-updater] Failed to clear successful update install marker: ${formatErrorMessage(error)}`,
      );
    }
    clearLegacyUpdaterZipAfterVerifiedInstall();
    return;
  }
  if (outcome === "stale" || outcome === "invalid") {
    quarantineInstallMarker(outcome);
    return;
  }

  let consecutiveFailures = marker.consecutiveFailures;
  if (outcome === "failure") {
    consecutiveFailures += 1;
    const failedMarker: UpdateInstallMarker = {
      ...marker,
      phase: "failed",
      consecutiveFailures,
      lastFailureAt: nowIso,
    };
    try {
      writeInstallMarker(filePath, failedMarker);
    } catch (error) {
      console.error(
        `[desktop-updater] Failed to persist restart install failure: ${formatErrorMessage(error)}`,
      );
    }
  }

  automaticUpdateActivitySuppressed = true;
  const message = desktopT("dialog.updates.installRestartFailure", {
    appName: APP_BASE_NAME,
    version: marker.toVersion,
  });
  setUpdateState(
    reduceDesktopUpdateStateOnInstallRestartFailure(
      updateState,
      marker.toVersion,
      consecutiveFailures,
      message,
    ),
  );
  console.error(
    `[desktop-updater] UPDATE INSTALL FAILED: still running ${app.getVersion()} after attempting ${marker.toVersion}; consecutive failures=${consecutiveFailures}. Automatic update checks are suppressed until the user retries.`,
  );
  void logMacUpdateDiagnostics("startup install verification failure");
}

// electron-updater can leave a same-version ZIP in `pending` after a restart or
// a failed install attempt. Clearing it prevents stale "ready" states.
async function clearPendingUpdateCache(reason: string): Promise<void> {
  const pendingDir = getPendingUpdateCacheDir();
  if (!pendingDir || updateDownloadInFlight) {
    return;
  }
  try {
    await FS.promises.rm(pendingDir, { recursive: true, force: true });
    console.info(`[desktop-updater] Cleared pending update cache (${reason}).`);
  } catch (error) {
    console.warn(
      `[desktop-updater] Failed to clear pending update cache (${reason}): ${formatErrorMessage(error)}`,
    );
  }
}

// Terminal updater events can arrive before downloadUpdate() settles; defer cache deletion
// until the updater has released its in-flight download bookkeeping.
function clearPendingUpdateCacheWhenSafe(reason: string): void {
  pendingUpdateCacheClearQueue.request(reason, updateDownloadInFlight, (safeReason) => {
    void clearPendingUpdateCache(safeReason);
  });
}

function clearUpdateBackgroundBlurTimer(): void {
  if (updateBackgroundBlurTimer) {
    clearTimeout(updateBackgroundBlurTimer);
    updateBackgroundBlurTimer = null;
  }
}

// Fail closed if electron-updater never emits a terminal check outcome.
function clearUpdateCheckTimeoutTimer(): void {
  if (updateCheckTimeoutTimer) {
    clearTimeout(updateCheckTimeoutTimer);
    updateCheckTimeoutTimer = null;
  }
}

function armUpdateCheckTimeout(reason: string): void {
  clearUpdateCheckTimeoutTimer();
  updateCheckTimeoutTimer = setTimeout(() => {
    updateCheckTimeoutTimer = null;
    if (updateState.status !== "checking") {
      return;
    }
    updateCheckInFlight = false;
    setUpdateState(
      reduceDesktopUpdateStateOnCheckFailure(
        updateState,
        "Timed out while checking for updates. Try again.",
        new Date().toISOString(),
      ),
    );
    console.error(`[desktop-updater] Update check timed out (${reason}).`);
  }, AUTO_UPDATE_CHECK_TIMEOUT_MS);
  updateCheckTimeoutTimer.unref();
}

function clearUpdateDownloadStallTimer(): void {
  if (updateDownloadStallTimer) {
    clearTimeout(updateDownloadStallTimer);
    updateDownloadStallTimer = null;
  }
}

function clearStalledDownloadCancellationSuppression(): void {
  stalledDownloadCancellationSuppressionsRemaining = 0;
  stalledDownloadCancellationSuppressionExpiresAtMs = 0;
}

function armStalledDownloadCancellationSuppression(): void {
  stalledDownloadCancellationSuppressionsRemaining += 1;
  stalledDownloadCancellationSuppressionExpiresAtMs =
    Date.now() + AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS;
}

function isStalledDownloadCancellationSuppressionArmed(): boolean {
  if (stalledDownloadCancellationSuppressionsRemaining <= 0) {
    return false;
  }
  if (Date.now() <= stalledDownloadCancellationSuppressionExpiresAtMs) {
    return true;
  }
  clearStalledDownloadCancellationSuppression();
  return false;
}

function consumeStalledDownloadCancellationSuppression(): void {
  stalledDownloadCancellationSuppressionsRemaining = Math.max(
    0,
    stalledDownloadCancellationSuppressionsRemaining - 1,
  );
  if (stalledDownloadCancellationSuppressionsRemaining === 0) {
    stalledDownloadCancellationSuppressionExpiresAtMs = 0;
  }
}

// Bounds a silent updater download while allowing slow downloads that keep making progress.
function armUpdateDownloadStallTimer(reason: string): void {
  clearUpdateDownloadStallTimer();
  updateDownloadStallTimer = setTimeout(() => {
    updateDownloadStallTimer = null;
    if (!updateDownloadInFlight || updateState.status !== "downloading") {
      return;
    }

    const error = new Error(getDownloadStallTimeoutMessage(AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS));
    console.error(`[desktop-updater] ${error.message} (${reason}).`);
    armStalledDownloadCancellationSuppression();
    rejectUpdateDownloadStall?.(error);
    updateDownloadCancellationToken?.cancel();
  }, AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS);
  updateDownloadStallTimer.unref();
}

function updateDownloadStallTimerOnProgress(progress: DownloadProgressSample): void {
  if (!updateDownloadInFlight) {
    return;
  }
  if (!hasDownloadProgressAdvanced(lastUpdateDownloadProgressSample, progress)) {
    return;
  }
  lastUpdateDownloadProgressSample = {
    percent: progress.percent ?? null,
    transferred: progress.transferred ?? null,
  };
  armUpdateDownloadStallTimer(`download progress ${Math.floor(progress.percent ?? 0)}%`);
}

function isDesktopAppForegrounded(): boolean {
  return BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.isFocused(),
  );
}

function markDesktopAppBackgrounded(): void {
  clearUpdateBackgroundBlurTimer();
  updateBackgroundBlurTimer = setTimeout(() => {
    updateBackgroundBlurTimer = null;
    if (isDesktopAppForegrounded()) {
      return;
    }
    updateBackgroundedAtMs = Date.now();
  }, 0);
}

function handleDesktopAppForegrounded(): void {
  clearUpdateBackgroundBlurTimer();
  clearUnreadNotificationBadge();
  const foregroundedAtMs = Date.now();
  const backgroundedAtMs = updateBackgroundedAtMs;
  updateBackgroundedAtMs = null;
  const shouldCheck = shouldCheckForUpdatesOnForeground({
    checkedAt: updateState.checkedAt,
    backgroundedAtMs,
    foregroundedAtMs,
    minBackgroundDurationMs: AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS,
    minIntervalMs: AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS,
  });
  if (!shouldCheck) {
    return;
  }
  void checkForUpdates("foreground");
}

async function checkForUpdates(reason: string): Promise<void> {
  if (isQuitting || !updaterConfigured || updateCheckInFlight) return;
  if (automaticUpdateActivitySuppressed) {
    if (!isExplicitUpdateCheckReason(reason)) {
      console.info(
        `[desktop-updater] Skipping automatic update check (${reason}) after an unverified install failure.`,
      );
      return;
    }
    automaticUpdateActivitySuppressed = false;
    console.info(
      `[desktop-updater] User requested update recovery (${reason}); automatic checks are enabled for this session.`,
    );
    scheduleUpdatePoll();
  }
  if (
    updateState.status === "checking" ||
    updateState.status === "downloading" ||
    updateState.status === "downloaded"
  ) {
    console.info(
      `[desktop-updater] Skipping update check (${reason}) while status=${updateState.status}.`,
    );
    return;
  }
  updateCheckInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnCheckStart(updateState, new Date().toISOString()));
  armUpdateCheckTimeout(reason);
  console.info(`[desktop-updater] Checking for updates (${reason})...`);

  try {
    await autoUpdater.checkForUpdates();
  } catch (error: unknown) {
    clearUpdateCheckTimeoutTimer();
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(
      reduceDesktopUpdateStateOnCheckFailure(updateState, message, new Date().toISOString()),
    );
    console.error(`[desktop-updater] Failed to check for updates: ${message}`);
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAvailableUpdate(): Promise<{
  accepted: boolean;
  completed: boolean;
}> {
  if (
    updaterConfigured &&
    updateState.status === "error" &&
    updateState.errorContext === "install" &&
    updateState.downloadedVersion === null &&
    updateState.availableVersion !== null
  ) {
    await checkForUpdates("renderer");
    return { accepted: true, completed: false };
  }
  if (!updaterConfigured || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false };
  }
  if (!isKnownUpdateVersionNewer(updateState.availableVersion)) {
    await clearPendingUpdateCache("available version is not newer than current app");
    setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
    console.info(
      `[desktop-updater] Ignoring stale available update ${updateState.availableVersion ?? "unknown"} for current ${app.getVersion()}.`,
    );
    return { accepted: false, completed: false };
  }
  updateDownloadInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnDownloadStart(updateState));
  // Keep existing cancellation suppressions across immediate retries; the old
  // updater cancellation can arrive after a new download has already started.
  lastUpdateDownloadProgressSample = null;
  const cancellationToken = new CancellationToken();
  updateDownloadCancellationToken = cancellationToken;
  const downloadStalled = new Promise<never>((_, reject) => {
    rejectUpdateDownloadStall = reject;
  });
  armUpdateDownloadStallTimer("download start");
  console.info("[desktop-updater] Downloading update...");

  // Track electron-updater's own download promise separately from the stall race.
  // When the stall timer wins the race it cancels this promise, but the updater
  // keeps its internal download promise set until that cancellation unwinds. We
  // observe its settlement here (so a late rejection can't surface as an unhandled
  // rejection) and wait on it before releasing the in-flight flag below.
  let updaterDownloadSettled = false;
  const updaterDownloadPromise = autoUpdater.downloadUpdate(cancellationToken);
  const updaterDownloadSettledPromise = updaterDownloadPromise.then(
    () => {
      updaterDownloadSettled = true;
    },
    () => {
      updaterDownloadSettled = true;
    },
  );

  try {
    await Promise.race([updaterDownloadPromise, downloadStalled]);
    return { accepted: true, completed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(updateState, message));
    console.error(`[desktop-updater] Failed to download update: ${message}`);
    return { accepted: true, completed: false };
  } finally {
    clearUpdateDownloadStallTimer();
    // Hold the in-flight flag until the updater download actually settles, so an
    // immediate retry can't grab the still-cancelling promise (which would reject
    // as "cancelled"). Bounded so a stuck updater promise can't wedge updates.
    if (!updaterDownloadSettled) {
      await Promise.race([
        updaterDownloadSettledPromise,
        new Promise<void>((resolve) => {
          setTimeout(resolve, AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS).unref();
        }),
      ]);
    }
    if (updateDownloadCancellationToken === cancellationToken) {
      updateDownloadCancellationToken = null;
    }
    rejectUpdateDownloadStall = null;
    lastUpdateDownloadProgressSample = null;
    updateDownloadInFlight = false;
    const pendingCacheClearReason = pendingUpdateCacheClearQueue.consumeAfterDownload();
    if (pendingCacheClearReason) {
      await clearPendingUpdateCache(pendingCacheClearReason);
    }
  }
}

// Starts the automatic prepare step after a successful update check; install
// stays user-controlled so active agent work is not interrupted by a restart.
function prepareAvailableUpdateInBackground(reason: string): void {
  if (updateDownloadInFlight || updateState.status !== "available") {
    return;
  }
  void downloadAvailableUpdate()
    .then((result) => {
      if (result.accepted && result.completed) {
        console.info(`[desktop-updater] Background update download completed (${reason}).`);
      }
    })
    .catch((error) => {
      console.error(
        `[desktop-updater] Background update download crashed (${reason}): ${formatErrorMessage(error)}`,
      );
    });
}

async function installDownloadedUpdate(): Promise<{
  accepted: boolean;
  completed: boolean;
}> {
  if (isQuitting || !updaterConfigured || updateState.status !== "downloaded") {
    return { accepted: false, completed: false };
  }
  const versionToInstall = updateState.downloadedVersion ?? updateState.availableVersion;
  if (!versionToInstall || !isKnownUpdateVersionNewer(versionToInstall)) {
    await clearPendingUpdateCache("downloaded version is not newer than current app");
    setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
    console.info(
      `[desktop-updater] Ignoring stale downloaded update ${versionToInstall ?? "unknown"} for current ${app.getVersion()}.`,
    );
    return { accepted: false, completed: false };
  }

  const markerPath = getUpdateInstallMarkerPath();
  const existingMarkerResult = readInstallMarker(markerPath);
  const existingMarker =
    existingMarkerResult.status === "valid" &&
    existingMarkerResult.marker.toVersion === versionToInstall
      ? existingMarkerResult.marker
      : null;
  const marker = createUpdateInstallMarker({
    fromVersion: app.getVersion(),
    toVersion: versionToInstall,
    requestedAt: new Date().toISOString(),
    consecutiveFailures: existingMarker?.consecutiveFailures ?? 0,
    lastFailureAt: existingMarker?.lastFailureAt ?? null,
  });
  let markerWritten = false;
  try {
    writeInstallMarker(markerPath, marker);
    markerWritten = true;
    isQuitting = true;
    isUpdaterInstallPreparing = true;
    clearUpdatePollTimer();
    await stopBackendAndWaitForExit();
    await logMacUpdateDiagnostics("before install handoff");
    isUpdaterQuitAndInstallInFlight = true;
    autoUpdater.quitAndInstall();
    armInstallWatchdog();
    return { accepted: true, completed: false };
  } catch (error: unknown) {
    const message = formatErrorMessage(error);
    isUpdaterInstallPreparing = false;
    isUpdaterQuitAndInstallInFlight = false;
    isQuitting = false;
    const consecutiveFailures = markerWritten
      ? recordInstallMarkerFailure(new Date().toISOString())
      : updateState.installFailureCount;
    startBackend();
    scheduleUpdatePoll();
    setUpdateState({
      ...reduceDesktopUpdateStateOnInstallFailure(updateState, message),
      installFailureCount: consecutiveFailures,
    });
    console.error(`[desktop-updater] Failed to install update: ${message}`);
    return { accepted: true, completed: false };
  }
}

function configureAutoUpdater(): void {
  const appUpdateYml = readAppUpdateYml();
  configuredUpdaterCacheDirName = resolveElectronUpdaterCacheDirName(appUpdateYml, app.getName());
  const enabled = shouldEnableAutoUpdates();
  setUpdateState({
    ...createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo),
    enabled,
    status: enabled ? "idle" : "disabled",
  });
  processInstallMarkerOnStartup();
  if (!enabled) {
    configuredGitHubUpdateSource = null;
    configuredUpdaterCacheDirName = null;
    return;
  }
  updaterConfigured = true;
  hardenElectronUpdater({ BaseUpdater }, autoUpdater);
  configuredGitHubUpdateSource = resolveGitHubUpdateSource(appUpdateYml);
  if (configuredGitHubUpdateSource !== null) {
    // The updater itself uses app-update.yml; this URL is only the human fallback.
    setUpdateState({ releaseUrl: buildGitHubReleasesPageUrl(configuredGitHubUpdateSource) });
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // The dedicated channel keeps the permanent compatibility release on the
  // default feed while DJL versions advance independently.
  autoUpdater.channel = SYNARA_DESKTOP_UPDATE_CHANNEL;
  autoUpdater.allowPrerelease = DESKTOP_UPDATE_ALLOW_PRERELEASE;
  autoUpdater.allowDowngrade = false;
  // The packaged app-update.yml owns the production feed. It may use either
  // GitHub Releases or DJL's HTTPS generic download feed.
  // macOS release builds repack and validate the Squirrel update zip, then omit
  // the stale zip blockmap so ShipIt always installs the exact signed payload.
  autoUpdater.disableDifferentialDownload =
    process.platform === "darwin" || isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  // electron-updater has no working idle timeout on macOS (its socket timeout is
  // wired to a `socket` event Electron's net.request never emits) and never
  // resumes from a byte offset, so a stalled CDN transfer hangs for minutes
  // until TCP recovers on its own. installResumableUpdateDownloader replaces the
  // download transfer with a stall-aware, resumable one and installs a real idle
  // timeout, so an intermittent stall becomes a brief reconnect-and-resume
  // instead of a multi-minute freeze. Independent of the zip-validation fix.
  if (!installResumableUpdateDownloader(autoUpdater as unknown as ResumableDownloaderTarget)) {
    console.warn(
      "[desktop-updater] Could not install resumable update downloader; falling back to default transfer.",
    );
  }
  let lastLoggedDownloadMilestone = -1;

  if (isArm64HostRunningIntelBuild(desktopRuntimeInfo)) {
    console.info(
      "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
    );
  }

  autoUpdater.on("checking-for-update", () => {
    console.info("[desktop-updater] Looking for updates...");
  });
  autoUpdater.on("update-available", (info) => {
    clearUpdateCheckTimeoutTimer();
    if (!isUpdateVersionNewer(app.getVersion(), info.version)) {
      void clearPendingUpdateCache("available version is not newer than current app");
      setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
      lastLoggedDownloadMilestone = -1;
      console.info(
        `[desktop-updater] Ignoring non-newer update ${info.version}; current version is ${app.getVersion()}.`,
      );
      return;
    }
    setUpdateState(
      reduceDesktopUpdateStateOnUpdateAvailable(
        updateState,
        info.version,
        new Date().toISOString(),
      ),
    );
    lastLoggedDownloadMilestone = -1;
    console.info(`[desktop-updater] Update available: ${info.version}`);
    prepareAvailableUpdateInBackground(`available ${info.version}`);
  });
  autoUpdater.on("update-not-available", () => {
    clearUpdateCheckTimeoutTimer();
    void clearPendingUpdateCache("no newer update available");
    setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
    lastLoggedDownloadMilestone = -1;
    console.info("[desktop-updater] No updates available.");
  });
  autoUpdater.on("error", (error) => {
    clearUpdateCheckTimeoutTimer();
    const message = formatErrorMessage(error);
    const errorContext = resolveUpdaterErrorContext();
    if (
      isExpectedStalledDownloadCancellationError({
        suppressionArmed: isStalledDownloadCancellationSuppressionArmed(),
        errorContext,
        message,
      })
    ) {
      consumeStalledDownloadCancellationSuppression();
      console.warn("[desktop-updater] Ignored expected cancellation after stalled download.");
      return;
    }
    clearUpdaterInstallInFlightAfterError();
    const installFailureCount =
      errorContext === "install"
        ? recordInstallMarkerFailure(new Date().toISOString())
        : updateState.installFailureCount;
    if (errorContext === "install") {
      startBackend();
      scheduleUpdatePoll();
    }
    if (!updateCheckInFlight && !updateDownloadInFlight) {
      setUpdateState({
        status: "error",
        message,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext,
        canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
        installFailureCount,
      });
    }
    console.error(`[desktop-updater] Updater error: ${message}`);
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent);
    updateDownloadStallTimerOnProgress(progress);
    if (
      shouldBroadcastDownloadProgress(updateState, progress.percent) ||
      updateState.message !== null
    ) {
      setUpdateState(reduceDesktopUpdateStateOnDownloadProgress(updateState, progress.percent));
    }
    const milestone = percent - (percent % 10);
    if (milestone > lastLoggedDownloadMilestone) {
      lastLoggedDownloadMilestone = milestone;
      console.info(`[desktop-updater] Download progress: ${percent}%`);
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    clearUpdateDownloadStallTimer();
    if (!isUpdateVersionNewer(app.getVersion(), info.version)) {
      clearPendingUpdateCacheWhenSafe("downloaded version is not newer than current app");
      setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
      console.info(
        `[desktop-updater] Ignoring downloaded non-newer update ${info.version}; current version is ${app.getVersion()}.`,
      );
      return;
    }
    setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, info.version));
    console.info(`[desktop-updater] Update downloaded: ${info.version}`);
  });

  clearUpdatePollTimer();

  if (automaticUpdateActivitySuppressed) {
    console.info(
      "[desktop-updater] Startup and periodic update checks suppressed after failed install verification.",
    );
    return;
  }

  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref();

  scheduleUpdatePoll();
}
// Builds process-local Node args so provider/tool children do not inherit Synara's heap guard.
function backendNodeArgs(): string[] {
  const configuredMaxOldSpaceMb =
    BACKEND_MAX_OLD_SPACE_ENV_KEYS.map((key) => process.env[key]).find(
      (value) => value !== undefined && value.trim().length > 0,
    ) ?? null;
  return resolveBackendNodeArgs({
    configuredMaxOldSpaceMb,
    existingNodeOptions: process.env.NODE_OPTIONS,
    totalMemoryBytes: OS.totalmem(),
  });
}

function backendEnv(): NodeJS.ProcessEnv {
  const servedStaticRoot = resolveServedStaticRoot();
  const migrationSources = [
    resolveDjlHome({}, OS.homedir()),
    ...(isDevelopment ? [Path.join(ROOT_DIR, ".djl", "electron-dev")] : []),
  ].filter((candidate) => Path.resolve(candidate) !== Path.resolve(BASE_DIR));
  return {
    ...process.env,
    // Point the backend's HTTP static route at the same swap-immune snapshot the
    // synara:// protocol serves, so both surfaces survive app.asar being replaced.
    ...(servedStaticRoot?.snapshotted ? { SYNARA_STATIC_DIR: servedStaticRoot.dir } : {}),
    SYNARA_MODE: "desktop",
    SYNARA_NO_BROWSER: "1",
    SYNARA_PORT: String(backendPort),
    DJL_SHARED_STATE: "1",
    DJL_SKIP_STATE_LOCK: "1",
    DJL_MIGRATION_SOURCES: migrationSources.join(Path.delimiter),
    DJL_HOME: BASE_DIR,
    SYNARA_HOME: BASE_DIR,
    SYNARA_AUTH_TOKEN: backendAuthToken,
    ...(app.isPackaged
      ? { DJL_OPENCODE_BINARY_PATH: resolveBundledOpenCodePath(process.resourcesPath) }
      : {}),
    [SYNARA_BROWSER_USE_PIPE_ENV]: SYNARA_BROWSER_USE_PIPE_PATH,
  };
}

function scheduleBackendRestart(reason: string): void {
  if (isQuitting || restartTimer) return;

  const delayMs = Math.min(500 * 2 ** restartAttempt, 10_000);
  restartAttempt += 1;
  safeConsoleError(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);

  restartTimer = setTimeout(() => {
    restartTimer = null;
    void restartBackendAfterCrash(reason);
  }, delayMs);
}

async function restartBackendAfterCrash(reason: string): Promise<void> {
  if (isQuitting || backendProcess) {
    return;
  }

  cancelBackendReadinessWait();
  try {
    await reserveBackendEndpoint("backend restart");
  } catch (error) {
    scheduleBackendRestart(
      `failed to reserve restart port after ${reason}: ${formatErrorMessage(error)}`,
    );
    return;
  }

  startBackend();
  ensureInitialBackendWindowOpen(backendHttpUrl);
}

function startBackend(): void {
  if (isQuitting || backendProcess) return;

  const backendEntry = resolveBackendEntry();
  if (!FS.existsSync(backendEntry)) {
    scheduleBackendRestart(`missing server entry at ${backendEntry}`);
    return;
  }

  const captureBackendLogs = app.isPackaged && backendLogSink !== null;
  const child = ChildProcess.spawn(process.execPath, [...backendNodeArgs(), backendEntry], {
    cwd: resolveBackendCwd(),
    // In Electron main, process.execPath points to the Electron binary.
    // Run the child in Node mode so this backend process does not become a GUI app instance.
    env: {
      ...backendEnv(),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: captureBackendLogs ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const listeningDetector = new ServerListeningDetector();
  backendListeningDetector = listeningDetector;
  backendProcess = child;
  let backendSessionClosed = false;
  const closeBackendSession = (details: string) => {
    if (backendSessionClosed) return;
    backendSessionClosed = true;
    writeBackendSessionBoundary("END", details);
  };
  writeBackendSessionBoundary(
    "START",
    `pid=${child.pid ?? "unknown"} port=${backendPort} cwd=${resolveBackendCwd()}`,
  );
  captureBackendOutput(child);

  child.once("spawn", () => {
    restartAttempt = 0;
  });

  child.on("error", (error) => {
    if (backendListeningDetector === listeningDetector) {
      listeningDetector.fail(error);
      backendListeningDetector = null;
    }
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
    scheduleBackendRestart(error.message);
  });

  child.on("exit", (code, signal) => {
    if (backendListeningDetector === listeningDetector) {
      listeningDetector.fail(
        new Error(
          `backend exited before logging readiness (code=${code ?? "null"} signal=${signal ?? "null"})`,
        ),
      );
      backendListeningDetector = null;
    }
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(
      `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    if (isQuitting) return;
    const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    scheduleBackendRestart(reason);
  });
}

function stopBackend(): void {
  cancelBackendReadinessWait();
  backendListeningDetector = null;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, BACKEND_FORCE_KILL_DELAY_MS).unref();
  }
}

async function stopBackendAndWaitForExit(timeoutMs = BACKEND_SHUTDOWN_TIMEOUT_MS): Promise<void> {
  cancelBackendReadinessWait();
  backendListeningDetector = null;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  const backendChild = child;
  if (backendChild.exitCode !== null || backendChild.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function settle(): void {
      if (settled) return;
      settled = true;
      backendChild.off("exit", onExit);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (exitTimeoutTimer) {
        clearTimeout(exitTimeoutTimer);
      }
      resolve();
    }

    function onExit(): void {
      settle();
    }

    backendChild.once("exit", onExit);
    backendChild.kill("SIGTERM");

    const forceKillDelayMs = Math.min(BACKEND_FORCE_KILL_DELAY_MS, Math.max(1, timeoutMs - 500));
    forceKillTimer = setTimeout(() => {
      if (backendChild.exitCode === null && backendChild.signalCode === null) {
        backendChild.kill("SIGKILL");
      }
    }, forceKillDelayMs);
    forceKillTimer.unref();

    exitTimeoutTimer = setTimeout(() => {
      settle();
    }, timeoutMs);
    exitTimeoutTimer.unref();
  });
}

function readRemoteGatewayPackageMetadata(): RemoteGatewayPackageMetadata | null {
  for (const candidate of [
    Path.join(app.getAppPath(), "package.json"),
    Path.join(ROOT_DIR, "apps", "desktop", "package.json"),
  ]) {
    try {
      const parsed = JSON.parse(FS.readFileSync(candidate, "utf8"));
      if (parsed && typeof parsed === "object") return parsed as RemoteGatewayPackageMetadata;
    } catch {
      // Development and unpacked builds may not have both package paths.
    }
  }
  return null;
}

function remoteGatewayPreferencesPath(): string {
  return Path.join(app.getPath("userData"), REMOTE_GATEWAY_PREFERENCES_FILE);
}

function readRemoteGatewayEnabled(): boolean {
  try {
    const parsed = JSON.parse(FS.readFileSync(remoteGatewayPreferencesPath(), "utf8"));
    return parsed?.enabled !== false;
  } catch {
    return true;
  }
}

function writeRemoteGatewayEnabled(enabled: boolean): void {
  const target = remoteGatewayPreferencesPath();
  FS.mkdirSync(Path.dirname(target), { recursive: true });
  FS.writeFileSync(target, JSON.stringify({ enabled }, null, 2), { mode: 0o600 });
  try {
    FS.chmodSync(target, 0o600);
  } catch {
    // Best effort for filesystems without POSIX permissions.
  }
}

function emitRemoteGatewayState(): void {
  const target = mainWindow?.webContents;
  if (!target || target.isDestroyed()) return;
  target.send(REMOTE_GATEWAY_IPC_CHANNELS.state, remoteGatewayState);
}

function setRemoteGatewayState(state: DesktopRemoteGatewayState): void {
  remoteGatewayState = state;
  emitRemoteGatewayState();
}

function initializeRemoteGatewayConfiguration(): void {
  remoteGatewayEnabled = readRemoteGatewayEnabled();
  remoteGatewayRelayUrl = resolveRemoteRelayUrl(process.env, readRemoteGatewayPackageMetadata());
  remoteGatewayState = createInitialRemoteGatewayState({
    enabled: remoteGatewayEnabled,
    relayUrl: remoteGatewayRelayUrl,
  });
}

function clearRemoteGatewayRestartTimer(): void {
  if (!remoteGatewayRestartTimer) return;
  clearTimeout(remoteGatewayRestartTimer);
  remoteGatewayRestartTimer = null;
}

function scheduleRemoteGatewayRestart(): void {
  if (remoteGatewayRestartTimer || isQuitting || !remoteGatewayEnabled || !remoteGatewayRelayUrl) {
    return;
  }
  const delay = Math.min(
    REMOTE_GATEWAY_RESTART_MAX_DELAY_MS,
    REMOTE_GATEWAY_RESTART_BASE_DELAY_MS * 2 ** remoteGatewayRestartAttempt,
  );
  remoteGatewayRestartAttempt += 1;
  remoteGatewayRestartTimer = setTimeout(() => {
    remoteGatewayRestartTimer = null;
    startRemoteGateway();
  }, delay);
  remoteGatewayRestartTimer.unref();
}

function sendRemoteUpdateResult(child: ChildProcess.ChildProcess, requestId: string): void {
  void checkForUpdates("remote").then(
    () => child.send?.({ type: "desktop-update-result", requestId, result: updateState }),
    (error: unknown) =>
      child.send?.({
        type: "desktop-update-result",
        requestId,
        error: formatErrorMessage(error),
      }),
  );
}

function startRemoteGateway(): void {
  if (remoteGatewayProcess || isQuitting) return;
  if (!remoteGatewayEnabled || !remoteGatewayRelayUrl) {
    setRemoteGatewayState(
      createInitialRemoteGatewayState({
        enabled: remoteGatewayEnabled,
        relayUrl: remoteGatewayRelayUrl,
      }),
    );
    return;
  }

  clearRemoteGatewayRestartTimer();
  setRemoteGatewayState({
    ...createInitialRemoteGatewayState({ enabled: true, relayUrl: remoteGatewayRelayUrl }),
    status: "starting",
  });
  const childEntry = Path.join(__dirname, "remoteGatewayChild.js");
  const child = ChildProcess.spawn(process.execPath, [childEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DJL_RELAY: remoteGatewayRelayUrl,
      DJL_DEVICE_STATE_DIR: Path.join(BASE_DIR, "remote"),
      // The phone bridge talks only to this Electron process's authenticated
      // loopback backend. It never attaches to Codex Desktop's global IPC bus
      // or starts a separate app-server with unrelated chat history.
      DJL_ELECTRON_BACKEND_ENDPOINT: backendWsUrl,
      // Development diagnostics contain only transport stage/method metadata;
      // keep them enabled locally so remote projection issues are observable
      // without logging chat content, pairing codes, or encryption material.
      DJL_ELECTRON_BRIDGE_DIAGNOSTICS: isDevelopment
        ? "1"
        : process.env.DJL_ELECTRON_BRIDGE_DIAGNOSTICS || "0",
      DJL_DESKTOP_IPC_ENABLED: "0",
      DJL_DESKTOP_IPC_LIVE_SYNC: "0",
      // Electron's read model is already an isolated per-DJL namespace, so a
      // second history filter would incorrectly hide chats created on Electron.
      DJL_REMOTE_THREAD_SCOPE_ENABLED: "0",
      DJL_REFRESH_ENABLED: "0",
      DJL_KEEP_MAC_AWAKE: "0",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  remoteGatewayProcess = child;

  child.stdout?.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line) console.info(`[desktop-remote] ${line}`);
  });
  child.stderr?.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line) console.warn(`[desktop-remote] ${line}`);
  });
  child.on("message", (message: unknown) => {
    if (message && typeof message === "object") {
      const record = message as Record<string, unknown>;
      if (record.type === "desktop-update-request" && typeof record.requestId === "string") {
        sendRemoteUpdateResult(child, record.requestId);
        return;
      }
    }
    const nextState = reduceRemoteGatewayChildMessage(remoteGatewayState, message);
    if (nextState !== remoteGatewayState) {
      setRemoteGatewayState(nextState);
      if (nextState.status === "ready" || nextState.status === "connected") {
        remoteGatewayRestartAttempt = 0;
      }
    }
  });
  child.on("error", (error) => {
    if (child !== remoteGatewayProcess) return;
    setRemoteGatewayState({
      ...remoteGatewayState,
      status: "error",
      message: error.message,
    });
  });
  child.on("exit", (code, signal) => {
    if (child !== remoteGatewayProcess) return;
    remoteGatewayProcess = null;
    const intentional = remoteGatewayIntentionalStop;
    remoteGatewayIntentionalStop = false;
    if (intentional || isQuitting || !remoteGatewayEnabled) return;
    setRemoteGatewayState({
      ...remoteGatewayState,
      status: code === 0 ? "offline" : "error",
      phoneFingerprint: null,
      phoneDeviceKind: null,
      message:
        code === 0
          ? desktopT("remote.stoppedUnexpectedly")
          : desktopT("remote.gatewayExited", {
              reason: signal ?? code ?? desktopT("remote.unknownReason"),
            }),
    });
    scheduleRemoteGatewayRestart();
  });
}

async function waitForRemoteGatewayExit(
  child: ChildProcess.ChildProcess,
  timeoutMs = REMOTE_GATEWAY_STOP_TIMEOUT_MS,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (timer) clearTimeout(timer);
      child.removeListener("exit", settle);
      resolve();
    };
    child.once("exit", settle);
    timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      settle();
    }, timeoutMs);
    timer.unref();
  });
}

async function stopRemoteGateway(): Promise<void> {
  clearRemoteGatewayRestartTimer();
  const child = remoteGatewayProcess;
  if (!child) return;
  remoteGatewayIntentionalStop = true;
  child.kill("SIGTERM");
  await waitForRemoteGatewayExit(child);
  if (remoteGatewayProcess === child) remoteGatewayProcess = null;
  remoteGatewayIntentionalStop = false;
}

async function restartRemoteGateway(): Promise<DesktopRemoteGatewayState> {
  await stopRemoteGateway();
  startRemoteGateway();
  return remoteGatewayState;
}

async function setRemoteGatewayEnabled(enabled: boolean): Promise<DesktopRemoteGatewayState> {
  remoteGatewayEnabled = enabled;
  writeRemoteGatewayEnabled(enabled);
  if (!enabled) {
    await stopRemoteGateway();
    setRemoteGatewayState(
      createInitialRemoteGatewayState({ enabled: false, relayUrl: remoteGatewayRelayUrl }),
    );
    return remoteGatewayState;
  }
  remoteGatewayState = createInitialRemoteGatewayState({
    enabled: true,
    relayUrl: remoteGatewayRelayUrl,
  });
  startRemoteGateway();
  return remoteGatewayState;
}

async function resetRemoteGatewayPairing(): Promise<DesktopRemoteGatewayState> {
  const child = remoteGatewayProcess;
  if (!child || !child.connected) return restartRemoteGateway();
  remoteGatewayIntentionalStop = true;
  const resetResult = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener("message", onMessage);
      reject(new Error("Timed out while clearing the trusted phone."));
    }, REMOTE_GATEWAY_STOP_TIMEOUT_MS);
    timeout.unref();
    const onMessage = (message: unknown): void => {
      if (!message || typeof message !== "object") return;
      const record = message as Record<string, unknown>;
      if (record.type !== "reset-complete" && record.type !== "reset-error") return;
      clearTimeout(timeout);
      child.removeListener("message", onMessage);
      if (record.type === "reset-error") {
        reject(
          new Error(typeof record.message === "string" ? record.message : "Pairing reset failed."),
        );
      } else {
        resolve();
      }
    };
    child.on("message", onMessage);
    child.send?.({ type: "reset-pairing" });
  });
  try {
    await resetResult;
    await waitForRemoteGatewayExit(child);
  } finally {
    if (remoteGatewayProcess === child) remoteGatewayProcess = null;
    remoteGatewayIntentionalStop = false;
  }
  startRemoteGateway();
  return remoteGatewayState;
}

async function disposeBrowserUsePipeServerForShutdown(reason: string): Promise<void> {
  const pipeServer = browserUsePipeServer;
  browserUsePipeServer = null;
  if (!pipeServer) return;

  try {
    await pipeServer.dispose();
  } catch (error: unknown) {
    const message = formatErrorMessage(error);
    writeDesktopLogHeader(`${reason} browser-use pipe dispose failed message=${message}`);
    console.warn(`[desktop] Failed to dispose browser-use pipe during ${reason}: ${message}`);
  }
}

// Keeps Electron alive long enough for backend finalizers to reap provider child processes.
async function shutdownDesktopRuntime(reason: string): Promise<void> {
  if (desktopShutdownPromise) {
    return desktopShutdownPromise;
  }

  isQuitting = true;
  desktopShutdownPromise = (async () => {
    writeDesktopLogHeader(`${reason} shutdown start`);
    try {
      clearUpdateBackgroundBlurTimer();
      clearUpdateCheckTimeoutTimer();
      clearUpdatePollTimer();
      cancelBackendReadinessWait();
      await disposeBrowserUsePipeServerForShutdown(reason);
      await stopRemoteGateway();
      await stopBackendAndWaitForExit();
      await sharedStateLock?.release();
      sharedStateLock = null;
      browserManager.dispose();
      restoreStdIoCapture?.();
      writeDesktopLogHeader(`${reason} shutdown complete`);
    } finally {
      desktopShutdownComplete = true;
    }
  })();

  return desktopShutdownPromise;
}

function requestGracefulAppQuit(reason: string): void {
  if (isUpdaterInstallPreparing) {
    writeDesktopLogHeader(`${reason} waiting for updater quit-and-install`);
    return;
  }

  void shutdownDesktopRuntime(reason)
    .catch((error: unknown) => {
      const message = formatErrorMessage(error);
      writeDesktopLogHeader(`${reason} shutdown failed message=${message}`);
      console.warn(`[desktop] Shutdown failed during ${reason}: ${message}`);
    })
    .finally(() => {
      app.quit();
    });
}

function getPreferredSystemLanguageCandidates(): readonly string[] {
  const preferred = app.getPreferredSystemLanguages();
  const locale = app.getLocale();
  return locale && !preferred.includes(locale) ? [...preferred, locale] : preferred;
}

function registerIpcHandlers(): void {
  const storageSnapshotPath = resolveDjlStorageSnapshotReadPath(app.getPath("userData"));
  const localePreferencePath = resolveDesktopLocalePreferencePath(app.getPath("userData"));

  ipcMain.removeAllListeners(DESKTOP_LOCALE_IPC_CHANNELS.preferredSystemLanguages);
  ipcMain.on(DESKTOP_LOCALE_IPC_CHANNELS.preferredSystemLanguages, (event: IpcMainEvent) => {
    event.returnValue = getPreferredSystemLanguageCandidates();
  });

  ipcMain.removeHandler(DESKTOP_LOCALE_IPC_CHANNELS.applyPreference);
  ipcMain.handle(DESKTOP_LOCALE_IPC_CHANNELS.applyPreference, async (_event, rawPreference) => {
    const preference = parseLocalePreferenceForIpc(rawPreference);
    writeDesktopLocalePreference(localePreferencePath, preference);
    const locale = await getDesktopI18n().applyPreference(
      preference,
      getPreferredSystemLanguageCandidates(),
    );
    configureApplicationMenu();
    return locale;
  });

  ipcMain.removeAllListeners(STORAGE_MIGRATION_IPC_CHANNELS.read);
  ipcMain.on(STORAGE_MIGRATION_IPC_CHANNELS.read, (event: IpcMainEvent) => {
    event.returnValue = readSynaraStorageSnapshot(storageSnapshotPath);
  });

  ipcMain.removeHandler(STORAGE_MIGRATION_IPC_CHANNELS.acknowledge);
  ipcMain.handle(STORAGE_MIGRATION_IPC_CHANNELS.acknowledge, async () => {
    await acknowledgeSynaraStorageSnapshot(storageSnapshotPath);
  });

  ipcMain.removeAllListeners(DESKTOP_WS_URL_CHANNEL);
  ipcMain.on(DESKTOP_WS_URL_CHANNEL, (event: IpcMainEvent) => {
    // The backend port is reserved at runtime, so preload asks main for the
    // live URL instead of trusting build-time or inherited renderer env.
    event.returnValue =
      normalizeDesktopWsUrl(backendWsUrl) ?? resolveDesktopWsUrlFromEnv(process.env);
  });

  ipcMain.removeAllListeners(DESKTOP_BUILD_INFO_CHANNEL);
  ipcMain.on(DESKTOP_BUILD_INFO_CHANNEL, (event: IpcMainEvent) => {
    event.returnValue = {
      version: resolveDiagnosticVersion(),
      commit: resolveAboutCommitHash(),
    };
  });

  ipcMain.removeHandler(REMOTE_GATEWAY_IPC_CHANNELS.getState);
  ipcMain.handle(REMOTE_GATEWAY_IPC_CHANNELS.getState, () => remoteGatewayState);

  ipcMain.removeHandler(REMOTE_GATEWAY_IPC_CHANNELS.setEnabled);
  ipcMain.handle(REMOTE_GATEWAY_IPC_CHANNELS.setEnabled, async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Remote enabled state must be boolean.");
    return setRemoteGatewayEnabled(enabled);
  });

  ipcMain.removeHandler(REMOTE_GATEWAY_IPC_CHANNELS.refreshPairing);
  ipcMain.handle(REMOTE_GATEWAY_IPC_CHANNELS.refreshPairing, async () => {
    if (!remoteGatewayEnabled) return remoteGatewayState;
    return restartRemoteGateway();
  });

  ipcMain.removeHandler(REMOTE_GATEWAY_IPC_CHANNELS.resetPairing);
  ipcMain.handle(REMOTE_GATEWAY_IPC_CHANNELS.resetPairing, async () => {
    if (!remoteGatewayEnabled) return remoteGatewayState;
    return resetRemoteGatewayPairing();
  });

  ipcMain.removeAllListeners(ZOOM_FACTOR_CHANNEL);
  ipcMain.on(ZOOM_FACTOR_CHANNEL, (event: IpcMainEvent) => {
    event.returnValue = event.sender.getZoomFactor();
  });

  ipcMain.removeHandler(PICK_FOLDER_CHANNEL);
  ipcMain.handle(PICK_FOLDER_CHANNEL, async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.removeHandler(SAVE_FILE_CHANNEL);
  ipcMain.handle(SAVE_FILE_CHANNEL, async (_event, input: unknown) => {
    if (!isSaveFileInput(input)) {
      throw new Error("Invalid save file input.");
    }

    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options = {
      defaultPath: input.defaultFilename,
      ...(input.filters ? { filters: input.filters } : {}),
    };
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return null;
    }

    await FS.promises.writeFile(result.filePath, input.contents, "utf8");
    return result.filePath;
  });

  ipcMain.removeHandler(CONFIRM_CHANNEL);
  ipcMain.handle(CONFIRM_CHANNEL, async (_event, message: unknown) => {
    if (typeof message !== "string") {
      return false;
    }

    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    return showDesktopConfirmDialog(message, owner);
  });

  ipcMain.removeHandler(SET_THEME_CHANNEL);
  ipcMain.handle(SET_THEME_CHANNEL, async (_event, rawTheme: unknown) => {
    const theme = getSafeTheme(rawTheme);
    if (!theme) {
      return;
    }

    nativeTheme.themeSource = theme;
  });

  ipcMain.removeHandler(CONTEXT_MENU_CHANNEL);
  ipcMain.handle(
    CONTEXT_MENU_CHANNEL,
    async (_event, items: ContextMenuItem[], position?: { x: number; y: number }) => {
      const normalizedItems = items
        .filter((item) => typeof item.id === "string" && typeof item.label === "string")
        .map((item) => ({
          id: item.id,
          label: item.label,
          separatorBefore: item.separatorBefore === true,
          destructive: item.destructive === true,
        }));
      if (normalizedItems.length === 0) {
        return null;
      }

      const popupPosition =
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        position.x >= 0 &&
        position.y >= 0
          ? {
              x: Math.floor(position.x),
              y: Math.floor(position.y),
            }
          : null;

      const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!window) return null;

      return new Promise<string | null>((resolve) => {
        const template: MenuItemConstructorOptions[] = [];
        let hasInsertedDestructiveSeparator = false;
        for (const item of normalizedItems) {
          const shouldInsertSeparator =
            item.separatorBefore ||
            (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0);
          if (shouldInsertSeparator && template.length > 0) {
            template.push({ type: "separator" });
          }
          if (item.destructive) {
            hasInsertedDestructiveSeparator = true;
          }
          const itemOption: MenuItemConstructorOptions = {
            label: item.label,
            click: () => resolve(item.id),
          };
          if (item.destructive) {
            const destructiveIcon = getDestructiveMenuIcon();
            if (destructiveIcon) {
              itemOption.icon = destructiveIcon;
            }
          }
          template.push(itemOption);
        }

        const menu = Menu.buildFromTemplate(template);
        menu.popup({
          window,
          ...popupPosition,
          callback: () => resolve(null),
        });
      });
    },
  );

  ipcMain.removeHandler(OPEN_EXTERNAL_CHANNEL);
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, rawUrl: unknown) => {
    const externalUrl = getSafeExternalUrl(rawUrl);
    if (!externalUrl) {
      return false;
    }

    try {
      await shell.openExternal(externalUrl);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.removeHandler(PRINT_PDF_CHANNEL);
  ipcMain.handle(PRINT_PDF_CHANNEL, async (_event, rawUrl: unknown) => {
    const previewUrl = getSafeDocumentPreviewUrl(rawUrl);
    if (!previewUrl) {
      throw new Error("Invalid document preview URL.");
    }

    const printWindow = new BrowserWindow({
      show: false,
      ...(mainWindow ? { parent: mainWindow } : {}),
      title: desktopT("dialog.printDocument"),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    try {
      await printWindow.loadURL(previewUrl);
      // macOS only presents the native print sheet for a visible owner window.
      // Keep this child out of the normal workflow until its PDF is loaded,
      // then let the system print sheet take focus.
      printWindow.show();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return await new Promise<boolean>((resolve, reject) => {
        printWindow.webContents.print(
          { silent: false, printBackground: true },
          (success, failureReason) => {
            writeDesktopLogHeader(
              `document print completed success=${success} reason=${sanitizeLogValue(failureReason || "none")}`,
            );
            if (success) {
              resolve(true);
              return;
            }
            if (failureReason === "Print job canceled") {
              resolve(false);
              return;
            }
            reject(new Error(failureReason || "Could not print the document."));
          },
        );
      });
    } finally {
      if (!printWindow.isDestroyed()) {
        printWindow.destroy();
      }
    }
  });

  ipcMain.removeHandler(CLIPBOARD_WRITE_IMAGE_CHANNEL);
  ipcMain.handle(CLIPBOARD_WRITE_IMAGE_CHANNEL, async (_event, rawDataUrl: unknown) => {
    if (typeof rawDataUrl !== "string") {
      return false;
    }
    if (rawDataUrl.length > MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH) {
      return false;
    }

    const dataUrl = rawDataUrl.trim();
    if (!dataUrl.startsWith("data:image/png;base64,")) {
      return false;
    }

    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) {
      return false;
    }

    clipboard.writeImage(image);
    return true;
  });

  ipcMain.removeHandler(SHOW_IN_FOLDER_CHANNEL);
  ipcMain.removeHandler(OPEN_PATH_CHANNEL);
  ipcMain.handle(OPEN_PATH_CHANNEL, async (_event, rawPath: unknown) => {
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      throw new Error("Missing file path.");
    }
    const resolvedPath = Path.resolve(rawPath);
    try {
      await FS.promises.stat(resolvedPath);
    } catch {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    const errorMessage = await shell.openPath(resolvedPath);
    if (errorMessage.trim().length > 0) {
      throw new Error(errorMessage);
    }
  });

  ipcMain.handle(SHOW_IN_FOLDER_CHANNEL, async (_event, rawPath: unknown) => {
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      throw new Error("Missing folder path.");
    }
    const resolvedPath = Path.resolve(rawPath);

    let stats: FS.Stats;
    try {
      stats = await FS.promises.stat(resolvedPath);
    } catch {
      throw new Error(`Folder not found: ${resolvedPath}`);
    }

    if (stats.isDirectory()) {
      const errorMessage = await shell.openPath(resolvedPath);
      if (errorMessage.trim().length > 0) {
        throw new Error(errorMessage);
      }
      return;
    }

    shell.showItemInFolder(resolvedPath);
  });

  ipcMain.removeHandler(WINDOW_MINIMIZE_CHANNEL);
  ipcMain.handle(WINDOW_MINIMIZE_CHANNEL, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    window?.minimize();
  });

  ipcMain.removeHandler(WINDOW_TOGGLE_MAXIMIZE_CHANNEL);
  ipcMain.handle(WINDOW_TOGGLE_MAXIMIZE_CHANNEL, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!window) {
      return { isMaximized: false, isFullscreen: false };
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    const state = getDesktopWindowState(window);
    window.webContents.send(WINDOW_STATE_CHANNEL, state);
    return state;
  });

  ipcMain.removeHandler(WINDOW_CLOSE_CHANNEL);
  ipcMain.handle(WINDOW_CLOSE_CHANNEL, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    window?.close();
  });

  ipcMain.removeHandler(WINDOW_GET_STATE_CHANNEL);
  ipcMain.handle(WINDOW_GET_STATE_CHANNEL, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    return window ? getDesktopWindowState(window) : { isMaximized: false, isFullscreen: false };
  });

  ipcMain.removeHandler(UPDATE_GET_STATE_CHANNEL);
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async () => updateState);

  ipcMain.removeHandler(UPDATE_CHECK_CHANNEL);
  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    await checkForUpdates("renderer");
    return updateState;
  });

  ipcMain.removeHandler(UPDATE_DOWNLOAD_CHANNEL);
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await downloadAvailableUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(UPDATE_INSTALL_CHANNEL);
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async () => {
    if (isQuitting) {
      return {
        accepted: false,
        completed: false,
        state: updateState,
      } satisfies DesktopUpdateActionResult;
    }
    const result = await installDownloadedUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(NOTIFICATIONS_IS_SUPPORTED_CHANNEL);
  ipcMain.handle(NOTIFICATIONS_IS_SUPPORTED_CHANNEL, async () => Notification.isSupported());

  ipcMain.removeHandler(NOTIFICATIONS_SHOW_CHANNEL);
  ipcMain.handle(
    NOTIFICATIONS_SHOW_CHANNEL,
    async (
      _event,
      input:
        | {
            title?: unknown;
            body?: unknown;
            silent?: unknown;
            threadId?: unknown;
          }
        | null
        | undefined,
    ) =>
      showDesktopNotification({
        title: typeof input?.title === "string" ? input.title : "",
        body: typeof input?.body === "string" ? input.body : "",
        silent: input?.silent === true,
        ...(typeof input?.threadId === "string" ? { threadId: input.threadId } : {}),
      }),
  );
  registerDesktopVoiceTranscriptionHandler();
  startBrowserPerformanceLogging();
  void ensureBrowserUsePipeServer().catch((error) => {
    console.warn(
      `[DJL browser] Failed to register the in-app browser backend at ${SYNARA_BROWSER_USE_PIPE_PATH}. Codex will not be able to discover or open the browser panel.`,
      error,
    );
  });

  registerBrowserIpcHandlers(ipcMain, browserManager);
}

function getIconOption(): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = process.platform === "win32" ? "ico" : "png";
  const iconPath = resolveIconPath(ext);
  return iconPath ? { icon: iconPath } : {};
}

// macOS backs the translucent shell with window vibrancy, so the window is created
// transparent (`#00000000`) over the vibrancy material. Windows/Linux have no vibrancy:
// a transparent window there leaves backdrop-filter surfaces bleeding through and, on
// fractional DPI, rendering blurry. So off macOS we create an opaque window and skip the
// macOS-only options. The background tracks the OS light/dark appearance purely to avoid
// a bright flash before the renderer paints — the window is shown only after first paint
// (`show: false`), so this color is not expected to match a custom in-app theme exactly.
function getWindowMaterialOptions(): BrowserWindowConstructorOptions {
  if (process.platform !== "darwin") {
    return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#181818" : "#ffffff" };
  }
  return {
    vibrancy: "under-window",
    // "followWindow" lets macOS drop vibrancy blending to inactive when the
    // window is backgrounded, so WindowServer stops continuously recompositing
    // it. "active" forced full-cost blending even when the app was unfocused.
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
  };
}

// macOS keeps native traffic lights inset into the renderer's top chrome. Windows
// uses a fully frameless shell and renderer-owned minimize/maximize/close controls,
// so the toolbar can occupy the top edge instead of sitting below a native title bar.
function getTitleBarOptions(): BrowserWindowConstructorOptions {
  if (process.platform === "win32") {
    return { frame: false };
  }
  if (process.platform !== "darwin") {
    return {};
  }
  return {
    titleBarStyle: "hiddenInset",
    // Derived from the shared chat-surface header geometry (@synara/shared/desktopChrome)
    // so the native lights and the renderer's leading toggle/arrow controls always share
    // the same vertical center. Tune the height/radius there, never the raw px here.
    trafficLightPosition: getMacTrafficLightPosition(),
  };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    ...getIconOption(),
    title: APP_DISPLAY_NAME,
    ...getTitleBarOptions(),
    ...getWindowMaterialOptions(),
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      // Let Chromium throttle renderer timers/rAF when the window is hidden.
      backgroundThrottling: true,
    },
  });
  browserManager.setWindow(window);
  attachDesktopZoomFactorSync(window);

  window.webContents.on("context-menu", (event, params) => {
    event.preventDefault();

    const menuTemplate: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuTemplate.push({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        menuTemplate.push({ label: desktopT("contextMenu.noSuggestions"), enabled: false });
      }
      menuTemplate.push({ type: "separator" });
    }

    if (params.mediaType === "image") {
      menuTemplate.push({
        label: desktopT("contextMenu.copyImage"),
        click: () => window.webContents.copyImageAt(params.x, params.y),
      });
      menuTemplate.push({ type: "separator" });
    }

    menuTemplate.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(menuTemplate).popup({ window });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getSafeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_DISPLAY_NAME);
  });
  window.webContents.on("did-finish-load", () => {
    window.setTitle(APP_DISPLAY_NAME);
    emitUpdateState();
    emitRemoteGatewayState();
  });
  window.once("ready-to-show", () => {
    // Launch filling the screen work area; the 1100x780 size above stays as the
    // restore bounds when the user toggles the window back out of maximized.
    window.maximize();
    window.show();
    emitDesktopWindowState(window);
  });

  window.on("maximize", () => emitDesktopWindowState(window));
  window.on("unmaximize", () => emitDesktopWindowState(window));
  window.on("enter-full-screen", () => emitDesktopWindowState(window));
  window.on("leave-full-screen", () => emitDesktopWindowState(window));

  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadURL(SYNARA_DESKTOP_ENTRY_URL);
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
    browserManager.setWindow(null);
  });

  return window;
}

function configureMediaPermissions(): void {
  const defaultSession = session.defaultSession;
  if (!defaultSession) {
    return;
  }

  defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === "media") {
      return process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("microphone") === "granted"
        : false;
    }
    return false;
  });

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== "media") {
      callback(false);
      return;
    }

    // Some Electron microphone requests omit `mediaTypes`, so denying here can suppress
    // the macOS permission prompt entirely even though the renderer asked for audio input.
    if (!shouldAllowMediaPermissionRequest(details)) {
      callback(false);
      return;
    }

    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status === "granted") {
        callback(true);
        return;
      }

      void systemPreferences.askForMediaAccess("microphone").then(callback, () => callback(false));
      return;
    }

    callback(true);
  });
}

// Override Electron's userData path before the `ready` event so that
// Chromium session data uses a filesystem-friendly directory name.
// Must be called synchronously at the top level — before `app.whenReady()`.
const userDataPath = resolveUserDataPath();
if (hasSingleInstanceLock) {
  repairBrowserProfileBeforeElectronReady(userDataPath);
}
app.setPath("userData", userDataPath);

configureAppIdentity();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });
}

async function bootstrap(): Promise<void> {
  writeDesktopLogHeader("bootstrap start");
  sharedStateLock = await acquireSharedStateLock(BASE_DIR);
  backendAuthToken = Crypto.randomBytes(24).toString("hex");
  await reserveBackendEndpoint("bootstrap");

  initializeRemoteGatewayConfiguration();
  registerIpcHandlers();
  writeDesktopLogHeader("bootstrap ipc handlers registered");
  startRemoteGateway();
  startBackend();
  writeDesktopLogHeader("bootstrap backend start requested");

  if (isDevelopment) {
    void waitForBackendWindowReady(backendHttpUrl)
      .then((source) => {
        writeDesktopLogHeader(`bootstrap backend ready source=${source}`);
        if (!mainWindow) {
          mainWindow = createWindow();
          writeDesktopLogHeader("bootstrap main window created");
        }
      })
      .catch((error) => {
        if (isBackendReadinessAborted(error)) {
          return;
        }
        writeDesktopLogHeader(
          `bootstrap backend readiness warning message=${formatErrorMessage(error)}`,
        );
        console.warn("[desktop] backend readiness check timed out during dev bootstrap", error);
        if (!mainWindow) {
          mainWindow = createWindow();
          writeDesktopLogHeader("bootstrap main window created after readiness warning");
        }
      });
    return;
  }

  ensureInitialBackendWindowOpen(backendHttpUrl);
}

app.on("before-quit", (event) => {
  writeDesktopLogHeader("before-quit received");
  if (desktopShutdownComplete) {
    return;
  }

  if (isUpdaterQuitAndInstallInFlight) {
    // Electron's updater owns this quit; canceling it would turn install into a plain app quit.
    try {
      markInstallHandoffSync(getUpdateInstallMarkerPath());
    } catch (error) {
      console.error(
        `[desktop-updater] Failed to persist install handoff marker during quit: ${formatErrorMessage(error)}`,
      );
    }
    writeDesktopLogHeader("before-quit allowing updater quit-and-install");
    return;
  }

  if (isUpdaterInstallPreparing) {
    // Keep user/system quits from preempting the pending updater install with a plain app.quit().
    writeDesktopLogHeader("before-quit waiting for updater quit-and-install");
    event.preventDefault();
    return;
  }

  event.preventDefault();
  requestGracefulAppQuit("before-quit");
});

if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(async () => {
      writeDesktopLogHeader("app ready");
      configureAppIdentity();
      applyLegacyMacDockIcon();
      refreshMacIconCacheOnVersionChange();
      configureMediaPermissions();
      const localePreferencePath = resolveDesktopLocalePreferencePath(app.getPath("userData"));
      await initializeDesktopI18n(
        readDesktopLocalePreference(localePreferencePath),
        getPreferredSystemLanguageCandidates(),
        app.isPackaged,
      );
      configureApplicationMenu();
      try {
        registerDesktopProtocol();
      } catch (error) {
        if (error instanceof BundleChangedDuringStartupError) {
          restartAfterStartupBundleSwap(error);
          return;
        }
        throw error;
      }
      startBundleSwapWatcher();
      configureAutoUpdater();
      void bootstrap().catch((error) => {
        handleFatalStartupError("bootstrap", error);
      });

      app.on("browser-window-blur", () => {
        markDesktopAppBackgrounded();
      });

      app.on("browser-window-focus", () => {
        handleDesktopAppForegrounded();
      });

      app.on("activate", () => {
        handleDesktopAppForegrounded();
        if (BrowserWindow.getAllWindows().length === 0) {
          if (!isDevelopment) {
            ensureInitialBackendWindowOpen(backendHttpUrl);
            return;
          }
          void waitForBackendWindowReady(backendHttpUrl)
            .catch((error) => {
              if (isBackendReadinessAborted(error)) {
                return;
              }
              console.warn(
                "[desktop] backend readiness check timed out during dev activate",
                error,
              );
            })
            .finally(() => {
              if (!mainWindow) {
                mainWindow = createWindow();
              }
            });
          return;
        }
        focusMainWindow();
      });
    })
    .catch((error) => {
      handleFatalStartupError("whenReady", error);
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

if (process.platform !== "win32") {
  process.on("uncaughtException", (error: unknown) => {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
    if (desktopShutdownPromise) return;
    writeDesktopLogHeader("EPIPE received");
    requestGracefulAppQuit("EPIPE");
  });

  process.on("SIGINT", () => {
    if (desktopShutdownPromise) return;
    writeDesktopLogHeader("SIGINT received");
    requestGracefulAppQuit("SIGINT");
  });

  process.on("SIGTERM", () => {
    if (desktopShutdownPromise) return;
    writeDesktopLogHeader("SIGTERM received");
    requestGracefulAppQuit("SIGTERM");
  });
}
