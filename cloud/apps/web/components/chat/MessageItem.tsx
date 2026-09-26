"use client";
/* oxlint-disable react/no-array-index-key -- message parts are append-only and carry no ids */
import type {
  CloudFileRefPart,
  CloudImageRefPart,
  CloudMessage,
  CloudMessagePart,
} from "@synara/contracts/cloud";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/chat/attachments";
import { useChatClient } from "@/lib/chat/context";
import { failureReason, isTerminal } from "@/lib/chat/runs";
import type { RunView } from "@/lib/chat/store";
import type { Siblings } from "@/lib/chat/tree";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

import { ImagePart } from "./ImageViewer";
import { Markdown } from "./Markdown";
import { TaskSteps } from "./TaskSteps";
import { signedFileUrl } from "./useFileUrl";
import { useCopy } from "./useCopy";

export const textOf = (parts: readonly CloudMessagePart[]) =>
  parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n\n");

export interface MessageItemProps {
  readonly message: CloudMessage;
  readonly siblings: Siblings;
  readonly run: RunView | undefined;
  readonly busy: boolean;
  readonly onSelect: (messageId: string) => void;
  readonly onEdit: (message: CloudMessage, text: string) => void;
  readonly onRegenerate: (message: CloudMessage) => void;
  readonly onEditImage: (part: CloudImageRefPart) => void;
}

function Action({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function BranchSwitcher({
  siblings,
  onSelect,
}: {
  siblings: Siblings;
  onSelect: (id: string) => void;
}) {
  const { d } = useLocale();
  if (siblings.count < 2) return null;
  return (
    <div className="flex items-center text-xs text-muted-foreground tabular-nums">
      <Action
        label={d.chat.previousVersion}
        disabled={!siblings.previousId}
        onClick={() => siblings.previousId && onSelect(siblings.previousId)}
      >
        <ChevronLeft />
      </Action>
      <span aria-live="polite">
        {fill(d.chat.version, { index: String(siblings.index + 1), count: String(siblings.count) })}
      </span>
      <Action
        label={d.chat.nextVersion}
        disabled={!siblings.nextId}
        onClick={() => siblings.nextId && onSelect(siblings.nextId)}
      >
        <ChevronRight />
      </Action>
    </div>
  );
}

function CopyAction({ text }: { text: string }) {
  const { d } = useLocale();
  const [copied, copy] = useCopy();
  return (
    <Action label={copied ? d.chat.copied : d.chat.copy} onClick={() => void copy(text)}>
      {copied ? <Check /> : <Copy />}
    </Action>
  );
}

export function FileChip({ part }: { part: CloudFileRefPart }) {
  const client = useChatClient();
  const { d } = useLocale();
  const open = async () => {
    const tab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const url = await signedFileUrl(client, part.fileId);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      tab?.close();
    }
  };
  return (
    <button
      type="button"
      onClick={() => void open()}
      aria-label={fill(d.chat.openFile, { name: part.name })}
      className="flex max-w-64 items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileText className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{part.name}</span>
        <span className="block text-xs text-muted-foreground">{formatBytes(part.size)}</span>
      </span>
    </button>
  );
}

function UserMessage(props: MessageItemProps) {
  const { message, siblings, busy, onSelect, onEdit } = props;
  const { d } = useLocale();
  const text = textOf(message.parts);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const attachments = message.parts.filter((p) => p.type === "file_ref" || p.type === "image_ref");

  const submit = () => {
    if (!draft.trim()) return;
    setEditing(false);
    onEdit(message, draft.trim());
  };

  return (
    <div className="group flex flex-col items-end gap-1.5">
      {attachments.length > 0 ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {attachments.map((p, i) =>
            p.type === "image_ref" ? (
              <div key={i} className="w-40">
                <ImagePart part={p} />
              </div>
            ) : p.type === "file_ref" ? (
              <FileChip key={i} part={p} />
            ) : null,
          )}
        </div>
      ) : null}
      {editing ? (
        <form
          className="w-full max-w-[85%] rounded-3xl border border-border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            aria-label={d.chat.editLabel}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
            className="max-h-72 min-h-12 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {d.chat.cancel}
            </Button>
            <Button type="submit" size="sm" disabled={!draft.trim() || busy}>
              {d.chat.send}
            </Button>
          </div>
        </form>
      ) : text ? (
        <div className="max-w-[85%] rounded-3xl bg-secondary px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap text-secondary-foreground [overflow-wrap:anywhere]">
          {text}
        </div>
      ) : null}
      {!editing ? (
        <div className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <CopyAction text={text} />
          <Action
            label={d.chat.edit}
            disabled={busy}
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            <Pencil />
          </Action>
          <BranchSwitcher siblings={siblings} onSelect={onSelect} />
        </div>
      ) : null}
    </div>
  );
}

function AssistantMessage(props: MessageItemProps) {
  const { message, siblings, run, busy, onSelect, onRegenerate, onEditImage } = props;
  const { d } = useLocale();
  const running = run ? !isTerminal(run.status) : false;
  const hasContent = message.parts.some(
    (p) => p.type === "text" || p.type === "image_ref" || p.type === "file_ref",
  );
  const text = textOf(message.parts);
  const lastTextIndex = message.parts.findLastIndex((p) => p.type === "text");

  return (
    <div className="flex flex-col gap-3" aria-busy={running}>
      <TaskSteps parts={message.parts} run={run} />
      {message.parts.map((p, i) => {
        if (p.type === "text")
          return (
            <div key={i} className={cn(running && i === lastTextIndex && "streaming")}>
              <Markdown text={p.text} />
            </div>
          );
        if (p.type === "image_ref") return <ImagePart key={i} part={p} onEdit={onEditImage} />;
        if (p.type === "file_ref") return <FileChip key={i} part={p} />;
        return null;
      })}
      {running && !hasContent && run?.mode !== "task" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
          {d.chat.thinking}
        </p>
      ) : null}
      {run?.status === "blocked_on_usage" ? (
        <p className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-fg" role="status">
          {d.chat.blockedOnUsage}
        </p>
      ) : null}
      {run?.status === "failed" ? (
        <p className="flex items-center gap-2 text-sm text-danger-fg" role="alert">
          <CircleAlert className="size-4" aria-hidden />
          {d.chat[failureReason(run.error)]}
        </p>
      ) : null}
      {run?.status === "cancelled" && run.mode !== "task" ? (
        <p className="text-xs text-muted-foreground">{d.chat.stopped}</p>
      ) : null}
      {!running ? (
        <div className="-ml-2 flex items-center">
          {text ? <CopyAction text={text} /> : null}
          <Action label={d.chat.regenerate} disabled={busy} onClick={() => onRegenerate(message)}>
            <RefreshCw />
          </Action>
          <BranchSwitcher siblings={siblings} onSelect={onSelect} />
        </div>
      ) : null}
    </div>
  );
}

export function MessageItem(props: MessageItemProps) {
  const { d } = useLocale();
  return (
    <article
      aria-label={props.message.role === "user" ? d.chat.you : d.chat.assistant}
      data-role={props.message.role}
      data-message-id={props.message.id}
      className="w-full"
    >
      {props.message.role === "user" ? <UserMessage {...props} /> : <AssistantMessage {...props} />}
    </article>
  );
}
