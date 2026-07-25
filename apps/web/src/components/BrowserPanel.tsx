// FILE: BrowserPanel.tsx
// Purpose: Renders the in-app browser chrome and mirrors the native Electron view.
// Layer: Desktop-only React component
// Depends on: browserStateStore, nativeApi browser bridge, DiffPanelShell
//
// Note: raw <button>s for autocomplete-suggestion rows and tab-title activate
// regions are intentional — list-row and tab semantics, not shadcn Buttons.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useTranslation } from "react-i18next";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  BrowserAnnotationAdjustments as BrowserAnnotationAdjustmentsSchema,
  type BrowserAnnotationAdjustments,
  type BrowserAnnotationSelection,
  type BrowserFindingDraft,
  type ServerLocalServerProcess,
  type ThreadId,
} from "@synara/contracts";
import { Schema } from "effect";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LinkIcon,
  MessageCircleIcon,
  LoaderCircleIcon,
  type LucideIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "~/lib/icons";

import { localServerPrimaryLabel } from "@synara/shared/localServers";
import {
  BROWSER_BLANK_URL,
  isBlankBrowserTabUrl,
  resolveCopyableBrowserTabUrl,
} from "@synara/shared/browserSession";
import { isBrowserCopyLinkChord } from "@synara/shared/browserShortcuts";

import { isElectron } from "~/env";
import { readNativeApi } from "~/nativeApi";
import type { DockPaneRuntimeMode } from "~/lib/dockPaneActivation";
import { IMAGE_SIZE_LIMIT_LABEL } from "~/lib/composerSend";
import {
  BrowserCommentingLifecycle,
  resolveBrowserCommentingRuntimeTarget,
} from "~/lib/browserCommentingLifecycle";
import { PANEL_RESIZE_OVERLAY_SYNC_EVENT } from "~/lib/panelResize";
import { serverLocalServersQueryOptions } from "~/lib/serverReactQuery";
import { cn, isMacPlatform } from "~/lib/utils";

import {
  useBrowserStateStore,
  selectThreadBrowserHistory,
  selectThreadBrowserState,
} from "../browserStateStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { anchoredToastManager } from "./ui/toast";
import {
  composerImageFromBrowserScreenshot,
  screenshotAttachmentName,
} from "../lib/browserPromptContext";
import {
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  requestBrowserPanelClose,
  restoreOrDisableBrowserAnnotation,
  shouldPreserveBrowserCommentingDuringTransitionFailure,
  resolveBrowserChromeStatus,
  resolveBrowserAddressSync,
  type BrowserAddressSuggestion,
} from "./BrowserPanel.logic";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { LocalServerIdentity } from "./LocalServerIdentity";
import { Button } from "./ui/button";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { Input } from "./ui/input";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "./ui/menu";
import { Skeleton } from "./ui/skeleton";
import { toastManager } from "./ui/toast";
import { BrowserAnnotationEditor } from "./BrowserAnnotationEditor";

const EMPTY_BROWSER_FINDINGS: readonly BrowserFindingDraft[] = [];

interface BrowserPanelProps {
  mode: DiffPanelMode;
  threadId: ThreadId;
  onClosePanel: () => void;
  onRegisterCloseRequest?: (
    requestClose: (onClosed?: () => void) => void,
  ) => (() => void) | undefined;
  runtimeMode?: DockPaneRuntimeMode;
  onRequestLive?: () => void;
}

const BROWSER_BOUNDS_SYNC_BURST_FRAMES = 30;
const BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET = 2;
const BROWSER_WEBVIEW_PARTITION = "persist:synara-browser";
const BROWSER_PERF_SAMPLE_INTERVAL_MS = 5_000;
// The address field and tab pills share one chrome-control surface so the whole row reads
// as a single cohesive control: matching height, radius, border width, and type scale.
const BROWSER_CHROME_CONTROL_CLASS_NAME = "h-8 rounded-lg border text-xs";
// The address field's filled look, reused by the active tab so the selected tab visually
// matches the search input (same border tone + faint fill).
const BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME = "border-border bg-background/70";
const BROWSER_ACTION_MENU_PANEL_CLASS_NAME = "w-52 min-w-52";
const BROWSER_ACTION_MENU_ITEM_CLASS_NAME =
  "text-[var(--color-text-foreground)] data-highlighted:text-[var(--color-text-foreground)]";
const BROWSER_ACTION_MENU_ICON_CLASS_NAME =
  "inline-flex size-3.5 shrink-0 items-center justify-center text-[var(--color-text-foreground-secondary)] [&>svg]:size-3.5 [&>[data-slot=central-icon]]:size-3.5";
const NATIVE_BROWSER_OBSCURING_OVERLAY_SELECTOR = [
  "[data-slot='dialog-backdrop']",
  "[data-slot='dialog-popup']",
  "[data-slot='dialog-viewport']",
  "[data-slot='alert-dialog-backdrop']",
  "[data-slot='alert-dialog-popup']",
  "[data-slot='alert-dialog-viewport']",
  "[data-slot='command-dialog-backdrop']",
  "[data-slot='command-dialog-popup']",
  "[data-slot='command-dialog-viewport']",
  "[data-slot='toast-popup']",
  "[role='dialog'][aria-modal='true']",
].join(", ");

function BrowserActionMenuIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className={BROWSER_ACTION_MENU_ICON_CLASS_NAME}>
      <Icon aria-hidden="true" />
    </span>
  );
}

// The browser itself lives inside a sheet, and toast portals/positioners are just
// layout containers. Treating either as blockers hides the WebContentsView.
const NATIVE_BROWSER_NON_OBSCURING_OVERLAY_SELECTOR = [
  "[data-panel-resize-overlay='true']",
  "[data-slot='sheet-backdrop']",
  "[data-slot='sheet-popup']",
  "[data-slot='toast-portal']",
  "[data-slot='toast-portal-anchored']",
  "[data-slot='toast-viewport']",
  "[data-slot='toast-viewport-anchored']",
  "[data-slot='toast-positioner']",
].join(", ");

interface BrowserViewportPerfCounters {
  syncAttempts: number;
  syncSkips: number;
  syncSends: number;
  resizeSchedules: number;
  resizeScheduleSkips: number;
  burstStarts: number;
  burstExtensions: number;
  burstFrames: number;
  transitionSignals: number;
  ignoredTransitionSignals: number;
}

interface BrowserWebviewElement extends HTMLElement {
  getWebContentsId?: () => number;
}

const VIEWPORT_TRANSITION_PROPERTIES = new Set([
  "transform",
  "translate",
  "scale",
  "rotate",
  "width",
  "max-width",
  "min-width",
  "height",
  "max-height",
  "min-height",
  "left",
  "right",
  "top",
  "bottom",
  "inset",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
]);
function closeButtonClassName(isActive: boolean) {
  return cn(
    "ml-1 size-5 shrink-0 rounded-sm p-0 text-muted-foreground/70 hover:bg-background/80 hover:text-foreground",
    isActive ? "hover:bg-background" : "hover:bg-card",
  );
}

function browserActionErrorDetail(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (/ERR_ABORTED|\(-3\)/i.test(error.message)) {
    return null;
  }
  return error.message;
}

type BrowserLocalError = {
  key: string;
  values?: Record<string, string | number>;
  detail?: string;
} | null;

function ignoreBrowserBoundsSyncError(): void {
  // Bounds sync is best-effort plumbing between the React shell and the native
  // browser surface. Avoid surfacing transient geometry-sync failures as user-facing
  // browser errors because they do not reflect page navigation health.
}

function ignoreBrowserWebviewDetachError(): void {
  // Renderer webview detach is best-effort cleanup; a stale/destroyed guest is already gone.
}

function setBrowserWebviewOverlayOcclusion(
  webview: BrowserWebviewElement | null,
  occluded: boolean,
): void {
  if (!webview) {
    return;
  }
  webview.style.visibility = occluded ? "hidden" : "visible";
  webview.style.pointerEvents = occluded ? "none" : "auto";
}

