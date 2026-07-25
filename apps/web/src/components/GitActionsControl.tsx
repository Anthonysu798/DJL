// FILE: GitActionsControl.tsx
// Purpose: Render the chat-header git action control, commit dialog, and action toasts.
// Layer: Header action control
// Depends on: git React Query hooks, native shell bridges, and shared picker/menu primitives.

import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "@synara/contracts";
import type {
  GitActionProgressEvent,
  GitActionProgressPhase,
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
  ModelSelection,
  ThreadId,
} from "@synara/contracts";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  CloudSyncIcon,
  GitBranchIcon,
  GitCommitIcon,
  InfoIcon,
  type LucideIcon,
  PushIcon,
} from "~/lib/icons";
import { Input } from "~/components/ui/input";
import { GitHubIcon } from "./Icons";
import {
  buildMenuItems,
  type GitActionMenuItem,
  type GitActionIconName,
  type GitQuickAction,
  type DefaultBranchConfirmableAction,
  requiresFeatureBranchForDefaultBranchAction,
  requiresDefaultBranchConfirmation,
  resolveLiveThreadBranchUpdate,
  resolveDefaultCreateBranchName,
  resolveCreatePrActionAvailability,
  resolveQuickAction,
  resolvePullActionAvailability,
  shouldOfferCreateBranchPrompt,
} from "./GitActionsControl.logic";
import { getProviderStartOptions, useAppSettings } from "~/appSettings";
import { formatClockDuration } from "~/session-logic";
import { Button } from "~/components/ui/button";
import {
  ChatHeaderSplitDivider,
  ChatHeaderSplitGroup,
  CHAT_HEADER_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
  CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
  CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME,
} from "./chat/chatHeaderControls";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRow,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "./chat/environment/EnvironmentRow";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { openInPreferredEditor } from "~/editorPreferences";
import {
  gitBranchesQueryOptions,
  gitInitMutationOptions,
  gitMutationKeys,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "~/lib/gitReactQuery";
import { cn, newCommandId, randomUUID } from "~/lib/utils";
import { resolvePathLinkTarget } from "~/terminal-links";
import { readNativeApi } from "~/nativeApi";
import { createThreadSelector } from "~/storeSelectors";
import { useStore } from "~/store";

interface GitActionsControlProps {
  gitCwd: string | null;
  activeThreadId: ThreadId | null;
  hideQuickActionLabel?: boolean;
  // `header` renders the split quick-action button; `panel` collapses every git
  // action into a single "Commit and Push" Environment panel row + dropdown.
  variant?: "header" | "panel";
}

interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  forcePushOnlyProgress: boolean;
  onConfirmed?: () => void;
  filePaths?: string[];
}

type GitActionToastId = ReturnType<typeof toastManager.add>;

interface ActiveGitActionProgress {
  toastId: GitActionToastId;
  actionId: string;
  phase: GitProgressPhase;
  phaseStartedAtMs: number | null;
  hookStartedAtMs: number | null;
  hookName: string | null;
  lastOutputLine: string | null;
  currentPhase: GitProgressPhase | null;
}

type GitProgressPhaseId =
  | "preparingBranch"
  | "pushing"
  | "creatingPr"
  | "committing"
  | "generatingMessage"
  | "running"
  | "runningHook";

interface GitProgressPhase {
  id: GitProgressPhaseId;
  name?: string;
  rawPhase?: GitActionProgressPhase;
  rawLabel?: string;
}

export function resolveGitProgressPhaseLabel(
  t: TFunction<"workspace">,
  phase: GitProgressPhase,
): string {
  return phase.name
    ? t(`git.progress.${phase.id}`, { name: phase.name })
    : t(`git.progress.${phase.id}`);
}

interface RunGitActionWithToastInput {
  action: GitStackedAction;
  commitMessage?: string;
  forcePushOnlyProgress?: boolean;
  onConfirmed?: () => void;
  skipDefaultBranchPrompt?: boolean;
  statusOverride?: GitStatusResult | null;
  featureBranch?: boolean;
  isDefaultBranchOverride?: boolean;
  progressToastId?: GitActionToastId;
  filePaths?: string[];
}

interface GitPickerMenuItem {
  id: "push" | "pr" | "sync" | "commit" | "commit_push" | "create_branch";
  label: string;
  disabled: boolean;
  disabledReason: string | null;
  icon: GitActionIconName | "sync" | "branch";
  onSelect: () => void;
}

function formatElapsedDescription(
  t: TFunction<"workspace">,
  startedAtMs: number | null,
): string | undefined {
  if (startedAtMs === null) {
    return undefined;
  }
  return t("git.progress.elapsed", { duration: formatClockDuration(Date.now() - startedAtMs) });
}

function resolveProgressDescription(
  t: TFunction<"workspace">,
  progress: ActiveGitActionProgress,
): string | undefined {
  if (progress.lastOutputLine) {
    return progress.lastOutputLine;
  }
  return formatElapsedDescription(t, progress.hookStartedAtMs ?? progress.phaseStartedAtMs);
}

function getMenuActionDisabledReason({
  t,
  item,
  gitStatus,
  isBusy,
  hasOriginRemote,
}: {
  t: TFunction<"workspace">;
  item: GitActionMenuItem;
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  hasOriginRemote: boolean;
}): string | null {
  if (!item.disabled) return null;
  if (isBusy) return t("git.disabled.busy");
  if (!gitStatus) return t("git.disabled.statusUnavailable");

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;

  if (item.id === "commit") {
    if (!hasChanges) {
      return t("git.disabled.clean");
    }
    return t("git.disabled.commit");
  }

  if (item.id === "push") {
    if (!hasBranch) {
      return t("git.disabled.detachedPush");
    }
    if (hasChanges) {
      return t("git.disabled.changesBeforePush");
    }
    if (isBehind) {
      return t("git.disabled.behindPush");
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return t("git.disabled.originPush");
    }
    if (!isAhead) {
      return t("git.disabled.noCommitsPush");
    }
    return t("git.disabled.push");
  }

  if (item.id === "commit_push") {
    if (!hasBranch) {
      return t("git.disabled.detachedCommitPush");
    }
    if (isBehind) {
      return t("git.disabled.behindCommitPush");
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return t("git.disabled.originCommitPush");
    }
    if (!hasChanges && !isAhead) {
      return t("git.disabled.noChangesPush");
    }
    return t("git.disabled.commitPush");
  }

  if (hasOpenPr) {
    return t("git.disabled.viewPr");
  }
  if (!hasBranch) {
    return t("git.disabled.detachedPr");
  }
  if (hasChanges) {
    return t("git.disabled.changesPr");
  }
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return t("git.disabled.originPr");
  }
  if (!isAhead) {
    return t("git.disabled.noCommitsPr");
  }
  if (isBehind) {
    return t("git.disabled.behindPr");
  }
  return t("git.disabled.createPr");
}

function gitActionLabel(t: TFunction<"workspace">, action: GitStackedAction): string {
  return t(`git.actions.${action}`);
}

