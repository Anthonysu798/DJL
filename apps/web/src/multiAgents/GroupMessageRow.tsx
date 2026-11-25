// FILE: GroupMessageRow.tsx
// Purpose: One row of a group chat: the user's message, or a member's final answer under its
//          name, icon and role, with failure and empty-reply states.
// Layer: UI component

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import ChatMarkdown from "~/components/ChatMarkdown";
import {
  buildExpandedImagePreview,
  type ExpandedImagePreview,
} from "~/components/chat/ExpandedImagePreview";
import { Button } from "~/components/ui/button";
import { FileIcon } from "~/lib/icons";

import { GroupAgentAvatar } from "./GroupAgentAvatar";
import { replyImages, type GroupChatRow } from "./groupChat.logic";
import { splitQuotedMessage } from "./groupComposer.logic";
import { GroupImageGallery } from "./GroupImageGallery";
import { roleLabel } from "./groupLabels";

export function GroupMessageRow(props: {
  row: GroupChatRow;
  cwd: string;
  onExpandImage?: ((preview: ExpandedImagePreview) => void) | undefined;
  onRetry?: (() => void) | undefined;
  onSetUp?: (() => void) | undefined;
  footer?: ReactNode;
  /** Members' 👀 / ✅ on a user's message. */
  reactions?: ReactNode;
}) {
  const { t } = useTranslation("shell");
  const { row } = props;

  if (row.kind === "user") {
    // A reply shows the answer it quotes as one quiet line, not as "> ..." text in the bubble.
    const message = splitQuotedMessage(row.text);
    if (row.guest !== undefined) {
      // An invited guest: on the left under their name, so it never reads as the owner's own.
      const name = row.guest || t("multiAgents.guests.removedName");
      return (
        <div className="flex gap-3 pt-5 pb-2" data-testid="group-row-guest">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] text-xs font-medium uppercase"
          >
            {name.slice(0, 1)}
          </span>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <p className="flex h-7 items-center gap-2 text-[13px]">
              <span className="font-medium text-foreground">{name}</span>
              <span className="text-xs text-muted-foreground/70">
                {t("multiAgents.guests.tag")}
              </span>
            </p>
            {message.quote ? (
              <p
                title={message.quote}
                className="max-w-full truncate border-l-2 border-[color:var(--color-border)] pl-2 text-xs text-muted-foreground"
              >
                {message.quote}
              </p>
            ) : null}
            {message.body ? (
              <div className="rounded-2xl bg-[var(--color-background-elevated-secondary)] px-3.5 py-2 text-sm leading-relaxed text-foreground">
                <p className="wrap-break-word whitespace-pre-wrap">{message.body}</p>
              </div>
            ) : null}
            {props.reactions}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-end gap-1.5 pt-5 pb-2">
        {row.images.length > 0 ? (
          <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
            {row.images.map((image) => (
              <button
                key={image.id}
                type="button"
                className="block size-24 overflow-hidden rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] transition-[border-color,transform] duration-150 ease-out hover:border-[color:var(--color-border)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]"
                aria-label={t("attachments.previewNamed", { ns: "chat", name: image.name })}
                title={image.name}
                onClick={() => {
                  const preview = buildExpandedImagePreview(row.images, image.id);
                  if (preview) props.onExpandImage?.(preview);
                }}
              >
                <img src={image.previewUrl} alt={image.name} className="size-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        {row.fileNames.length > 0 ? (
          <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
            {row.fileNames.map((name) => (
              <span
                key={name}
                className="flex max-w-56 items-center gap-1.5 rounded-lg border border-[color:var(--color-border-light)] px-2 py-1 text-xs text-[var(--color-text-foreground-secondary)]"
              >
                <FileIcon className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate">{name}</span>
              </span>
            ))}
          </div>
        ) : null}
        {message.quote ? (
          <p
            data-testid="group-row-quote"
            title={message.quote}
            className="max-w-[80%] truncate border-l-2 border-[color:var(--color-border)] pl-2 text-xs text-muted-foreground"
          >
            {message.quote}
          </p>
        ) : null}
        {message.body ? (
          <div className="max-w-[80%] rounded-2xl bg-[var(--color-background-elevated-secondary)] px-3.5 py-2 text-sm leading-relaxed text-foreground">
            <p className="wrap-break-word whitespace-pre-wrap">{message.body}</p>
          </div>
        ) : null}
        {props.reactions}
      </div>
    );
  }

  if (row.kind === "unknown-member") {
    return (
      <div className="py-3 pl-10">
        <p className="mb-1 text-xs text-muted-foreground">{t("multiAgents.chat.removedAgent")}</p>
        <div className="text-sm leading-relaxed text-[var(--color-text-foreground-secondary)]">
          <ChatMarkdown text={row.text} cwd={props.cwd} onImageExpand={props.onExpandImage} />
        </div>
      </div>
    );
  }

  if (row.passed) {
    // A member with nothing to add takes one quiet line, not a whole reply.
    return (
      <div className="py-1.5 pl-10">
        <p className="text-xs text-muted-foreground/80">
          {t("multiAgents.chat.passed", { name: row.handle })}
        </p>
        {props.footer}
      </div>
    );
  }

  const failed = row.status === "failed";
  const reply = replyImages(row.text);
  return (
    <div className="group/row flex gap-3 py-3">
      <GroupAgentAvatar provider={row.provider} />
      <div className="min-w-0 flex-1">
        <p className="flex h-7 items-center gap-2 text-[13px]">
          <span className="font-medium text-foreground">{row.handle}</span>
          {row.role ? (
            <span className="text-xs text-muted-foreground/70">{roleLabel(t, row.role)}</span>
          ) : null}
        </p>
        {failed ? (
          <div className="mt-1 rounded-xl border border-destructive/25 bg-destructive/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed">
            <p>
              {t("multiAgents.chat.failed", { name: row.handle, error: row.error ?? row.text })}
            </p>
            {props.onSetUp || props.onRetry ? (
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
            ) : null}
          </div>
        ) : row.status === "empty" ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("multiAgents.chat.empty", { name: row.handle })}
          </p>
        ) : (
          <>
            {reply.text ? (
              <div className="text-sm leading-relaxed">
                <ChatMarkdown
                  text={reply.text}
                  cwd={props.cwd}
                  onImageExpand={props.onExpandImage}
                />
              </div>
            ) : null}
            {reply.images.length > 0 ? (
              <GroupImageGallery
                images={reply.images}
                cwd={props.cwd}
                onExpand={props.onExpandImage}
              />
            ) : null}
          </>
        )}
        {props.footer}
      </div>
    </div>
  );
}
