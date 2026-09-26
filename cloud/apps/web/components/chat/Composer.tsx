"use client";
import type {
  CloudImageRefPart,
  CloudRunMode,
  CloudUserMessagePart,
} from "@synara/contracts/cloud";
import { ArrowUp, FileText, Loader2, Paperclip, Square, Telescope, X } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ACCEPT_ATTRIBUTE,
  formatBytes,
  isImageType,
  resolveMimeType,
  validateFile,
  type AttachmentProblem,
} from "@/lib/chat/attachments";
import { useChatClient } from "@/lib/chat/context";
import { newClientId } from "@/lib/chat/store";
import { fill, type Dict } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

import { useFileUrl } from "./useFileUrl";

interface Attachment {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly mimeType: string;
  readonly previewUrl: string | null;
  readonly status: "uploading" | "ready" | "error";
  readonly part: CloudUserMessagePart | null;
}

export interface ComposerHandle {
  addFiles(files: readonly File[]): void;
  /** Starts an "Edit image" message with an existing image attached. */
  editImage(part: CloudImageRefPart, prefix: string): void;
  focus(): void;
}

export interface ComposerProps {
  readonly running: boolean;
  readonly onStop: () => void;
  /**
   * Resolves ok once the message is accepted. On failure the draft comes back
   * and `error` (if any) is shown inline; resending the unchanged draft reuses
   * the same clientMessageId so the server can't record it twice.
   */
  readonly onSubmit: (message: {
    parts: CloudUserMessagePart[];
    mode: CloudRunMode;
    clientMessageId: string;
  }) => Promise<{ ok: true } | { ok: false; error: string | null }>;
  readonly blocked?: boolean;
  readonly autoFocus?: boolean;
}

export function problemMessage(d: Dict, name: string, problem: AttachmentProblem): string {
  switch (problem.kind) {
    case "too_large":
      return fill(d.chat.errTooLarge, { name, max: String(problem.maxMb) });
    case "unsupported_type":
      return fill(d.chat.errUnsupported, { name });
    case "empty":
      return fill(d.chat.errEmpty, { name });
    case "too_many":
      return fill(d.chat.errTooMany, { max: String(problem.max) });
  }
}

function imageSize(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener("load", () =>
      resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null }),
    );
    img.addEventListener("error", () => resolve({ width: null, height: null }));
    img.src = url;
  });
}

