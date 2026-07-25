import type {
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
} from "@synara/contracts";
import { isTemporaryWorktreeBranch, resolveUniqueSynaraBranchName } from "@synara/shared/git";
import { translateRendererCopy } from "../i18n";

export type GitActionIconName = "commit" | "push" | "pr";

export type GitDialogAction = "commit" | "push" | "commit_push" | "create_pr";

export interface GitActionMenuItem {
  id: "commit" | "commit_push" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog" | "open_pr";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_pr" | "show_hint" | "create_branch";
  action?: GitStackedAction;
  hint?: string;
}

const FALLBACK_DEFAULT_BRANCH_NAMES = new Set(["main", "master"]);
const gitCopy = (key: string, defaultValue: string, values?: Readonly<Record<string, unknown>>) =>
  translateRendererCopy(`workspace:git.${key}`, defaultValue, values);

const CREATE_PR_UNAVAILABLE_HINT = () =>
  gitCopy("disabled.noBranchChangesPr", "No branch changes to include in a PR.");

export interface DefaultBranchActionDialogCopy {
  title: string;
  description: string;
  continueLabel: string;
}

export type DefaultBranchConfirmableAction =
  | "push"
  | "create_pr"
  | "commit_push"
  | "commit_push_pr";

export function requiresFeatureBranchForDefaultBranchAction(
  action: DefaultBranchConfirmableAction,
): boolean {
  return action === "create_pr" || action === "commit_push_pr";
}

const SHORT_SHA_LENGTH = 7;
const TOAST_DESCRIPTION_MAX = 72;

function shortenSha(sha: string | undefined): string | null {
  if (!sha) return null;
  return sha.slice(0, SHORT_SHA_LENGTH);
}

function truncateText(
  value: string | undefined,
  maxLength = TOAST_DESCRIPTION_MAX,
): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return "...".slice(0, maxLength);
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function resolveDefaultCreateBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  return resolveUniqueSynaraBranchName(existingBranchNames, preferredBranch);
}

export function buildGitActionProgressStages(input: {
  action: GitStackedAction;
  hasCustomCommitMessage: boolean;
  hasWorkingTreeChanges: boolean;
  forcePushOnly?: boolean;
  pushTarget?: string;
  featureBranch?: boolean;
  shouldPushBeforePr?: boolean;
}): string[] {
  const branchStages = input.featureBranch
    ? [gitCopy("progress.preparingBranch", "Preparing feature branch...")]
    : [];
  const pushStage = input.pushTarget
    ? gitCopy("progress.pushingTo", "Pushing to {{target}}...", { target: input.pushTarget })
    : gitCopy("progress.pushing", "Pushing...");
  if (input.action === "push") {
    return [pushStage];
  }
  if (input.action === "create_pr") {
    const creatingPr = gitCopy("progress.creatingPr", "Creating PR...");
    return input.shouldPushBeforePr ? [pushStage, creatingPr] : [creatingPr];
  }
  const shouldIncludeCommitStages =
    !input.forcePushOnly && (input.action === "commit" || input.hasWorkingTreeChanges);
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? [gitCopy("progress.committing", "Committing...")]
      : [
          gitCopy("progress.generatingMessage", "Generating commit message..."),
          gitCopy("progress.committing", "Committing..."),
        ];
  if (input.action === "commit") {
    return [...branchStages, ...commitStages];
  }
  if (input.action === "commit_push") {
    return [...branchStages, ...commitStages, pushStage];
  }
  return [
    ...branchStages,
    ...commitStages,
    pushStage,
    gitCopy("progress.creatingPr", "Creating PR..."),
  ];
}

const withDescription = (title: string, description: string | undefined) =>
  description ? { title, description } : { title };

// Shared PR eligibility for explicit menu/CTA paths; the primary quick action ranks separately.
function canRunCreatePrAction(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  isDefaultBranch: boolean;
  hasOriginRemote: boolean;
  defaultBranchName?: string | null | undefined;
}): boolean {
  const { gitStatus, isBusy, isDefaultBranch, hasOriginRemote, defaultBranchName } = input;
  if (!gitStatus) return false;

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canPushWithoutUpstream = hasOriginRemote && !gitStatus.hasUpstream;
  const canCreateCleanPublishedPr =
    !isDefaultBranch &&
    gitStatus.hasUpstream &&
    gitStatus.upstreamBranch !== null &&
    !tracksDefaultUpstream(gitStatus, defaultBranchName);

  return (
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !hasOpenPr &&
    !isBehind &&
    (canCreateCleanPublishedPr ||
      (gitStatus.aheadCount > 0 && (gitStatus.hasUpstream || canPushWithoutUpstream)))
  );
}

