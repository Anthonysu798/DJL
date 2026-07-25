// FILE: EnvironmentPullRequestSection.tsx
// Purpose: "Pull request" section of the Environment panel — PR title link, live CI check
//          rollup, and open review comments with a one-click "Fix" handoff to the composer.
// Layer: Environment panel section
// Depends on: git status/PR-snapshot React Query helpers and the shared Environment row skin.

import type { GitPullRequestCheck, GitPullRequestComment, ThreadId } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ComposerPickerMenuPopup } from "../ComposerPickerMenuPopup";
import { DiffStatLabel } from "../DiffStatLabel";
import { Menu, MenuItem, MenuTrigger } from "../../ui/menu";
import { appendComposerPromptText } from "~/lib/chatReferences";
import { gitPullRequestSnapshotQueryOptions, gitStatusQueryOptions } from "~/lib/gitReactQuery";
import {
  ArrowUpRightIcon,
  ChatBubbleIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  DiffIcon,
  GitPullRequestIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { useSelectedLocale } from "~/i18n/intl";
import { cn } from "~/lib/utils";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentLabeledSection,
  EnvironmentRow,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "./EnvironmentRow";
import {
  buildFixReviewCommentsPrompt,
  buildResolveConflictsPrompt,
  describePullRequestComment,
  PULL_REQUEST_CHECK_STATUS_KEYS,
  summarizePullRequestChecks,
  summarizePullRequestComments,
  summarizePullRequestDiffStat,
  withStableCheckKeys,
  type PullRequestChecksTone,
} from "./environmentPullRequest.logic";

function CheckStatusIcon({ status }: { status: GitPullRequestCheck["status"] }) {
  switch (status) {
    case "pending":
      return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-warning" aria-hidden />;
    case "success":
      return <CircleCheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />;
    case "failure":
    case "cancelled":
      return <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-hidden />;
    default:
      // Skipped/neutral render as GitHub's dashed "not run" circle.
      return (
        <span
          className="size-3 shrink-0 rounded-full border border-dashed border-current opacity-50"
          aria-hidden
        />
      );
  }
}

function checksToneIcon(tone: PullRequestChecksTone) {
  switch (tone) {
    case "failure":
      return (
        <CircleAlertIcon
          className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "text-destructive")}
          aria-hidden
        />
      );
    case "pending":
      return (
        <Loader2Icon
          className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "animate-spin text-warning")}
          aria-hidden
        />
      );
    case "success":
      return (
        <CircleCheckIcon
          className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "text-success")}
          aria-hidden
        />
      );
    default:
      return (
        <CircleCheckIcon
          className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "opacity-50")}
          aria-hidden
        />
      );
  }
}

// Popup row that is clickable only when it has a URL: plain div without one, MenuItem with one.
function MenuRow({
  url,
  onOpenUrl,
  className,
  children,
}: {
  url: string | null;
  onOpenUrl: (url: string) => void;
  className: string;
  children: ReactNode;
}) {
  if (!url) {
    return (
      <div className={cn("w-full cursor-default rounded-[0.5rem] text-left", className)}>
        {children}
      </div>
    );
  }

  return (
    <MenuItem
      onClick={() => onOpenUrl(url)}
      className={cn(
        "w-full cursor-pointer rounded-[0.5rem] text-left data-highlighted:bg-[var(--color-background-elevated-secondary)]",
        className,
      )}
    >
      {children}
    </MenuItem>
  );
}

function ChecksMenuRow({
  check,
  onOpenUrl,
}: {
  check: GitPullRequestCheck;
  onOpenUrl: (url: string) => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <MenuRow
      url={check.url}
      onOpenUrl={onOpenUrl}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1 text-[length:var(--app-font-size-ui,12px)]"
    >
      <CheckStatusIcon status={check.status} />
      <span className="min-w-0 truncate text-[var(--color-text-foreground)]">{check.name}</span>
      <span className="shrink-0 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
        {t(PULL_REQUEST_CHECK_STATUS_KEYS[check.status])}
      </span>
    </MenuRow>
  );
}

