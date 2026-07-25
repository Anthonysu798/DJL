// FILE: taskCompletion.logic.ts
// Purpose: Detects new thread lifecycle notifications and builds alert copy.
// Layer: Notification logic
// Exports: lifecycle detection helpers and notification copy helpers

import {
  defaultTerminalTitleForCliKind,
  type TerminalCliKind,
  type TerminalVisualState,
} from "@synara/shared/terminalThreads";
import type { Thread, ThreadSession } from "../types";
import type { ProviderRequestKind } from "@synara/contracts";
import type { TFunction } from "i18next";
import { translateRendererCopy } from "../i18n";
import englishCatalog from "../i18n/locales/en.json";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  hasLiveLatestTurn,
} from "../session-logic";

export interface CompletedThreadCandidate {
  threadId: Thread["id"];
  projectId: Thread["projectId"];
  title: string;
  completedAt: string;
  assistantSummary: string | null;
}

export interface ThreadAttentionCandidate {
  kind: "approval" | "user-input";
  threadId: Thread["id"];
  projectId: Thread["projectId"];
  title: string;
  requestId: string;
  createdAt: string;
  requestKind?: ProviderRequestKind;
  summary?: string;
}

interface TerminalNotificationThreadState {
  runningTerminalIds: string[];
  terminalAttentionStatesById: Record<string, "attention" | "review">;
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalIds: string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
}

export interface CompletedTerminalCandidate {
  cliKind: TerminalCliKind | null;
  terminalId: string;
  threadId: Thread["id"];
  title: string;
}

export interface TerminalAttentionCandidate {
  cliKind: TerminalCliKind | null;
  terminalId: string;
  threadId: Thread["id"];
  title: string;
}

type ThreadSessionStatus = ThreadSession["status"];

// Thread completion toasts are for off-screen work; visible threads already show the result inline.
export function shouldShowThreadNotificationToast(input: {
  threadId: Thread["id"];
  visibleThreadIds: ReadonlySet<Thread["id"]>;
}): boolean {
  return !input.visibleThreadIds.has(input.threadId);
}

// Treat sidebar "working" states as the only notification-worthy starting point.
function isRunningStatus(status: ThreadSessionStatus | null | undefined): boolean {
  return status === "running" || status === "connecting";
}

const NOTIFICATION_SUMMARY_MAX_LENGTH = 140;

