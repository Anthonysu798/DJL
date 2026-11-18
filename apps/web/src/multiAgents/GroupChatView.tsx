// FILE: GroupChatView.tsx
// Purpose: The chat of one Multi agents group: labelled member replies, who is working, the
//          hop-limit Continue / Stop card, and the composer.
// Layer: UI component

import { GROUP_MODEL_SELECTION, type Group } from "@synara/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { newCommandId, newMessageId } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { createThreadSelector } from "~/storeSelectors";
import { useRetainVisibleThreadDetails } from "~/threadDetailSubscriptionRetention";

import { deriveGroupChatRows, type GroupMemberRow } from "./groupChat.logic";
import { GroupMessageRow } from "./GroupMessageRow";
import { useGroupStore } from "./groupStore";

export type GroupSendInput = { text: string; dispatchMode?: "queue" | "steer" };

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
          attachments: [],
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

export function GroupChatView(props: {
  group: Group;
  headerActions?: ReactNode;
  composer?: (input: {
    running: boolean;
    send: (input: GroupSendInput) => Promise<boolean>;
  }) => ReactNode;
  replyFooter?: (row: GroupMemberRow, rowIndex: number) => ReactNode;
}) {
  const { group } = props;
  const { t } = useTranslation("shell");
  const navigate = useNavigate();
  useRetainVisibleThreadDetails(useMemo(() => [group.threadId], [group.threadId]));
  const thread = useStore(useMemo(() => createThreadSelector(group.threadId), [group.threadId]));
  const replies = useGroupStore((state) => state.replies);
  const memberStates = useGroupStore((state) => state.memberStates);
  const rows = useMemo(
    () => deriveGroupChatRows(thread?.messages ?? [], group, replies),
    [group, replies, thread?.messages],
  );
  const running = thread?.session?.status === "running";
  const busyMembers = group.members.filter((member) => {
    const state = memberStates[member.id];
    return running && (state === "working" || state === "waiting");
  });
  const { send, error } = useGroupSend(group);
  const bottomRef = useRef<HTMLDivElement | null>(null);
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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="truncate text-sm font-semibold">
          {group.name}
          <span className="ml-2 font-normal text-muted-foreground">({group.members.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          {running ? (
            <Button size="xs" variant="outline" onClick={stopAll}>
              {t("multiAgents.chat.stopAll")}
            </Button>
          ) : null}
          {props.headerActions}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-3" data-testid="group-chat-rows">
        {rows.map((row, index) => (
          <GroupMessageRow
            key={row.id}
            row={row}
            cwd={group.folder}
            onSetUp={
              row.kind === "member" && row.status === "failed"
                ? () => void navigate({ to: "/settings", search: { section: "accounts" } })
                : undefined
            }
            footer={row.kind === "member" ? props.replyFooter?.(row, index) : undefined}
          />
        ))}
        {busyMembers.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-2 px-4 py-1 text-xs text-muted-foreground"
          >
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            <span>
              {memberStates[member.id] === "waiting"
                ? t("multiAgents.chat.waiting", { name: member.handle })
                : t("multiAgents.chat.working", { name: member.handle })}
            </span>
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() =>
                void ensureNativeApi()
                  .groups.stopMember({ groupId: group.id, memberId: member.id })
                  .catch(() => undefined)
              }
            >
              {t("multiAgents.chat.stopMember")}
            </button>
          </div>
        ))}
        {group.pendingHandoffs.length > 0 && !running ? (
          <div className="mx-4 my-3 rounded-xl border border-border bg-muted/50 p-4 text-sm">
            <p className="font-medium">{t("multiAgents.pause.title", { count: group.hopLimit })}</p>
            <p className="mt-1 text-muted-foreground">{t("multiAgents.pause.body")}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => void resolvePause("continue")}>
                {t("multiAgents.pause.continue")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void resolvePause("stop")}>
                {t("multiAgents.pause.stop")}
              </Button>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      {error ? <p className="px-4 pb-1 text-xs text-destructive">{error}</p> : null}
      {props.composer ? (
        props.composer({ running, send })
      ) : (
        <SimpleGroupComposer running={running} send={send} />
      )}
    </div>
  );
}

function SimpleGroupComposer(props: {
  running: boolean;
  send: (input: GroupSendInput) => Promise<boolean>;
}) {
  const { t } = useTranslation("shell");
  const [text, setText] = useState("");
  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    if (await props.send({ text: value })) setText("");
  };
  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <textarea
        className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        rows={2}
        value={text}
        placeholder={t("multiAgents.chat.placeholder")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <Button size="sm" onClick={() => void submit()} disabled={!text.trim()}>
        {t("multiAgents.chat.send")}
      </Button>
    </div>
  );
}