function extractTrackedBranchName(upstreamBranch: string | null | undefined): string | null {
  if (!upstreamBranch) return null;
  const branchName = upstreamBranch.trim();
  return branchName.length > 0 ? branchName : null;
}

function tracksDefaultUpstream(
  gitStatus: GitStatusResult,
  defaultBranchName?: string | null,
): boolean {
  const trackedBranchName = extractTrackedBranchName(gitStatus.upstreamBranch);
  if (!trackedBranchName) return false;
  if (defaultBranchName) return trackedBranchName === defaultBranchName;
  return FALLBACK_DEFAULT_BRANCH_NAMES.has(trackedBranchName);
}

export function summarizeGitResult(result: GitRunStackedActionResult): {
  title: string;
  description?: string;
} {
  if (result.pr.status === "created" || result.pr.status === "opened_existing") {
    const prNumber = result.pr.number ? ` #${result.pr.number}` : "";
    const title =
      result.pr.status === "created"
        ? gitCopy("success.createdPr", "Created PR{{number}}", { number: prNumber })
        : gitCopy("success.openedPr", "Opened PR{{number}}", { number: prNumber });
    return withDescription(title, truncateText(result.pr.title));
  }

  if (result.push.status === "pushed") {
    const shortSha = shortenSha(result.commit.commitSha);
    const branch = result.push.upstreamBranch ?? result.push.branch;
    return withDescription(
      branch
        ? gitCopy("success.pushed", "Pushed{{sha}} to {{branch}}", {
            sha: shortSha ? ` ${shortSha}` : "",
            branch,
          })
        : gitCopy("success.pushedWithoutBranch", "Pushed{{sha}}", {
            sha: shortSha ? ` ${shortSha}` : "",
          }),
      truncateText(result.commit.subject),
    );
  }

  if (result.commit.status === "created") {
    const shortSha = shortenSha(result.commit.commitSha);
    const title = gitCopy("success.committed", "Committed{{sha}}", {
      sha: shortSha ? ` ${shortSha}` : " changes",
    });
    return withDescription(title, truncateText(result.commit.subject));
  }

  return { title: gitCopy("success.done", "Done") };
}

export function buildMenuItems(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  hasOriginRemote = true,
  isDefaultBranch = false,
  defaultBranchName?: string | null,
): GitActionMenuItem[] {
  if (!gitStatus) return [];

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canPushWithoutUpstream = hasOriginRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCommitPush =
    !isBusy &&
    hasBranch &&
    !isBehind &&
    (hasChanges || gitStatus.aheadCount > 0) &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr = canRunCreatePrAction({
    gitStatus,
    isBusy,
    isDefaultBranch,
    hasOriginRemote,
    defaultBranchName,
  });
  const canOpenPr = !isBusy && hasOpenPr;

  return [
    {
      id: "commit",
      label: gitCopy("actions.commit", "Commit"),
      disabled: !canCommit,
      icon: "commit",
      kind: "open_dialog",
      dialogAction: "commit",
    },
    ...(hasChanges && !isDefaultBranch
      ? [
          {
            id: "commit_push" as const,
            label: gitCopy("actions.commit_push", "Commit & push"),
            disabled: !canCommitPush,
            icon: "push" as const,
            kind: "open_dialog" as const,
            dialogAction: "commit_push" as const,
          },
        ]
      : []),
    {
      id: "push",
      label: isDefaultBranch
        ? gitCopy("actions.commit_push", "Commit & push")
        : gitCopy("actions.push", "Push"),
      disabled: !(isDefaultBranch ? canCommitPush : canPush),
      icon: "push",
      kind: "open_dialog",
      dialogAction: isDefaultBranch ? "commit_push" : "push",
    },
    hasOpenPr
      ? {
          id: "pr",
          label: gitCopy("actions.createPr", "Create PR"),
          disabled: !canOpenPr,
          icon: "pr",
          kind: "open_pr",
        }
      : {
          id: "pr",
          label: gitCopy("actions.createPr", "Create PR"),
          disabled: !canCreatePr,
          icon: "pr",
          kind: "open_dialog",
          dialogAction: "create_pr",
        },
  ];
}

