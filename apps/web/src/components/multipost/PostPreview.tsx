import { useRef, useState } from "react";
import {
  MULTIPOST_CROP_RATIO,
  type MultiPostAccount,
  type MultiPostCapability,
  type MultiPostFile,
} from "@djl/contracts";
import { mediaPreviewUrl } from "./client";
import { PlatformMark } from "./PlatformMark";
import { foldCaption, postLook } from "./postLook";
import { platformName, useMultiPostText } from "./shared";

type Focus = NonNullable<MultiPostFile["focus"]>;
const middle: Focus = { x: 0.5, y: 0.5 };
const STEP = 0.1;
const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

/** The post as each platform will frame it: its picture shape and how much caption shows first. */
export function PostPreview({
  threadId,
  text,
  files,
  accounts,
  capabilities,
  onFocus,
}: {
  threadId: string;
  text: string;
  files: MultiPostFile[];
  accounts: MultiPostAccount[];
  capabilities: MultiPostCapability[];
  /** Where to keep a photo in view when a platform crops it; DJL crops around this point. */
  onFocus?: (url: string, focus: Focus) => void;
}) {
  const l = useMultiPostText();
  const [picked, setPicked] = useState("");
  const [index, setIndex] = useState(0);
  const drag = useRef<{ x: number; y: number; focus: Focus } | null>(null);
  const platforms = [...new Set(accounts.map((account) => account.platformKey))];
  const platformKey = platforms.includes(picked) ? picked : platforms[0];
  if (!platformKey || (!text.trim() && !files.length)) return null;
  const title = (key: string) => {
    const platform = capabilities.find((x) => x.platformKey === key);
    return platform ? platformName(platform) : key;
  };
  const account = accounts.find((x) => x.platformKey === platformKey)!;
  const media = files[index % Math.max(files.length, 1)];
  const photo = media && !media.type?.startsWith("video/");
  const ratio = MULTIPOST_CROP_RATIO[platformKey];
  const crop = Boolean(ratio && photo && onFocus);
  const focus = media?.focus ?? middle;
  const move = (next: Focus) => onFocus?.(media!.url, { x: clamp(next.x), y: clamp(next.y) });
  const caption = foldCaption(text, platformKey);
  return (
    <section className="mp-step mp-preview" aria-label={l("previewTitle", "How it will look")}>
      <h2>{l("previewTitle", "How it will look")}</h2>
      {platforms.length > 1 && (
        <div className="mp-preview-tabs" role="tablist" aria-label={l("previewOn", "Preview on")}>
          {platforms.map((key) => (
            <button
              type="button"
              role="tab"
              key={key}
              aria-selected={key === platformKey}
              onClick={() => setPicked(key)}
            >
              {title(key)}
            </button>
          ))}
        </div>
      )}
      <article className="mp-preview-card" data-platform={platformKey}>
        <header>
          <PlatformMark platformKey={platformKey} name={account.label} />
          <strong>{account.label}</strong>
        </header>
        {media && (
          <div
            className="mp-preview-media"
            style={{ aspectRatio: ratio ? String(ratio) : postLook(platformKey).ratio }}
            {...(crop && {
              role: "group",
              tabIndex: 0,
              "aria-label": l("previewMove", "Move the picture"),
              "data-crop": "",
              onKeyDown: (event: React.KeyboardEvent) => {
                const delta: Record<string, [number, number]> = {
                  ArrowLeft: [-STEP, 0],
                  ArrowRight: [STEP, 0],
                  ArrowUp: [0, -STEP],
                  ArrowDown: [0, STEP],
                };
                const [dx, dy] = delta[event.key] ?? [];
                if (dx === undefined || dy === undefined) return;
                event.preventDefault();
                move({ x: focus.x + dx, y: focus.y + dy });
              },
              onPointerDown: (event: React.PointerEvent) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { x: event.clientX, y: event.clientY, focus };
              },
              onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
                const start = drag.current;
                const image = event.currentTarget.querySelector("img");
                if (!start || !image?.naturalWidth) return;
                const frame = event.currentTarget.getBoundingClientRect();
                const scale = Math.max(
                  frame.width / image.naturalWidth,
                  frame.height / image.naturalHeight,
                );
                // How far the picture can slide each way; dragging right shows more of its left.
                const spareX = image.naturalWidth * scale - frame.width;
                const spareY = image.naturalHeight * scale - frame.height;
                move({
                  x:
                    spareX > 1 ? start.focus.x - (event.clientX - start.x) / spareX : start.focus.x,
                  y:
                    spareY > 1 ? start.focus.y - (event.clientY - start.y) / spareY : start.focus.y,
                });
              },
              onPointerUp: () => {
                drag.current = null;
              },
              onPointerCancel: () => {
                drag.current = null;
              },
            })}
          >
            {photo ? (
              <img
                src={mediaPreviewUrl(threadId, media.url)}
                alt=""
                draggable={false}
                style={crop ? { objectPosition: `${focus.x * 100}% ${focus.y * 100}%` } : undefined}
              />
            ) : (
              <video src={mediaPreviewUrl(threadId, media.url)} muted playsInline />
            )}
            {files.length > 1 && (
              <button
                type="button"
                className="mp-preview-count"
                aria-label={l("previewNext", "Next photo")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setIndex((index + 1) % files.length)}
              >
                {(index % files.length) + 1}/{files.length}
              </button>
            )}
          </div>
        )}
        {caption.shown && (
          <p className="mp-preview-caption">
            {caption.shown}
            {caption.more && <span className="mp-muted">… {l("previewMore", "more")}</span>}
          </p>
        )}
      </article>
      {media && (
        <p className="mp-muted">
          {crop
            ? l(
                "previewCropMove",
                "Drag the picture to choose what {{name}} shows. DJL crops it to this shape before posting.",
                { name: title(platformKey) },
              )
            : l(
                "previewCropHint",
                "{{name}} shows the picture in this shape. Your file is not changed.",
                { name: title(platformKey) },
              )}
        </p>
      )}
    </section>
  );
}