function CommentsMenuRow({
  comment,
  onOpenUrl,
}: {
  comment: GitPullRequestComment;
  onOpenUrl: (url: string) => void;
}) {
  const { t } = useTranslation("chat");
  const locale = useSelectedLocale();
  const display = describePullRequestComment(comment, t("environment.pullRequest.emptyComment"));
  return (
    // items-stretch overrides the menu-option default items-center for this column layout.
    <MenuRow
      url={comment.url}
      onOpenUrl={onOpenUrl}
      className="flex flex-col items-stretch gap-0.5 px-2 py-1.5"
    >
      <span className="line-clamp-2 text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)]">
        {display.title}
      </span>
      {display.snippet ? (
        <span className="line-clamp-2 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
          {display.snippet}
        </span>
      ) : null}
      <span className="flex items-center justify-between gap-2 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground/70">
        <span className="min-w-0 truncate">{comment.path ?? comment.author ?? ""}</span>
        {comment.createdAt ? (
          <span className="shrink-0 tabular-nums">
            {formatRelativeTime(comment.createdAt, locale)}
          </span>
        ) : null}
      </span>
    </MenuRow>
  );
}

function MenuPlaceholder({ text }: { text: string }) {
  return (
    <div className="px-3 py-3 text-center text-[length:var(--app-font-size-ui,12px)] text-muted-foreground">
      {text}
    </div>
  );
}

