/**
 * Attachment rules, checked before anything is uploaded so the user gets an
 * inline message instead of a server rejection. The server re-checks size and
 * magic bytes; this is only the friendly first pass.
 */
import { CLOUD_FILE_MAX_BYTES } from "@synara/contracts/cloud";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** Documents the agent's read_file tool can parse, by extension. */
const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export const MAX_FILE_BYTES = CLOUD_FILE_MAX_BYTES;
/** A message carries at most 20 parts (contract); one is reserved for the text. */
export const MAX_ATTACHMENTS = 19;

/** `accept` attribute for the file picker. Advisory only; validateFile is authoritative. */
export const ACCEPT_ATTRIBUTE = [
  ...IMAGE_TYPES,
  ...Object.values(DOCUMENT_TYPES),
  ...Object.keys({ ...DOCUMENT_TYPES, ...IMAGE_EXTENSIONS }).map((ext) => `.${ext}`),
].join(",");

export type AttachmentProblem =
  | { readonly kind: "empty" }
  | { readonly kind: "too_large"; readonly maxMb: number }
  | { readonly kind: "unsupported_type" }
  | { readonly kind: "too_many"; readonly max: number };

export interface FileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

const extensionOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";

/** The MIME type to declare for a file, or null if it isn't one we accept. Browsers often leave `type` empty for .md and .csv. */
export function resolveMimeType(file: FileLike): string | null {
  const ext = extensionOf(file.name);
  const byExtension = IMAGE_EXTENSIONS[ext] ?? DOCUMENT_TYPES[ext] ?? null;
  const declared = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (declared && (IMAGE_TYPES as readonly string[]).includes(declared)) return declared;
  if (declared && Object.values(DOCUMENT_TYPES).includes(declared)) return declared;
  return byExtension;
}

export const isImageType = (mimeType: string) =>
  (IMAGE_TYPES as readonly string[]).includes(mimeType);

export function validateFile(file: FileLike, alreadyAttached: number): AttachmentProblem | null {
  if (alreadyAttached >= MAX_ATTACHMENTS) return { kind: "too_many", max: MAX_ATTACHMENTS };
  if (resolveMimeType(file) === null) return { kind: "unsupported_type" };
  if (file.size === 0) return { kind: "empty" };
  if (file.size > MAX_FILE_BYTES)
    return { kind: "too_large", maxMb: Math.round(MAX_FILE_BYTES / (1024 * 1024)) };
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
