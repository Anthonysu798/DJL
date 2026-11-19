/**
 * Upload types the API accepts and the magic bytes each must start with. The
 * declared type is checked against the uploaded bytes, never trusted alone.
 */
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const zip = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
const utf8Text = (b: Uint8Array) => {
  if (b.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
};

// ISO BMFF container signature only; this does not establish codecs or duration.
// Exclude image-only AVIF/HEIF and audio-only brands even though they also use ftyp.
const mp4 = (bytes: Uint8Array) => {
  if (bytes.length < 16 || !startsWith(bytes, ascii("ftyp"), 4)) return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16 || size > bytes.length || size % 4 !== 0) return false;
  const brand = new TextDecoder("ascii").decode(bytes.subarray(8, 12));
  return ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1"].includes(brand);
};

const MATCHERS: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = {
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  "image/gif": (b) => startsWith(b, ascii("GIF8")),
  "image/webp": (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8),
  "video/mp4": mp4,
  "application/pdf": (b) => startsWith(b, ascii("%PDF-")),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": zip,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": zip,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": zip,
  "text/plain": utf8Text,
  "text/markdown": utf8Text,
  "text/csv": utf8Text,
  "application/json": utf8Text,
};

export const isSupportedType = (mimeType: string) => mimeType in MATCHERS;
export const isImageType = (mimeType: string) =>
  isSupportedType(mimeType) && mimeType.startsWith("image/");

/** True when `bytes` really are a `mimeType` file. */
export const bytesMatchType = (mimeType: string, bytes: Uint8Array) =>
  MATCHERS[mimeType]?.(bytes) ?? false;
