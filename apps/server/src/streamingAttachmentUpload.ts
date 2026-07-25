// FILE: streamingAttachmentUpload.ts
// Purpose: Auth-independent, bounded streaming persistence for immutable Work attachments.

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
  STREAMING_UPLOAD_MAX_FILE_BYTES,
  type StreamingAttachmentReference,
} from "@synara/contracts";
import { Effect, FileSystem, Path, Stream } from "effect";

import { resolveAttachmentRelativePath } from "./attachmentPaths";
import { toSafeThreadAttachmentSegment } from "./attachmentStore";

const MAX_DETECTION_HEADER_BYTES = 64 * 1024;
const MACRO_EXTENSIONS = new Set([
  ".docm",
  ".dotm",
  ".xlsm",
  ".xltm",
  ".xlam",
  ".pptm",
  ".potm",
  ".ppam",
  ".sldm",
]);
const ARCHIVE_EXTENSIONS = new Set([".zip", ".rar", ".7z", ".tar", ".gz"]);

const OFFICE_MEDIA_BY_EXTENSION = new Map([
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
] as const);

const EXTENSION_BY_IMAGE_MEDIA = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/tiff", ".tiff"],
  ["image/bmp", ".bmp"],
] as const);

export interface DetectedUploadMedia {
  readonly type: "image" | "file";
  readonly mediaType: string;
  readonly extension: string;
}

function hasPrefix(bytes: Uint8Array, prefix: ReadonlyArray<number>): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function isZipHeader(bytes: Uint8Array): boolean {
  return (
    hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08])
  );
}

function sniffImage(bytes: Uint8Array): DetectedUploadMedia | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { type: "image", mediaType: "image/png", extension: ".png" };
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return { type: "image", mediaType: "image/jpeg", extension: ".jpg" };
  }
  if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { type: "image", mediaType: "image/gif", extension: ".gif" };
  }
  if (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    hasPrefix(bytes.slice(8, 12), [0x57, 0x45, 0x42, 0x50])
  ) {
    return { type: "image", mediaType: "image/webp", extension: ".webp" };
  }
  if (hasPrefix(bytes, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { type: "image", mediaType: "image/tiff", extension: ".tiff" };
  }
  if (hasPrefix(bytes, [0x42, 0x4d])) {
    return { type: "image", mediaType: "image/bmp", extension: ".bmp" };
  }
  return null;
}

