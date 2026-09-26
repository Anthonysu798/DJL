"use client";
import type { CloudImageRefPart } from "@synara/contracts/cloud";
import { Download, ImageOff, Link2, Minus, Pencil, Plus, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef, useState, type PointerEvent, type WheelEvent } from "react";

import { Button } from "@/components/ui/button";
import { useChatClient } from "@/lib/chat/context";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

import { toast } from "./toast";
import { signedFileUrl, useFileUrl } from "./useFileUrl";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
const extension = (mimeType: string) =>
  ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  })[mimeType] ?? "img";

/** Inline image in a message; opens the full-screen viewer. */
export function ImagePart({
  part,
  onEdit,
}: {
  part: CloudImageRefPart;
  onEdit?: ((part: CloudImageRefPart) => void) | undefined;
}) {
  const { url, failed } = useFileUrl(part.fileId);
  const [open, setOpen] = useState(false);
  const { d } = useLocale();
  const ratio = part.width && part.height ? `${part.width} / ${part.height}` : "1 / 1";
  if (failed)
    return (
      <div className="flex aspect-square w-64 max-w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        <ImageOff className="size-5" aria-hidden />
        {d.chat.imageUnavailable}
      </div>
    );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={d.chat.openImage}
        className="group relative block w-full max-w-sm overflow-hidden rounded-xl border border-border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        style={{ aspectRatio: ratio }}
      >
        {url ? (
          // Signed storage URLs can't go through next/image's optimizer.
          <img
            src={url}
            alt={d.chat.image}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <span className="block size-full animate-pulse bg-muted" />
        )}
      </button>
      {open && url ? (
        <ImageViewer
          part={part}
          url={url}
          onClose={() => setOpen(false)}
          onEdit={
            onEdit
              ? () => {
                  setOpen(false);
                  onEdit(part);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

export function ImageViewer({
  part,
  url,
  onClose,
  onEdit,
}: {
  part: CloudImageRefPart;
  url: string;
  onClose: () => void;
  onEdit?: (() => void) | undefined;
}) {
  const { d } = useLocale();
  const client = useChatClient();
  const [zoom, setZoom] = useState(2); // index into ZOOM_STEPS (100%)
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const scale = ZOOM_STEPS[zoom]!;

  const zoomTo = (index: number) => {
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index));
    setZoom(next);
    if (ZOOM_STEPS[next]! <= 1) setOffset({ x: 0, y: 0 });
  };

  const download = async () => {
    try {
      const fresh = await signedFileUrl(client, part.fileId);
      const blob = await (await fetch(fresh)).blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `djl-${part.fileId}.${extension(part.mimeType)}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(await signedFileUrl(client, part.fileId));
      toast(d.chat.linkCopied);
    } catch {
      toast(d.error, "error");
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) < 4) return;
    zoomTo(zoom + (e.deltaY < 0 ? 1 : -1));
  };
  const onPointerDown = (e: PointerEvent) => {
    if (scale <= 1) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setOffset({
      x: drag.current.ox + e.clientX - drag.current.x,
      y: drag.current.oy + e.clientY - drag.current.y,
    });
  };

  const tool = "text-white/85 hover:bg-white/10 hover:text-white focus-visible:ring-white/40";

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-neutral-950/95 backdrop-blur-md animate-in fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-none animate-in fade-in-0"
          onKeyDown={(e) => {
            if (e.key === "+" || e.key === "=") zoomTo(zoom + 1);
            else if (e.key === "-") zoomTo(zoom - 1);
            else if (e.key === "0") zoomTo(2);
          }}
        >
          <DialogPrimitive.Title className="sr-only">{d.chat.imagePreview}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {d.chat.openImage}
          </DialogPrimitive.Description>
          <div className="flex flex-wrap items-center justify-end gap-1 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="mr-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                className={tool}
                onClick={() => zoomTo(zoom - 1)}
                aria-label={d.chat.zoomOut}
                disabled={zoom === 0}
              >
                <Minus />
              </Button>
              <button
                type="button"
                onClick={() => zoomTo(2)}
                aria-label={d.chat.resetZoom}
                className="h-8 min-w-14 rounded-md px-2 text-xs text-white/85 tabular-nums hover:bg-white/10 focus-visible:ring-[3px] focus-visible:ring-white/40 focus-visible:outline-none"
              >
                {Math.round(scale * 100)}%
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={tool}
                onClick={() => zoomTo(zoom + 1)}
                aria-label={d.chat.zoomIn}
                disabled={zoom === ZOOM_STEPS.length - 1}
              >
                <Plus />
              </Button>
            </div>
            {onEdit ? (
              <Button variant="ghost" size="sm" className={tool} onClick={onEdit}>
                <Pencil /> <span className="max-sm:sr-only">{d.chat.editImage}</span>
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" className={tool} onClick={() => void copyLink()}>
              <Link2 /> <span className="max-sm:sr-only">{d.chat.copyLink}</span>
            </Button>
            <Button variant="ghost" size="sm" className={tool} onClick={() => void download()}>
              <Download /> <span className="max-sm:sr-only">{d.chat.download}</span>
            </Button>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" className={tool} aria-label={d.chat.close}>
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div
            className={cn(
              "relative flex-1 overflow-hidden",
              scale > 1 ? "cursor-grab active:cursor-grabbing" : "",
            )}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <img
              src={url}
              alt={d.chat.image}
              draggable={false}
              className="absolute top-1/2 left-1/2 max-h-[calc(100%-3rem)] max-w-[calc(100%-3rem)] select-none object-contain transition-transform duration-150"
              style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
              }}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
