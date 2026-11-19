// FILE: GroupImageGallery.tsx
// Purpose: Shows the images of one reply together: one large image with a strip of thumbnails
//          beside it. Click a thumbnail (or use the arrow keys) to switch, click the large image
//          to open it full size.
// Layer: UI component

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { useLocalImageDownloadClick } from "~/components/LocalImagePreview";
import { DownloadIcon, Maximize2 } from "~/lib/icons";
import { buildLocalImageUrl, localImageFileName } from "~/lib/localImageUrls";
import { cn } from "~/lib/utils";

import type { ReplyImage } from "./groupChat.logic";

const TILE_CLASS =
  "overflow-hidden border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)]";

export function GroupImageGallery(props: {
  images: readonly ReplyImage[];
  cwd: string;
  onExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
}) {
  const { t } = useTranslation("chat");
  const [selected, setSelected] = useState(0);
  const items = props.images.map((image) => ({
    ...image,
    name: image.label || localImageFileName(image.src) || t("image.generated"),
    url: buildLocalImageUrl({ src: image.src, cwd: props.cwd }),
  }));
  const index = Math.min(selected, items.length - 1);
  const current = items[index]!;
  const download = useLocalImageDownloadClick({
    downloadUrl: buildLocalImageUrl({ src: current.src, cwd: props.cwd, download: true }),
    downloadName: localImageFileName(current.src) || current.name,
    errorTitle: t("image.downloadError"),
  });
  const step = (delta: number) => setSelected((index + delta + items.length) % items.length);
  const expand = () =>
    props.onExpand?.({
      images: items.map((item) => ({ src: item.url, name: item.name })),
      index,
    });

  return (
    <div
      className="mt-3 flex max-w-[34rem] flex-col gap-2"
      data-testid="group-image-gallery"
      onKeyDown={(event) => {
        if (
          event.key !== "ArrowRight" &&
          event.key !== "ArrowDown" &&
          event.key !== "ArrowLeft" &&
          event.key !== "ArrowUp"
        )
          return;
        event.preventDefault();
        step(event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1);
      }}
    >
      <div className="flex gap-2.5">
        <div
          className={cn(TILE_CLASS, "group/main relative aspect-square min-w-0 flex-1 rounded-2xl")}
        >
          <button
            type="button"
            className="block size-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            aria-label={t("attachments.previewNamed", { name: current.name })}
            onClick={expand}
          >
            <img
              key={current.url}
              src={current.url}
              alt={current.name}
              draggable={false}
              className="size-full animate-in object-contain duration-200 ease-out fade-in motion-reduce:animate-none"
            />
          </button>
          <div className="absolute right-2 bottom-2 flex gap-1 opacity-0 transition-opacity duration-150 ease-out group-focus-within/main:opacity-100 group-hover/main:opacity-100">
            {(
              [
                [t("image.expand"), expand, Maximize2],
                [t("image.download"), download, DownloadIcon],
              ] as const
            ).map(([label, onClick, Icon]) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                className="flex size-7 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-[background-color,transform] duration-150 ease-out hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none active:scale-[0.94]"
                onClick={onClick}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        </div>
        {/* The strip takes the large image's height and scrolls inside it. */}
        <div className="relative w-16 shrink-0">
          <ul className="absolute inset-0 flex flex-col gap-2 overflow-y-auto p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((item, position) => (
              <li key={item.src}>
                <button
                  type="button"
                  aria-label={item.name}
                  aria-current={position === index ? "true" : undefined}
                  title={item.name}
                  className={cn(
                    TILE_CLASS,
                    "block aspect-square w-full rounded-xl transition-[opacity,transform,box-shadow] duration-150 ease-out focus-visible:outline-none active:scale-[0.96]",
                    position === index
                      ? "ring-2 ring-foreground/70"
                      : "opacity-60 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  onClick={() => setSelected(position)}
                >
                  <img
                    src={item.url}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="size-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="flex items-baseline gap-2 pr-[4.625rem] text-xs">
        <span className="min-w-0 truncate text-[var(--color-text-foreground-secondary)]">
          {current.name}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground/70 tabular-nums">
          {index + 1} / {items.length}
        </span>
      </p>
    </div>
  );
}