function isVisibleOverlayElement(element: HTMLElement): boolean {
  const styles = window.getComputedStyle(element);
  if (styles.display === "none" || styles.visibility === "hidden" || styles.opacity === "0") {
    return false;
  }
  return element.getClientRects().length > 0;
}

function isNativeBrowserNonObscuringOverlayElement(element: HTMLElement): boolean {
  return (
    element.closest("[data-slot='toast-popup']") === null &&
    element.closest(NATIVE_BROWSER_NON_OBSCURING_OVERLAY_SELECTOR) !== null
  );
}

const NATIVE_BROWSER_OVERLAY_SAMPLE_POINTS = [
  [0.5, 0.5],
  [0.2, 0.2],
  [0.8, 0.2],
  [0.2, 0.8],
  [0.8, 0.8],
] as const;

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function candidateObscuresNativeBrowser(candidate: HTMLElement, element: HTMLElement): boolean {
  if (candidate === element || candidate.contains(element) || element.contains(candidate)) {
    return false;
  }
  if (!isVisibleOverlayElement(candidate)) {
    return false;
  }

  const elementRect = element.getBoundingClientRect();
  const candidateRects = candidate.getClientRects();
  for (const candidateRect of candidateRects) {
    if (rectsIntersect(elementRect, candidateRect)) {
      return true;
    }
  }

  return false;
}

function hasTopLayerDomObstruction(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  for (const [xRatio, yRatio] of NATIVE_BROWSER_OVERLAY_SAMPLE_POINTS) {
    const x = rect.left + rect.width * xRatio;
    const y = rect.top + rect.height * yRatio;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      continue;
    }

    const hitElements = document.elementsFromPoint(x, y);
    for (const hitElement of hitElements) {
      if (!(hitElement instanceof HTMLElement)) {
        continue;
      }
      if (hitElement === element || element.contains(hitElement) || hitElement.contains(element)) {
        continue;
      }
      if (isNativeBrowserNonObscuringOverlayElement(hitElement)) {
        continue;
      }
      if (!isVisibleOverlayElement(hitElement)) {
        continue;
      }
      return true;
    }
  }

  return false;
}

function hasNativeBrowserObscuringOverlay(element: HTMLElement): boolean {
  const candidates = document.querySelectorAll<HTMLElement>(
    NATIVE_BROWSER_OBSCURING_OVERLAY_SELECTOR,
  );
  for (const candidate of candidates) {
    if (candidateObscuresNativeBrowser(candidate, element)) {
      return true;
    }
  }

  return hasTopLayerDomObstruction(element);
}

function isNativeBrowserTransitionSignalTarget(
  target: EventTarget | null,
  viewportElement: HTMLElement,
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (viewportElement.contains(target) || target.contains(viewportElement)) {
    return true;
  }

  return (
    target.closest(NATIVE_BROWSER_OBSCURING_OVERLAY_SELECTOR) !== null ||
    target.closest("[data-slot='sidebar-container']") !== null ||
    target.closest("[data-slot='sheet-popup']") !== null
  );
}

function isBrowserPerfLoggingEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem("synara:browser-perf") === "1";
  } catch {
    return false;
  }
}

// Keeps a restored browser pane visually occupied while the live webview hydrates.
function BrowserRuntimePreview(props: { title: string; detail: string }) {
  const { t } = useTranslation("workspace");
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-background/35 p-6"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3 rounded-full" />
            <Skeleton className="h-2.5 w-full rounded-full" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-lg" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
          </div>
        </div>
        <div className="mt-4 min-w-0 text-center">
          <p className="text-xs font-medium text-foreground">{t("browser.restoring")}</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground" title={props.detail}>
            {props.title}
          </p>
        </div>
      </div>
    </div>
  );
}

function browserLocalServerUrl(server: ServerLocalServerProcess): string | null {
  const addressWithUrl = server.addresses.find((address) => address.url);
  if (addressWithUrl?.url) {
    return addressWithUrl.url;
  }

  const port = server.ports[0];
  if (!port) {
    return null;
  }
  return `http://localhost:${port}/`;
}