function gitProgressStages(input: {
  action: GitStackedAction;
  hasCustomCommitMessage: boolean;
  hasWorkingTreeChanges: boolean;
  forcePushOnly: boolean;
  featureBranch: boolean;
  shouldPushBeforePr: boolean;
}): GitProgressPhase[] {
  const branchStages: GitProgressPhase[] = input.featureBranch ? [{ id: "preparingBranch" }] : [];
  const pushStage: GitProgressPhase = { id: "pushing" };
  if (input.action === "push") return [pushStage];
  if (input.action === "create_pr") {
    return input.shouldPushBeforePr ? [pushStage, { id: "creatingPr" }] : [{ id: "creatingPr" }];
  }
  const includeCommit =
    !input.forcePushOnly && (input.action === "commit" || input.hasWorkingTreeChanges);
  const commitStages: GitProgressPhase[] = !includeCommit
    ? []
    : input.hasCustomCommitMessage
      ? [{ id: "committing" }]
      : [{ id: "generatingMessage" }, { id: "committing" }];
  if (input.action === "commit") return [...branchStages, ...commitStages];
  if (input.action === "commit_push") return [...branchStages, ...commitStages, pushStage];
  return [...branchStages, ...commitStages, pushStage, { id: "creatingPr" }];
}

function summarizeLocalizedGitResult(
  t: TFunction<"workspace">,
  result: GitRunStackedActionResult,
): { title: string; description?: string } {
  if (result.pr.status === "created" || result.pr.status === "opened_existing") {
    return {
      title: t(result.pr.status === "created" ? "git.success.createdPr" : "git.success.openedPr", {
        number: result.pr.number ? ` #${result.pr.number}` : "",
      }),
      ...(result.pr.title ? { description: result.pr.title } : {}),
    };
  }
  if (result.push.status === "pushed") {
    return {
      title: t("git.success.pushed", {
        sha: result.commit.commitSha ? ` ${result.commit.commitSha.slice(0, 7)}` : "",
        branch: result.push.upstreamBranch ?? result.push.branch ?? "",
      }),
      ...(result.commit.subject ? { description: result.commit.subject } : {}),
    };
  }
  if (result.commit.status === "created") {
    return {
      title: t("git.success.committed", {
        sha: result.commit.commitSha ? ` ${result.commit.commitSha.slice(0, 7)}` : "",
      }),
      ...(result.commit.subject ? { description: result.commit.subject } : {}),
    };
  }
  return { title: t("git.success.done") };
}

function defaultBranchActionCopy(
  t: TFunction<"workspace">,
  pending: PendingDefaultBranchAction | null,
): { title: string; description: string; continueLabel: string } | null {
  if (!pending) return null;
  const values = { branch: pending.branchName };
  if (pending.action === "push" || pending.action === "commit_push") {
    return pending.includesCommit
      ? {
          title: t("git.defaultBranch.commitPushTitle"),
          description: t("git.defaultBranch.commitPushDescription", values),
          continueLabel: t("git.defaultBranch.commitPushContinue", values),
        }
      : {
          title: t("git.defaultBranch.pushTitle"),
          description: t("git.defaultBranch.pushDescription", values),
          continueLabel: t("git.defaultBranch.pushContinue", values),
        };
  }
  return pending.includesCommit
    ? {
        title: t("git.defaultBranch.featureCommitPrTitle"),
        description: t("git.defaultBranch.featureCommitPrDescription", values),
        continueLabel: t("git.defaultBranch.featureContinue"),
      }
    : {
        title: t("git.defaultBranch.featurePrTitle"),
        description: t("git.defaultBranch.featurePrDescription", values),
        continueLabel: t("git.defaultBranch.featureContinue"),
      };
}

// Central icons render as masked spans (not <svg>), so size them explicitly here
// rather than relying on parent `[&>svg]` selectors.
const GIT_ACTION_ICON_CLASS = "size-3.5";

/** Semantic name → glyph for every git affordance. Single source of truth shared by
 *  the header quick action and the dropdown picker rows so the same action always
 *  renders the same icon (e.g. push-family → the cloud PushIcon, PR → GitHub mark). */
type GitGlyphName = GitActionIconName | "sync" | "branch";

const GIT_ACTION_GLYPH: Record<GitGlyphName, LucideIcon> = {
  commit: GitCommitIcon,
  push: PushIcon,
  pr: GitHubIcon,
  sync: CloudSyncIcon,
  branch: GitBranchIcon,
};

function GitActionGlyph({ name, className }: { name: GitGlyphName; className?: string }) {
  const Glyph = GIT_ACTION_GLYPH[name];
  return <Glyph className={className ?? GIT_ACTION_ICON_CLASS} />;
}

// Map a header quick action onto its shared glyph name; null falls back to a hint icon.
// Every push-family action collapses to "push" so the button matches the picker rows.
function resolveGitQuickActionGlyph(quickAction: GitQuickAction): GitGlyphName | null {
  if (quickAction.kind === "open_pr") return "pr";
  if (quickAction.kind === "run_pull") return "sync";
  if (quickAction.kind === "create_branch") return "branch";
  if (quickAction.kind === "run_action") {
    return quickAction.action === "commit" ? "commit" : "push";
  }
  return null;
}

function GitQuickActionIcon({ quickAction }: { quickAction: GitQuickAction }) {
  const name = resolveGitQuickActionGlyph(quickAction);
  if (name) return <GitActionGlyph name={name} />;
  return <InfoIcon className={GIT_ACTION_ICON_CLASS} />;
}

function GitPickerMenuRow({ item }: { item: GitPickerMenuItem }) {
  return (
    <MenuItem disabled={item.disabled} onClick={item.onSelect}>
      <span className="inline-flex shrink-0 items-center [&>svg]:size-3.5">
        <GitActionGlyph name={item.icon} />
      </span>
      <span>{item.label}</span>
    </MenuItem>
  );
}