function ExistingImageThumb({ fileId }: { fileId: string }) {
  const { url } = useFileUrl(fileId);
  return url ? <img src={url} alt="" className="size-full object-cover" /> : null;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { running, onStop, onSubmit, blocked = false, autoFocus = false },
  ref,
) {
  const { d } = useLocale();
  const client = useChatClient();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<CloudRunMode>("chat");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const retry = useRef<{ id: string; signature: string } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const resize = useCallback(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
  }, []);
  useEffect(resize, [text, resize]);

  const patch = (key: string, next: Partial<Attachment>) =>
    setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...next } : a)));

  const upload = useCallback(
    async (file: File, key: string, mimeType: string, previewUrl: string | null) => {
      try {
        const presign = await client.presignFile({ name: file.name, mimeType, size: file.size });
        await client.putToStorage(presign, file);
        const done = await client.completeFile(presign.file.id);
        if (done.status === "rejected") throw new Error("rejected");
        const part: CloudUserMessagePart = isImageType(mimeType)
          ? {
              type: "image_ref",
              fileId: done.id,
              mimeType,
              ...(previewUrl ? await imageSize(previewUrl) : { width: null, height: null }),
            }
          : { type: "file_ref", fileId: done.id, name: done.name, mimeType, size: done.size };
        patch(key, { status: "ready", part });
      } catch {
        patch(key, { status: "error" });
      }
    },
    [client],
  );

  const addFiles = useCallback(
    (files: readonly File[]) => {
      const problems: string[] = [];
      const added: Attachment[] = [];
      let count = attachmentsRef.current.length;
      for (const file of files) {
        const problem = validateFile(file, count);
        if (problem) {
          problems.push(problemMessage(d, file.name, problem));
          if (problem.kind === "too_many") break;
          continue;
        }
        const mimeType = resolveMimeType(file)!;
        const previewUrl = isImageType(mimeType) ? URL.createObjectURL(file) : null;
        const key = newClientId();
        added.push({
          key,
          name: file.name,
          size: file.size,
          mimeType,
          previewUrl,
          status: "uploading",
          part: null,
        });
        count++;
        void upload(file, key, mimeType, previewUrl);
      }
      setErrors(problems);
      if (added.length) setAttachments((list) => [...list, ...added]);
    },
    [d, upload],
  );

  useImperativeHandle(
    ref,
    () => ({
      addFiles,
      editImage(part, prefix) {
        setAttachments((list) => [
          ...list.filter((a) => a.part?.type !== "image_ref" || a.part.fileId !== part.fileId),
          {
            key: newClientId(),
            name: d.chat.image,
            size: 0,
            mimeType: part.mimeType,
            previewUrl: null,
            status: "ready",
            part,
          },
        ]);
        setText((t) => (t.startsWith(prefix) ? t : prefix + t));
        requestAnimationFrame(() => {
          const el = textarea.current;
          el?.focus();
          el?.setSelectionRange(el.value.length, el.value.length);
        });
      },
      focus: () => textarea.current?.focus(),
    }),
    [addFiles, d],
  );

  const remove = (key: string) => {
    setAttachments((list) => {
      const gone = list.find((a) => a.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return list.filter((a) => a.key !== key);
    });
    setErrors([]);
  };

  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const uploading = attachments.some((a) => a.status === "uploading");

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (running || submitting || !hasContent || blocked) return;
    if (uploading) return setErrors([d.chat.errWaitUploads]);
    if (attachments.some((a) => a.status === "error")) return setErrors([d.chat.uploadFailed]);
    const parts: CloudUserMessagePart[] = [
      ...attachments.map((a) => a.part!),
      ...(text.trim() ? [{ type: "text" as const, text: text.trim() }] : []),
    ];
    const signature = JSON.stringify([parts, mode]);
    const clientMessageId =
      retry.current?.signature === signature ? retry.current.id : newClientId();
    const draft = { text, attachments };
    setSubmitting(true);
    setErrors([]);
    setText("");
    setAttachments([]);
    const result = await onSubmit({ parts, mode, clientMessageId });
    setSubmitting(false);
    if (result.ok) {
      retry.current = null;
      for (const a of draft.attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    } else {
      retry.current = { id: clientMessageId, signature };
      setText(draft.text);
      setAttachments(draft.attachments);
      if (result.error) setErrors([result.error]);
    }
    textarea.current?.focus();
  };

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="rounded-[1.75rem] border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)] transition-shadow focus-within:border-ring/60 dark:shadow-none"
    >
      {attachments.length > 0 ? (
        <ul className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label={d.chat.attach}>
          {attachments.map((a) => (
            <li
              key={a.key}
              className={cn(
                "relative flex h-14 shrink-0 items-center gap-2 rounded-xl border bg-background pr-8",
                a.status === "error" ? "border-destructive/60" : "border-border",
                a.part?.type === "image_ref" || a.previewUrl ? "w-14 p-0" : "max-w-56 pl-2",
              )}
            >
              {a.previewUrl || a.part?.type === "image_ref" ? (
                <span className="block size-full overflow-hidden rounded-[11px]">
                  {a.previewUrl ? (
                    <img src={a.previewUrl} alt="" className="size-full object-cover" />
                  ) : a.part?.type === "image_ref" ? (
                    <ExistingImageThumb fileId={a.part.fileId} />
                  ) : null}
                </span>
              ) : (
                <>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 text-xs">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="block text-muted-foreground">
                      {a.status === "error" ? d.chat.uploadFailed : formatBytes(a.size)}
                    </span>
                  </span>
                </>
              )}
              {a.status === "uploading" ? (
                <span
                  className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/60"
                  role="status"
                >
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                  <span className="sr-only">{d.chat.uploading}</span>
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => remove(a.key)}
                aria-label={fill(d.chat.removeAttachment, { name: a.name })}
                className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-foreground/80 text-background hover:bg-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor="composer-input" className="sr-only">
        {mode === "task" ? d.chat.taskPlaceholder : d.chat.placeholder}
      </label>
      <textarea
        id="composer-input"
        ref={textarea}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        placeholder={mode === "task" ? d.chat.taskPlaceholder : d.chat.placeholder}
        onChange={(e) => {
          setText(e.target.value);
          if (errors.length) setErrors([]);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length === 0) return;
          e.preventDefault();
          addFiles(files);
        }}
        aria-describedby={errors.length ? "composer-errors" : undefined}
        className="block max-h-52 w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          tabIndex={-1}
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 rounded-full"
              aria-label={d.chat.attach}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{d.chat.attach}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={mode === "task"}
              onClick={() => setMode((m) => (m === "task" ? "chat" : "task"))}
              className={cn(
                "h-9 rounded-full border px-3",
                mode === "task"
                  ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                  : "border-border text-muted-foreground",
              )}
            >
              <Telescope />
              {d.chat.taskMode}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{d.chat.taskModeHint}</TooltipContent>
        </Tooltip>
        <div className="ml-auto">
          {running ? (
            <Button
              type="button"
              size="icon"
              className="size-9 rounded-full bg-foreground text-background hover:bg-foreground/85"
              onClick={onStop}
              aria-label={d.chat.stop}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="size-9 rounded-full"
              disabled={!hasContent || submitting || blocked}
              aria-label={d.chat.send}
            >
              {submitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          )}
        </div>
      </div>
      {errors.length > 0 ? (
        <div
          id="composer-errors"
          role="alert"
          className="border-t border-border px-5 py-2.5 text-sm text-danger-fg"
        >
          {errors.map((err) => (
            <p key={err}>{err}</p>
          ))}
        </div>
      ) : null}
    </form>
  );
});