function normalizeDeclaredMimeType(value: string): string {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function assertDeclaredMimeMatches(declared: string, detected: string): void {
  if (declared.length > 0 && declared !== "application/octet-stream" && declared !== detected) {
    throw new Error(`Declared MIME type '${declared}' does not match detected type '${detected}'.`);
  }
}

export function detectUploadedMediaType(input: {
  readonly name: string;
  readonly declaredMimeType: string;
  readonly header: Uint8Array;
}): DetectedUploadMedia {
  const extension = path.extname(input.name.trim()).toLowerCase();
  if (MACRO_EXTENSIONS.has(extension)) {
    throw new Error("Macro-enabled Office documents are not supported.");
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    throw new Error("Archive uploads are not supported.");
  }

  const declared = normalizeDeclaredMimeType(input.declaredMimeType);
  const headerText = new TextDecoder("utf-8", { fatal: false }).decode(input.header);
  let detected: DetectedUploadMedia | null = null;

  if (hasPrefix(input.header, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    detected = { type: "file", mediaType: "application/pdf", extension: ".pdf" };
  } else {
    detected = sniffImage(input.header);
  }

  if (!detected && isZipHeader(input.header)) {
    const officeMediaType = OFFICE_MEDIA_BY_EXTENSION.get(extension as ".docx" | ".xlsx" | ".pptx");
    if (!officeMediaType) {
      throw new Error("Unsupported or ambiguous ZIP-based document format.");
    }
    detected = { type: "file", mediaType: officeMediaType, extension };
  }

  if (!detected && !input.header.includes(0)) {
    if (extension === ".csv") {
      detected = { type: "file", mediaType: "text/csv", extension };
    } else if (extension === ".json") {
      detected = { type: "file", mediaType: "application/json", extension };
    } else if (extension === ".txt" || extension === ".md" || extension === ".markdown") {
      detected = { type: "file", mediaType: "text/plain", extension };
    } else if (headerText.trimStart().startsWith("{")) {
      detected = { type: "file", mediaType: "application/json", extension: ".json" };
    }
  }

  if (!detected) {
    throw new Error(`Unsupported document format for '${input.name}'.`);
  }

  const expectedOfficeMedia = OFFICE_MEDIA_BY_EXTENSION.get(
    extension as ".docx" | ".xlsx" | ".pptx",
  );
  const expectedImageMedia = [...EXTENSION_BY_IMAGE_MEDIA.entries()].find(
    ([, expectedExtension]) =>
      expectedExtension === extension || (extension === ".jpeg" && expectedExtension === ".jpg"),
  )?.[0];
  const expectedMedia =
    extension === ".pdf" ? "application/pdf" : (expectedOfficeMedia ?? expectedImageMedia ?? null);
  if (expectedMedia && expectedMedia !== detected.mediaType) {
    throw new Error(
      `File extension '${extension}' does not match detected MIME type '${detected.mediaType}'.`,
    );
  }
  assertDeclaredMimeMatches(declared, detected.mediaType);
  return detected;
}

export function attachmentIdForContentHash(threadId: string, contentHash: string): string {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment || !/^[a-f0-9]{64}$/i.test(contentHash)) {
    throw new Error("Cannot derive a safe content-addressed attachment id.");
  }
  const prefix = contentHash.slice(0, 32).toLowerCase();
  const uuid = `${prefix.slice(0, 8)}-${prefix.slice(8, 12)}-${prefix.slice(12, 16)}-${prefix.slice(16, 20)}-${prefix.slice(20, 32)}`;
  return `${threadSegment}-${uuid}`;
}

function appendDetectionHeader(
  chunks: Array<Uint8Array>,
  chunk: Uint8Array,
  currentLength: number,
): number {
  if (currentLength >= MAX_DETECTION_HEADER_BYTES) return currentLength;
  const remaining = MAX_DETECTION_HEADER_BYTES - currentLength;
  const slice = chunk.byteLength > remaining ? chunk.slice(0, remaining) : chunk;
  chunks.push(slice);
  return currentLength + slice.byteLength;
}

function combineChunks(chunks: ReadonlyArray<Uint8Array>, total: number): Uint8Array {
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export class BoundedStreamLimitError extends Error {
  override readonly name = "BoundedStreamLimitError";
}

export function collectBoundedStream<E>(stream: Stream.Stream<Uint8Array, E>, maxBytes: number) {
  return Effect.gen(function* () {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      return yield* Effect.fail(new Error("The stream size limit must be a positive integer."));
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    yield* Stream.runForEach(stream, (chunk) =>
      Effect.gen(function* () {
        total += chunk.byteLength;
        if (total > maxBytes) {
          return yield* Effect.fail(
            new BoundedStreamLimitError(`Request body is too large (limit: ${maxBytes} bytes).`),
          );
        }
        chunks.push(chunk);
      }),
    );
    return combineChunks(chunks, total);
  });
}

export function persistStreamingAttachment<E>(input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly name: string;
  readonly declaredMimeType: string;
  readonly expectedSizeBytes: number;
  readonly stream: Stream.Stream<Uint8Array, E>;
  readonly maxBytes?: number;
}) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const effectPath = yield* Path.Path;
    const maxBytes = input.maxBytes ?? STREAMING_UPLOAD_MAX_FILE_BYTES;
    if (
      !Number.isSafeInteger(input.expectedSizeBytes) ||
      input.expectedSizeBytes <= 0 ||
      input.expectedSizeBytes > maxBytes
    ) {
      return yield* Effect.fail(new Error("Attachment is empty or too large."));
    }

    yield* fileSystem.makeDirectory(input.attachmentsDir, { recursive: true });
    const temporaryPath = effectPath.join(input.attachmentsDir, `.${randomUUID()}.upload`);

    const result = yield* Effect.gen(function* () {
      const hash = createHash("sha256");
      const headerChunks: Uint8Array[] = [];
      let headerLength = 0;
      let sizeBytes = 0;

      yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fileSystem.open(temporaryPath, { flag: "wx" });
          yield* Stream.runForEach(input.stream, (chunk) =>
            Effect.gen(function* () {
              sizeBytes += chunk.byteLength;
              if (sizeBytes > maxBytes) {
                return yield* Effect.fail(new Error("Attachment is too large."));
              }
              hash.update(chunk);
              headerLength = appendDetectionHeader(headerChunks, chunk, headerLength);
              yield* file.writeAll(chunk);
            }),
          );
        }),
      );

      if (sizeBytes !== input.expectedSizeBytes) {
        return yield* Effect.fail(
          new Error(
            `Attachment size changed during upload (expected ${input.expectedSizeBytes}, received ${sizeBytes}).`,
          ),
        );
      }
      const contentHash = hash.digest("hex");
      const detected = detectUploadedMediaType({
        name: input.name,
        declaredMimeType: input.declaredMimeType,
        header: combineChunks(headerChunks, headerLength),
      });
      const id = attachmentIdForContentHash(input.threadId, contentHash);
      const destinationPath = resolveAttachmentRelativePath({
        attachmentsDir: input.attachmentsDir,
        relativePath: `${id}${detected.extension}`,
      });
      if (!destinationPath) {
        return yield* Effect.fail(new Error("Unable to resolve the immutable attachment path."));
      }

      const existing = yield* fileSystem
        .stat(destinationPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (existing) {
        if (existing.type !== "File" || Number(existing.size) !== sizeBytes) {
          return yield* Effect.fail(new Error("Content-addressed attachment collision detected."));
        }
      } else {
        yield* fileSystem.link(temporaryPath, destinationPath);
      }

      const reference: StreamingAttachmentReference = {
        type: detected.type,
        id,
        name: input.name.trim(),
        mimeType: detected.mediaType,
        sizeBytes,
        contentHash,
        uploadMethod: "stream",
      };
      return reference;
    }).pipe(Effect.ensuring(fileSystem.remove(temporaryPath, { force: true }).pipe(Effect.ignore)));

    return result;
  });
}
