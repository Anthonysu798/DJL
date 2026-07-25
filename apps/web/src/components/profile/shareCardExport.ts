// FILE: shareCardExport.ts
// Purpose: Fully offline rendering of the share card to a PNG, plus clipboard copy,
// file download, and social-intent URLs. No data leaves the device to BUILD the image;
// opening a social composer is an explicit, user-initiated action.
// Layer: web profile feature.

import { toBlob } from "html-to-image";
import { copyPngBlobToDesktopClipboard } from "~/lib/desktopClipboard";
import { readNativeApi } from "~/nativeApi";
import type { TFunction } from "i18next";
import englishCatalog from "../../i18n/locales/en.json";

export { downloadBlob } from "~/lib/browserDownload";

export const SHARE_TWEET_TEXT = englishCatalog.settings.profileShareSocial.text;
const SHARE_URL = "https://trysynara.com";

export type ShareTarget = "x" | "linkedin" | "reddit";

// Renders the given node to a PNG blob entirely on-device (canvas serialization).
// Passing explicit width/height keeps the export deterministic and free of trailing
// whitespace regardless of layout measurement quirks.
export async function renderNodeToPngBlob(
  node: HTMLElement,
  size?: { width: number; height: number },
): Promise<Blob | null> {
  try {
    return await toBlob(node, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#ffffff",
      ...(size ? { width: size.width, height: size.height } : {}),
    });
  } catch {
    return null;
  }
}

export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  if (await copyPngBlobToDesktopClipboard(blob)) {
    return true;
  }

  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      return false;
    }
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    return true;
  } catch {
    return false;
  }
}

// Opens an external URL via the desktop shell when available, else a new browser tab.
export function openExternalUrl(url: string): void {
  const api = readNativeApi();
  if (api?.shell?.openExternal) {
    void api.shell.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function shareIntentUrl(target: ShareTarget, t?: TFunction): string {
  const text = t?.("profileShareSocial.text", { ns: "settings" }) ?? SHARE_TWEET_TEXT;
  const redditTitle =
    t?.("profileShareSocial.redditTitle", { ns: "settings" }) ??
    englishCatalog.settings.profileShareSocial.redditTitle;
  switch (target) {
    case "x":
      return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SHARE_URL)}`;
    case "reddit":
      return `https://www.reddit.com/submit?url=${encodeURIComponent(
        SHARE_URL,
      )}&title=${encodeURIComponent(redditTitle)}`;
  }
}
