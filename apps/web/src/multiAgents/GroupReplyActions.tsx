// FILE: GroupReplyActions.tsx
// Purpose: Under a member's reply: the "Changed N files · ran N commands" chip with its details,
//          and Copy, Ask again, Reply to this and Ask another agent.
// Layer: UI component

import type { Group } from "@djl/contracts";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  RefreshCwIcon,
  SteerIcon,
  Undo2Icon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";

import { GroupAgentAvatar } from "./GroupAgentAvatar";
import type { GroupChatRow, GroupMemberRow } from "./groupChat.logic";
import { workChipCounts } from "./groupChat.logic";
import { answeredUserText, askAgainText, askAnotherText, replyToText } from "./groupComposer.logic";
import type { GroupSendInput } from "./GroupChatView";

function ActionButton(props: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94] [&_svg]:size-3.5",
              props.active && "bg-[var(--color-background-button-secondary-hover)] text-foreground",
            )}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

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
    <div className="mt-1.5 flex flex-col gap-1.5">
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
          "-ml-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 ease-out group-hover/row:opacity-100 focus-within:opacity-100",
          picking && "opacity-100",
        )}
      >
        <ActionButton
          label={copied ? t("multiAgents.reply.copied") : t("multiAgents.reply.copy")}
          onClick={() => {
            void navigator.clipboard.writeText(row.text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </ActionButton>
        <ActionButton
          label={t("multiAgents.reply.askAgain")}
          onClick={() =>
            void props.send({ text: askAgainText(row, answeredUserText(props.rows, row.id)) })
          }
        >
          <RefreshCwIcon />
        </ActionButton>
        <ActionButton
          label={t("multiAgents.reply.replyTo")}
          onClick={() => props.prefill(replyToText(row))}
        >
          <Undo2Icon />
        </ActionButton>
        {others.length > 0 ? (
          <ActionButton
            label={t("multiAgents.reply.askAnother")}
            active={picking}
            onClick={() => setPicking((open) => !open)}
          >
            <SteerIcon />
          </ActionButton>
        ) : null}
        {picking ? (
          <div className="ml-1 flex items-center gap-1 border-l border-[color:var(--color-border-light)] pl-2">
            {others.map((member) => (
              <button
                key={member.id}
                type="button"
                className="flex h-6 items-center gap-1.5 rounded-md pr-2 pl-0.5 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
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
                <GroupAgentAvatar provider={member.provider} size="xs" />@{member.handle}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
