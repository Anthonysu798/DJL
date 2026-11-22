import { DESKTOP_IPC_CHANNELS as IPC } from "./ipcChannels";
import type { DesktopComputerPreviewFrame } from "@djl/contracts";
import { COMPUTER_USE_IPC_CHANNELS } from "./computerUseIpcChannels";
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopBuildInfo } from "@djl/contracts";
import { RENDERER_READY_CHANNEL } from "./windowReveal";
import { BROWSER_IPC_CHANNELS } from "./browserIpcChannels";
import { DESKTOP_BUILD_INFO_CHANNEL } from "./desktopBuildInfo";
import {
  DESKTOP_WS_URL_CHANNEL,
  DESKTOP_STARTUP_SCOPE_CHANNEL,
  normalizeDesktopWsUrl,
  resolveDesktopWsUrlFromEnv,
} from "./desktopWsBridge";
import { SERVER_TRANSCRIBE_VOICE_CHANNEL } from "./voiceTranscription";
import { SHOP_OPEN_CHANNEL } from "./shopWindowPolicy";
import { createMenuActionDelivery } from "./menuActionDelivery";
import {
  CLOUD_AUTH_CALLBACK_CHANNEL,
  CLOUD_AUTH_TAKE_CALLBACK_CHANNEL,
  type CloudAuthCallback,
} from "./cloudAuthIpcChannels";
import { STORAGE_MIGRATION_IPC_CHANNELS } from "./desktopStorageMigration";
import { REMOTE_GATEWAY_IPC_CHANNELS } from "./remoteGatewayIpc";
import {
  DESKTOP_LOCALE_IPC_CHANNELS,
  parseLocalePreferenceForIpc,
  parsePreferredSystemLanguagesForIpc,
} from "./desktopLocaleIpc";

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
const WINDOW_MINIMIZE_CHANNEL = "desktop:window-minimize";
const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = "desktop:window-toggle-maximize";
const WINDOW_CLOSE_CHANNEL = "desktop:window-close";
const WINDOW_GET_STATE_CHANNEL = "desktop:window-get-state";
const WINDOW_STATE_CHANNEL = "desktop:window-state";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const NOTIFICATIONS_IS_SUPPORTED_CHANNEL = "desktop:notifications-is-supported";
const NOTIFICATIONS_SHOW_CHANNEL = "desktop:notifications-show";
const ZOOM_FACTOR_CHANNEL = "desktop:zoom-factor";
const ZOOM_FACTOR_CHANGED_CHANNEL = "desktop:zoom-factor-changed";

// did-finish-load can precede React's menu subscriptions when restoring the AI window.
const menuActions = createMenuActionDelivery();
ipcRenderer.on(MENU_ACTION_CHANNEL, (_event, action: unknown) => menuActions.receive(action));

function getDesktopWsUrl(): string | null {
  try {
    const ipcWsUrl = normalizeDesktopWsUrl(ipcRenderer.sendSync(DESKTOP_WS_URL_CHANNEL));
    return ipcWsUrl ?? resolveDesktopWsUrlFromEnv(process.env);
  } catch {
    return resolveDesktopWsUrlFromEnv(process.env);
  }
}

function computerPreviewFrameBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly type?: unknown }).type === "Buffer" &&
    Array.isArray((value as { readonly data?: unknown }).data)
  ) {
    return Uint8Array.from((value as { readonly data: readonly number[] }).data);
  }
  return null;
}

function parseComputerPreviewFrame(payload: unknown): DesktopComputerPreviewFrame | null {
  if (!payload || typeof payload !== "object") return null;
  const frame = payload as Record<string, unknown>;
  if (typeof frame.windowId !== "number" || !Number.isFinite(frame.windowId)) return null;
  if (typeof frame.seq !== "number" || !Number.isFinite(frame.seq)) return null;
  const jpeg = computerPreviewFrameBytes(frame.jpeg);
  if (!jpeg || jpeg.byteLength === 0) return null;
  return { windowId: frame.windowId, seq: frame.seq, jpeg };
}

let computerPreviewListenerCount = 0;

