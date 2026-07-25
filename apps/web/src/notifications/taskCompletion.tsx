// FILE: taskCompletion.tsx
// Purpose: Bridges thread completion and attention-needed events to in-app toasts and OS notifications.
// Layer: Notification runtime
// Exports: TaskCompletionNotifications and browser permission helpers

import { ThreadId, type DesktopNotificationInput } from "@synara/contracts";
import type { TFunction } from "i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import englishCatalog from "../i18n/locales/en.json";
import { toastManager } from "../components/ui/toast";
import { resolveVisibleToastThreadIds } from "../components/ui/toastRouteVisibility";
import { useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { useDiffRouteSearch } from "../hooks/useDiffRouteSearch";
import { selectSplitView, useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { createAllThreadsSelector } from "../storeSelectors";
import { useTerminalStateStore } from "../terminalStateStore";
import type { Thread } from "../types";
import {
  buildTerminalAttentionCopy,
  buildTerminalCompletionCopy,
  buildInputNeededCopy,
  buildTaskCompletionCopy,
  collectCompletedThreadCandidates,
  collectCompletedTerminalCandidates,
  collectInputNeededThreadCandidates,
  collectTerminalAttentionCandidates,
  isNotificationRuntimeFreshTimestamp,
  shouldShowThreadNotificationToast,
} from "./taskCompletion.logic";

export type BrowserNotificationPermissionState =
  | NotificationPermission
  | "unsupported"
  | "insecure";

function isBrowserNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

// Browsers require secure contexts and a user gesture before asking for permission.
export function readBrowserNotificationPermissionState(): BrowserNotificationPermissionState {
  if (typeof window === "undefined") {
    return "unsupported";
  }
  if (!isBrowserNotificationSupported()) {
    return "unsupported";
  }
  if (!window.isSecureContext) {
    return "insecure";
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  const current = readBrowserNotificationPermissionState();
  if (current === "unsupported" || current === "insecure" || current === "denied") {
    return current;
  }
  if (current === "granted") {
    return current;
  }
  return Notification.requestPermission();
}

function isWindowForeground(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

interface ThreadNotificationCopy {
  title: string;
  body: string;
}

interface DesktopNotificationBridge {
  isSupported(): Promise<boolean>;
  show(payload: DesktopNotificationInput): Promise<boolean>;
}

export async function showDesktopThreadNotification(
  bridge: DesktopNotificationBridge,
  copy: ThreadNotificationCopy,
  threadId: Thread["id"],
): Promise<boolean> {
  if (!(await bridge.isSupported())) return false;
  return bridge.show({ ...copy, silent: false, threadId });
}

// Notification opens are generic thread activations, so they clear splitViewId
// instead of resurrecting a hidden split pairing.
function focusThread(threadId: Thread["id"], navigate: ReturnType<typeof useNavigate>): void {
  void navigate({
    to: "/$threadId",
    params: { threadId },
    search: (previous) => ({ ...previous, splitViewId: undefined }),
  });
}

async function showSystemThreadNotification(
  copy: ThreadNotificationCopy,
  threadId: Thread["id"],
  navigate: ReturnType<typeof useNavigate>,
): Promise<boolean> {
  const { body, title } = copy;

  if (window.desktopBridge) {
    return showDesktopThreadNotification(
      window.desktopBridge.notifications,
      { title, body },
      threadId,
    );
  }

  if (readBrowserNotificationPermissionState() !== "granted") {
    return false;
  }

  const notification = new Notification(title, {
    body,
    tag: `thread-notification:${threadId}`,
  });
  notification.addEventListener("click", () => {
    window.focus();
    focusThread(threadId, navigate);
  });
  return true;
}

function showThreadToast(
  copy: ThreadNotificationCopy,
  threadId: Thread["id"],
  tone: "success" | "warning",
  navigate: ReturnType<typeof useNavigate>,
  openLabel: string,
): void {
  const { body, title } = copy;
  toastManager.add({
    type: tone,
    title,
    description: body,
    data: {
      allowCrossThreadVisibility: true,
      threadId,
      dismissAfterVisibleMs: 8000,
    },
    actionProps: {
      children: openLabel,
      onClick: () => focusThread(threadId, navigate),
    },
  });
}

export function TaskCompletionNotifications() {
  const { t } = useTranslation("notifications");
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  const activeThreadId = useParams({
    strict: false,
    select: (params) =>
      typeof params.threadId === "string" ? ThreadId.makeUnsafe(params.threadId) : null,
  });
  const routeSearch = useDiffRouteSearch();
  const splitView = useSplitViewStore(selectSplitView(routeSearch.splitViewId ?? null));
  const threads = useStore(useRef(createAllThreadsSelector()).current);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const terminalStateByThreadId = useTerminalStateStore((store) => store.terminalStateByThreadId);
  const visibleThreadIds = useMemo(() => {
    return resolveVisibleToastThreadIds({ activeThreadId, splitView });
  }, [activeThreadId, splitView]);
  const previousThreadsRef = useRef<readonly Thread[]>([]);
  const previousTerminalStateRef = useRef(terminalStateByThreadId);
  const runtimeStartedAtMsRef = useRef(Date.now());
  const readyRef = useRef(false);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      const prefix = "notification-open-thread:";
      if (!action.startsWith(prefix)) {
        return;
      }
      const threadId = action.slice(prefix.length).trim();
      if (threadId.length === 0) {
        return;
      }
      focusThread(threadId as Thread["id"], navigate);
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!readyRef.current) {
      previousThreadsRef.current = threads;
      previousTerminalStateRef.current = terminalStateByThreadId;
      readyRef.current = true;
      return;
    }

    const completions = collectCompletedThreadCandidates(
      previousThreadsRef.current,
      threads,
    ).filter((candidate) =>
      isNotificationRuntimeFreshTimestamp(candidate.completedAt, runtimeStartedAtMsRef.current),
    );
    const terminalCompletions = collectCompletedTerminalCandidates(
      previousTerminalStateRef.current,
      terminalStateByThreadId,
    );
    const inputNeededCandidates = collectInputNeededThreadCandidates(
      previousThreadsRef.current,
      threads,
    ).filter((candidate) =>
      isNotificationRuntimeFreshTimestamp(candidate.createdAt, runtimeStartedAtMsRef.current),
    );
    const terminalAttentionCandidates = collectTerminalAttentionCandidates(
      previousTerminalStateRef.current,
      terminalStateByThreadId,
    );
    previousThreadsRef.current = threads;
    previousTerminalStateRef.current = terminalStateByThreadId;

    if (
      completions.length === 0 &&
      inputNeededCandidates.length === 0 &&
      terminalCompletions.length === 0 &&
      terminalAttentionCandidates.length === 0
    ) {
      return;
    }

    const shouldAttemptSystemNotification =
      settings.enableSystemTaskCompletionNotifications &&
      (window.desktopBridge ? true : !isWindowForeground());

    for (const completion of completions) {
      const copy = buildTaskCompletionCopy(completion, t);
      if (
        settings.enableTaskCompletionToasts &&
        shouldShowThreadNotificationToast({
          threadId: completion.threadId,
          visibleThreadIds,
        })
      ) {
        showThreadToast(copy, completion.threadId, "success", navigate, t("actions.open"));
      }

      if (shouldAttemptSystemNotification) {
        void showSystemThreadNotification(copy, completion.threadId, navigate);
      }
    }

    for (const candidate of inputNeededCandidates) {
      const copy = buildInputNeededCopy(candidate, t);
      if (
        settings.enableTaskCompletionToasts &&
        shouldShowThreadNotificationToast({
          threadId: candidate.threadId,
          visibleThreadIds,
        })
      ) {
        showThreadToast(copy, candidate.threadId, "warning", navigate, t("actions.open"));
      }

      if (shouldAttemptSystemNotification) {
        void showSystemThreadNotification(copy, candidate.threadId, navigate);
      }
    }

    for (const completion of terminalCompletions) {
      const copy = buildTerminalCompletionCopy(completion, t);
      if (
        settings.enableTaskCompletionToasts &&
        shouldShowThreadNotificationToast({
          threadId: completion.threadId,
          visibleThreadIds,
        })
      ) {
        showThreadToast(copy, completion.threadId, "success", navigate, t("actions.open"));
      }

      if (shouldAttemptSystemNotification) {
        void showSystemThreadNotification(copy, completion.threadId, navigate);
      }
    }

    for (const candidate of terminalAttentionCandidates) {
      const copy = buildTerminalAttentionCopy(candidate, t);
      if (
        settings.enableTaskCompletionToasts &&
        shouldShowThreadNotificationToast({
          threadId: candidate.threadId,
          visibleThreadIds,
        })
      ) {
        showThreadToast(copy, candidate.threadId, "warning", navigate, t("actions.open"));
      }

      if (shouldAttemptSystemNotification) {
        void showSystemThreadNotification(copy, candidate.threadId, navigate);
      }
    }
  }, [
    navigate,
    settings.enableSystemTaskCompletionNotifications,
    settings.enableTaskCompletionToasts,
    terminalStateByThreadId,
    threads,
    threadsHydrated,
    t,
    visibleThreadIds,
  ]);

  return null;
}

export function buildNotificationSettingsSupportText(
  permissionState: BrowserNotificationPermissionState,
  t?: TFunction,
): string {
  const copy = (key: string, fallback: string) =>
    t?.(key, { ns: "settings", defaultValue: fallback }) ?? fallback;
  const support = englishCatalog.settings.notifications.desktop.support;
  if (isElectron) {
    return copy("notifications.desktop.support.desktop", support.desktop);
  }
  switch (permissionState) {
    case "granted":
      return copy("notifications.desktop.support.granted", support.granted);
    case "denied":
      return copy("notifications.desktop.support.denied", support.denied);
    case "insecure":
      return copy("notifications.desktop.support.insecure", support.insecure);
    case "unsupported":
      return copy("notifications.desktop.support.unsupported", support.unsupported);
    case "default":
      return copy("notifications.desktop.support.default", support.default);
  }
}
