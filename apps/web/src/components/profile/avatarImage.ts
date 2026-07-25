// FILE: avatarImage.ts
// Purpose: Compress a user-picked profile photo entirely on-device into a tiny, square
// data URL so it can be persisted in localStorage without consuming much space. No I/O
// leaves the device.
// Layer: web profile feature.

// Square output edge in CSS px. 160 covers the largest avatar (size-20 / share card) at 2x
// without storing anything close to the original photo.
const AVATAR_MAX_EDGE = 160;
const AVATAR_QUALITY = 0.82;

// Hard cap on the encoded string so a pathological image can never blow the localStorage
// budget. Comfortable for a 160px square (~5–12 KB typical).
export const AVATAR_MAX_DATA_URL_LENGTH = 200_000;

export type AvatarImageErrorCode =
  | "readFailed"
  | "unreadable"
  | "notImage"
  | "noPixels"
  | "unsupported"
  | "tooLarge";

export class AvatarImageError extends Error {
  constructor(readonly code: AvatarImageErrorCode) {
    super(`profile.avatar.${code}`);
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new AvatarImageError("readFailed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AvatarImageError("unreadable"));
    img.src = src;
  });
}

// Resize + center-crop to a square and re-encode (WebP, JPEG fallback) at low quality.
export async function compressAvatarImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarImageError("notImage");
  }

  const sourceUrl = await readFileAsDataUrl(file);
  const img = await loadImage(sourceUrl);

  const sourceEdge = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (sourceEdge <= 0) {
    throw new AvatarImageError("noPixels");
  }
  const edge = Math.min(AVATAR_MAX_EDGE, sourceEdge);

  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AvatarImageError("unsupported");
  }

  const sx = ((img.naturalWidth || img.width) - sourceEdge) / 2;
  const sy = ((img.naturalHeight || img.height) - sourceEdge) / 2;
  ctx.drawImage(img, sx, sy, sourceEdge, sourceEdge, 0, 0, edge, edge);

  const webp = canvas.toDataURL("image/webp", AVATAR_QUALITY);
  const dataUrl = webp.startsWith("data:image/webp")
    ? webp
    : canvas.toDataURL("image/jpeg", AVATAR_QUALITY);

  if (dataUrl.length > AVATAR_MAX_DATA_URL_LENGTH) {
    throw new AvatarImageError("tooLarge");
  }
  return dataUrl;
}
