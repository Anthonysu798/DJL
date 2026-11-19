// FILE: GroupImageViewer.tsx
// Purpose: Full-screen preview for images in a group chat (composer attachments and sent
//          messages), with the same look and keys as the main chat's image preview.
// Layer: UI component

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { Button } from "~/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "~/lib/icons";

export function GroupImageViewer(props: {
  preview: ExpandedImagePreview | null;
  onChange: (preview: ExpandedImagePreview | null) => void;
}) {
  const { t } = useTranslation("chat");
  const { preview, onChange } = props;
  const item = preview ? preview.images[preview.index] : null;

  useEffect(() => {
    if (!preview) return;
    const step = (delta: number) =>
      onChange({
        ...preview,
        index: (preview.index + delta + preview.images.length) % preview.images.length,
      });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onChange(null);
      else if (event.key === "ArrowLeft" && preview.images.length > 1) step(-1);
      else if (event.key === "ArrowRight" && preview.images.length > 1) step(1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview, onChange]);

  if (!preview || !item) return null;
  const many = preview.images.length > 1;
  const step = (delta: number) =>
    onChange({
      ...preview,
      index: (preview.index + delta + preview.images.length) % preview.images.length,
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 [-webkit-app-region:no-drag]"
      role="dialog"
      aria-modal="true"
      aria-label={t("a11y.expandedImage")}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-zoom-out"
        aria-label={t("a11y.closeImage")}
        onClick={() => onChange(null)}
      />
      {many ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute top-1/2 left-2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
          aria-label={t("a11y.previousImage")}
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon className="size-5" />
        </Button>
      ) : null}
      <div className="relative isolate z-10 max-h-[92vh] max-w-[92vw]">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="absolute top-2 right-2"
          onClick={() => onChange(null)}
          aria-label={t("a11y.closeImage")}
        >
          <XIcon />
        </Button>
        <img
          src={item.src}
          alt={item.name}
          className="max-h-[86vh] max-w-[92vw] rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] object-contain shadow-2xl select-none"
          draggable={false}
        />
        <p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
          {item.name}
          {many ? ` (${preview.index + 1}/${preview.images.length})` : ""}
        </p>
      </div>
      {many ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute top-1/2 right-2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
          aria-label={t("a11y.nextImage")}
          onClick={() => step(1)}
        >
          <ChevronRightIcon className="size-5" />
        </Button>
      ) : null}
    </div>
  );
}