export function resolveQuickAction(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  isDefaultBranch = false,
  hasOriginRemote = true,
  shouldOfferCreateBranch = false,
  _defaultBranchName?: string | null,
): GitQuickAction {
  if (isBusy) {
    return {
      label: gitCopy("actions.commit", "Commit"),
      disabled: true,
      kind: "show_hint",
      hint: gitCopy("disabled.busy", "Git action in progress."),
    };
  }

  if (!gitStatus) {
    return {
      label: gitCopy("actions.commit", "Commit"),
      disabled: true,
      kind: "show_hint",
      hint: gitCopy("disabled.statusUnavailable", "Git status is unavailable."),
    };
  }

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;

  if (!hasBranch) {
    return {
      label: gitCopy("actions.commit", "Commit"),
      disabled: true,
      kind: "show_hint",
      hint: "Create and checkout a branch before pushing or opening a PR.",
    };
  }

  if (!gitStatus.hasUpstream && shouldOfferCreateBranch) {
    return {
      label: gitCopy("actions.createBranch", "Create Branch"),
      disabled: false,
      kind: "create_branch",
    };
  }

  if (gitStatus.hasUpstream) {
    if (isDiverged) {
      return {
        label: gitCopy("actions.syncBranch", "Sync branch"),
        disabled: true,
        kind: "show_hint",
        hint: "Branch has diverged from upstream. Rebase/merge first.",
      };
    }

    if (isBehind) {
      return {
        label: gitCopy("actions.pull", "Pull"),
        disabled: false,
        kind: "run_pull",
      };
    }
  }

  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return {
        label: gitCopy("actions.commit", "Commit"),
        disabled: false,
        kind: "run_action",
        action: "commit",
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: gitCopy("actions.commit_push", "Commit & push"),
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    return {
      label: gitCopy("actions.commit_push_pr", "Commit, push & PR"),
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasOriginRemote) {
      if (hasOpenPr && !isAhead) {
        return { label: gitCopy("actions.viewPr", "View PR"), disabled: false, kind: "open_pr" };
      }
      return {
        label: gitCopy("actions.push", "Push"),
        disabled: true,
        kind: "show_hint",
        hint: 'Add an "origin" remote before pushing or creating a PR.',
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return { label: gitCopy("actions.viewPr", "View PR"), disabled: false, kind: "open_pr" };
      }
      return {
        label: gitCopy("actions.push", "Push"),
        disabled: true,
        kind: "show_hint",
        hint: "No local commits to push.",
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: isDefaultBranch
          ? gitCopy("actions.commit_push", "Commit & push")
          : gitCopy("actions.push", "Push"),
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return {
      label: gitCopy("actions.pushCreatePr", "Push & create PR"),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isAhead) {
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: isDefaultBranch
          ? gitCopy("actions.commit_push", "Commit & push")
          : gitCopy("actions.push", "Push"),
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return {
      label: gitCopy("actions.pushCreatePr", "Push & create PR"),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (hasOpenPr && gitStatus.hasUpstream) {
    return { label: gitCopy("actions.viewPr", "View PR"), disabled: false, kind: "open_pr" };
  }

  return {
    label: gitCopy("actions.commit", "Commit"),
    disabled: true,
    kind: "show_hint",
    hint: "Branch is up to date. No action needed.",
  };
}

export function resolveCreatePrActionAvailability(input: {
  gitStatus: GitStatusResult | null;
  isDefaultBranch?: boolean;
  hasOriginRemote?: boolean;
  defaultBranchName?: string | null | undefined;
}): { canRun: boolean; hint: string | null } {
  const canRun = canRunCreatePrAction({
    gitStatus: input.gitStatus,
    isBusy: false,
    isDefaultBranch: input.isDefaultBranch ?? false,
    hasOriginRemote: input.hasOriginRemote ?? true,
    defaultBranchName: input.defaultBranchName,
  });

  return {
    canRun,
    hint: canRun ? null : CREATE_PR_UNAVAILABLE_HINT(),
  };
}

export function resolvePullActionAvailability(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
}): { canRun: boolean; hint: string | null } {
  const { gitStatus, isBusy } = input;
  if (isBusy) return { canRun: false, hint: "Git action in progress." };
  if (!gitStatus) return { canRun: false, hint: "Git status is unavailable." };
  if (gitStatus.branch === null) {
    return { canRun: false, hint: "Detached HEAD: checkout a branch before pulling." };
  }
  if (!gitStatus.hasUpstream) {
    return { canRun: false, hint: "Current branch has no upstream to pull from." };
  }
  if (gitStatus.aheadCount > 0 && gitStatus.behindCount > 0) {
    return { canRun: false, hint: "Branch has diverged from upstream. Rebase/merge first." };
  }
  if (gitStatus.behindCount <= 0) {
    return { canRun: false, hint: "Branch is already up to date." };
  }
  return { canRun: true, hint: null };
}

export function shouldOfferCreateBranchPrompt(input: {
  activeWorktreePath: string | null;
  gitStatus: Pick<GitStatusResult, "branch" | "hasUpstream"> | null;
  createBranchFlowCompleted?: boolean;
}): boolean {
  if (!input.activeWorktreePath) return false;
  if (!input.gitStatus?.branch) return false;
  if (input.gitStatus.hasUpstream) return false;
  if (input.createBranchFlowCompleted) return false;
  return true;
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultBranch: boolean,
): action is DefaultBranchConfirmableAction {
  if (!isDefaultBranch) return false;
  return (
    action === "push" ||
    action === "create_pr" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: gitCopy("defaultBranch.commitPushTitle", "Commit & push to default branch?"),
        description: gitCopy(
          "defaultBranch.commitPushDescription",
          'This action will commit and push changes on "{{branch}}". You can continue on this branch or create a feature branch and run the same action there.',
          { branch: branchLabel },
        ),
        continueLabel: gitCopy("defaultBranch.commitPushContinue", "Commit & push to {{branch}}", {
          branch: branchLabel,
        }),
      };
    }
    return {
      title: gitCopy("defaultBranch.pushTitle", "Push to default branch?"),
      description: gitCopy(
        "defaultBranch.pushDescription",
        'This action will push local commits on "{{branch}}". You can continue on this branch or create a feature branch and run the same action there.',
        { branch: branchLabel },
      ),
      continueLabel: gitCopy("defaultBranch.pushContinue", "Push to {{branch}}", {
        branch: branchLabel,
      }),
    };
  }

  if (input.includesCommit) {
    return {
      title: gitCopy("defaultBranch.featureCommitPrTitle", "Create feature branch, commit & PR?"),
      description: gitCopy(
        "defaultBranch.featureCommitPrDescription",
        'Pull requests can\'t be opened from "{{branch}}" into itself. This action will create a feature branch, commit your changes there, push it, and create the PR.',
        { branch: branchLabel },
      ),
      continueLabel: gitCopy("defaultBranch.featureContinue", "Create feature branch & continue"),
    };
  }
  return {
    title: gitCopy("defaultBranch.featurePrTitle", "Create feature branch & PR?"),
    description: gitCopy(
      "defaultBranch.featurePrDescription",
      'Pull requests can\'t be opened from "{{branch}}" into itself. This action will create a feature branch from your current commits, push it, and create the PR.',
      { branch: branchLabel },
    ),
    continueLabel: gitCopy("defaultBranch.featureContinue", "Create feature branch & continue"),
  };
}

export function resolveLiveThreadBranchUpdate(input: {
  threadBranch: string | null;
  gitStatus: GitStatusResult | null;
}): { branch: string | null } | null {
  if (!input.gitStatus) {
    return null;
  }

  if (input.gitStatus.branch === null && input.threadBranch !== null) {
    return null;
  }

  if (input.threadBranch === input.gitStatus.branch) {
    return null;
  }

  if (
    input.threadBranch !== null &&
    input.gitStatus.branch !== null &&
    !isTemporaryWorktreeBranch(input.threadBranch) &&
    isTemporaryWorktreeBranch(input.gitStatus.branch)
  ) {
    return null;
  }

  return {
    branch: input.gitStatus.branch,
  };
}

// Re-export from shared for backwards compatibility in this module's exports
export { resolveAutoFeatureBranchName } from "@synara/shared/git";
