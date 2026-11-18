// FILE: GroupMessageRow.tsx
// Purpose: One row of a group chat: the user's message, or a member's final answer under its
//          name, icon and role, with failure and empty-reply states.
// Layer: UI component

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import ChatMarkdown from "~/components/ChatMarkdown";
import { ProviderIcon } from "~/components/ProviderIcon";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import type { GroupChatRow } from "./groupChat.logic";
import { roleLabel } from "./groupLabels";

export function GroupMessageRow(props: {
  row: GroupChatRow;
  cwd: string;
  onRetry?: (() => void) | undefined;
  onSetUp?: (() => void) | undefined;
  footer?: ReactNode;
}) {
  const { t } = useTranslation("shell");
  const { row } = props;

  if (row.kind === "user") {
    return (
      <div className="flex justify-end px-4 py-2">
        <div className="max-w-[78%] rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap break-words">{row.text}</p>
          {row.attachmentNames.length > 0 ? (
            <p className="mt-1 text-xs opacity-80">{row.attachmentNames.join(", ")}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (row.kind === "unknown-member") {
    return (
      <div className="px-4 py-2">
        <p className="mb-1 text-xs text-muted-foreground">{t("multiAgents.chat.removedAgent")}</p>
        <div className="max-w-[78%] rounded-2xl bg-muted px-4 py-2 text-sm">
          <ChatMarkdown text={row.text} cwd={props.cwd} />
        </div>
      </div>
    );
  }

  const failed = row.status === "failed";
  const empty = row.status === "empty";
  return (
    <div className="group/row flex gap-3 px-4 py-2">
      <ProviderIcon provider={row.provider} className="mt-1 size-8 shrink-0" />
      <div className="min-w-0 max-w-[78%]">
        <p className="mb-1 flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{row.handle}</span>
          {row.role ? <span>{roleLabel(t, row.role)}</span> : null}
        </p>
        {failed ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm">
            <p>
              {t("multiAgents.chat.failed", { name: row.handle, error: row.error ?? row.text })}
            </p>
            <div className="mt-2 flex gap-2">
              {props.onSetUp ? (
                <Button size="xs" variant="outline" onClick={props.onSetUp}>
                  {t("multiAgents.setup.setUp")}
                </Button>
              ) : null}
              {props.onRetry ? (
                <Button size="xs" variant="outline" onClick={props.onRetry}>
                  {t("multiAgents.chat.tryAgain")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "rounded-2xl bg-muted px-4 py-2 text-sm",
              empty && "italic text-muted-foreground",
            )}
          >
            {empty ? (
              <p>{t("multiAgents.chat.empty", { name: row.handle })}</p>
            ) : (
              <ChatMarkdown text={row.text} cwd={props.cwd} />
            )}
          </div>
        )}
        {props.footer}
      </div>
    </div>
  );
}
