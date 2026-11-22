// FILE: GroupChatView.tsx
// Purpose: The chat of one Multi agents group: labelled member replies, who is working, the
//          hop-limit Continue / Stop card, and the composer.
// Layer: UI component

import {
  GROUP_MODEL_SELECTION,
  type Group,
  type ProviderSkillReference,
  type UploadChatAttachment,
} from "@djl/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { CHAT_COLUMN_FRAME_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { Button } from "~/components/ui/button";
import { cn, newCommandId, newMessageId } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { createThreadSelector } from "~/storeSelectors";
import { useRetainVisibleThreadDetails } from "~/threadDetailSubscriptionRetention";

import { GroupAgentAvatar, GroupAvatarStack } from "./GroupAgentAvatar";
import { deriveGroupChatRows } from "./groupChat.logic";
import { GroupComposer, type GroupComposerHandle } from "./GroupComposer";
import { GroupEmptyChat } from "./GroupEmptyChat";
import { GroupImageViewer } from "./GroupImageViewer";
import { GroupMessageRow } from "./GroupMessageRow";
import { GroupReplyActions } from "./GroupReplyActions";
import { useGroupStore } from "./groupStore";

export type GroupSendInput = {
  text: string;
  attachments?: UploadChatAttachment[];
  skills?: ProviderSkillReference[];
  dispatchMode?: "queue" | "steer";
};

export function useGroupSend(group: Group) {
  const { t } = useTranslation("shell");
  const [error, setError] = useState<string | null>(null);
  const send = async (input: GroupSendInput) => {
    setError(null);
    try {
      await ensureNativeApi().orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: group.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: input.text,
          attachments: input.attachments ?? [],
          ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
        },
        modelSelection: GROUP_MODEL_SELECTION,
        dispatchMode: input.dispatchMode ?? "queue",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      return true;
    } catch {
      setError(t("multiAgents.errors.sendFailed"));
      return false;
    }
  };
  return { send, error };
}

export function GroupChatView(props: { group: Group; headerActions?: ReactNode }) {
  const { group } = props;
  const { t } = useTranslation("shell");
  const navigate = useNavigate();
  useRetainVisibleThreadDetails(useMemo(() => [group.threadId], [group.threadId]));
  const thread = useStore(useMemo(() => createThreadSelector(group.threadId), [group.threadId]));
  const replies = useGroupStore((state) => state.replies);
  const memberStates = useGroupStore((state) => state.memberStates);
  const drafts = useGroupStore((state) => state.drafts);
  const rows = useMemo(
    () => deriveGroupChatRows(thread?.messages ?? [], group, replies),
    [group, replies, thread?.messages],
  );
  const running = thread?.session?.status === "running";
  const busyMembers = group.members.filter((member) => {
    const state = memberStates[member.id];
    return running && (state === "working" || state === "waiting");
  });
  const { send: sendQueued, error } = useGroupSend(group);
  // While a round runs, a new message joins it instead of waiting for it to end.
  const send = (input: GroupSendInput) =>
    sendQueued({ dispatchMode: running ? "steer" : "queue", ...input });
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<GroupComposerHandle | null>(null);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length, busyMembers.length]);

  const stopAll = () =>
    ensureNativeApi()
      .orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: group.threadId,
        createdAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  const resolvePause = (action: "continue" | "stop") =>
    ensureNativeApi()
      .groups.resolvePause({
        groupId: group.id,
        action,
        continueText: t("multiAgents.pause.continue"),
      })
      .catch(() => undefined);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[color:var(--color-border-light)] px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <GroupAvatarStack members={group.members} size="sm" />
          <h2 className="truncate text-[13px] font-medium">{group.name}</h2>
          <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
            {group.members.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {running ? (
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
              onClick={stopAll}
            >
              <span aria-hidden className="size-2 rounded-[2px] bg-current" />
              {t("multiAgents.chat.stopAll")}
            </button>
          ) : null}
          {props.headerActions}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="group-chat-rows">
        <div className={cn(CHAT_COLUMN_FRAME_CLASS_NAME, "min-h-full px-4 pt-2 pb-6")}>
          {thread && rows.length === 0 && busyMembers.length === 0 ? (
            <GroupEmptyChat group={group} onPick={(value) => composerRef.current?.setText(value)} />
          ) : null}
          {rows.map((row) => (
            <GroupMessageRow
              key={row.id}
              row={row}
              cwd={group.folder}
              onExpandImage={setExpandedImage}
              onSetUp={
                row.kind === "member" && row.status === "failed"
                  ? () => void navigate({ to: "/settings", search: { section: "accounts" } })
                  : undefined
              }
              footer={
                row.kind === "member" ? (
                  <GroupReplyActions
                    group={group}
                    row={row}
                    rows={rows}
                    send={send}
                    prefill={(value) => composerRef.current?.setText(value)}
                  />
                ) : undefined
              }
            />
          ))}
          {busyMembers.map((member) => (
            <div
              key={member.id}
              className={cn(
                "group/busy flex animate-in gap-3 py-2 duration-200 fade-in motion-reduce:animate-none",
                drafts[member.id] ? "items-start" : "items-center",
              )}
            >
              <GroupAgentAvatar provider={member.provider} />
              {drafts[member.id] ? (
                <span className="min-w-0 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
                  {drafts[member.id]}
                </span>
              ) : (
                <span className="shimmer text-[13px] text-[var(--color-text-foreground-secondary)]">
                  {memberStates[member.id] === "waiting"
                    ? t("multiAgents.chat.waiting", { name: member.handle })
                    : t("multiAgents.chat.working", { name: member.handle })}
                </span>
              )}
              <button
                type="button"
                className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground opacity-0 transition-[color,background-color,opacity] duration-150 ease-out group-hover/busy:opacity-100 hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() =>
                  void ensureNativeApi()
                    .groups.stopMember({ groupId: group.id, memberId: member.id })
                    .catch(() => undefined)
                }
              >
                <span aria-hidden className="size-1.5 rounded-[1.5px] bg-current" />
                {t("multiAgents.chat.stopMember")}
              </button>
            </div>
          ))}
          {group.pendingHandoffs.length > 0 && !running ? (
            <div className="my-3 ml-10 flex animate-in flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] px-4 py-3 duration-200 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
              <div className="min-w-0 text-[13px] leading-relaxed">
                <p className="font-medium">
                  {t("multiAgents.pause.title", { count: group.hopLimit })}
                </p>
                <p className="text-muted-foreground">{t("multiAgents.pause.body")}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => void resolvePause("stop")}>
                  {t("multiAgents.pause.stop")}
                </Button>
                <Button size="sm" onClick={() => void resolvePause("continue")}>
                  {t("multiAgents.pause.continue")}
                </Button>
              </div>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      {error ? (
        <p className={cn(CHAT_COLUMN_FRAME_CLASS_NAME, "px-4 pb-1 text-xs text-destructive")}>
          {error}
        </p>
      ) : null}
      <GroupComposer
        group={group}
        send={send}
        handle={composerRef}
        onExpandImage={setExpandedImage}
      />
      <GroupImageViewer preview={expandedImage} onChange={setExpandedImage} />
    </div>
  );
}