// Paints a tiny browser-preview tile without fetching screenshots or adding network work.
// The page name and address are rendered into the tile so it reads as a real preview.
function BrowserLocalServerThumbnail({ server }: { server: ServerLocalServerProcess }) {
  const label = localServerPrimaryLabel(server);
  const port = server.ports[0];

  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-[4.5rem] shrink-0 flex-col gap-1 overflow-hidden rounded-md border border-white/12 bg-[#f7f7f2] p-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.28)]"
    >
      <span className="flex gap-[3px]">
        <span className="size-[3px] rounded-full bg-[#ff6b65]" />
        <span className="size-[3px] rounded-full bg-[#f4c047]" />
        <span className="size-[3px] rounded-full bg-[#45cf77]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="truncate text-[7px] font-bold leading-none text-[#2a2a2a]">{label}</span>
        {port ? (
          <span className="truncate text-[6px] font-medium leading-none text-[#9a9a9a]">
            localhost:{port}
          </span>
        ) : null}
      </span>
    </span>
  );
}

// Replaces about:blank with a local-server launcher so the browser never opens to white.
function BrowserLocalServersHome({
  activeTabId,
  loading,
  onNavigate,
  onRefresh,
  servers,
}: {
  activeTabId: string | null;
  loading: boolean;
  onNavigate: (url: string, tabId: string | null) => void;
  onRefresh: () => void;
  servers: readonly ServerLocalServerProcess[];
}) {
  const { t } = useTranslation("workspace");
  const hasServers = servers.length > 0;

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-[#0d0d0d] text-white">
      <div className="mx-auto flex h-full w-full max-w-[52rem] flex-col px-8 py-9">
        <div className="flex shrink-0 items-center justify-between">
          <p className="text-[15px] font-medium text-white/35">{t("browser.local.title")}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 text-white/35 hover:bg-white/[0.06] hover:text-white/70"
            disabled={loading}
            onClick={onRefresh}
            aria-label={t("browser.local.refresh")}
            title={t("browser.local.refresh")}
          >
            <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>

        {!hasServers ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
            {loading ? (
              <>
                <RefreshCwIcon className="mb-4 size-12 animate-spin text-white/20" />
                <p className="text-base font-semibold text-white">{t("browser.local.scanning")}</p>
                <p className="mt-2 text-sm text-white/35">{t("browser.local.checking")}</p>
              </>
            ) : (
              <>
                <GlobeIcon className="mb-4 size-16 stroke-[1.5] text-white/30" />
                <p className="text-base font-semibold text-white">{t("browser.local.empty")}</p>
                <p className="mt-2 text-sm text-white/35">{t("browser.local.emptyHint")}</p>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-6">
            {servers.map((server) => {
              const url = browserLocalServerUrl(server);

              return (
                <button
                  key={server.id}
                  type="button"
                  disabled={!url}
                  onClick={() => {
                    if (url) {
                      onNavigate(url, activeTabId);
                    }
                  }}
                  className="group grid w-full shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-white/[0.07] px-3 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <BrowserLocalServerThumbnail server={server} />
                  <LocalServerIdentity server={server} tone="browser" />
                  <span
                    className="mr-1 size-2 rounded-full bg-[#36d07b] shadow-[0_0_0_2.5px_rgba(54,208,123,0.16)]"
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function BrowserPanel({
  mode,
  threadId,
  onClosePanel,
  onRegisterCloseRequest,
  runtimeMode = "live",
  onRequestLive,
}: BrowserPanelProps) {
  const { t } = useTranslation("workspace");
  const api = readNativeApi();
  const isLiveRuntime = runtimeMode === "live";
  const threadBrowserState = useStore(useBrowserStateStore, selectThreadBrowserState(threadId));
  const recentHistory = useStore(useBrowserStateStore, selectThreadBrowserHistory(threadId));
  const upsertThreadState = useBrowserStateStore((store) => store.upsertThreadState);
  const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
  const addBrowserFinding = useComposerDraftStore((store) => store.addBrowserFinding);
  const browserFindings = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.browserFindings ?? EMPTY_BROWSER_FINDINGS,
  );
  const composerDraftImageCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.images.length ?? 0,
  );
  const composerDraftFileCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.files.length ?? 0,
  );
  const composerDraftAssistantSelectionCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.assistantSelections.length ?? 0,
  );
  const addressInputRef = useRef<HTMLInputElement>(null);
  const browserTabsBarRef = useRef<HTMLDivElement>(null);
  const browserViewportRef = useRef<HTMLDivElement>(null);
  const browserWebviewRef = useRef<BrowserWebviewElement | null>(null);
  const browserWebviewTabIdRef = useRef<string | null>(null);
  const browserWebviewAttachKeyRef = useRef<string | null>(null);
  const copyScreenshotButtonRef = useRef<HTMLButtonElement>(null);
  const addressDraftsByTabIdRef = useRef(new Map<string, string>());
  const lastSyncedAddressByTabIdRef = useRef(new Map<string, string>());
  const previousActiveTabIdRef = useRef<string | null>(null);
  const commentingGenerationRef = useRef(0);
  const commentingTransitionErrorRef = useRef<string | null>(null);
  const commentingLifecycle = useMemo(
    () =>
      api
        ? new BrowserCommentingLifecycle((tabId, enabled) =>
            api.browser.annotationCommand({
              threadId,
              tabId,
              command: { type: enabled ? "enable" : "disable" },
            }),
          )
        : null,
    [api, threadId],
  );
  const lastSentBoundsRef = useRef<string | null>(null);
  const lastMeasuredBoundsKeyRef = useRef<string | null>(null);
  const lastOverlayObscuredRef = useRef(false);
  const isAddressEditingRef = useRef(false);
  const resizeFrameRef = useRef<number | null>(null);
  const boundsBurstFrameRef = useRef<number | null>(null);
  const burstFramesRemainingRef = useRef(0);
  const burstStableFramesRef = useRef(0);
  const perfCountersRef = useRef<BrowserViewportPerfCounters>({
    syncAttempts: 0,
    syncSkips: 0,
    syncSends: 0,
    resizeSchedules: 0,
    resizeScheduleSkips: 0,
    burstStarts: 0,
    burstExtensions: 0,
    burstFrames: 0,
    transitionSignals: 0,
    ignoredTransitionSignals: 0,
  });
  const [addressValue, setAddressValue] = useState("");
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [localError, setLocalError] = useState<BrowserLocalError>(null);
  const [commenting, setCommenting] = useState(false);
  const [annotationSelection, setAnnotationSelection] = useState<BrowserAnnotationSelection | null>(
    null,
  );
  const [annotationSelectionTabId, setAnnotationSelectionTabId] = useState<string | null>(null);
  const [annotationComment, setAnnotationComment] = useState("");
  const [annotationAdjustments, setAnnotationAdjustments] = useState<BrowserAnnotationAdjustments>(
    {},
  );
  const [annotationAdjustOpen, setAnnotationAdjustOpen] = useState(false);
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [annotationRuntimeRevision, setAnnotationRuntimeRevision] = useState(0);
  const [attachedWebviewTabId, setAttachedWebviewTabId] = useState<string | null>(null);
  const annotationAdjustmentsValid = Schema.is(BrowserAnnotationAdjustmentsSchema)(
    annotationAdjustments,
  );
  const runtimeReady = isLiveRuntime ? workspaceReady : true;
  const activeTab =
    threadBrowserState?.tabs.find((tab) => tab.id === threadBrowserState.activeTabId) ??
    threadBrowserState?.tabs[0] ??
    null;
  const browserTabIdsKey = threadBrowserState?.tabs.map((tab) => tab.id).join("\0") ?? "";
  const loading = activeTab?.isLoading ?? false;
  const activeTabIsBlank = isBlankBrowserTabUrl(activeTab);
  const showLocalServersHome = isLiveRuntime && workspaceReady && (!activeTab || activeTabIsBlank);
  const localServersQuery = useQuery(serverLocalServersQueryOptions(showLocalServersHome));
  const activeTabStatus = activeTab?.status ?? "suspended";
  const localErrorSummary = localError
    ? localError.values
      ? t(localError.key, localError.values)
      : t(localError.key)
    : null;
  const browserChromeStatus = resolveBrowserChromeStatus({
    localError: localErrorSummary,
    threadLastError: threadBrowserState?.lastError,
    activeTabStatus: showLocalServersHome ? "live" : activeTabStatus,
    hasActiveTab: activeTab !== null,
    workspaceReady: runtimeReady,
    labels: {
      noTabs: t("browser.status.noTabs"),
      restoring: t("browser.status.restoring"),
      starting: t("browser.status.starting"),
    },
  });
  const browserChromeStatusDetail =
    localError?.detail ?? (localError === null ? (threadBrowserState?.lastError ?? null) : null);
  const browserAddressSuggestions = buildBrowserAddressSuggestions({
    query: addressValue,
    activeTabId: activeTab?.id ?? null,
    tabs: threadBrowserState?.tabs ?? [],
    recentHistory,
  });
  const showBrowserAddressSuggestions =
    isLiveRuntime && isAddressFocused && browserAddressSuggestions.length > 0 && runtimeReady;

  const requestLiveRuntime = useCallback(() => {
    onRequestLive?.();
  }, [onRequestLive]);

  const ensureLiveRuntime = useCallback(() => {
    if (isLiveRuntime) {
      return true;
    }
    requestLiveRuntime();
    return false;
  }, [isLiveRuntime, requestLiveRuntime]);

  const runBrowserAction = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await action();
      setLocalError(null);
      return result;
    } catch (error) {
      const detail = browserActionErrorDetail(error);
      setLocalError(detail === null ? null : { key: "browser.errors.action", detail });
      return null;
    }
  }, []);

  const cancelAnnotationSelection = useCallback(async (): Promise<boolean> => {
    const tabId = annotationSelectionTabId ?? activeTab?.id;
    if (api && tabId) {
      const recovery = await restoreOrDisableBrowserAnnotation(
        () =>
          api.browser.annotationCommand({
            threadId,
            tabId,
            command: { type: "cancel-selection" },
          }),
        () =>
          api.browser.annotationCommand({
            threadId,
            tabId,
            command: { type: "disable" },
          }),
      );
      if (recovery === "failed") {
        setLocalError({ key: "browser.errors.restoreAnnotation" });
        return false;
      }
      if (recovery === "disabled") setCommenting(false);
    }
    setAnnotationSelection(null);
    setAnnotationSelectionTabId(null);
    setAnnotationComment("");
    setAnnotationAdjustments({});
    setAnnotationAdjustOpen(false);
    return true;
  }, [activeTab?.id, annotationSelectionTabId, api, threadId]);

  const confirmDiscardAnnotation = useCallback(async () => {
    if (!annotationSelection) return true;
    if (!api) return false;
    const confirmed = await api.dialogs.confirm(t("browser.confirmDiscard"));
    if (!confirmed) return false;
    return cancelAnnotationSelection();
  }, [annotationSelection, api, cancelAnnotationSelection, t]);

  // Renderer-owned <webview>s are adopted by the desktop manager. Always detach before
  // removing the DOM node so main never keeps a stale webContents runtime.
  const detachRendererBrowserWebview = useCallback(() => {
    const webview = browserWebviewRef.current;
    const tabId = browserWebviewTabIdRef.current;

    if (webview && api && isLiveRuntime && tabId) {
      let webContentsId: number | undefined;
      try {
        webContentsId = webview.getWebContentsId?.();
      } catch {
        webContentsId = undefined;
      }
      if (webContentsId && webContentsId > 0) {
        void api.browser
          .detachWebview({ threadId, tabId, webContentsId })
          .catch(ignoreBrowserWebviewDetachError);
      }
    }

    webview?.remove();
    browserWebviewRef.current = null;
    browserWebviewTabIdRef.current = null;
    browserWebviewAttachKeyRef.current = null;
    setAttachedWebviewTabId(null);
  }, [api, isLiveRuntime, threadId]);

  useEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    return api.browser.onState((state) => {
      upsertThreadState(state);
    });
  }, [api, isLiveRuntime, upsertThreadState]);

  useEffect(() => {
    if (!api || !isLiveRuntime) return;
    return api.browser.onAnnotationEvent((event) => {
      if (event.threadId !== threadId || event.tabId !== activeTab?.id) return;
      if (event.type === "selected") {
        setAnnotationSelection(event.selection);
        setAnnotationSelectionTabId(event.tabId);
        setAnnotationComment("");
        setAnnotationAdjustments({});
        setAnnotationAdjustOpen(false);
      } else if (event.type === "cancelled" || event.type === "runtime-ready") {
        if (event.type === "runtime-ready") {
          setAnnotationRuntimeRevision((revision) => revision + 1);
        }
        setAnnotationSelection(null);
        setAnnotationSelectionTabId(null);
        setAnnotationComment("");
        setAnnotationAdjustments({});
      } else {
        if (
          shouldPreserveBrowserCommentingDuringTransitionFailure({
            desiredEnabled: commenting,
            activeTabIsLoading: activeTab?.isLoading ?? false,
            activeTabAttached: attachedWebviewTabId === event.tabId,
          })
        ) {
          return;
        }
        commentingTransitionErrorRef.current = event.message;
        setLocalError({ key: "browser.errors.annotation", detail: event.message });
        void cancelAnnotationSelection().then(() => setCommenting(false));
      }
    });
  }, [
    activeTab?.id,
    activeTab?.isLoading,
    api,
    attachedWebviewTabId,
    cancelAnnotationSelection,
    commenting,
    isLiveRuntime,
    threadId,
  ]);

  useEffect(() => {
    if (!api || !annotationSelection || !annotationSelectionTabId || !annotationAdjustmentsValid)
      return;
    const timeout = window.setTimeout(() => {
      void api.browser
        .annotationCommand({
          threadId,
          tabId: annotationSelectionTabId,
          command: {
            type: "preview",
            selectionId: annotationSelection.id,
            adjustments: annotationAdjustments,
          },
        })
        .catch(() => {
          setLocalError({ key: "browser.errors.previewAdjustment" });
          void cancelAnnotationSelection();
        });
    }, 60);
    return () => window.clearTimeout(timeout);
  }, [
    annotationAdjustments,
    annotationAdjustmentsValid,
    annotationSelection,
    annotationSelectionTabId,
    api,
    cancelAnnotationSelection,
    threadId,
  ]);

  useEffect(
    () => () => {
      commentingGenerationRef.current += 1;
      if (!commentingLifecycle || !isLiveRuntime) return;
      void commentingLifecycle.reconcile(false, null, new Set(browserTabIdsKey.split("\0")));
    },
    [browserTabIdsKey, commentingLifecycle, isLiveRuntime],
  );

  const toggleCommenting = useCallback(async () => {
    if (!ensureLiveRuntime() || !api || !activeTab) return;
    const next = !commenting;
    if (!next && annotationSelection && !(await cancelAnnotationSelection())) return;
    setCommenting(next);
  }, [
    activeTab,
    annotationSelection,
    api,
    cancelAnnotationSelection,
    commenting,
    ensureLiveRuntime,
  ]);

  useEffect(() => {
    if (!commentingLifecycle || !isLiveRuntime) return;
    const generation = ++commentingGenerationRef.current;
    const currentTabId = activeTab?.id ?? null;
    const liveTabIds = new Set(browserTabIdsKey ? browserTabIdsKey.split("\0") : []);
    if (annotationSelectionTabId && annotationSelectionTabId !== currentTabId) {
      void cancelAnnotationSelection();
    }
    const runtimeTarget = resolveBrowserCommentingRuntimeTarget(
      commenting,
      currentTabId,
      attachedWebviewTabId,
    );
    void commentingLifecycle
      .reconcile(runtimeTarget.enabled, runtimeTarget.tabId, liveTabIds)
      .then(() => {
        if (generation !== commentingGenerationRef.current) return;
        const resolvedError = commentingTransitionErrorRef.current;
        if (resolvedError) {
          setLocalError((current) =>
            current?.key === "browser.errors.commentingMode" ? null : current,
          );
          commentingTransitionErrorRef.current = null;
        }
      })
      .catch(() => {
        if (generation !== commentingGenerationRef.current) return;
        const message = "commenting-transition";
        if (
          shouldPreserveBrowserCommentingDuringTransitionFailure({
            desiredEnabled: commenting,
            activeTabIsLoading: activeTab?.isLoading ?? false,
            activeTabAttached: attachedWebviewTabId === currentTabId,
          })
        ) {
          return;
        }
        commentingTransitionErrorRef.current = message;
        setLocalError({ key: "browser.errors.commentingMode" });
        void cancelAnnotationSelection();
        setCommenting(false);
      });
  }, [
    activeTab?.id,
    activeTab?.isLoading,
    activeTab?.lastCommittedUrl,
    annotationRuntimeRevision,
    annotationSelectionTabId,
    attachedWebviewTabId,
    browserTabIdsKey,
    cancelAnnotationSelection,
    commenting,
    commentingLifecycle,
    isLiveRuntime,
  ]);

  const saveAnnotation = useCallback(async () => {
    if (!api || !annotationSelection || !annotationSelectionTabId || annotationSaving) return;
    const comment = annotationComment.trim();
    if (!comment || !annotationAdjustmentsValid) return;
    const attachmentCount =
      composerDraftImageCount + composerDraftFileCount + composerDraftAssistantSelectionCount;
    if (attachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      setLocalError({
        key: "browser.errors.attachmentCount",
        values: { count: PROVIDER_SEND_TURN_MAX_ATTACHMENTS },
      });
      return;
    }
    setAnnotationSaving(true);
    let pendingImage: { id: string; previewUrl: string } | null = null;
    try {
      const markerNumber =
        Array.from({ length: 20 }, (_, index) => index + 1).find(
          (number) => !browserFindings.some((finding) => finding.markerNumber === number),
        ) ?? 20;
      const screenshot = await api.browser.captureAnnotation({
        threadId,
        tabId: annotationSelectionTabId,
        selectionId: annotationSelection.id,
        markerNumber,
        adjustments: annotationAdjustments,
      });
      await api.browser.annotationCommand({
        threadId,
        tabId: annotationSelectionTabId,
        command: {
          type: "preview",
          selectionId: annotationSelection.id,
          adjustments: annotationAdjustments,
        },
      });
      if (screenshot.sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
        setLocalError({
          key: "browser.errors.attachmentSize",
          values: { name: screenshot.name, limit: IMAGE_SIZE_LIMIT_LABEL },
        });
        return;
      }
      const image = composerImageFromBrowserScreenshot(screenshot);
      pendingImage = { id: image.id, previewUrl: image.previewUrl };
      addComposerDraftImage(threadId, image);
      const accepted = addBrowserFinding(threadId, {
        version: 1,
        id: crypto.randomUUID(),
        imageId: image.id,
        screenshotName: screenshot.name,
        markerNumber,
        comment,
        target: screenshot.target,
        page: screenshot.page,
        viewport: screenshot.viewport,
        adjustments: annotationAdjustments,
        createdAt: new Date().toISOString(),
      });
      if (!accepted) {
        useComposerDraftStore.getState().removeImage(threadId, image.id);
        pendingImage = null;
        setLocalError({ key: "browser.errors.saveFinding" });
        return;
      }
      pendingImage = null;
      if (await cancelAnnotationSelection()) setLocalError(null);
    } catch (error) {
      if (pendingImage) {
        useComposerDraftStore.getState().removeImage(threadId, pendingImage.id);
        URL.revokeObjectURL(pendingImage.previewUrl);
      }
      const detail = browserActionErrorDetail(error);
      setLocalError(detail === null ? null : { key: "browser.errors.action", detail });
      await cancelAnnotationSelection();
    } finally {
      setAnnotationSaving(false);
    }
  }, [
    addBrowserFinding,
    addComposerDraftImage,
    annotationAdjustments,
    annotationAdjustmentsValid,
    annotationComment,
    annotationSaving,
    annotationSelection,
    annotationSelectionTabId,
    api,
    browserFindings,
    cancelAnnotationSelection,
    composerDraftAssistantSelectionCount,
    composerDraftFileCount,
    composerDraftImageCount,
    threadId,
  ]);

  useEffect(() => {
    if (!commenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (annotationSelection) void cancelAnnotationSelection();
        else void toggleCommenting();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && annotationSelection) {
        event.preventDefault();
        void saveAnnotation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    annotationSelection,
    cancelAnnotationSelection,
    commenting,
    saveAnnotation,
    toggleCommenting,
  ]);

  useEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    let cancelled = false;
    setWorkspaceReady(false);
    setLocalError(null);

    void runBrowserAction(() => api.browser.open({ threadId })).then((state) => {
      if (cancelled) {
        return;
      }
      if (!state) {
        setWorkspaceReady(true);
        return;
      }
      upsertThreadState(state);
      setWorkspaceReady(true);
    });

    return () => {
      cancelled = true;
      void api.browser.hide({ threadId });
    };
  }, [api, isLiveRuntime, runBrowserAction, threadId, upsertThreadState]);

  useEffect(() => {
    const activeTabId = activeTab?.id ?? null;
    const nextDisplayValue = browserAddressDisplayValue(activeTab);
    const decision = resolveBrowserAddressSync({
      activeTabId,
      previousActiveTabId: previousActiveTabIdRef.current,
      savedDraft: activeTabId ? addressDraftsByTabIdRef.current.get(activeTabId) : undefined,
      nextDisplayValue,
      lastSyncedValue: activeTabId
        ? lastSyncedAddressByTabIdRef.current.get(activeTabId)
        : undefined,
      isEditing: isAddressEditingRef.current,
    });

    if (decision.type === "replace") {
      setAddressValue(decision.value);
      if (activeTabId) {
        addressDraftsByTabIdRef.current.set(activeTabId, decision.value);
        if (decision.syncedValue !== undefined) {
          lastSyncedAddressByTabIdRef.current.set(activeTabId, decision.syncedValue);
        }
      }
    }

    previousActiveTabIdRef.current = activeTabId;
  }, [activeTab]);

  useLayoutEffect(() => {
    if (!api || !isLiveRuntime || !workspaceReady || !activeTab) {
      return;
    }

    if (showLocalServersHome) {
      detachRendererBrowserWebview();
      return;
    }

    const host = browserViewportRef.current;
    if (!host) {
      return;
    }

    let webview = browserWebviewRef.current;
    if (!webview) {
      webview = document.createElement("webview") as BrowserWebviewElement;
      webview.className = "h-full w-full";
      webview.style.display = "flex";
      webview.style.width = "100%";
      webview.style.height = "100%";
      webview.style.backgroundColor = "#0d0d0d";
      webview.setAttribute("partition", BROWSER_WEBVIEW_PARTITION);
      webview.setAttribute("webpreferences", "contextIsolation=yes,nodeIntegration=no,sandbox=yes");
      // A <webview> blocks window.open() unless `allowpopups` is set. Without it, clicking
      // "Continue with Google" (and any OAuth/popup flow) is silently dropped before the main
      // process's window-open handler ever runs. Enabling it lets the popup classifier in
      // browserManager decide popup-vs-tab and keep the OAuth `window.opener` handshake alive.
      webview.setAttribute("allowpopups", "true");
      // No `useragent` attribute on purpose: the desktop main process spoofs a desktop Chrome
      // UA on the shared persistent partition, so this webview (and OAuth popups) inherit the
      // same identity. This keeps in-app Google/OAuth sign-in working without duplicating the
      // UA string into the renderer.
      browserWebviewRef.current = webview;
      host.append(webview);
    } else if (webview.parentElement !== host) {
      host.append(webview);
    }

    const initialUrl = activeTab.lastCommittedUrl ?? activeTab.url ?? BROWSER_BLANK_URL;
    if (browserWebviewTabIdRef.current !== activeTab.id) {
      setAttachedWebviewTabId(null);
      browserWebviewTabIdRef.current = activeTab.id;
      browserWebviewAttachKeyRef.current = null;
      webview.setAttribute("src", initialUrl.length > 0 ? initialUrl : BROWSER_BLANK_URL);
    }

    const attachVisibleWebview = () => {
      let webContentsId: number | undefined;
      try {
        webContentsId = webview.getWebContentsId?.();
      } catch {
        return;
      }
      if (!webContentsId || webContentsId <= 0) {
        return;
      }

      const attachKey = `${activeTab.id}:${webContentsId}`;
      if (browserWebviewAttachKeyRef.current === attachKey) {
        return;
      }
      browserWebviewAttachKeyRef.current = attachKey;
      void runBrowserAction(() =>
        api.browser.attachWebview({
          threadId,
          tabId: activeTab.id,
          webContentsId,
        }),
      ).then((state) => {
        if (
          state &&
          browserWebviewAttachKeyRef.current === attachKey &&
          browserWebviewTabIdRef.current === activeTab.id
        ) {
          upsertThreadState(state);
          setAttachedWebviewTabId(activeTab.id);
        }
      });
    };

    webview.addEventListener("dom-ready", attachVisibleWebview);
    webview.addEventListener("did-start-loading", attachVisibleWebview);
    window.requestAnimationFrame(attachVisibleWebview);

    return () => {
      webview.removeEventListener("dom-ready", attachVisibleWebview);
      webview.removeEventListener("did-start-loading", attachVisibleWebview);
    };
  }, [
    activeTab,
    api,
    detachRendererBrowserWebview,
    isLiveRuntime,
    runBrowserAction,
    showLocalServersHome,
    threadId,
    upsertThreadState,
    workspaceReady,
  ]);

  useEffect(() => {
    return () => {
      detachRendererBrowserWebview();
    };
  }, [detachRendererBrowserWebview]);

  useEffect(() => {
    const liveTabIds = new Set(threadBrowserState?.tabs.map((tab) => tab.id) ?? []);
    for (const tabId of addressDraftsByTabIdRef.current.keys()) {
      if (!liveTabIds.has(tabId)) {
        addressDraftsByTabIdRef.current.delete(tabId);
        lastSyncedAddressByTabIdRef.current.delete(tabId);
      }
    }
  }, [threadBrowserState?.tabs]);

  useEffect(() => {
    if (!isLiveRuntime || !isBrowserPerfLoggingEnabled()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      console.info("[DJL browser panel perf]", {
        threadId,
        ...perfCountersRef.current,
      });
    }, BROWSER_PERF_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLiveRuntime, threadId]);

  useLayoutEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    const element = browserViewportRef.current;
    if (!element) {
      return;
    }

    const syncBounds = () => {
      perfCountersRef.current.syncAttempts += 1;
      // While the local-servers home is up, force the browser surface hidden instead of
      // trusting the obscuring-overlay heuristic. The native/inline webview otherwise paints
      // about:blank white over our dark DOM home — the "always white" empty state.
      const obscuredByOverlay = showLocalServersHome || hasNativeBrowserObscuringOverlay(element);
      lastOverlayObscuredRef.current = obscuredByOverlay;
      setBrowserWebviewOverlayOcclusion(browserWebviewRef.current, obscuredByOverlay);
      const rect = element.getBoundingClientRect();
      const bounds = obscuredByOverlay
        ? null
        : (() => {
            if (rect.width <= 0 || rect.height <= 0) {
              return null;
            }
            return {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            };
          })();
      const nextKey = bounds
        ? `renderer:${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}`
        : "renderer:hidden";
      lastMeasuredBoundsKeyRef.current = nextKey;
      if (lastSentBoundsRef.current === nextKey) {
        perfCountersRef.current.syncSkips += 1;
        return;
      }
      lastSentBoundsRef.current = nextKey;
      perfCountersRef.current.syncSends += 1;
      void api.browser
        .setPanelBounds({ threadId, bounds, surface: "renderer" })
        .catch(ignoreBrowserBoundsSyncError);
    };

    // The panel can slide horizontally without resizing. A short burst keeps the
    // native browser view in lockstep without paying for a long frame-by-frame loop.
    const syncBoundsBurst = (frames = BROWSER_BOUNDS_SYNC_BURST_FRAMES) => {
      if (boundsBurstFrameRef.current !== null) {
        perfCountersRef.current.burstExtensions += 1;
        burstFramesRemainingRef.current = Math.max(burstFramesRemainingRef.current, frames);
        burstStableFramesRef.current = 0;
        return;
      }

      perfCountersRef.current.burstStarts += 1;
      burstFramesRemainingRef.current = frames;
      burstStableFramesRef.current = 0;
      const tick = () => {
        perfCountersRef.current.burstFrames += 1;
        const previousMeasuredKey = lastMeasuredBoundsKeyRef.current;
        syncBounds();
        const measuredHidden = lastMeasuredBoundsKeyRef.current?.endsWith(":hidden") ?? false;
        if (!measuredHidden && lastMeasuredBoundsKeyRef.current === previousMeasuredKey) {
          burstStableFramesRef.current += 1;
        } else {
          burstStableFramesRef.current = 0;
        }
        burstFramesRemainingRef.current -= 1;
        if (
          burstFramesRemainingRef.current > 0 &&
          burstStableFramesRef.current < BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET
        ) {
          boundsBurstFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }
        boundsBurstFrameRef.current = null;
        burstFramesRemainingRef.current = 0;
        burstStableFramesRef.current = 0;
      };

      boundsBurstFrameRef.current = window.requestAnimationFrame(tick);
    };

    const scheduleSyncBounds = () => {
      perfCountersRef.current.resizeSchedules += 1;
      if (resizeFrameRef.current !== null) {
        perfCountersRef.current.resizeScheduleSkips += 1;
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        syncBounds();
      });
    };

    const handleTransitionBounds = (event: TransitionEvent) => {
      if (!isNativeBrowserTransitionSignalTarget(event.target, element)) {
        perfCountersRef.current.ignoredTransitionSignals += 1;
        return;
      }

      if (
        event.propertyName.length > 0 &&
        !VIEWPORT_TRANSITION_PROPERTIES.has(event.propertyName)
      ) {
        perfCountersRef.current.ignoredTransitionSignals += 1;
        return;
      }

      perfCountersRef.current.transitionSignals += 1;
      scheduleSyncBounds();
      if (event.type === "transitionrun") {
        syncBoundsBurst();
      }
    };

    syncBounds();
    syncBoundsBurst();
    const observer = new ResizeObserver(() => {
      scheduleSyncBounds();
    });
    observer.observe(element);
    window.addEventListener("resize", scheduleSyncBounds);
    window.addEventListener(PANEL_RESIZE_OVERLAY_SYNC_EVENT, scheduleSyncBounds);
    document.addEventListener("transitionrun", handleTransitionBounds, true);
    document.addEventListener("transitionend", handleTransitionBounds, true);
    document.addEventListener("transitioncancel", handleTransitionBounds, true);

    return () => {
      setBrowserWebviewOverlayOcclusion(browserWebviewRef.current, false);
      observer.disconnect();
      window.removeEventListener("resize", scheduleSyncBounds);
      window.removeEventListener(PANEL_RESIZE_OVERLAY_SYNC_EVENT, scheduleSyncBounds);
      document.removeEventListener("transitionrun", handleTransitionBounds, true);
      document.removeEventListener("transitionend", handleTransitionBounds, true);
      document.removeEventListener("transitioncancel", handleTransitionBounds, true);
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (boundsBurstFrameRef.current !== null) {
        cancelAnimationFrame(boundsBurstFrameRef.current);
        boundsBurstFrameRef.current = null;
      }
      burstFramesRemainingRef.current = 0;
      burstStableFramesRef.current = 0;
    };
  }, [api, isLiveRuntime, showLocalServersHome, threadId]);

  const onSubmitAddress = useCallback(async () => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api || !activeTab) {
      return;
    }
    if (!(await confirmDiscardAnnotation())) return;
    isAddressEditingRef.current = false;
    setIsAddressFocused(false);
    const normalizedAddress = normalizeBrowserAddressInput(addressValue);
    addressDraftsByTabIdRef.current.set(activeTab.id, normalizedAddress);
    setAddressValue(normalizedAddress);
    void runBrowserAction(() =>
      api.browser.navigate({
        threadId,
        tabId: activeTab.id,
        url: normalizedAddress,
      }),
    ).then((state) => {
      if (state) {
        upsertThreadState(state);
      }
    });
  }, [
    activeTab,
    addressValue,
    api,
    ensureLiveRuntime,
    runBrowserAction,
    confirmDiscardAnnotation,
    threadId,
    upsertThreadState,
  ]);

  const onChooseSuggestion = useCallback(
    async (suggestion: BrowserAddressSuggestion) => {
      if (!api) {
        return;
      }
      if (!ensureLiveRuntime()) {
        return;
      }
      if (!(await confirmDiscardAnnotation())) return;

      isAddressEditingRef.current = false;
      setIsAddressFocused(false);
      setAddressValue(suggestion.url);

      const tabId = suggestion.tabId;
      if (suggestion.kind === "tab" && typeof tabId === "string") {
        void runBrowserAction(() => api.browser.selectTab({ threadId, tabId })).then((state) => {
          if (state) {
            upsertThreadState(state);
          }
          window.requestAnimationFrame(() => {
            addressInputRef.current?.focus();
            addressInputRef.current?.select();
          });
        });
        return;
      }

      if (activeTab) {
        addressDraftsByTabIdRef.current.set(activeTab.id, suggestion.url);
      }

      void runBrowserAction(() =>
        api.browser.navigate({
          threadId,
          url: suggestion.url,
          ...(activeTab ? { tabId: activeTab.id } : {}),
        }),
      ).then((state) => {
        if (state) {
          upsertThreadState(state);
        }
      });
    },
    [
      activeTab,
      api,
      confirmDiscardAnnotation,
      ensureLiveRuntime,
      runBrowserAction,
      threadId,
      upsertThreadState,
    ],
  );

  const onOpenLocalServer = useCallback(
    (url: string, tabId: string | null) => {
      if (!api) {
        return;
      }
      if (!ensureLiveRuntime()) {
        return;
      }

      isAddressEditingRef.current = false;
      setIsAddressFocused(false);
      setAddressValue(url);
      if (tabId) {
        addressDraftsByTabIdRef.current.set(tabId, url);
      }

      void runBrowserAction(() =>
        api.browser.navigate({
          threadId,
          url,
          ...(tabId ? { tabId } : {}),
        }),
      ).then((state) => {
        if (state) {
          upsertThreadState(state);
        }
      });
    },
    [api, ensureLiveRuntime, runBrowserAction, threadId, upsertThreadState],
  );

  const onCreateTab = useCallback(async () => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api) {
      return;
    }
    if (!(await confirmDiscardAnnotation())) return;
    void runBrowserAction(() => api.browser.newTab({ threadId, activate: true })).then((state) => {
      if (state) {
        upsertThreadState(state);
      }
      window.requestAnimationFrame(() => {
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
      });
    });
  }, [
    api,
    confirmDiscardAnnotation,
    ensureLiveRuntime,
    runBrowserAction,
    threadId,
    upsertThreadState,
  ]);

  const onCaptureScreenshot = useCallback(() => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api || !activeTab) {
      return;
    }

    const attachmentCount =
      composerDraftImageCount + composerDraftFileCount + composerDraftAssistantSelectionCount;
    if (attachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      setLocalError({
        key: "browser.errors.attachmentCount",
        values: { count: PROVIDER_SEND_TURN_MAX_ATTACHMENTS },
      });
      return;
    }

    void runBrowserAction(() =>
      api.browser.captureScreenshot({ threadId, tabId: activeTab.id }),
    ).then((screenshot) => {
      if (!screenshot) {
        return;
      }
      if (screenshot.sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
        setLocalError({
          key: "browser.errors.attachmentSize",
          values: {
            name: screenshotAttachmentName(screenshot),
            limit: IMAGE_SIZE_LIMIT_LABEL,
          },
        });
        return;
      }

      addComposerDraftImage(threadId, composerImageFromBrowserScreenshot(screenshot));
      setLocalError(null);
    });
  }, [
    activeTab,
    addComposerDraftImage,
    api,
    composerDraftAssistantSelectionCount,
    composerDraftFileCount,
    composerDraftImageCount,
    ensureLiveRuntime,
    runBrowserAction,
    threadId,
  ]);

  const onCopyScreenshotToClipboard = useCallback(() => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api || !activeTab) {
      return;
    }

    void runBrowserAction(() =>
      api.browser.copyScreenshotToClipboard({ threadId, tabId: activeTab.id }),
    ).then((result) => {
      if (result === null) {
        return;
      }
      const anchor = copyScreenshotButtonRef.current;
      if (anchor) {
        anchoredToastManager.add({
          data: {
            tooltipStyle: true,
          },
          positionerProps: {
            anchor,
          },
          timeout: 1_200,
          title: t("browser.screenshotCopied"),
        });
        return;
      }

      toastManager.add({
        type: "success",
        title: t("browser.screenshotCopied"),
      });
    });
  }, [activeTab, api, ensureLiveRuntime, runBrowserAction, t, threadId]);

  const copyActiveTabLink = useCallback(() => {
    if (!activeTab) {
      return;
    }
    // Desktop: copy through the native Electron clipboard. navigator.clipboard can reject
    // with "Document is not focused" while the native browser view holds focus, so this
    // mirrors the keyboard chord — main writes the URL and emits onCopyLink, which surfaces
    // the toast in the listener below.
    if (isElectron && api) {
      void runBrowserAction(() => api.browser.copyLink({ threadId, tabId: activeTab.id }));
      return;
    }
    const url = resolveCopyableBrowserTabUrl(activeTab);
    if (!url) {
      return;
    }
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard) {
      return;
    }
    void clipboard.writeText(url).then(
      () => {
        toastManager.add({ type: "success", title: t("browser.linkCopied") });
      },
      () => {
        // Clipboard writes can reject without user gesture; nothing actionable to surface.
      },
    );
  }, [activeTab, api, runBrowserAction, t, threadId]);

  // React chrome focus path: the native page handles the chord through the desktop main
  // process, so this only fires when the address bar/tab strip (not the page) is focused.
  useEffect(() => {
    if (!isLiveRuntime) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const matches = isBrowserCopyLinkChord(
        {
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          key: event.key,
        },
        isMacPlatform(navigator.platform),
      );
      if (!matches) {
        return;
      }
      event.preventDefault();
      copyActiveTabLink();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [copyActiveTabLink, isLiveRuntime]);

  // Native page focus path: main already wrote the URL to the clipboard, so just toast.
  useEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }
    return api.browser.onCopyLink((event) => {
      if (event.threadId !== threadId) {
        return;
      }
      toastManager.add({ type: "success", title: t("browser.linkCopied") });
    });
  }, [api, isLiveRuntime, t, threadId]);

  const onCloseTab = useCallback(
    async (tabId: string) => {
      if (!ensureLiveRuntime()) {
        return;
      }
      if (!api) {
        return;
      }
      if (!(await confirmDiscardAnnotation())) return;
      void runBrowserAction(() => api.browser.closeTab({ threadId, tabId })).then((state) => {
        if (!state) {
          return;
        }
        upsertThreadState(state);
        if (!state.open && state.tabs.length === 0) {
          onClosePanel();
        }
      });
    },
    [
      api,
      confirmDiscardAnnotation,
      ensureLiveRuntime,
      onClosePanel,
      runBrowserAction,
      threadId,
      upsertThreadState,
    ],
  );

  const requestClosePanel = useCallback(
    async (onClosed: () => void = onClosePanel) => {
      await requestBrowserPanelClose(confirmDiscardAnnotation, onClosed);
    },
    [confirmDiscardAnnotation, onClosePanel],
  );

  useEffect(() => {
    if (!onRegisterCloseRequest) return;
    return onRegisterCloseRequest((onClosed) => void requestClosePanel(onClosed));
  }, [onRegisterCloseRequest, requestClosePanel]);

  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {/* Keep the browser chrome interactive inside Electron's draggable titlebar. */}
      <div className="relative flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab?.canGoBack}
            onClick={async () => {
              if (!ensureLiveRuntime()) return;
              if (!api || !activeTab) return;
              if (!(await confirmDiscardAnnotation())) return;
              void runBrowserAction(() =>
                api.browser.goBack({ threadId, tabId: activeTab.id }),
              ).then((state) => {
                if (state) {
                  upsertThreadState(state);
                }
              });
            }}
          >
            <ArrowLeftIcon className="size-3.5" />
            <span className="sr-only">{t("browser.actions.back")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab?.canGoForward}
            onClick={async () => {
              if (!ensureLiveRuntime()) return;
              if (!api || !activeTab) return;
              if (!(await confirmDiscardAnnotation())) return;
              void runBrowserAction(() =>
                api.browser.goForward({ threadId, tabId: activeTab.id }),
              ).then((state) => {
                if (state) {
                  upsertThreadState(state);
                }
              });
            }}
          >
            <ArrowRightIcon className="size-3.5" />
            <span className="sr-only">{t("browser.actions.forward")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab}
            onClick={async () => {
              if (!ensureLiveRuntime()) return;
              if (!api || !activeTab) return;
              if (!(await confirmDiscardAnnotation())) return;
              void runBrowserAction(() =>
                api.browser.reload({ threadId, tabId: activeTab.id }),
              ).then((state) => {
                if (state) {
                  upsertThreadState(state);
                }
              });
            }}
          >
            {loading ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            <span className="sr-only">{t("browser.actions.reload")}</span>
          </Button>
        </div>
        <form
          className="min-w-0 flex-1 [-webkit-app-region:no-drag]"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitAddress();
          }}
        >
          <Input
            ref={addressInputRef}
            value={addressValue}
            onChange={(event) => {
              if (!isLiveRuntime) {
                requestLiveRuntime();
              }
              const nextValue = event.target.value;
              isAddressEditingRef.current = true;
              setAddressValue(nextValue);
              if (activeTab) {
                addressDraftsByTabIdRef.current.set(activeTab.id, nextValue);
              }
            }}
            onFocus={() => {
              if (!isLiveRuntime) {
                requestLiveRuntime();
              }
              isAddressEditingRef.current = true;
              setIsAddressFocused(true);
            }}
            onBlur={() => {
              isAddressEditingRef.current = false;
              setIsAddressFocused(false);
            }}
            placeholder={t("browser.addressPlaceholder")}
            className={cn(
              "font-mono min-w-0 [-webkit-app-region:no-drag]",
              BROWSER_CHROME_CONTROL_CLASS_NAME,
              BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME,
            )}
          />
        </form>
        {showBrowserAddressSuggestions ? (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-lg border border-border bg-popover shadow-lg [-webkit-app-region:no-drag]">
            <div className="max-h-64 overflow-auto p-1">
              {browserAddressSuggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChooseSuggestion(suggestion);
                  }}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-background/80">
                    {suggestion.kind === "navigate" ? (
                      <ExternalLinkIcon className="size-3 text-muted-foreground" />
                    ) : suggestion.faviconUrl ? (
                      <img alt="" src={suggestion.faviconUrl} className="size-3 rounded-[2px]" />
                    ) : (
                      <GlobeIcon className="size-3 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{suggestion.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {suggestion.detail}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <Button
          type="button"
          variant={commenting ? "secondary" : "ghost"}
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={!activeTab}
          aria-pressed={commenting}
          title={t("browser.commentingHint")}
          onClick={toggleCommenting}
        >
          <MessageCircleIcon className="size-3.5" />
          <span>{t("browser.commenting")}</span>
          {browserFindings.length > 0 ? (
            <span className="rounded-full bg-foreground/10 px-1.5 text-[10px]">
              {browserFindings.length}
            </span>
          ) : null}
        </Button>
        {commenting ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!activeTab || annotationSelection !== null}
            onClick={() => {
              if (!api || !activeTab) return;
              void api.browser
                .annotationCommand({
                  threadId,
                  tabId: activeTab.id,
                  command: { type: "select-area" },
                })
                .catch(() => {
                  setLocalError({ key: "browser.errors.areaSelection" });
                  void cancelAnnotationSelection();
                });
            }}
          >
            {t("browser.actions.selectArea")}
          </Button>
        ) : null}
        <Button
          ref={copyScreenshotButtonRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={!activeTab}
          aria-label={t("browser.actions.copyScreenshot")}
          title={t("browser.actions.copyScreenshot")}
          onClick={onCopyScreenshotToClipboard}
        >
          <CameraIcon className="size-3.5" />
          <span className="sr-only">{t("browser.actions.copyScreenshot")}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={!activeTab}
          aria-label={t("browser.actions.copyLink")}
          title={t("browser.actions.copyLink")}
          onClick={copyActiveTabLink}
        >
          <LinkIcon className="size-3.5" />
          <span className="sr-only">{t("browser.actions.copyLink")}</span>
        </Button>
        <Menu modal={false}>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label={t("browser.actions.menu")}
              />
            }
          >
            <EllipsisIcon className="size-3.5" />
          </MenuTrigger>
          <ComposerPickerMenuPopup
            align="end"
            side="bottom"
            className={BROWSER_ACTION_MENU_PANEL_CLASS_NAME}
          >
            <MenuItem className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME} onClick={onCreateTab}>
              <BrowserActionMenuIcon icon={PlusIcon} />
              <span>{t("browser.actions.newTab")}</span>
            </MenuItem>
            <MenuItem
              className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME}
              disabled={!activeTab}
              onClick={onCaptureScreenshot}
            >
              <BrowserActionMenuIcon icon={CameraIcon} />
              <span>{t("browser.actions.captureScreenshot")}</span>
            </MenuItem>
            <MenuItem
              className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME}
              disabled={!activeTab}
              onClick={() => {
                if (!ensureLiveRuntime()) return;
                if (!api || !activeTab) return;
                void api.shell.openExternal(activeTab.url);
              }}
            >
              <BrowserActionMenuIcon icon={ExternalLinkIcon} />
              <span>{t("browser.actions.openExternal")}</span>
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME}
              onClick={() => void requestClosePanel()}
            >
              <BrowserActionMenuIcon icon={XIcon} />
              <span>{t("browser.actions.closePanel")}</span>
            </MenuItem>
          </ComposerPickerMenuPopup>
        </Menu>
      </div>
    </div>
  );

  if (!api && isLiveRuntime) {
    return (
      <DiffPanelShell mode={mode} header={header}>
        <DiffPanelLoadingState label={t("browser.unavailable")} />
      </DiffPanelShell>
    );
  }

  return (
    <DiffPanelShell mode={mode} header={header}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={browserTabsBarRef}
          className={cn(
            "flex items-center gap-2 border-b border-border px-2 py-1.5",
            // Extend the frameless window drag region across the tab strip's empty space so
            // the panel is easy to grab; interactive children stay no-drag via global CSS.
            isElectron && mode !== "sheet" && "drag-region",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {threadBrowserState?.tabs.map((tab) => {
              const isActive = tab.id === activeTab?.id;
              const tabIsBlank = isBlankBrowserTabUrl(tab);
              return (
                <div
                  key={tab.id}
                  className={cn(
                    "group flex min-w-0 max-w-[14rem] items-center px-2.5 text-left transition-colors",
                    BROWSER_CHROME_CONTROL_CLASS_NAME,
                    isActive
                      ? cn(BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME, "text-foreground")
                      : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-background/40 hover:text-foreground",
                    tab.status === "suspended" && !tabIsBlank ? "opacity-75" : "",
                  )}
                >
                  <span className="mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm">
                    {tab.faviconUrl ? (
                      <img alt="" src={tab.faviconUrl} className="size-3 rounded-[2px]" />
                    ) : (
                      <GlobeIcon className="size-3 text-muted-foreground" />
                    )}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={async () => {
                      if (!ensureLiveRuntime()) return;
                      if (!api) return;
                      if (!(await confirmDiscardAnnotation())) return;
                      void runBrowserAction(() =>
                        api.browser.selectTab({ threadId, tabId: tab.id }),
                      ).then((state) => {
                        if (state) {
                          upsertThreadState(state);
                        }
                      });
                    }}
                  >
                    {tab.title || t("browser.untitled")}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={closeButtonClassName(isActive)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onCloseTab(tab.id);
                    }}
                  >
                    <XIcon className="size-3" />
                    <span className="sr-only">{t("browser.actions.closeTab")}</span>
                  </Button>
                </div>
              );
            })}
          </div>
          {browserChromeStatus ? (
            <div
              className={cn(
                "max-w-[13rem] shrink-0 truncate rounded-full border px-2.5 py-1 text-[11px] leading-none sm:max-w-[16rem]",
                browserChromeStatus.tone === "error"
                  ? "border-destructive/25 bg-destructive/8 text-destructive"
                  : "border-border/60 bg-background/80 text-muted-foreground",
              )}
              title={browserChromeStatusDetail ?? browserChromeStatus.label}
            >
              {browserChromeStatus.label}
              {browserChromeStatusDetail ? (
                <span className="sr-only"> {browserChromeStatusDetail}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="relative min-h-0 flex-1 bg-transparent">
          {!isLiveRuntime ? (
            <BrowserRuntimePreview
              title={activeTab?.title || t("browser.sleeping")}
              detail={activeTab?.lastCommittedUrl ?? activeTab?.url ?? t("browser.restoringCached")}
            />
          ) : !workspaceReady ? (
            <div className="absolute inset-0 z-10">
              <DiffPanelLoadingState label={t("browser.status.starting")} />
            </div>
          ) : null}
          {isLiveRuntime ? (
            <div ref={browserViewportRef} className="absolute inset-0 bg-[#0d0d0d]" />
          ) : null}
          {showLocalServersHome ? (
            <BrowserLocalServersHome
              activeTabId={activeTab?.id ?? null}
              loading={localServersQuery.isLoading || localServersQuery.isFetching}
              onNavigate={onOpenLocalServer}
              onRefresh={() => void localServersQuery.refetch()}
              servers={localServersQuery.data?.servers ?? []}
            />
          ) : null}
          {annotationSelection ? (
            <BrowserAnnotationEditor
              selection={annotationSelection}
              comment={annotationComment}
              adjustments={annotationAdjustments}
              adjustmentsValid={annotationAdjustmentsValid}
              adjustOpen={annotationAdjustOpen}
              saving={annotationSaving}
              onCommentChange={setAnnotationComment}
              onAdjustOpenChange={setAnnotationAdjustOpen}
              onAdjustmentsChange={setAnnotationAdjustments}
              onCancel={cancelAnnotationSelection}
              onSave={() => void saveAnnotation()}
            />
          ) : null}
        </div>
      </div>
    </DiffPanelShell>
  );
}

export default BrowserPanel;