export default function GitActionsControl({
  gitCwd,
  activeThreadId,
  hideQuickActionLabel = false,
  variant = "header",
}: GitActionsControlProps) {
  const { t } = useTranslation("workspace");
  const isPanel = variant === "panel";
  const { settings } = useAppSettings();
  const providerOptions = useMemo(() => getProviderStartOptions(settings), [settings]);
  const gitTextGenerationModelSelection = useMemo(
    (): ModelSelection => ({
      provider: settings.textGenerationProvider ?? "opencode",
      model: settings.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
    }),
    [settings.textGenerationModel, settings.textGenerationProvider],
  );
  const activeThread = useStore(
    useMemo(() => createThreadSelector(activeThreadId), [activeThreadId]),
  );
  const setThreadWorkspaceAction = useStore((store) => store.setThreadWorkspace);
  const threadToastData = useMemo(
    () => (activeThreadId ? { threadId: activeThreadId } : undefined),
    [activeThreadId],
  );
  const queryClient = useQueryClient();
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [dialogCommitMessage, setDialogCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null);
  const [isCreateBranchDialogOpen, setIsCreateBranchDialogOpen] = useState(false);
  const [createBranchName, setCreateBranchName] = useState("");
  const activeGitActionProgressRef = useRef<ActiveGitActionProgress | null>(null);

  const updateActiveProgressToast = useCallback(() => {
    const progress = activeGitActionProgressRef.current;
    if (!progress) {
      return;
    }
    toastManager.update(progress.toastId, {
      type: "loading",
      title: resolveGitProgressPhaseLabel(t, progress.phase),
      description: resolveProgressDescription(t, progress),
      timeout: 0,
      data: threadToastData,
    });
  }, [t, threadToastData]);

  useEffect(() => {
    updateActiveProgressToast();
  }, [updateActiveProgressToast]);

  const { data: gitStatus = null, error: gitStatusError } = useQuery(gitStatusQueryOptions(gitCwd));

  const { data: branchList = null } = useQuery(gitBranchesQueryOptions(gitCwd));
  // Default to true while loading so we don't flash init controls.
  const isRepo = branchList?.isRepo ?? true;
  const hasOriginRemote = branchList?.hasOriginRemote ?? false;
  const currentBranch = branchList?.branches.find((branch) => branch.current)?.name ?? null;
  const liveThreadBranchUpdate = useMemo(
    () =>
      resolveLiveThreadBranchUpdate({
        threadBranch: currentBranch,
        gitStatus,
      }),
    [currentBranch, gitStatus],
  );
  const isGitStatusOutOfSync = liveThreadBranchUpdate !== null;

  useEffect(() => {
    if (!isGitStatusOutOfSync) return;
    void invalidateGitQueries(queryClient);
  }, [isGitStatusOutOfSync, queryClient]);

  const gitStatusForActions = isGitStatusOutOfSync ? null : gitStatus;

  const allFiles = gitStatusForActions?.workingTree.files ?? [];
  const selectedFiles = allFiles.filter((f) => !excludedFiles.has(f.path));
  const allSelected = excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;

  const initMutation = useMutation(gitInitMutationOptions({ cwd: gitCwd, queryClient }));

  const runImmediateGitActionMutation = useMutation(
    gitRunStackedActionMutationOptions({
      cwd: gitCwd,
      queryClient,
      codexHomePath: settings.codexHomePath || null,
      model: settings.textGenerationModel ?? null,
      modelSelection: gitTextGenerationModelSelection,
      ...(providerOptions ? { providerOptions } : {}),
    }),
  );
  const pullMutation = useMutation(gitPullMutationOptions({ cwd: gitCwd, queryClient }));
  const persistThreadPr = useCallback(
    async (pr: {
      number: number;
      title: string;
      url: string;
      baseBranch: string;
      headBranch: string;
      state: "open" | "closed" | "merged";
      isDraft?: boolean;
      mergeability?: "mergeable" | "conflicting" | "unknown";
      additions?: number | null;
      deletions?: number | null;
      changedFiles?: number | null;
    }) => {
      if (!activeThreadId) {
        return;
      }
      const api = readNativeApi();
      if (!api) {
        return;
      }
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: activeThreadId,
        lastKnownPr: pr,
      });
    },
    [activeThreadId],
  );

  const isRunStackedActionRunning =
    useIsMutating({ mutationKey: gitMutationKeys.runStackedAction(gitCwd) }) > 0;
  const isPullRunning = useIsMutating({ mutationKey: gitMutationKeys.pull(gitCwd) }) > 0;
  const isGitActionRunning = isRunStackedActionRunning || isPullRunning;
  const isDefaultBranch = useMemo(() => {
    const branchName = gitStatusForActions?.branch;
    if (!branchName) return false;
    const current = branchList?.branches.find((branch) => branch.name === branchName);
    return current?.isDefault ?? (branchName === "main" || branchName === "master");
  }, [branchList?.branches, gitStatusForActions?.branch]);
  const defaultBranchName = useMemo(
    () => branchList?.branches.find((branch) => !branch.isRemote && branch.isDefault)?.name ?? null,
    [branchList?.branches],
  );
  const shouldOfferCreateBranch = useMemo(() => {
    return shouldOfferCreateBranchPrompt({
      activeWorktreePath: activeThread?.worktreePath ?? null,
      gitStatus: gitStatusForActions
        ? {
            branch: gitStatusForActions.branch,
            hasUpstream: gitStatusForActions.hasUpstream,
          }
        : null,
      createBranchFlowCompleted: activeThread?.createBranchFlowCompleted ?? false,
    });
  }, [activeThread?.createBranchFlowCompleted, activeThread?.worktreePath, gitStatusForActions]);
  const currentBranchName =
    gitStatusForActions?.branch ?? currentBranch ?? activeThread?.branch ?? null;
  const existingBranchNames = useMemo(
    () => (branchList?.branches ?? []).map((branch) => branch.name),
    [branchList?.branches],
  );
  const branchNames = useMemo(
    () => new Set(existingBranchNames.map((branchName) => branchName.toLowerCase())),
    [existingBranchNames],
  );
  const suggestedCreateBranchName = useMemo(
    () =>
      resolveDefaultCreateBranchName(
        existingBranchNames,
        activeThread?.associatedWorktreeBranch ?? activeThread?.title,
      ),
    [activeThread?.associatedWorktreeBranch, activeThread?.title, existingBranchNames],
  );

  const quickAction = useMemo(
    () =>
      resolveQuickAction(
        gitStatusForActions,
        isGitActionRunning,
        isDefaultBranch,
        hasOriginRemote,
        shouldOfferCreateBranch,
        defaultBranchName,
      ),
    [
      defaultBranchName,
      gitStatusForActions,
      hasOriginRemote,
      isDefaultBranch,
      isGitActionRunning,
      shouldOfferCreateBranch,
    ],
  );
  const gitActionMenuItems = useMemo(
    () =>
      buildMenuItems(
        gitStatusForActions,
        isGitActionRunning,
        hasOriginRemote,
        isDefaultBranch,
        defaultBranchName,
      ),
    [defaultBranchName, gitStatusForActions, hasOriginRemote, isDefaultBranch, isGitActionRunning],
  );
  const quickActionDisabledReason = quickAction.disabled
    ? t("git.disabled.actionUnavailable")
    : null;
  const quickActionLabel =
    quickAction.kind === "open_pr"
      ? t("git.actions.viewPr")
      : quickAction.kind === "run_pull"
        ? t("git.actions.pull")
        : quickAction.kind === "create_branch"
          ? t("git.actions.createBranch")
          : quickAction.kind === "run_action" && quickAction.action
            ? gitActionLabel(t, quickAction.action)
            : gitStatusForActions?.aheadCount && gitStatusForActions.behindCount
              ? t("git.actions.syncBranch")
              : t("git.actions.commit");
  const pendingDefaultBranchActionCopy = defaultBranchActionCopy(t, pendingDefaultBranchAction);
  useEffect(() => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    const applyProgressEvent = (event: GitActionProgressEvent) => {
      const progress = activeGitActionProgressRef.current;
      if (!progress) {
        return;
      }
      if (gitCwd && event.cwd !== gitCwd) {
        return;
      }
      if (progress.actionId !== event.actionId) {
        return;
      }

      const now = Date.now();
      switch (event.kind) {
        case "action_started":
          progress.phaseStartedAtMs = now;
          progress.hookStartedAtMs = null;
          progress.hookName = null;
          progress.lastOutputLine = null;
          break;
        case "phase_started":
          progress.phase = {
            id:
              event.phase === "branch"
                ? "preparingBranch"
                : event.phase === "push"
                  ? "pushing"
                  : event.phase === "pr"
                    ? "creatingPr"
                    : "committing",
            rawPhase: event.phase,
            rawLabel: event.label,
          };
          progress.currentPhase = progress.phase;
          progress.phaseStartedAtMs = now;
          progress.hookStartedAtMs = null;
          progress.hookName = null;
          progress.lastOutputLine = null;
          break;
        case "hook_started":
          progress.phase = { id: "runningHook", name: event.hookName };
          progress.hookName = event.hookName;
          progress.hookStartedAtMs = now;
          progress.lastOutputLine = null;
          break;
        case "hook_output":
          progress.lastOutputLine = event.text;
          break;
        case "hook_finished":
          progress.phase = progress.currentPhase ?? { id: "committing" };
          progress.hookName = null;
          progress.hookStartedAtMs = null;
          progress.lastOutputLine = null;
          break;
        case "action_finished":
          // Don't clear timestamps here — the HTTP response handler (line 496)
          // sets activeGitActionProgressRef to null and shows the success toast.
          // Clearing timestamps early causes the "Running for Xs" description
          // to disappear before the success state renders, leaving a bare
          // "Pushing..." toast in the gap between the WS event and HTTP response.
          return;
        case "action_failed":
          // Same reasoning as action_finished — let the HTTP error handler
          // manage the final toast state to avoid a flash of bare title.
          return;
      }

      updateActiveProgressToast();
    };

    return api.git.onActionProgress(applyProgressEvent);
  }, [gitCwd, t, updateActiveProgressToast]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!activeGitActionProgressRef.current) {
        return;
      }
      updateActiveProgressToast();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [updateActiveProgressToast]);

  const openExistingPr = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: t("git.errors.linkUnavailable"),
        data: threadToastData,
      });
      return;
    }
    const prUrl = gitStatusForActions?.pr?.state === "open" ? gitStatusForActions.pr.url : null;
    if (!prUrl) {
      toastManager.add({
        type: "error",
        title: t("git.errors.noOpenPr"),
        data: threadToastData,
      });
      return;
    }
    void api.shell.openExternal(prUrl).catch((err) => {
      toastManager.add({
        type: "error",
        title: t("git.errors.openPr"),
        description: err instanceof Error ? err.message : String(err),
        data: threadToastData,
      });
    });
  }, [gitStatusForActions, t, threadToastData]);

  const runSyncWithRemote = useCallback(() => {
    const promise = pullMutation.mutateAsync();
    toastManager.promise(promise, {
      loading: { title: t("git.progress.syncing"), data: threadToastData },
      success: (result) => ({
        title: result.status === "pulled" ? t("git.success.synced") : t("git.success.upToDate"),
        description:
          result.status === "pulled"
            ? t("git.success.updated", {
                branch: result.branch,
                upstream: result.upstreamBranch ?? t("git.upstream"),
              })
            : t("git.success.synchronized", { branch: result.branch }),
        data: threadToastData,
      }),
      error: (err) => ({
        title: t("git.errors.sync"),
        description: err instanceof Error ? err.message : String(err),
        data: threadToastData,
      }),
    });
    void promise.catch(() => undefined);
  }, [pullMutation, t, threadToastData]);

  const runGitActionWithToast = useEffectEvent(
    async ({
      action,
      commitMessage,
      forcePushOnlyProgress = false,
      onConfirmed,
      skipDefaultBranchPrompt = false,
      statusOverride,
      featureBranch = false,
      isDefaultBranchOverride,
      progressToastId,
      filePaths,
    }: RunGitActionWithToastInput) => {
      const actionStatus = statusOverride ?? gitStatusForActions;
      const actionBranch = actionStatus?.branch ?? null;
      const actionIsDefaultBranch =
        isDefaultBranchOverride ?? (featureBranch ? false : isDefaultBranch);
      const includesCommit =
        !forcePushOnlyProgress &&
        action !== "push" &&
        action !== "create_pr" &&
        (action === "commit" || !!actionStatus?.hasWorkingTreeChanges);
      const shouldPushBeforePr =
        action === "create_pr" &&
        (!actionStatus?.hasUpstream || (actionStatus?.aheadCount ?? 0) > 0);
      if (
        !skipDefaultBranchPrompt &&
        requiresDefaultBranchConfirmation(action, actionIsDefaultBranch) &&
        actionBranch
      ) {
        setPendingDefaultBranchAction({
          action,
          branchName: actionBranch,
          includesCommit,
          ...(commitMessage ? { commitMessage } : {}),
          forcePushOnlyProgress,
          ...(onConfirmed ? { onConfirmed } : {}),
          ...(filePaths ? { filePaths } : {}),
        });
        return;
      }
      if (action === "create_pr" && !featureBranch) {
        const createPrAvailability = resolveCreatePrActionAvailability({
          gitStatus: actionStatus,
          isDefaultBranch: actionIsDefaultBranch,
          hasOriginRemote,
          defaultBranchName,
        });
        if (!createPrAvailability.canRun) {
          toastManager.add({
            type: "info",
            title: t("git.disabled.createPr"),
            description: t("git.disabled.noBranchChangesPr"),
            data: threadToastData,
          });
          return;
        }
      }
      onConfirmed?.();

      const progressStages = gitProgressStages({
        action,
        hasCustomCommitMessage: !!commitMessage?.trim(),
        hasWorkingTreeChanges: !!actionStatus?.hasWorkingTreeChanges,
        forcePushOnly: forcePushOnlyProgress,
        featureBranch,
        shouldPushBeforePr,
      });
      const actionId = randomUUID();
      const resolvedProgressToastId =
        progressToastId ??
        toastManager.add({
          type: "loading",
          title: resolveGitProgressPhaseLabel(t, progressStages[0] ?? { id: "running" }),
          description: t("git.progress.waiting"),
          timeout: 0,
          data: threadToastData,
        });

      activeGitActionProgressRef.current = {
        toastId: resolvedProgressToastId,
        actionId,
        phase: progressStages[0] ?? { id: "running" },
        phaseStartedAtMs: null,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        currentPhase: progressStages[0] ?? { id: "running" },
      };

      if (progressToastId) {
        toastManager.update(progressToastId, {
          type: "loading",
          title: resolveGitProgressPhaseLabel(t, progressStages[0] ?? { id: "running" }),
          description: t("git.progress.waiting"),
          timeout: 0,
          data: threadToastData,
        });
      }

      const promise = runImmediateGitActionMutation.mutateAsync({
        actionId,
        action,
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths } : {}),
      });

      try {
        const result = await promise;
        activeGitActionProgressRef.current = null;
        const resultToast = summarizeLocalizedGitResult(t, result);
        const persistedPr =
          result.pr.status === "created" || result.pr.status === "opened_existing"
            ? result.pr.number &&
              result.pr.title &&
              result.pr.url &&
              result.pr.baseBranch &&
              result.pr.headBranch
              ? {
                  number: result.pr.number,
                  title: result.pr.title,
                  url: result.pr.url,
                  baseBranch: result.pr.baseBranch,
                  headBranch: result.pr.headBranch,
                  state: "open" as const,
                }
              : null
            : actionStatus?.pr?.state === "open"
              ? actionStatus.pr
              : null;
        if (persistedPr) {
          void persistThreadPr(persistedPr).catch(() => undefined);
        }

        const existingOpenPrUrl =
          actionStatus?.pr?.state === "open" ? actionStatus.pr.url : undefined;
        const prUrl = result.pr.url ?? existingOpenPrUrl;
        const shouldOfferPushCta = action === "commit" && result.commit.status === "created";
        const shouldOfferOpenPrCta =
          (action === "push" ||
            action === "create_pr" ||
            action === "commit_push" ||
            action === "commit_push_pr") &&
          !!prUrl &&
          (!actionIsDefaultBranch ||
            result.pr.status === "created" ||
            result.pr.status === "opened_existing");
        const postPushStatus = actionStatus
          ? {
              ...actionStatus,
              hasUpstream: true,
              upstreamBranch:
                actionStatus.upstreamBranch ??
                (!actionStatus.hasUpstream ? (result.push.branch ?? actionStatus.branch) : null),
              aheadCount: 0,
            }
          : null;
        const shouldOfferCreatePrCta =
          (action === "push" || action === "commit_push") &&
          !prUrl &&
          result.push.status === "pushed" &&
          !actionIsDefaultBranch &&
          resolveCreatePrActionAvailability({
            gitStatus: postPushStatus,
            isDefaultBranch: actionIsDefaultBranch,
            hasOriginRemote,
            defaultBranchName,
          }).canRun;
        const closeResultToast = () => {
          toastManager.close(resolvedProgressToastId);
        };

        toastManager.update(resolvedProgressToastId, {
          type: "success",
          title: resultToast.title,
          description: resultToast.description,
          timeout: 0,
          data: {
            ...threadToastData,
            dismissAfterVisibleMs: 10_000,
          },
          ...(shouldOfferPushCta
            ? {
                actionProps: {
                  children: t("git.actions.push"),
                  onClick: () => {
                    void runGitActionWithToast({
                      action: "push",
                      onConfirmed: closeResultToast,
                      statusOverride: actionStatus,
                      isDefaultBranchOverride: actionIsDefaultBranch,
                    });
                  },
                },
              }
            : shouldOfferOpenPrCta
              ? {
                  actionProps: {
                    children: t("git.actions.viewPr"),
                    onClick: () => {
                      const api = readNativeApi();
                      if (!api) return;
                      closeResultToast();
                      void api.shell.openExternal(prUrl);
                    },
                  },
                }
              : shouldOfferCreatePrCta
                ? {
                    actionProps: {
                      children: t("git.actions.createPr"),
                      onClick: () => {
                        closeResultToast();
                        void runGitActionWithToast({
                          action: "create_pr",
                          statusOverride: postPushStatus,
                          isDefaultBranchOverride: actionIsDefaultBranch,
                        });
                      },
                    },
                  }
                : {}),
        });
      } catch (err) {
        activeGitActionProgressRef.current = null;
        toastManager.update(resolvedProgressToastId, {
          type: "error",
          title: t("git.errors.action"),
          description: err instanceof Error ? err.message : String(err),
          data: threadToastData,
        });
      }
    },
  );

  const continuePendingDefaultBranchAction = useCallback(() => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, forcePushOnlyProgress, onConfirmed, filePaths } =
      pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      forcePushOnlyProgress,
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      ...(requiresFeatureBranchForDefaultBranchAction(action) ? { featureBranch: true } : {}),
      skipDefaultBranchPrompt: true,
    });
  }, [pendingDefaultBranchAction]);

  const checkoutFeatureBranchAndContinuePendingAction = useCallback(() => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, forcePushOnlyProgress, onConfirmed, filePaths } =
      pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      forcePushOnlyProgress,
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  }, [pendingDefaultBranchAction]);

  const runDialogActionOnNewBranch = useCallback(() => {
    if (!isCommitDialogOpen) return;
    const commitMessage = dialogCommitMessage.trim();

    setIsCommitDialogOpen(false);
    setDialogCommitMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);

    void runGitActionWithToast({
      action: "commit",
      ...(commitMessage ? { commitMessage } : {}),
      ...(!allSelected ? { filePaths: selectedFiles.map((f) => f.path) } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  }, [allSelected, isCommitDialogOpen, dialogCommitMessage, selectedFiles]);

  const openCreateBranchDialog = useCallback(() => {
    setCreateBranchName(suggestedCreateBranchName);
    setIsCreateBranchDialogOpen(true);
  }, [suggestedCreateBranchName]);

  const runQuickAction = useCallback(() => {
    if (quickAction.kind === "open_pr") {
      void openExistingPr();
      return;
    }
    if (quickAction.kind === "run_pull") {
      runSyncWithRemote();
      return;
    }
    if (quickAction.kind === "create_branch") {
      openCreateBranchDialog();
      return;
    }
    if (quickAction.kind === "show_hint") {
      toastManager.add({
        type: "info",
        title: quickActionLabel,
        description: quickActionDisabledReason ?? t("git.disabled.actionUnavailable"),
        data: threadToastData,
      });
      return;
    }
    if (quickAction.action) {
      void runGitActionWithToast({ action: quickAction.action });
    }
  }, [
    openCreateBranchDialog,
    openExistingPr,
    quickAction,
    quickActionDisabledReason,
    quickActionLabel,
    runSyncWithRemote,
    t,
    threadToastData,
  ]);

  const openCommitDialog = useCallback(() => {
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
    setIsCommitDialogOpen(true);
  }, []);

  const normalizedCurrentBranchName = currentBranchName?.trim().toLowerCase() ?? "";
  const normalizedCreateBranchName = createBranchName.trim().toLowerCase();
  const createBranchNameConflicts =
    normalizedCreateBranchName.length > 0 &&
    normalizedCreateBranchName !== normalizedCurrentBranchName &&
    branchNames.has(normalizedCreateBranchName);

  const createAndCheckoutBranch = useCallback(
    async (branchName: string) => {
      const api = readNativeApi();
      if (!api || !gitCwd) return;

      const trimmedName = branchName.trim();
      if (!trimmedName) return;

      setIsCreateBranchDialogOpen(false);
      setCreateBranchName("");

      if (trimmedName.toLowerCase() === normalizedCurrentBranchName) {
        if (activeThreadId) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: activeThreadId,
              createBranchFlowCompleted: true,
            })
            .catch(() => {
              setThreadWorkspaceAction(activeThreadId, {
                createBranchFlowCompleted: false,
              });
            });
          setThreadWorkspaceAction(activeThreadId, {
            createBranchFlowCompleted: true,
          });
        }
        toastManager.add({
          type: "success",
          title: t("git.success.keepingBranch", { branch: trimmedName }),
          description: t("git.success.branchConfirmed"),
          data: threadToastData,
        });
        return;
      }

      const toastId = toastManager.add({
        type: "loading",
        title: t("git.progress.creatingBranch"),
        timeout: 0,
        data: threadToastData,
      });

      try {
        await api.git.createBranch({ cwd: gitCwd, branch: trimmedName, publish: hasOriginRemote });
        await api.git.checkout({ cwd: gitCwd, branch: trimmedName });
        if (activeThreadId) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: activeThreadId,
              branch: trimmedName,
              worktreePath: activeThread?.worktreePath ?? null,
              associatedWorktreeBranch: trimmedName,
              associatedWorktreeRef: trimmedName,
              createBranchFlowCompleted: true,
            })
            .catch(() => {
              setThreadWorkspaceAction(activeThreadId, {
                createBranchFlowCompleted: false,
              });
            });
          setThreadWorkspaceAction(activeThreadId, {
            branch: trimmedName,
            associatedWorktreeBranch: trimmedName,
            associatedWorktreeRef: trimmedName,
            createBranchFlowCompleted: true,
          });
        }
        await invalidateGitQueries(queryClient);

        toastManager.update(toastId, {
          type: "success",
          title: t("git.success.switchedBranch", { branch: trimmedName }),
          description: t("git.success.branchCreated"),
          data: threadToastData,
        });
      } catch (error) {
        toastManager.update(toastId, {
          type: "error",
          title: t("git.errors.createBranch"),
          description: error instanceof Error ? error.message : String(error),
          data: threadToastData,
        });
      }
    },
    [
      activeThread?.worktreePath,
      activeThreadId,
      gitCwd,
      hasOriginRemote,
      normalizedCurrentBranchName,
      queryClient,
      setThreadWorkspaceAction,
      t,
      threadToastData,
    ],
  );

  const openDialogForMenuItem = useCallback(
    (item: GitActionMenuItem) => {
      if (item.disabled) return;
      if (item.kind === "open_pr") {
        void openExistingPr();
        return;
      }
      if (item.dialogAction === "push") {
        void runGitActionWithToast({ action: "push" });
        return;
      }
      if (item.dialogAction === "commit_push") {
        void runGitActionWithToast({ action: "commit_push" });
        return;
      }
      if (item.dialogAction === "create_pr") {
        void runGitActionWithToast({ action: "create_pr" });
        return;
      }
      openCommitDialog();
    },
    [openCommitDialog, openExistingPr],
  );

  const gitPickerMenuItems = useMemo<GitPickerMenuItem[]>(() => {
    const items: GitPickerMenuItem[] = [];
    const commitMenuItem = gitActionMenuItems.find((item) => item.id === "commit");
    const commitPushMenuItem = gitActionMenuItems.find((item) => item.id === "commit_push");
    const pushMenuItem = gitActionMenuItems.find((item) => item.id === "push");
    const prMenuItem = gitActionMenuItems.find((item) => item.id === "pr");
    const createBranchDisabled = isGitActionRunning || !gitStatusForActions;
    const pullAvailability = resolvePullActionAvailability({
      gitStatus: gitStatusForActions,
      isBusy: isGitActionRunning,
    });

    if (commitMenuItem) {
      items.push({
        id: "commit",
        label: t("git.actions.commit"),
        disabled: commitMenuItem.disabled,
        disabledReason: getMenuActionDisabledReason({
          t,
          item: commitMenuItem,
          gitStatus: gitStatusForActions,
          isBusy: isGitActionRunning,
          hasOriginRemote,
        }),
        icon: "commit",
        onSelect: () => openDialogForMenuItem(commitMenuItem),
      });
    }

    if (commitPushMenuItem) {
      items.push({
        id: "commit_push",
        label: t("git.actions.commit_push"),
        disabled: commitPushMenuItem.disabled,
        disabledReason: getMenuActionDisabledReason({
          t,
          item: commitPushMenuItem,
          gitStatus: gitStatusForActions,
          isBusy: isGitActionRunning,
          hasOriginRemote,
        }),
        icon: "push",
        onSelect: () => openDialogForMenuItem(commitPushMenuItem),
      });
    }

    items.push({
      id: "sync",
      label: t("git.actions.pull"),
      disabled: !pullAvailability.canRun,
      disabledReason: pullAvailability.canRun ? null : t("git.disabled.pull"),
      icon: "sync",
      onSelect: runSyncWithRemote,
    });

    if (pushMenuItem) {
      items.push({
        id: "push",
        label: t("git.actions.push"),
        disabled: pushMenuItem.disabled,
        disabledReason: getMenuActionDisabledReason({
          t,
          item: pushMenuItem,
          gitStatus: gitStatusForActions,
          isBusy: isGitActionRunning,
          hasOriginRemote,
        }),
        icon: "push",
        onSelect: () => openDialogForMenuItem(pushMenuItem),
      });
    }

    if (prMenuItem) {
      items.push({
        id: "pr",
        label: prMenuItem.kind === "open_pr" ? t("git.actions.viewPr") : t("git.actions.createPr"),
        disabled: prMenuItem.disabled,
        disabledReason: getMenuActionDisabledReason({
          t,
          item: prMenuItem,
          gitStatus: gitStatusForActions,
          isBusy: isGitActionRunning,
          hasOriginRemote,
        }),
        icon: "pr",
        onSelect: () => openDialogForMenuItem(prMenuItem),
      });
    }

    items.push({
      id: "create_branch",
      label: t("git.actions.createBranch"),
      disabled: createBranchDisabled,
      disabledReason: createBranchDisabled
        ? isGitActionRunning
          ? t("git.disabled.busy")
          : t("git.disabled.statusUnavailable")
        : null,
      icon: "branch",
      onSelect: openCreateBranchDialog,
    });

    return items;
  }, [
    gitActionMenuItems,
    gitStatusForActions,
    hasOriginRemote,
    isGitActionRunning,
    openCreateBranchDialog,
    openDialogForMenuItem,
    runSyncWithRemote,
    t,
  ]);

  const runDialogAction = useCallback(() => {
    if (!isCommitDialogOpen) return;
    const commitMessage = dialogCommitMessage.trim();
    setIsCommitDialogOpen(false);
    setDialogCommitMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
    void runGitActionWithToast({
      action: "commit",
      ...(commitMessage ? { commitMessage } : {}),
      ...(!allSelected ? { filePaths: selectedFiles.map((f) => f.path) } : {}),
    });
  }, [
    allSelected,
    dialogCommitMessage,
    isCommitDialogOpen,
    selectedFiles,
    setDialogCommitMessage,
    setIsCommitDialogOpen,
  ]);

  const openChangedFileInEditor = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api || !gitCwd) {
        toastManager.add({
          type: "error",
          title: t("git.errors.editorUnavailable"),
          data: threadToastData,
        });
        return;
      }
      const target = resolvePathLinkTarget(filePath, gitCwd);
      void openInPreferredEditor(api, target).catch((error) => {
        toastManager.add({
          type: "error",
          title: t("git.errors.openFile"),
          description: error instanceof Error ? error.message : String(error),
          data: threadToastData,
        });
      });
    },
    [gitCwd, t, threadToastData],
  );

  if (!gitCwd) return null;

  const hasRunnableCommitPushAction = gitActionMenuItems.some(
    (item) => (item.id === "commit_push" || item.id === "push") && !item.disabled,
  );
  const shouldDimPanelCommitPushRow = isGitActionRunning || !hasRunnableCommitPushAction;

  // Shared dropdown body — the picker rows plus the contextual git-status warnings.
  // Rendered identically by the header split button and the panel "Commit and Push" row.
  const gitMenuContent = (
    <>
      <MenuGroup>
        <MenuGroupLabel>{t("git.title")}</MenuGroupLabel>
        {gitPickerMenuItems.map((item) => {
          const menuRow = <GitPickerMenuRow item={item} />;
          if (item.disabled && item.disabledReason) {
            return (
              <Popover key={item.id}>
                <PopoverTrigger
                  openOnHover
                  nativeButton={false}
                  render={<span className="block cursor-not-allowed" />}
                >
                  {menuRow}
                </PopoverTrigger>
                <PopoverPopup tooltipStyle side="left" align="center">
                  {item.disabledReason}
                </PopoverPopup>
              </Popover>
            );
          }
          return <GitPickerMenuRow key={item.id} item={item} />;
        })}
      </MenuGroup>
      {(gitStatusForActions?.branch === null ||
        (gitStatusForActions &&
          gitStatusForActions.branch !== null &&
          !gitStatusForActions.hasWorkingTreeChanges &&
          gitStatusForActions.behindCount > 0 &&
          gitStatusForActions.aheadCount === 0) ||
        isGitStatusOutOfSync ||
        gitStatusError) && <MenuSeparator className="mx-3 mt-2" />}
      {gitStatusForActions?.branch === null && (
        <p className="px-3 py-1.5 text-xs text-warning">{t("git.warnings.detached")}</p>
      )}
      {gitStatusForActions &&
        gitStatusForActions.branch !== null &&
        !gitStatusForActions.hasWorkingTreeChanges &&
        gitStatusForActions.behindCount > 0 &&
        gitStatusForActions.aheadCount === 0 && (
          <p className="px-3 py-1.5 text-xs text-warning">{t("git.warnings.behind")}</p>
        )}
      {isGitStatusOutOfSync && (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">{t("git.progress.refreshing")}</p>
      )}
      {gitStatusError && (
        <p className="px-3 py-1.5 text-xs text-destructive">{gitStatusError.message}</p>
      )}
    </>
  );

  // The git action dialogs are identical across surfaces; only the trigger differs.
  const gitActionDialogs = (
    <>
      <Dialog
        open={isCommitDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCommitDialogOpen(false);
            setDialogCommitMessage("");
            setExcludedFiles(new Set());
            setIsEditingFiles(false);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("git.commitDialog.title")}</DialogTitle>
            <DialogDescription>{t("git.commitDialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="space-y-3 rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)] p-3 text-xs">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">{t("git.branch")}</span>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {gitStatusForActions?.branch ?? t("git.detachedHead")}
                  </span>
                  {isDefaultBranch && (
                    <span className="text-right text-warning text-xs">
                      {t("git.warnings.defaultBranch")}
                    </span>
                  )}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isEditingFiles && allFiles.length > 0 && (
                      <Checkbox
                        checked={allSelected}
                        indeterminate={!allSelected && !noneSelected}
                        onCheckedChange={() => {
                          setExcludedFiles(
                            allSelected ? new Set(allFiles.map((f) => f.path)) : new Set(),
                          );
                        }}
                      />
                    )}
                    <span className="text-muted-foreground">{t("git.files")}</span>
                    {!allSelected && !isEditingFiles && (
                      <span className="text-muted-foreground">
                        {t("git.selectedFiles", {
                          selected: selectedFiles.length,
                          total: allFiles.length,
                        })}
                      </span>
                    )}
                  </div>
                  {allFiles.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setIsEditingFiles((prev) => !prev)}
                    >
                      {isEditingFiles ? t("git.done") : t("common:actions.edit")}
                    </Button>
                  )}
                </div>
                {!gitStatusForActions || allFiles.length === 0 ? (
                  <p className="font-medium">{t("git.none")}</p>
                ) : (
                  <div className="space-y-2">
                    <ScrollArea className="h-44 rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)]">
                      <div className="space-y-1 p-1">
                        {allFiles.map((file) => {
                          const isExcluded = excludedFiles.has(file.path);
                          return (
                            <div
                              key={file.path}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
                            >
                              {isEditingFiles && (
                                <Checkbox
                                  checked={!excludedFiles.has(file.path)}
                                  onCheckedChange={() => {
                                    setExcludedFiles((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(file.path)) {
                                        next.delete(file.path);
                                      } else {
                                        next.add(file.path);
                                      }
                                      return next;
                                    });
                                  }}
                                />
                              )}
                              {/* Raw <button> intentionally — list-row click target, not a shadcn Button. */}
                              <button
                                type="button"
                                className="group flex flex-1 items-center justify-between gap-3 text-left truncate"
                                onClick={() => openChangedFileInEditor(file.path)}
                              >
                                <span
                                  className={`truncate underline-offset-2 group-hover:underline group-focus-visible:underline${isExcluded ? " text-muted-foreground" : ""}`}
                                >
                                  {file.path}
                                </span>
                                <span className="shrink-0">
                                  {isExcluded ? (
                                    <span className="text-muted-foreground">
                                      {t("git.excluded")}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-success">+{file.insertions}</span>
                                      <span className="text-muted-foreground"> / </span>
                                      <span className="text-destructive">-{file.deletions}</span>
                                    </>
                                  )}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                    <div className="flex justify-end font-mono">
                      <span className="text-success">
                        +{selectedFiles.reduce((sum, f) => sum + f.insertions, 0)}
                      </span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-destructive">
                        -{selectedFiles.reduce((sum, f) => sum + f.deletions, 0)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">{t("git.commitDialog.message")}</p>
              <Textarea
                value={dialogCommitMessage}
                onChange={(event) => setDialogCommitMessage(event.target.value)}
                placeholder={t("git.commitDialog.messagePlaceholder")}
                size="sm"
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsCommitDialogOpen(false);
                setDialogCommitMessage("");
                setExcludedFiles(new Set());
                setIsEditingFiles(false);
              }}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={noneSelected}
              onClick={runDialogActionOnNewBranch}
            >
              {t("git.actions.commitNewBranch")}
            </Button>
            <Button size="sm" disabled={noneSelected} onClick={runDialogAction}>
              {t("git.actions.commit")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={pendingDefaultBranchAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDefaultBranchAction(null);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {pendingDefaultBranchActionCopy?.title ?? t("git.defaultBranch.fallbackTitle")}
            </DialogTitle>
            <DialogDescription>{pendingDefaultBranchActionCopy?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDefaultBranchAction(null)}>
              {t("git.actions.abort")}
            </Button>
            <Button variant="outline" size="sm" onClick={continuePendingDefaultBranchAction}>
              {pendingDefaultBranchAction &&
              requiresFeatureBranchForDefaultBranchAction(pendingDefaultBranchAction.action)
                ? t("git.defaultBranch.featureContinue")
                : (pendingDefaultBranchActionCopy?.continueLabel ?? t("git.actions.continue"))}
            </Button>
            {pendingDefaultBranchAction &&
            !requiresFeatureBranchForDefaultBranchAction(pendingDefaultBranchAction.action) ? (
              <Button size="sm" onClick={checkoutFeatureBranchAndContinuePendingAction}>
                {t("git.actions.checkoutFeatureContinue")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={isCreateBranchDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateBranchDialogOpen(false);
            setCreateBranchName("");
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("git.createBranch.title")}</DialogTitle>
            <DialogDescription>{t("git.createBranch.description")}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmedName = createBranchName.trim();
                if (!trimmedName || createBranchNameConflicts) {
                  return;
                }
                void createAndCheckoutBranch(trimmedName);
              }}
            >
              <div className="space-y-1.5">
                <label className="block font-medium text-sm" htmlFor="create-branch-name">
                  {t("git.createBranch.name")}
                </label>
                <Input
                  autoFocus
                  id="create-branch-name"
                  placeholder="feature/my-change"
                  value={createBranchName}
                  onChange={(event) => setCreateBranchName(event.target.value)}
                />
              </div>
              {createBranchNameConflicts ? (
                <p className="text-destructive text-sm">{t("git.createBranch.exists")}</p>
              ) : null}
              <DialogFooter variant="bare">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setIsCreateBranchDialogOpen(false);
                    setCreateBranchName("");
                  }}
                >
                  {t("common:actions.cancel")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createBranchName.trim().length === 0 || createBranchNameConflicts}
                >
                  {t("git.actions.createBranch")}
                </Button>
              </DialogFooter>
            </form>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );

  if (isPanel) {
    return (
      <>
        {!isRepo ? (
          <EnvironmentRow
            icon={<GitActionGlyph name="branch" className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />}
            label={initMutation.isPending ? t("git.progress.initializing") : t("git.initialize")}
            disabled={initMutation.isPending}
            onClick={() => initMutation.mutate()}
          />
        ) : (
          <Menu
            onOpenChange={(open) => {
              if (open) void invalidateGitQueries(queryClient);
            }}
          >
            <MenuTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    ENVIRONMENT_ROW_CLASS_NAME,
                    shouldDimPanelCommitPushRow && "opacity-55",
                  )}
                  aria-label={
                    shouldDimPanelCommitPushRow
                      ? t("git.commitPushUnavailableLabel")
                      : t("git.commitPush")
                  }
                  title={
                    shouldDimPanelCommitPushRow
                      ? t("git.commitPushUnavailableTitle")
                      : t("git.commitPush")
                  }
                />
              }
            >
              <EnvironmentRowBody
                icon={<GitActionGlyph name="push" className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />}
                label={t("git.commitPush")}
                trailing={<EnvironmentRowChevron />}
              />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="start" side="bottom" className="w-60 min-w-60">
              {gitMenuContent}
            </ComposerPickerMenuPopup>
          </Menu>
        )}
        {gitActionDialogs}
      </>
    );
  }

  return (
    <>
      {!isRepo ? (
        <Button
          variant="chrome-outline"
          size="xs"
          className={cn(CHAT_HEADER_CONTROL_CLASS_NAME, CHAT_HEADER_ICON_STRENGTH_CLASS_NAME)}
          disabled={initMutation.isPending}
          onClick={() => initMutation.mutate()}
        >
          {initMutation.isPending ? t("git.progress.initializing") : t("git.initialize")}
        </Button>
      ) : (
        <ChatHeaderSplitGroup label={t("git.title")}>
          {quickActionDisabledReason ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={
                  <Button
                    aria-label={quickActionLabel}
                    aria-disabled="true"
                    className={cn(
                      hideQuickActionLabel
                        ? CHAT_HEADER_ICON_CONTROL_CLASS_NAME
                        : CHAT_HEADER_CONTROL_CLASS_NAME,
                      CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                      CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
                      "cursor-not-allowed opacity-64",
                    )}
                    size={hideQuickActionLabel ? "icon-xs" : "xs"}
                    variant="chrome-outline"
                    title={quickActionLabel}
                  />
                }
              >
                <GitQuickActionIcon quickAction={quickAction} />
                {!hideQuickActionLabel ? (
                  <span className="font-normal">{quickActionLabel}</span>
                ) : null}
              </PopoverTrigger>
              <PopoverPopup tooltipStyle side="bottom" align="start">
                {quickActionDisabledReason}
              </PopoverPopup>
            </Popover>
          ) : (
            <Button
              variant="chrome-outline"
              size={hideQuickActionLabel ? "icon-xs" : "xs"}
              className={cn(
                hideQuickActionLabel
                  ? CHAT_HEADER_ICON_CONTROL_CLASS_NAME
                  : CHAT_HEADER_CONTROL_CLASS_NAME,
                CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
              )}
              disabled={isGitActionRunning || quickAction.disabled}
              aria-label={quickActionLabel}
              title={quickActionLabel}
              onClick={runQuickAction}
            >
              <GitQuickActionIcon quickAction={quickAction} />
              {!hideQuickActionLabel ? (
                <span className="font-normal">{quickActionLabel}</span>
              ) : null}
            </Button>
          )}
          <ChatHeaderSplitDivider />
          <Menu
            onOpenChange={(open) => {
              if (open) void invalidateGitQueries(queryClient);
            }}
          >
            <MenuTrigger
              render={
                <Button
                  aria-label={t("git.options")}
                  size="icon-xs"
                  variant="chrome-outline"
                  className={cn(
                    CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
                    CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                    CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME,
                  )}
                />
              }
              disabled={isGitActionRunning}
            >
              <ChevronDownIcon aria-hidden="true" className="size-3.5" />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="end" side="bottom" className="w-50 min-w-50">
              {gitMenuContent}
            </ComposerPickerMenuPopup>
          </Menu>
        </ChatHeaderSplitGroup>
      )}

      {gitActionDialogs}
    </>
  );
}