export function EnvironmentPullRequestSection({
  gitCwd,
  enabled,
  activeThreadId,
  onOpenUrl,
  onClose,
}: {
  gitCwd: string | null;
  /** Gate polling on the panel being open (mirrors the Local Servers section). */
  enabled: boolean;
  activeThreadId: ThreadId | null;
  /** Open a URL in the in-app browser panel. */
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("chat");
  // Shares the cached git status the git block already fetches — no extra RPC.
  const { data: gitStatus } = useQuery(gitStatusQueryOptions(gitCwd));
  const pr = gitStatus?.pr ?? null;

  const snapshotQuery = useQuery(
    gitPullRequestSnapshotQueryOptions({
      cwd: gitCwd,
      reference: pr?.url ?? null,
      enabled: enabled && pr !== null && pr.state === "open",
    }),
  );

  // The snapshot's own PR summary is fresher than the cached git status: prefer its
  // title/number/url for display, and when it reports the PR merged/closed between
  // git-status polls, swap the checks/comments rows for a state note instead of
  // rendering stale "open" data.
  const livePr = snapshotQuery.data?.pullRequest ?? null;
  const displayPr = livePr ?? pr;

  if (!pr || pr.state !== "open" || !displayPr) {
    return null;
  }

  const settledState = displayPr.state !== "open" ? displayPr.state : null;
  const diffStat = summarizePullRequestDiffStat(displayPr);
  const hasConflicts = settledState === null && displayPr.mergeability === "conflicting";

  const checks = snapshotQuery.data?.checks ?? [];
  const comments = snapshotQuery.data?.comments ?? [];
  const commentsTruncated = snapshotQuery.data?.commentsTruncated ?? false;
  const commentsError = snapshotQuery.data?.commentsError ?? null;
  const checksSummary = summarizePullRequestChecks(checks);
  const loading = snapshotQuery.isLoading;
  // Any failed refetch should be visible; otherwise stale rows look current.
  const failed = snapshotQuery.isError;

  // Fix actions keep the PR context visible while the user reviews the generated draft.
  const handleFixComments = () => {
    if (!activeThreadId || comments.length === 0) {
      return;
    }
    appendComposerPromptText(
      activeThreadId,
      buildFixReviewCommentsPrompt({
        prNumber: displayPr.number,
        prUrl: displayPr.url,
        comments,
        commentsTruncated,
        copy: {
          commentHeading: (comment) => {
            const context = [
              comment.path
                ? t("environment.pullRequest.fixPrompt.onPath", { path: comment.path })
                : null,
              comment.url
                ? t("environment.pullRequest.fixPrompt.atUrl", { url: comment.url })
                : null,
              comment.author
                ? t("environment.pullRequest.fixPrompt.byAuthor", { author: comment.author })
                : null,
            ].filter((part): part is string => part !== null);
            return context.length > 0
              ? t("environment.pullRequest.fixPrompt.commentWithContext", {
                  context: context.join(" "),
                })
              : t("environment.pullRequest.fixPrompt.comment");
          },
          intro: (prNumber, prUrl) =>
            t("environment.pullRequest.fixPrompt.intro", { prNumber, prUrl }),
          warning: t("environment.pullRequest.fixPrompt.warning"),
          more: (prUrl) => t("environment.pullRequest.fixPrompt.more", { prUrl }),
        },
      }),
    );
  };

  const handleResolveConflicts = () => {
    if (!activeThreadId) {
      return;
    }
    appendComposerPromptText(
      activeThreadId,
      buildResolveConflictsPrompt({
        prNumber: displayPr.number,
        prUrl: displayPr.url,
        baseBranch: displayPr.baseBranch,
        headBranch: displayPr.headBranch,
      }),
    );
  };

  return (
    <EnvironmentLabeledSection label={t("environment.pullRequest.title")}>
      <EnvironmentRow
        icon={<GitPullRequestIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
        label={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{`#${displayPr.number} ${displayPr.title}`}</span>
            {displayPr.isDraft ? (
              <span className="shrink-0 rounded-full bg-[var(--color-background-elevated-secondary)] px-1.5 py-px text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
                {t("environment.pullRequest.draft")}
              </span>
            ) : null}
          </span>
        }
        trailing={<ArrowUpRightIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
        onClick={() => {
          onOpenUrl(displayPr.url);
          onClose();
        }}
      />

      {diffStat ? (
        <EnvironmentRow
          icon={<DiffIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
          label={
            <span className="flex min-w-0 items-center gap-1.5">
              <DiffStatLabel additions={diffStat.additions} deletions={diffStat.deletions} />
              {diffStat.changedFiles !== null ? (
                <span className="truncate text-muted-foreground">
                  {t("environment.pullRequest.fileCount", { count: diffStat.changedFiles })}
                </span>
              ) : null}
            </span>
          }
          trailing={<ArrowUpRightIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
          title={t("environment.pullRequest.openFiles")}
          onClick={() => {
            onOpenUrl(`${displayPr.url}/files`);
            onClose();
          }}
        />
      ) : null}

      {hasConflicts ? (
        <div className="flex w-full items-center gap-1">
          <EnvironmentRow
            className="min-w-0 flex-1"
            icon={
              <CircleAlertIcon
                className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "text-warning")}
                aria-hidden
              />
            }
            label={
              <span className="truncate">
                {t("environment.pullRequest.conflictsWith", { branch: displayPr.baseBranch })}
              </span>
            }
            trailing={<ArrowUpRightIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
            onClick={() => {
              onOpenUrl(displayPr.url);
              onClose();
            }}
          />
          {activeThreadId ? (
            <button
              type="button"
              onClick={handleResolveConflicts}
              title={t("environment.pullRequest.resolveConflictsHint")}
              className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)] transition-colors hover:bg-[var(--color-background-elevated-secondary)]"
            >
              {t("environment.pullRequest.fix")}
            </button>
          ) : null}
        </div>
      ) : null}

      {settledState ? (
        <EnvironmentRow
          icon={
            settledState === "merged" ? (
              <CircleCheckIcon
                className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "text-success")}
                aria-hidden
              />
            ) : (
              <CircleAlertIcon
                className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "opacity-60")}
                aria-hidden
              />
            )
          }
          label={t(
            settledState === "merged"
              ? "environment.pullRequest.merged"
              : "environment.pullRequest.closed",
          )}
          trailing={<ArrowUpRightIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
          onClick={() => {
            onOpenUrl(displayPr.url);
            onClose();
          }}
        />
      ) : failed ? (
        <EnvironmentRow
          icon={
            <CircleAlertIcon
              className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "text-destructive")}
              aria-hidden
            />
          }
          label={t("environment.pullRequest.loadFailed")}
          trailing={
            <RefreshCwIcon
              className={cn("size-3 shrink-0", snapshotQuery.isFetching && "animate-spin")}
              aria-hidden
            />
          }
          title={t("environment.pullRequest.retry")}
          onClick={() => void snapshotQuery.refetch()}
        />
      ) : (
        <>
          <Menu>
            <MenuTrigger
              render={
                <button type="button" className={ENVIRONMENT_ROW_CLASS_NAME} disabled={loading} />
              }
            >
              <EnvironmentRowBody
                icon={
                  loading ? (
                    <RefreshCwIcon
                      className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "animate-spin")}
                      aria-hidden
                    />
                  ) : (
                    checksToneIcon(checksSummary.tone)
                  )
                }
                label={
                  loading
                    ? t("environment.pullRequest.loadingChecks")
                    : t(checksSummary.labelKey, { count: checksSummary.count })
                }
                trailing={<EnvironmentRowChevron />}
              />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="start" side="bottom" className="w-72 min-w-72">
              {checks.length === 0 ? (
                <MenuPlaceholder text={t("environment.pullRequest.noChecksReported")} />
              ) : (
                <div className="flex flex-col gap-0.5">
                  {withStableCheckKeys(checks).map(({ key, check }) => (
                    <ChecksMenuRow
                      key={key}
                      check={check}
                      onOpenUrl={(url) => {
                        onOpenUrl(url);
                        onClose();
                      }}
                    />
                  ))}
                </div>
              )}
            </ComposerPickerMenuPopup>
          </Menu>

          {/* The summary opens details; its sibling Fix drafts the entire visible batch. */}
          <div className="flex w-full items-center gap-1">
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(ENVIRONMENT_ROW_CLASS_NAME, "min-w-0 flex-1")}
                    disabled={loading}
                  />
                }
              >
                <EnvironmentRowBody
                  icon={<ChatBubbleIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
                  label={
                    loading
                      ? t("environment.pullRequest.loadingComments")
                      : commentsError
                        ? t("environment.pullRequest.commentsUnavailable")
                        : (() => {
                            const summary = summarizePullRequestComments(
                              comments.length,
                              commentsTruncated,
                            );
                            return t(summary.key, { count: summary.count });
                          })()
                  }
                  trailing={<EnvironmentRowChevron />}
                />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" side="bottom" className="w-80 min-w-80">
                {commentsError ? (
                  <MenuPlaceholder
                    text={t("environment.pullRequest.commentsLoadFailed", {
                      detail: commentsError,
                    })}
                  />
                ) : comments.length === 0 ? (
                  <MenuPlaceholder
                    text={
                      commentsTruncated
                        ? t("environment.pullRequest.commentsMayBeHidden")
                        : t("environment.pullRequest.noUnresolvedComments")
                    }
                  />
                ) : (
                  <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                    {comments.map((comment) => (
                      <CommentsMenuRow
                        key={comment.id}
                        comment={comment}
                        onOpenUrl={(url) => {
                          onOpenUrl(url);
                          onClose();
                        }}
                      />
                    ))}
                    {commentsTruncated ? (
                      <MenuPlaceholder text={t("environment.pullRequest.moreComments")} />
                    ) : null}
                  </div>
                )}
              </ComposerPickerMenuPopup>
            </Menu>
            {!commentsError && comments.length > 0 && activeThreadId ? (
              <button
                type="button"
                onClick={handleFixComments}
                title={t("environment.pullRequest.fixCommentsHint")}
                className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)] transition-colors hover:bg-[var(--color-background-elevated-secondary)]"
              >
                {t("environment.pullRequest.fix")}
              </button>
            ) : null}
          </div>
        </>
      )}
    </EnvironmentLabeledSection>
  );
}