contextBridge.exposeInMainWorld("desktopBridge", {
  notifyReady: () => ipcRenderer.send(RENDERER_READY_CHANNEL),
  getWsUrl: getDesktopWsUrl,
  getStartupScope: () => ipcRenderer.sendSync(DESKTOP_STARTUP_SCOPE_CHANNEL) as string,
  getBuildInfo: () => ipcRenderer.sendSync(DESKTOP_BUILD_INFO_CHANNEL) as DesktopBuildInfo,
  locale: {
    getPreferredSystemLanguages: () =>
      parsePreferredSystemLanguagesForIpc(
        ipcRenderer.sendSync(DESKTOP_LOCALE_IPC_CHANNELS.preferredSystemLanguages),
      ),
    applyPreference: (preference) =>
      ipcRenderer.invoke(
        DESKTOP_LOCALE_IPC_CHANNELS.applyPreference,
        parseLocalePreferenceForIpc(preference),
      ),
  },
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  saveFile: (input) => ipcRenderer.invoke(SAVE_FILE_CHANNEL, input),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  openShop: () => ipcRenderer.invoke(SHOP_OPEN_CHANNEL),
  printPdf: (url: string) => ipcRenderer.invoke(PRINT_PDF_CHANNEL, url),
  openPath: (path: string) => ipcRenderer.invoke(OPEN_PATH_CHANNEL, path),
  showInFolder: (path: string) => ipcRenderer.invoke(SHOW_IN_FOLDER_CHANNEL, path),
  shell: {
    openPath: (path: string) => ipcRenderer.invoke(OPEN_PATH_CHANNEL, path),
    showInFolder: (path: string) => ipcRenderer.invoke(SHOW_IN_FOLDER_CHANNEL, path),
  },
  clipboard: {
    writeImagePngDataUrl: (dataUrl: string) =>
      ipcRenderer.invoke(CLIPBOARD_WRITE_IMAGE_CHANNEL, dataUrl),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke(WINDOW_MINIMIZE_CHANNEL),
    toggleMaximize: () => ipcRenderer.invoke(WINDOW_TOGGLE_MAXIMIZE_CHANNEL),
    close: () => ipcRenderer.invoke(WINDOW_CLOSE_CHANNEL),
    getState: () => ipcRenderer.invoke(WINDOW_GET_STATE_CHANNEL),
    onState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as Parameters<typeof listener>[0]);
      };

      ipcRenderer.on(WINDOW_STATE_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(WINDOW_STATE_CHANNEL, wrappedListener);
      };
    },
  },
  onMenuAction: (listener, actions) => menuActions.subscribe(listener, actions),
  onCloudAuthCallback: (listener) => {
    // Main keeps the newest callback until it is taken, so each one is handled once.
    const take = async () => {
      const callback = (await ipcRenderer.invoke(
        CLOUD_AUTH_TAKE_CALLBACK_CHANNEL,
      )) as CloudAuthCallback | null;
      if (callback) listener({ code: callback.code, state: callback.state });
    };
    const wrappedListener = () => void take();
    ipcRenderer.on(CLOUD_AUTH_CALLBACK_CHANNEL, wrappedListener);
    void take();
    return () => {
      ipcRenderer.removeListener(CLOUD_AUTH_CALLBACK_CHANNEL, wrappedListener);
    };
  },
  getZoomFactor: () => {
    const factor = ipcRenderer.sendSync(ZOOM_FACTOR_CHANNEL);
    return typeof factor === "number" && Number.isFinite(factor) && factor > 0 ? factor : 1;
  },
  onZoomFactorChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, factor: unknown) => {
      if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) return;
      listener(factor);
    };

    ipcRenderer.on(ZOOM_FACTOR_CHANGED_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(ZOOM_FACTOR_CHANGED_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdates: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  notifications: {
    isSupported: () => ipcRenderer.invoke(NOTIFICATIONS_IS_SUPPORTED_CHANNEL),
    show: (input) => ipcRenderer.invoke(NOTIFICATIONS_SHOW_CHANNEL, input),
  },
  remote: {
    getState: () => ipcRenderer.invoke(REMOTE_GATEWAY_IPC_CHANNELS.getState),
    setEnabled: (enabled) => ipcRenderer.invoke(REMOTE_GATEWAY_IPC_CHANNELS.setEnabled, enabled),
    refreshPairing: () => ipcRenderer.invoke(REMOTE_GATEWAY_IPC_CHANNELS.refreshPairing),
    resetPairing: () => ipcRenderer.invoke(REMOTE_GATEWAY_IPC_CHANNELS.resetPairing),
    onState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(REMOTE_GATEWAY_IPC_CHANNELS.state, wrappedListener);
      return () => ipcRenderer.removeListener(REMOTE_GATEWAY_IPC_CHANNELS.state, wrappedListener);
    },
  },
  appSnap: {
    captureCurrentApp: (requestId) => ipcRenderer.invoke(IPC.appSnap.captureCurrentApp, requestId),
    cancelCapture: (requestId) => ipcRenderer.invoke(IPC.appSnap.cancelCapture, requestId),
    getState: (permissions) => ipcRenderer.invoke(IPC.appSnap.getState, permissions),
    setEnabled: (enabled) => ipcRenderer.invoke(IPC.appSnap.setEnabled, enabled),
    checkShortcut: (shortcut) => ipcRenderer.invoke(IPC.appSnap.checkShortcut, shortcut),
    setShortcut: (shortcut) => ipcRenderer.invoke(IPC.appSnap.setShortcut, shortcut),
    requestPermissions: (permissions) =>
      ipcRenderer.invoke(IPC.appSnap.requestPermissions, permissions),
    startPermissionSetup: (permissions) =>
      ipcRenderer.invoke(IPC.appSnap.startPermissionSetup, permissions),
    listPendingCaptures: () => ipcRenderer.invoke(IPC.appSnap.listPendingCaptures),
    acknowledgeCapture: (captureId) =>
      ipcRenderer.invoke(IPC.appSnap.acknowledgeCapture, captureId),
    listWindows: () => ipcRenderer.invoke(IPC.appSnap.listWindows),
    captureWindow: (input) => ipcRenderer.invoke(IPC.appSnap.captureWindow, input),
    openPermissionSettings: (pane) => ipcRenderer.invoke(IPC.appSnap.openPermissionSettings, pane),
    restartApp: () => ipcRenderer.invoke(IPC.appSnap.restartApp),
    showPermissionGuide: (pane) => ipcRenderer.invoke(IPC.appSnap.showPermissionGuide, pane),
    hidePermissionGuide: () => ipcRenderer.invoke(IPC.appSnap.hidePermissionGuide),
    onPermissionGuideState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "string") return;
        listener(state as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC.appSnap.permissionGuideState, wrappedListener);
      return () => ipcRenderer.removeListener(IPC.appSnap.permissionGuideState, wrappedListener);
    },
    onCaptured: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, capture: unknown) => {
        if (typeof capture !== "object" || capture === null) return;
        listener(capture as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC.appSnap.captured, wrappedListener);
      return () => ipcRenderer.removeListener(IPC.appSnap.captured, wrappedListener);
    },
    onError: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, error: unknown) => {
        if (typeof error !== "object" || error === null) return;
        listener(error as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC.appSnap.error, wrappedListener);
      return () => ipcRenderer.removeListener(IPC.appSnap.error, wrappedListener);
    },
    onState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC.appSnap.state, wrappedListener);
      return () => ipcRenderer.removeListener(IPC.appSnap.state, wrappedListener);
    },
  },
  storageMigration: {
    readSnapshot: () => ipcRenderer.sendSync(STORAGE_MIGRATION_IPC_CHANNELS.read),
    acknowledgeSnapshot: () => ipcRenderer.invoke(STORAGE_MIGRATION_IPC_CHANNELS.acknowledge),
  },
  server: {
    transcribeVoice: (input) => ipcRenderer.invoke(SERVER_TRANSCRIBE_VOICE_CHANNEL, input),
  },
  computerPreview: {
    onFrame: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        const frame = parseComputerPreviewFrame(payload);
        if (frame) listener(frame);
      };

      ipcRenderer.on(IPC.computerPreviewFrame, wrappedListener);
      // A frame listener is the preview's demand signal: the main process runs
      // the native capture helper only while this window has one.
      computerPreviewListenerCount += 1;
      if (computerPreviewListenerCount === 1) ipcRenderer.send(IPC.computerPreviewSubscribe);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        ipcRenderer.removeListener(IPC.computerPreviewFrame, wrappedListener);
        computerPreviewListenerCount -= 1;
        if (computerPreviewListenerCount === 0) ipcRenderer.send(IPC.computerPreviewUnsubscribe);
      };
    },
  },
  computer: {
    engine: ipcRenderer.sendSync("desktop:computer-engine") === "cua" ? "cua" : "legacy",
    setCursorStyle: (style) => ipcRenderer.invoke(IPC.computerSetCursorStyle, style),
    onThreadStopped: (listener) => {
      const receive = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        const event = payload as { type?: unknown; threadId?: unknown };
        if (
          event.type === "thread-stopped" &&
          typeof event.threadId === "string" &&
          event.threadId.length <= 128
        )
          listener(event.threadId);
      };
      ipcRenderer.on(COMPUTER_USE_IPC_CHANNELS.event, receive);
      return () => ipcRenderer.removeListener(COMPUTER_USE_IPC_CHANNELS.event, receive);
    },
    request: (input) => ipcRenderer.invoke(COMPUTER_USE_IPC_CHANNELS.request, input),
    onEvent: (listener) => {
      const receive = () => listener();
      ipcRenderer.on(COMPUTER_USE_IPC_CHANNELS.event, receive);
      return () => ipcRenderer.removeListener(COMPUTER_USE_IPC_CHANNELS.event, receive);
    },
    stopAll: async () => {
      const response = await ipcRenderer.invoke(COMPUTER_USE_IPC_CHANNELS.request, {
        threadId: "desktop:settings",
        request: { method: "stop" },
      });
      if (response.error) throw new Error(response.error.message);
    },
  },
  browser: {
    open: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.open, input),
    close: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.close, input),
    hide: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.hide, input),
    getState: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.getState, input),
    setPanelBounds: async (input) => {
      ipcRenderer.send(BROWSER_IPC_CHANNELS.setBounds, input);
    },
    attachWebview: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.attachWebview, input),
    detachWebview: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.detachWebview, input),
    copyLink: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.requestCopyLink, input),
    copyScreenshotToClipboard: (input) =>
      ipcRenderer.invoke(BROWSER_IPC_CHANNELS.copyScreenshotToClipboard, input),
    captureScreenshot: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.captureScreenshot, input),
    annotationCommand: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.annotationCommand, input),
    captureAnnotation: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.captureAnnotation, input),
    executeCdp: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.executeCdp, input),
    navigate: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.navigate, input),
    reload: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.reload, input),
    goBack: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.goBack, input),
    goForward: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.goForward, input),
    newTab: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.newTab, input),
    closeTab: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.closeTab, input),
    selectTab: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.selectTab, input),
    openDevTools: (input) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.openDevTools, input),
    onState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as Parameters<typeof listener>[0]);
      };

      ipcRenderer.on(BROWSER_IPC_CHANNELS.state, wrappedListener);
      return () => {
        ipcRenderer.removeListener(BROWSER_IPC_CHANNELS.state, wrappedListener);
      };
    },
    onBrowserUseOpenPanelRequest: (listener) => {
      const wrappedListener = () => listener();
      ipcRenderer.on(BROWSER_IPC_CHANNELS.requestOpenPanel, wrappedListener);
      return () => {
        ipcRenderer.removeListener(BROWSER_IPC_CHANNELS.requestOpenPanel, wrappedListener);
      };
    },
    onBrowserCopyLink: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        listener(payload as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(BROWSER_IPC_CHANNELS.copyLink, wrappedListener);
      return () => {
        ipcRenderer.removeListener(BROWSER_IPC_CHANNELS.copyLink, wrappedListener);
      };
    },
    onAnnotationEvent: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        listener(payload as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(BROWSER_IPC_CHANNELS.annotationEvent, wrappedListener);
      return () =>
        ipcRenderer.removeListener(BROWSER_IPC_CHANNELS.annotationEvent, wrappedListener);
    },
  },
} satisfies DesktopBridge);
