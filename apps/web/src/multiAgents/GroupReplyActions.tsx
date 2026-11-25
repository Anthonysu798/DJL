// FILE: GroupReplyActions.tsx
// Purpose: Under a member's reply: the "Changed N files · ran N commands" chip with its details;
//          Go with this under a proposal; Combine and Discuss under the last reply of a round of
//          proposals; Undo changes under the newest round that changed files; and one small
//          glass pill on hover with the tap reactions, Copy and a "…" menu (Ask again, Reply to
//          this, Ask another agent).
// Layer: UI component

import type { Group, GroupReaction } from "@djl/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  GitMergeIcon,
  MessageCircleIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Undo2Icon,
} from "~/lib/icons";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { GroupAgentAvatar } from "./GroupAgentAvatar";
import { GROUP_MENU_CLASS } from "./GroupMenu";
import { GroupMemberReactions, GroupReactionBar, USER_REACTION_EMOJI } from "./GroupReactions";
import type { GroupChatRow, GroupMemberRow } from "./groupChat.logic";
import { reactionSummary, workChipCounts } from "./groupChat.logic";
import {
  answeredUserText,
  askAgainText,
  askAnotherText,
  combineText,
  discussText,
} from "./groupComposer.logic";
import type { GroupSendInput } from "./GroupChatView";

const ACTION_BUTTON_CLASS =
  "flex h-6 min-w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94] data-popup-open:bg-[var(--color-background-button-secondary-hover)] data-popup-open:text-foreground [&_svg]:size-3.5";

const PILL_CLASS =
  "flex h-6 items-center gap-1.5 rounded-md border border-[color:var(--color-border-light)] px-2 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,border-color,transform] duration-150 ease-out hover:border-[color:var(--color-border)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3";
const PICK_CLASS =
  "flex h-6 items-center gap-1.5 rounded-md pr-2 pl-0.5 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]";

