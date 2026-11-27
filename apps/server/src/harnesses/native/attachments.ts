// FILE: attachments.ts
// Purpose: Turns a chat turn's attachments into what a native harness can use: every file's
// saved path in the prompt, plus the images for drivers whose protocol takes pictures directly.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import {
  ProjectId,
  type ChatFileAttachment,
  type ChatImageAttachment,
  type ProviderSendTurnInput,
  type ThreadId,
} from "@djl/contracts";
import { formatBytes } from "@djl/shared/formatBytes";
import sharp from "sharp";

import { resolveAttachmentPath, resolveAttachmentPathById } from "../../attachmentStore";
import { formatLocator, normalizeDocument } from "../../work/documentExtraction";
import type { NativeProvider, NativeTurn, NativeTurnFile } from "./types";

const MODEL_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
// Model APIs cap an image at 5 MB once base64-encoded, which adds a third.
const MAX_MODEL_IMAGE_BYTES = 3_500_000;
const MAX_MODEL_IMAGE_EDGE = 2000;

export interface ModelImage {
  readonly data: string;
  readonly mimeType: (typeof MODEL_IMAGE_TYPES)[number];
}

/**
 * The turn's images as base64 a model API accepts. A large screenshot or a format the APIs
 * do not take (HEIC, TIFF, BMP) is scaled down and re-encoded. An image that cannot be
 * decoded is left out: its path is still in the prompt.
 */
export async function modelImages(
  files: ReadonlyArray<NativeTurnFile> | undefined,
): Promise<ModelImage[]> {
  const images: ModelImage[] = [];
  for (const file of files ?? []) {
    if (!file.image) continue;
    try {
      const bytes = await readFile(file.path);
      const mimeType = MODEL_IMAGE_TYPES.find((type) => type === file.mimeType.toLowerCase());
      if (mimeType && bytes.byteLength <= MAX_MODEL_IMAGE_BYTES) {
        images.push({ data: bytes.toString("base64"), mimeType });
        continue;
      }
      const smaller = await sharp(bytes, { limitInputPixels: 80_000_000 })
        .rotate()
        .resize({
          width: MAX_MODEL_IMAGE_EDGE,
          height: MAX_MODEL_IMAGE_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toBuffer();
      images.push({ data: smaller.toString("base64"), mimeType: "image/webp" });
    } catch (error) {
      console.warn(`[attachments] Could not prepare image '${file.name}' for the model.`, error);
    }
  }
  return images;
}

/** Providers whose models take text only; an image there would be silently unseen. */
const TEXT_ONLY_PROVIDERS: ReadonlySet<NativeProvider> = new Set(["deepseek", "djlCloud"]);

function savedPath(attachmentsDir: string, attachment: ChatImageAttachment | ChatFileAttachment) {
  // By id first: the saved extension comes from the file's content, not always from its name.
  const path =
    resolveAttachmentPathById({ attachmentsDir, attachmentId: attachment.id }) ??
    resolveAttachmentPath({ attachmentsDir, attachment });
  if (!path || !existsSync(path))
    throw new Error(`'${attachment.name}' is no longer available. Attach it again and resend.`);
  return path;
}

/** Checks the turn's attachments against the provider and finds each one's saved file. */
export function nativeTurn(
  provider: NativeProvider,
  attachmentsDir: string | undefined,
  input: ProviderSendTurnInput,
): NativeTurn {
  // An assistant selection is quoted text the composer already put in the prompt.
  const attachments = (input.attachments ?? []).filter(
    (attachment) => attachment.type !== "assistant-selection",
  );
  // A group lists the paths for each of its members itself.
  if (attachments.length === 0 || provider === "group") return input;
  if (provider === "djlCloud")
    throw new Error(
      "DJL Cloud models cannot open attached files or images in this chat. Switch to Claude or Codex, or remove the attachment.",
    );
  const images = attachments.filter((attachment) => attachment.type === "image");
  if (images.length > 0 && TEXT_ONLY_PROVIDERS.has(provider))
    throw new Error(
      "This model cannot read images. Switch to a model that can, such as Claude or Codex, or remove the image.",
    );
  if (!attachmentsDir) throw new Error("Attachments are not available in this session.");
  return {
    ...input,
    files: attachments.map((attachment) => ({
      path: savedPath(attachmentsDir, attachment),
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      image: attachment.type === "image",
    })),
  };
}

const TEXT_EXTRACTED_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".pptx"]);

/** Writes a PDF or Office file's text into `textDir`; undefined when there is none to offer. */
async function extractText(file: NativeTurnFile, threadId: ThreadId, textDir: string) {
  if (!TEXT_EXTRACTED_EXTENSIONS.has(extname(file.name).toLowerCase())) return undefined;
  try {
    const { blocks } = await normalizeDocument({
      filePath: file.path,
      attachment: { type: "file", id: basename(file.path) as never, ...file },
      // Only the extracted blocks are used here; the artifact itself is not kept.
      jobId: "native-turn",
      threadId,
      projectId: ProjectId.makeUnsafe("native-turn"),
      createdAt: new Date().toISOString(),
    });
    if (blocks.length === 0) return undefined;
    const textPath = join(textDir, `${basename(file.path)}.txt`);
    await writeFile(
      textPath,
      [
        `Text DJL extracted from ${JSON.stringify(file.name)}. Layout, images and formatting are not included.`,
        ...blocks.map((block) => `[${formatLocator(block)}]\n${block.text}`),
      ].join("\n\n"),
    );
    return textPath;
  } catch (error) {
    console.warn(`[attachments] Could not extract text from '${file.name}'.`, error);
    return undefined;
  }
}

/**
 * Lists the turn's files in the prompt, in the same wording as OpenCode's block in
 * provider/attachmentProjection.ts so every harness reads attachments the same way.
 */
export async function withAttachedFiles(
  turn: NativeTurn,
  textDir: () => Promise<string>,
): Promise<NativeTurn> {
  if (!turn.files?.length) return turn;
  const files: NativeTurnFile[] = [];
  for (const file of turn.files) {
    const textPath = file.image
      ? undefined
      : await extractText(file, turn.threadId, await textDir());
    files.push(textPath ? { ...file, textPath } : file);
  }
  const block = [
    "<attached_files>",
    "The user attached the following file(s), saved on disk. Read them with your tools as needed; do not assume their contents. Images are also shown to you directly when your runtime supports it.",
    ...files.map(
      (file) =>
        `- ${JSON.stringify(file.name)} - ${file.mimeType} - ${formatBytes(file.sizeBytes)} - ${file.path}${file.textPath ? ` (text extracted to ${file.textPath})` : ""}`,
    ),
    "</attached_files>",
  ].join("\n");
  return { ...turn, input: `${turn.input ?? ""}\n\n${block}`, files };
}
