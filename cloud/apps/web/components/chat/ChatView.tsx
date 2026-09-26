"use client";
import type {
  CloudImageRefPart,
  CloudMessage,
  CloudUserMessagePart,
} from "@synara/contracts/cloud";
import { ArrowDown, Paperclip, Share, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { ChatApiError } from "@/lib/chat/client";
import { useChat, useChatStore } from "@/lib/chat/context";
import { isTerminal } from "@/lib/chat/runs";
import { newClientId } from "@/lib/chat/store";
import { buildTree, siblingsOf, visibleBranch } from "@/lib/chat/tree";
import { useLocale } from "@/lib/locale-context";

import { SidebarButton } from "./ChatShell";
import { Composer, type ComposerHandle } from "./Composer";
import { MessageItem } from "./MessageItem";
import { ModelPicker, useModelChoice } from "./ModelPicker";
import { ShareDialog } from "./ShareDialog";
import { toast } from "./toast";
import { UsageExhaustedPanel } from "./Usage";

const NO_MESSAGES: readonly CloudMessage[] = [];

export function ChatView({ conversationId }: { conversationId: string | null }) {
  const { d } = useLocale();
  const router = useRouter();
  const store = useChatStore();
  const models = useChat((s) => s.models);
  const view = useChat((s) => (conversationId ? s.views[conversationId] : undefined));
  const runs = useChat((s) => s.runs);
  const blocked = useChat((s) => s.usageBlock !== null);
  const onFreePlan = useChat((s) => s.usage?.planId === "free");
  const [model, setModel] = useModelChoice(models, onFreePlan);
  const [shareOpen, setShareOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (conversationId) void store.openConversation(conversationId);
  }, [conversationId, store]);

  const messages = view?.messages ?? NO_MESSAGES;
  const tree = useMemo(() => buildTree(messages), [messages]);
  const branch = useMemo(() => visibleBranch(tree, view?.selection ?? {}), [tree, view?.selection]);
  const activeRun = useMemo(
    () =>
      Object.values(runs).find((r) => r.conversationId === conversationId && !isTerminal(r.status)),
    [runs, conversationId],
  );
  const last = branch[branch.length - 1] ?? null;
  const notFound = view?.status === "error";
  const loading =
    conversationId !== null && (!view || (view.status === "loading" && messages.length === 0));
  const empty = !loading && !notFound && branch.length === 0;

  // Keep the newest content in view while the user is at the bottom, including
  // when late content (images, code blocks) grows the page.
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [branch, runs, atBottom]);
  useEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [empty, notFound]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };
  const scrollToBottom = () => {
    const el = scroller.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const runModeFor = (message: CloudMessage) => {
    const reply = tree.children.get(message.id)?.find((m) => m.runId);
    return (reply?.runId && runs[reply.runId]?.mode) || "chat";
  };

  const failure = useCallback(
    (error: unknown): { ok: false; error: string | null } => ({
      ok: false,
      error:
        error instanceof ChatApiError && error.code === "usage_window_exhausted"
          ? null
          : d.chat.sendFailed,
    }),
    [d],
  );

  const submit = async ({
    parts,
    mode,
    clientMessageId,
  }: {
    parts: CloudUserMessagePart[];
    mode: "chat" | "task";
    clientMessageId: string;
  }) => {
    if (!model) return { ok: false as const, error: d.chat.chooseModel };
    try {
      setAtBottom(true);
      const id = await store.send({
        conversationId,
        parentId: last?.id ?? null,
        parts,
        model,
        mode,
        clientMessageId,
      });
      if (!conversationId) router.replace(`/chat/${encodeURIComponent(id)}`);
      return { ok: true as const };
    } catch (error) {
      return failure(error);
    }
  };

  const edit = (message: CloudMessage, text: string) => {
    if (!conversationId || !model) return;
    const parts: CloudUserMessagePart[] = [
      ...message.parts.filter(
        (p): p is CloudUserMessagePart => p.type === "file_ref" || p.type === "image_ref",
      ),
      { type: "text", text },
    ];
    setAtBottom(true);
    store
      .send({
        conversationId,
        parentId: message.parentId,
        parts,
        model,
        mode: runModeFor(message),
        clientMessageId: newClientId(),
      })
      .catch((e: unknown) => {
        const f = failure(e);
        if (f.error) toast(f.error, "error");
      });
  };

  const regenerate = (message: CloudMessage) => {
    if (!conversationId) return;
    setAtBottom(true);
    store.regenerate(conversationId, message.id, model ?? undefined).catch((e: unknown) => {
      const f = failure(e);
      if (f.error) toast(f.error, "error");
    });
  };

  const onDrag = (e: DragEvent, kind: "enter" | "leave" | "over" | "drop") => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    if (kind === "enter") dragDepth.current++;
    if (kind === "leave") dragDepth.current--;
    if (kind === "drop") {
      dragDepth.current = 0;
      composer.current?.addFiles([...e.dataTransfer.files]);
    }
    setDragging(dragDepth.current > 0);
  };

  const composerEl = (
    <div className="mx-auto w-full max-w-3xl px-3 sm:px-4">
      <UsageExhaustedPanel />
      <Composer
        ref={composer}
        running={!!activeRun}
        blocked={blocked || !model}
        autoFocus
        onStop={() =>
          activeRun && void store.cancel(activeRun.id).catch(() => toast(d.error, "error"))
        }
        onSubmit={submit}
      />
    </div>
  );

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => onDrag(e, "enter")}
      onDragLeave={(e) => onDrag(e, "leave")}
      onDragOver={(e) => onDrag(e, "over")}
      onDrop={(e) => onDrag(e, "drop")}
    >
      <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
        <SidebarButton />
        <ModelPicker models={models} value={model} onChange={setModel} />
        <div className="ml-auto flex items-center gap-1">
          {conversationId && branch.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShareOpen(true)}
              className="text-muted-foreground"
            >
              <Share />
              <span className="max-sm:sr-only">{d.chat.share}</span>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            asChild
            className="text-muted-foreground md:hidden"
          >
            <Link href="/chat" aria-label={d.chat.newChat}>
              <SquarePen />
            </Link>
          </Button>
        </div>
      </header>

      {notFound ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-muted-foreground">{d.chat.notFound}</p>
          <Button asChild variant="outline">
            <Link href="/chat">{d.chat.backToChats}</Link>
          </Button>
        </div>
      ) : empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-7 pb-[12vh]">
          <h1 className="px-6 text-center text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
            {d.chat.emptyTitle}
          </h1>
          {composerEl}
        </div>
      ) : (
        <>
          <div
            ref={scroller}
            onScroll={onScroll}
            className="relative min-h-0 flex-1 overflow-y-auto"
          >
            <div
              className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-4 pb-10 sm:px-6"
              aria-live="off"
            >
              {loading ? (
                <div className="space-y-4" aria-label={d.loading}>
                  <div className="ml-auto h-10 w-1/2 animate-pulse rounded-3xl bg-muted" />
                  <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
                </div>
              ) : (
                branch.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    siblings={siblingsOf(tree, message)}
                    run={message.runId ? runs[message.runId] : undefined}
                    busy={!!activeRun}
                    onSelect={(id) => {
                      const target = tree.byId.get(id);
                      if (target && conversationId) store.selectMessage(conversationId, target);
                    }}
                    onEdit={edit}
                    onRegenerate={regenerate}
                    onEditImage={(part: CloudImageRefPart) =>
                      composer.current?.editImage(part, d.chat.editImagePrefix)
                    }
                  />
                ))
              )}
            </div>
          </div>
          {!atBottom ? (
            <Button
              variant="outline"
              size="icon"
              onClick={scrollToBottom}
              className="absolute bottom-40 left-1/2 z-10 size-8 -translate-x-1/2 rounded-full bg-card shadow-md"
              aria-label={d.chat.scrollToLatest}
            >
              <ArrowDown />
            </Button>
          ) : null}
          <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{composerEl}</div>
        </>
      )}

      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/50 bg-card/85 text-sm font-medium backdrop-blur-sm">
          <Paperclip className="size-6 text-primary" aria-hidden />
          {d.chat.dropFiles}
        </div>
      ) : null}

      {conversationId ? (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          conversationId={conversationId}
          lastMessageId={last?.id ?? null}
        />
      ) : null}
    </div>
  );
}