// Normalize + cap a message body so long output never leaks into OS chrome.
function summarizeAssistantText(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length <= NOTIFICATION_SUMMARY_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, NOTIFICATION_SUMMARY_MAX_LENGTH - 3)}...`;
}

// Build a short body from the turn's *final* assistant message — the end-of-turn reply
// that lands after the work/compaction, not the opening preamble. Prefer the canonical
// `latestTurn.assistantMessageId`; if it's missing/empty, fall back to the last non-empty
// assistant message of that turn so we still surface the latest reply.
function summarizeLatestAssistantMessage(thread: Thread): string | null {
  const latestTurnId = thread.latestTurn?.turnId ?? null;
  const finalAssistantMessageId = thread.latestTurn?.assistantMessageId ?? null;

  if (finalAssistantMessageId) {
    const finalMessage = thread.messages.find((message) => message.id === finalAssistantMessageId);
    if (finalMessage) {
      const summary = summarizeAssistantText(finalMessage.text);
      if (summary) {
        return summary;
      }
    }
  }

  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    // Stay within the just-completed turn so an earlier/other-turn preamble can't win.
    if (latestTurnId && message.turnId && message.turnId !== latestTurnId) {
      continue;
    }
    const summary = summarizeAssistantText(message.text);
    if (summary) {
      return summary;
    }
  }
  return null;
}

function hadUnsettledTurn(thread: Thread | undefined): boolean {
  if (!thread) {
    return false;
  }
  if (hasLiveLatestTurn(thread.latestTurn, thread.session)) {
    return true;
  }
  return !thread.latestTurn?.completedAt && isRunningStatus(thread.session?.status);
}

function isCompletionNotificationSettled(thread: Thread | undefined): boolean {
  if (!thread?.latestTurn?.startedAt || !thread.latestTurn.completedAt) {
    return false;
  }
  if (!thread.session) {
    return true;
  }
  return thread.session.orchestrationStatus !== "running";
}

// Compare consecutive snapshots and emit fresh settled completions, even if the
// session snapshot skips directly to ready before the toast logic observes it.
export function collectCompletedThreadCandidates(
  previousThreads: readonly Thread[],
  nextThreads: readonly Thread[],
): CompletedThreadCandidate[] {
  const previousById = new Map(previousThreads.map((thread) => [thread.id, thread] as const));
  const candidates: CompletedThreadCandidate[] = [];

  for (const thread of nextThreads) {
    const previousThread = previousById.get(thread.id);
    if (!previousThread) {
      continue;
    }

    const completedAt = thread.latestTurn?.completedAt;
    if (!completedAt) {
      continue;
    }
    if (!isCompletionNotificationSettled(thread)) {
      continue;
    }
    if (!previousThread.session && !previousThread.latestTurn?.completedAt) {
      continue;
    }
    if (!hadUnsettledTurn(previousThread) && !previousThread.latestTurn?.completedAt) {
      continue;
    }
    if (
      previousThread.latestTurn?.turnId === thread.latestTurn?.turnId &&
      isCompletionNotificationSettled(previousThread)
    ) {
      continue;
    }

    candidates.push({
      threadId: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      completedAt,
      assistantSummary: summarizeLatestAssistantMessage(thread),
    });
  }

  return candidates;
}
function resolveTerminalNotificationState(
  threadState: TerminalNotificationThreadState | undefined,
  terminalId: string,
): TerminalVisualState {
  if (!threadState) {
    return "idle";
  }
  if (threadState.terminalAttentionStatesById?.[terminalId] === "attention") {
    return "attention";
  }
  if ((threadState.runningTerminalIds ?? []).includes(terminalId)) {
    return "running";
  }
  if (threadState.terminalAttentionStatesById?.[terminalId] === "review") {
    return "review";
  }
  return "idle";
}

function resolveTerminalNotificationTitle(
  threadState: TerminalNotificationThreadState | undefined,
  terminalId: string,
): { cliKind: TerminalCliKind | null; title: string } {
  const cliKind = threadState?.terminalCliKindsById?.[terminalId] ?? null;
  const title =
    threadState?.terminalTitleOverridesById?.[terminalId]?.trim() ||
    threadState?.terminalLabelsById?.[terminalId]?.trim() ||
    (cliKind ? defaultTerminalTitleForCliKind(cliKind) : "");
  return { cliKind, title };
}

export function collectCompletedTerminalCandidates(
  previousByThreadId: Record<string, TerminalNotificationThreadState>,
  nextByThreadId: Record<string, TerminalNotificationThreadState>,
): CompletedTerminalCandidate[] {
  const threadIds = new Set([...Object.keys(previousByThreadId), ...Object.keys(nextByThreadId)]);
  const candidates: CompletedTerminalCandidate[] = [];

  for (const threadId of threadIds) {
    const previousThreadState = previousByThreadId[threadId];
    const nextThreadState = nextByThreadId[threadId];
    const terminalIds = new Set([
      ...(previousThreadState?.terminalIds ?? []),
      ...(nextThreadState?.terminalIds ?? []),
    ]);

    for (const terminalId of terminalIds) {
      const previousState = resolveTerminalNotificationState(previousThreadState, terminalId);
      const nextState = resolveTerminalNotificationState(nextThreadState, terminalId);
      if (nextState !== "review" || previousState === "review") {
        continue;
      }
      const { cliKind, title } = resolveTerminalNotificationTitle(nextThreadState, terminalId);
      candidates.push({
        threadId: threadId as Thread["id"],
        terminalId,
        cliKind,
        title,
      });
    }
  }

  return candidates;
}

function notificationText(key: string, options?: Record<string, unknown>, t?: TFunction): string {
  const defaults: Record<string, string> = {
    "approval.command": englishCatalog.notifications.approval.command,
    "approval.fileRead": englishCatalog.notifications.approval.fileRead,
    "approval.fileChange": englishCatalog.notifications.approval.fileChange,
    "approval.title": englishCatalog.notifications.approval.title,
    bodyWithDetail: englishCatalog.notifications.bodyWithDetail,
    "input.requested": englishCatalog.notifications.input.requested,
    "input.title": englishCatalog.notifications.input.title,
    "task.completeTitle": englishCatalog.notifications.task.completeTitle,
    "task.finishedWorking": englishCatalog.notifications.task.finishedWorking,
    "terminal.completeTitle": englishCatalog.notifications.terminal.completeTitle,
    "terminal.finishedBody": englishCatalog.notifications.terminal.finishedBody,
    "terminal.inputBody": englishCatalog.notifications.terminal.inputBody,
    "terminal.inputTitle": englishCatalog.notifications.terminal.inputTitle,
    "terminal.label": englishCatalog.notifications.terminal.label,
    untitledThread: englishCatalog.notifications.untitledThread,
  };
  const defaultValue = defaults[key] ?? key;
  return t
    ? t(key, { ns: "notifications", defaultValue, ...options })
    : translateRendererCopy(`notifications:${key}`, defaultValue, options);
}

function approvalSummary(requestKind: ProviderRequestKind, t?: TFunction): string {
  switch (requestKind) {
    case "command":
      return notificationText("approval.command", undefined, t);
    case "file-read":
      return notificationText("approval.fileRead", undefined, t);
    case "file-change":
      return notificationText("approval.fileChange", undefined, t);
    case "tool":
      return notificationText("approval.tool", undefined, t);
  }
}

// Compare consecutive activity snapshots and emit only fresh input-needed transitions.
export function collectThreadAttentionCandidates(
  previousThreads: readonly Thread[],
  nextThreads: readonly Thread[],
): ThreadAttentionCandidate[] {
  const previousById = new Map(previousThreads.map((thread) => [thread.id, thread] as const));
  const candidates: ThreadAttentionCandidate[] = [];

  for (const thread of nextThreads) {
    const previousThread = previousById.get(thread.id);
    if (!previousThread) {
      continue;
    }

    const previousApprovalIds = new Set(
      derivePendingApprovals(previousThread.activities).map((approval) => approval.requestId),
    );
    const previousUserInputIds = new Set(
      derivePendingUserInputs(previousThread.activities).map((request) => request.requestId),
    );

    for (const approval of derivePendingApprovals(thread.activities)) {
      if (previousApprovalIds.has(approval.requestId)) {
        continue;
      }
      candidates.push({
        kind: "approval",
        threadId: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        requestId: approval.requestId,
        createdAt: approval.createdAt,
        requestKind: approval.requestKind,
        ...(approval.detail ? { summary: approval.detail } : {}),
      });
    }

    for (const request of derivePendingUserInputs(thread.activities)) {
      if (previousUserInputIds.has(request.requestId)) {
        continue;
      }
      candidates.push({
        kind: "user-input",
        threadId: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        requestId: request.requestId,
        createdAt: request.createdAt,
      });
    }
  }

  return candidates.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function collectTerminalAttentionCandidates(
  previousByThreadId: Record<string, TerminalNotificationThreadState>,
  nextByThreadId: Record<string, TerminalNotificationThreadState>,
): TerminalAttentionCandidate[] {
  const threadIds = new Set([...Object.keys(previousByThreadId), ...Object.keys(nextByThreadId)]);
  const candidates: TerminalAttentionCandidate[] = [];

  for (const threadId of threadIds) {
    const previousThreadState = previousByThreadId[threadId];
    const nextThreadState = nextByThreadId[threadId];
    const terminalIds = new Set([
      ...(previousThreadState?.terminalIds ?? []),
      ...(nextThreadState?.terminalIds ?? []),
    ]);

    for (const terminalId of terminalIds) {
      const previousState = resolveTerminalNotificationState(previousThreadState, terminalId);
      const nextState = resolveTerminalNotificationState(nextThreadState, terminalId);
      if (nextState !== "attention" || previousState === "attention") {
        continue;
      }
      const { cliKind, title } = resolveTerminalNotificationTitle(nextThreadState, terminalId);
      candidates.push({
        threadId: threadId as Thread["id"],
        terminalId,
        cliKind,
        title,
      });
    }
  }

  return candidates;
}

// Keep toast and OS notification copy aligned across browser and desktop surfaces.
export function buildTaskCompletionCopy(
  candidate: CompletedThreadCandidate,
  t?: TFunction,
): {
  title: string;
  body: string;
} {
  const normalizedTitle = candidate.title.trim();
  const threadLabel =
    normalizedTitle.length > 0 ? normalizedTitle : notificationText("untitledThread", undefined, t);
  const detail =
    candidate.assistantSummary || notificationText("task.finishedWorking", undefined, t);

  if (!t) {
    return { title: threadLabel, body: detail };
  }

  return {
    title: notificationText("task.completeTitle", undefined, t),
    body: notificationText("bodyWithDetail", { label: threadLabel, detail }, t),
  };
}

export function buildThreadAttentionCopy(
  candidate: ThreadAttentionCandidate,
  t?: TFunction,
): {
  title: string;
  body: string;
} {
  const normalizedTitle = candidate.title.trim();
  const threadLabel =
    normalizedTitle.length > 0 ? normalizedTitle : notificationText("untitledThread", undefined, t);
  const summary =
    candidate.summary ??
    (candidate.kind === "approval"
      ? approvalSummary(candidate.requestKind ?? "command", t)
      : notificationText("input.requested", undefined, t));

  return {
    title: notificationText(
      t && candidate.kind === "approval" ? "approval.title" : "input.title",
      undefined,
      t,
    ),
    body: notificationText("bodyWithDetail", { label: threadLabel, detail: summary }, t),
  };
}

export function buildTerminalCompletionCopy(
  candidate: CompletedTerminalCandidate,
  t?: TFunction,
): {
  title: string;
  body: string;
} {
  const terminalLabel = candidate.title.trim() || notificationText("terminal.label", undefined, t);
  return {
    title: notificationText("terminal.completeTitle", undefined, t),
    body: notificationText("terminal.finishedBody", { terminal: terminalLabel }, t),
  };
}

export function buildTerminalAttentionCopy(
  candidate: TerminalAttentionCandidate,
  t?: TFunction,
): {
  title: string;
  body: string;
} {
  const terminalLabel = candidate.title.trim() || notificationText("terminal.label", undefined, t);
  return {
    title: notificationText("terminal.inputTitle", undefined, t),
    body: notificationText("terminal.inputBody", { terminal: terminalLabel }, t),
  };
}

export function shouldSuppressVisibleThreadNotification(input: {
  threadId: Thread["id"];
  visibleThreadIds: ReadonlySet<Thread["id"]>;
  windowForeground: boolean;
}): boolean {
  return input.windowForeground && input.visibleThreadIds.has(input.threadId);
}

export const collectInputNeededThreadCandidates = collectThreadAttentionCandidates;

export const buildInputNeededCopy = buildThreadAttentionCopy;

// Hydration can replay old thread details after refresh; only timestamps after
// this notification runtime mounted should be treated as live events.
export function isNotificationRuntimeFreshTimestamp(
  candidateTimestamp: string,
  runtimeStartedAtMs: number,
): boolean {
  const candidateMs = Date.parse(candidateTimestamp);
  if (!Number.isFinite(candidateMs) || !Number.isFinite(runtimeStartedAtMs)) {
    return true;
  }
  return candidateMs > runtimeStartedAtMs;
}
