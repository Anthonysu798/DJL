// FILE: GroupReactions.tsx
// Purpose: Reactions in a group chat: the 👀 / ✅ / 💤 / ⚠️ a member puts on a message it picked
//          up, and the user's tap reactions under an answer (👍 Good, 👎 Not quite, ✅ Do it,
//          🤔 Explain simpler), each of which the agent answers.
// Layer: UI component

import type { Group, GroupReaction, GroupUserReaction } from "@djl/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { GroupAgentAvatar } from "./GroupAgentAvatar";
import { reactionSummary, type GroupMemberRow } from "./groupChat.logic";

const MEMBER_EMOJI = { seen: "👀", done: "✅", passed: "💤", failed: "⚠️" } as const;
export const USER_REACTION_EMOJI: Record<GroupUserReaction, string> = {
  like: "👍",
  dislike: "👎",
  doIt: "✅",
  simpler: "🤔",
};
const USER_REACTIONS: readonly GroupUserReaction[] = ["like", "dislike", "doIt", "simpler"];

/** The members' reactions on one message, newest state per member. */
export function GroupMemberReactions(props: {
  group: Group;
  reactions: readonly GroupReaction[] | undefined;
  className?: string;
}) {
  const { t } = useTranslation("shell");
  const summary = reactionSummary(props.reactions);
  if (summary.members.length === 0) return null;
  return (
    <div
      data-testid="group-member-reactions"
      className={cn("flex flex-wrap items-center gap-1", props.className)}
    >
      {summary.members.map(({ memberId, kind }) => {
        const member = props.group.members.find((entry) => entry.id === memberId);
        if (!member) return null;
        const label = t(`multiAgents.reactions.member.${kind}`, { name: member.handle });
        return (
          <span
            key={`${memberId}:${kind}`}
            role="img"
            aria-label={label}
            title={label}
            className="flex h-6 animate-in items-center gap-1 rounded-full border border-[color:var(--color-border-light)] bg-[var(--color-background-surface)] pr-1.5 pl-0.5 text-xs duration-300 zoom-in-75 fade-in motion-reduce:animate-none"
          >
            <GroupAgentAvatar provider={member.provider} size="xs" className="rounded-full" />
            <span
              aria-hidden
              className={cn(
                "leading-none",
                kind === "seen" &&
                  "animate-[group-peek_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
              )}
            >
              {MEMBER_EMOJI[kind]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** What the agent is asked to do when the user taps a reaction that wakes it. */
export function reactionMessage(
  t: ReturnType<typeof useTranslation<"shell">>["t"],
  kind: Exclude<GroupUserReaction, "like">,
  handle: string,
): string {
  return `@${handle} ${USER_REACTION_EMOJI[kind]} ${t(`multiAgents.reactions.text.${kind}`)}`;
}

/** The user's reaction buttons under one answer, with the ones already used lit. */
export function GroupReactionBar(props: {
  group: Group;
  row: GroupMemberRow;
  reactions: readonly GroupReaction[] | undefined;
  /** A round is running; reactions that wake an agent still join it. */
  disabled?: boolean;
}) {
  const { t } = useTranslation("shell");
  const { group, row } = props;
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<GroupUserReaction | null>(null);
  const [popped, setPopped] = useState<GroupUserReaction | null>(null);
  const used = reactionSummary(props.reactions).user;

  const react = async (kind: GroupUserReaction) => {
    setError(null);
    setPopped(kind);
    setSending(kind);
    try {
      await ensureNativeApi().groups.react({
        groupId: group.id,
        replyId: row.replyId,
        kind,
        ...(kind === "like" ? {} : { message: reactionMessage(t, kind, row.handle) }),
      });
    } catch {
      setError(t("multiAgents.reactions.failed"));
    } finally {
      setSending(null);
    }
  };

  return (
    <div data-testid="group-reaction-bar" className="flex items-center gap-0.5">
      {USER_REACTIONS.map((kind) => {
        const label = t(`multiAgents.reactions.label.${kind}`);
        const active = used.has(kind);
        return (
          <Tooltip key={kind}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  disabled={props.disabled || sending !== null}
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] leading-none transition-[background-color,transform,opacity] duration-150 ease-out hover:scale-110 hover:bg-[var(--color-background-button-secondary-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-90 disabled:pointer-events-none disabled:opacity-40 motion-reduce:hover:scale-100",
                    active &&
                      "bg-[var(--color-background-button-secondary-hover)] ring-1 ring-[color:var(--color-border)]",
                    sending === kind && "animate-pulse",
                  )}
                  onClick={() => void react(kind)}
                />
              }
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block",
                  popped === kind &&
                    "animate-[group-pop_360ms_ease-out_1] motion-reduce:animate-none",
                )}
                onAnimationEnd={() => setPopped(null)}
              >
                {USER_REACTION_EMOJI[kind]}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">{label}</TooltipPopup>
          </Tooltip>
        );
      })}
      {error ? <span className="ml-1 text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
