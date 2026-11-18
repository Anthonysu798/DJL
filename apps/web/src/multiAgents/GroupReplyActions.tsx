// FILE: GroupReplyActions.tsx
// Purpose: Under a member's reply: the "Changed N files · ran N commands" chip with its details,
//          and Copy, Ask again, Reply to this and Ask another agent.
// Layer: UI component

import type { Group } from "@synara/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { GroupChatRow, GroupMemberRow } from "./groupChat.logic";
import { workChipCounts } from "./groupChat.logic";
import { answeredUserText, askAgainText, askAnotherText, replyToText } from "./groupComposer.logic";
import type { GroupSendInput } from "./GroupChatView";

const actionClass =
  "rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";

export function GroupReplyActions(props: {
  group: Group;
  row: GroupMemberRow;
  rows: readonly GroupChatRow[];
  send: (input: GroupSendInput) => Promise<boolean>;
  prefill: (text: string) => void;
}) {
  const { t } = useTranslation("shell");
  const { group, row } = props;
  const [copied, setCopied] = useState(false);
  const [showWork, setShowWork] = useState(false);
  const [picking, setPicking] = useState(false);
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

  return (
    <div className="mt-1 flex flex-col gap-1">
      {chipLabel ? (
        <div>
          <button
            type="button"
            className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => setShowWork((open) => !open)}
          >
            {chipLabel}
          </button>
          {showWork ? (
            <div className="mt-1 rounded-md border border-border bg-background p-2 text-xs">
              {row.files.length > 0 ? (
                <>
                  <p className="font-medium">{t("multiAgents.reply.filesHeading")}</p>
                  <p className="mb-1 whitespace-pre-wrap break-all">{row.files.join("\n")}</p>
                </>
              ) : null}
              {row.commands.length > 0 ? (
                <>
                  <p className="font-medium">{t("multiAgents.reply.commandsHeading")}</p>
                  <p className="whitespace-pre-wrap break-all font-mono">
                    {row.commands.join("\n")}
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            void navigator.clipboard.writeText(row.text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? t("multiAgents.reply.copied") : t("multiAgents.reply.copy")}
        </button>
        <button
          type="button"
          className={actionClass}
          onClick={() =>
            void props.send({ text: askAgainText(row, answeredUserText(props.rows, row.id)) })
          }
        >
          {t("multiAgents.reply.askAgain")}
        </button>
        <button
          type="button"
          className={actionClass}
          onClick={() => props.prefill(replyToText(row))}
        >
          {t("multiAgents.reply.replyTo")}
        </button>
        {others.length > 0 ? (
          <button type="button" className={actionClass} onClick={() => setPicking((open) => !open)}>
            {t("multiAgents.reply.askAnother")}
          </button>
        ) : null}
      </div>
      {picking ? (
        <div className="flex flex-wrap gap-1">
          {others.map((member) => (
            <button
              key={member.id}
              type="button"
              className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
              onClick={() => {
                setPicking(false);
                void props.send({
                  text: askAnotherText(
                    row,
                    member,
                    t("multiAgents.reply.checkLead", { name: row.handle }),
                  ),
                });
              }}
            >
              @{member.handle}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