export function GroupReplyActions(props: {
  group: Group;
  row: GroupMemberRow;
  rows: readonly GroupChatRow[];
  send: (input: GroupSendInput) => Promise<boolean>;
  /** Reply to this answer: the composer shows who is being answered. */
  onReply: (row: GroupMemberRow) => void;
  /** Set on the last reply of a round of proposals: the members who proposed something. */
  proposalAuthors?: readonly GroupMemberRow[] | undefined;
  /** Set on the last reply of the newest round that changed files. */
  undo?: { turnCount: number; files: number } | undefined;
  /** A round is running, so nothing that starts or changes one is offered. */
  busy?: boolean;
  /** Reactions on this answer: members' status and the user's own. */
  reactions?: readonly GroupReaction[] | undefined;
}) {
  const { t } = useTranslation("shell");
  const { group, row } = props;
  // The desktop app refuses the browser clipboard API; this falls back to a copy that works.
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard<void>({
    timeout: 1600,
    onError: (cause) =>
      toastManager.add({
        type: "error",
        title: t("copy.failed", { ns: "chat" }),
        description: cause.message,
      }),
  });
  const [showWork, setShowWork] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [combining, setCombining] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const proposal = row.proposeOnly && row.status === "ok" && !row.passed;
  const authors = props.proposalAuthors ?? [];
  const decisions = !props.busy && (proposal || authors.length > 0 || props.undo !== undefined);

  const undo = async () => {
    if (!props.undo) return;
    if (!window.confirm(t("multiAgents.reply.undoConfirm", { count: props.undo.files }))) return;
    setUndoing(true);
    setUndoError(null);
    try {
      // Resolves once the files really changed back; the button then moves to the next round.
      await ensureNativeApi().groups.undoRound({
        groupId: group.id,
        turnCount: props.undo.turnCount,
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "";
      setUndoError(
        reason
          ? `${t("multiAgents.reply.undoFailed")} ${reason}`
          : t("multiAgents.reply.undoFailed"),
      );
    } finally {
      setUndoing(false);
    }
  };

  const decisionBar = decisions ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {proposal ? (
        <button
          type="button"
          className={PILL_CLASS}
          onClick={() =>
            void ensureNativeApi()
              .groups.react({
                groupId: group.id,
                replyId: row.replyId,
                kind: "doIt",
                message: `@${row.handle} ${USER_REACTION_EMOJI.doIt} ${t("multiAgents.reply.goWithText")}`,
              })
              .catch(() => undefined)
          }
        >
          <CheckIcon />
          {t("multiAgents.reply.goWith")}
        </button>
      ) : null}
      {authors.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={combining}
            className={cn(PILL_CLASS, combining && "border-[color:var(--color-border)]")}
            onClick={() => setCombining((open) => !open)}
          >
            <GitMergeIcon />
            {t("multiAgents.reply.combine")}
          </button>
          <button
            type="button"
            className={PILL_CLASS}
            onClick={() =>
              void props.send({ text: discussText(t("multiAgents.reply.discussText")) })
            }
          >
            <MessageCircleIcon />
            {t("multiAgents.reply.discuss")}
          </button>
        </>
      ) : null}
      {props.undo ? (
        <button type="button" disabled={undoing} className={PILL_CLASS} onClick={() => void undo()}>
          <RotateCcwIcon />
          {t("multiAgents.reply.undo")}
        </button>
      ) : null}
      {undoError ? <span className="text-xs text-destructive">{undoError}</span> : null}
      {combining ? (
        <div className="flex items-center gap-1 border-l border-[color:var(--color-border-light)] pl-2">
          <span className="pr-1 text-xs text-muted-foreground">
            {t("multiAgents.reply.combineWho")}
          </span>
          {group.members.map((member) => (
            <button
              key={member.id}
              type="button"
              className={PICK_CLASS}
              onClick={() => {
                setCombining(false);
                void props.send({
                  text: combineText(member, t("multiAgents.reply.combineText")),
                });
              }}
            >
              <GroupAgentAvatar provider={member.provider} size="xs" />@{member.handle}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  if (row.passed) return decisionBar ? <div className="mt-1.5">{decisionBar}</div> : null;
  const counts = workChipCounts(row);
  const others = group.members.filter((member) => member.id !== row.memberId);

  const chipLabel = counts
    ? [
        counts.files > 0 ? t("multiAgents.reply.workFiles", { count: counts.files }) : null,
        counts.commands > 0
          ? t("multiAgents.reply.workCommands", { count: counts.commands })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const summary = reactionSummary(props.reactions);
  const userReactions = [...summary.user] as (keyof typeof USER_REACTION_EMOJI)[];

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {summary.members.length > 0 || userReactions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {userReactions.map((kind) => (
            <span
              key={kind}
              title={t(`multiAgents.reactions.label.${kind}`)}
              className="flex h-6 animate-in items-center rounded-full border border-[color:var(--color-border)] bg-[var(--color-background-surface)] px-1.5 text-xs leading-none duration-200 zoom-in-75 fade-in motion-reduce:animate-none"
            >
              {USER_REACTION_EMOJI[kind]}
            </span>
          ))}
          <GroupMemberReactions group={group} reactions={props.reactions} />
        </div>
      ) : null}
      {decisionBar}
      {chipLabel ? (
        <div>
          <button
            type="button"
            aria-expanded={showWork}
            className="-ml-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => setShowWork((open) => !open)}
          >
            <ChevronRightIcon
              className={cn(
                "size-3 transition-transform duration-150 ease-out",
                showWork && "rotate-90",
              )}
            />
            {chipLabel}
          </button>
          {showWork ? (
            <div className="mt-1 flex flex-col gap-2 border-l border-[color:var(--color-border-light)] py-0.5 pl-3 text-xs">
              {row.files.length > 0 ? (
                <div>
                  <p className="mb-0.5 text-muted-foreground/70">
                    {t("multiAgents.reply.filesHeading")}
                  </p>
                  <p className="font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-text-foreground-secondary)]">
                    {row.files.join("\n")}
                  </p>
                </div>
              ) : null}
              {row.commands.length > 0 ? (
                <div>
                  <p className="mb-0.5 text-muted-foreground/70">
                    {t("multiAgents.reply.commandsHeading")}
                  </p>
                  <p className="font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-text-foreground-secondary)]">
                    {row.commands.join("\n")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "-ml-1 flex w-fit items-center gap-0.5 rounded-full border border-[color:var(--glass-border)] bg-[var(--glass-control-fill)] px-1 py-0.5 opacity-0 [box-shadow:var(--glass-highlight)] transition-opacity duration-150 ease-out group-hover/row:opacity-100 focus-within:opacity-100",
          menuOpen && "opacity-100",
        )}
      >
        {row.status === "ok" ? (
          <>
            <GroupReactionBar group={group} row={row} reactions={props.reactions} />
            <span
              aria-hidden
              className="mx-1 h-3.5 w-px bg-[color-mix(in_srgb,var(--color-text-foreground)_12%,transparent)]"
            />
          </>
        ) : null}
        <button
          type="button"
          aria-label={copied ? t("multiAgents.reply.copied") : t("multiAgents.reply.copy")}
          title={copied ? undefined : t("multiAgents.reply.copy")}
          data-copied={copied}
          className={cn(
            ACTION_BUTTON_CLASS,
            "gap-1 rounded-full px-1 text-[11px]",
            copied && "pr-2 text-emerald-600 hover:text-emerald-600 dark:text-emerald-400",
          )}
          onClick={() => copyToClipboard(row.text, undefined)}
        >
          {copied ? (
            <>
              <CheckIcon className="animate-[group-pop_360ms_ease-out_1] motion-reduce:animate-none" />
              <span className="animate-in duration-200 fade-in slide-in-from-left-1 motion-reduce:animate-none">
                {t("multiAgents.reply.copied")}
              </span>
            </>
          ) : (
            <CopyIcon />
          )}
        </button>
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label={t("multiAgents.reply.more")}
                title={t("multiAgents.reply.more")}
                className={cn(ACTION_BUTTON_CLASS, "rounded-full")}
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup
            surface="liquid"
            align="start"
            sideOffset={6}
            className={cn(GROUP_MENU_CLASS, "w-56")}
          >
            <MenuItem
              onClick={() =>
                void props.send({ text: askAgainText(row, answeredUserText(props.rows, row.id)) })
              }
            >
              <RefreshCwIcon />
              {t("multiAgents.reply.askAgain")}
            </MenuItem>
            <MenuItem onClick={() => props.onReply(row)}>
              <Undo2Icon />
              {t("multiAgents.reply.replyTo")}
            </MenuItem>
            {others.length > 0 ? (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>{t("multiAgents.reply.askAnother")}</MenuGroupLabel>
                  {others.map((member) => (
                    <MenuItem
                      key={member.id}
                      onClick={() =>
                        void props.send({
                          text: askAnotherText(
                            row,
                            member,
                            t("multiAgents.reply.checkLead", { name: row.handle }),
                          ),
                        })
                      }
                    >
                      <GroupAgentAvatar provider={member.provider} size="sm" />
                      {member.handle}
                    </MenuItem>
                  ))}
                </MenuGroup>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}
