// FILE: composerSend.ts
// Purpose: Shared composer send helpers for attachment intake, prompt formatting, and upload payloads.
// Layer: Web composer utility
// Depends on: provider/model contracts plus composer draft attachment shapes.

import {
  MessageId,
  ThreadId,
  type ModelSelection,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ClaudeCodeEffort,
  type ProviderKind,
  type StreamingAttachmentReference,
  type UploadChatAttachment,
} from "@synara/contracts";
import { applyClaudePromptEffortPrefix, getModelCapabilities } from "@synara/shared/model";

import type {
  ComposerAssistantSelectionAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
} from "../composerDraftStore";
import { randomUUID } from "./utils";
import { resolveWsHttpUrl } from "./wsHttpUrl";

export const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024),
)}MB`;
export const FILE_SIZE_LIMIT_LABEL = `${Math.round(
  PROVIDER_SEND_TURN_MAX_FILE_BYTES / (1024 * 1024),
)}MB`;

export const COMPOSER_ATTACHMENT_ACCEPT = "image/*,.pdf,.docx,.xlsx,.pptx";

export function partitionComposerAttachmentFiles(files: readonly File[]): {
  images: File[];
  files: File[];
} {
  const images: File[] = [];
  const genericFiles: File[] = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      images.push(file);
    } else {
      genericFiles.push(file);
    }
  }
  return { images, files: genericFiles };
}

export interface ComposerImageBuildResult {
  images: ComposerImageAttachment[];
  error: string | null;
}

export interface ComposerFileBuildResult {
  files: ComposerFileAttachment[];
  error: string | null;
}

// Centralizes the shared file/count/size guard while each attachment type maps its own draft shape.
function collectComposerAttachmentFiles(input: {
  files: readonly File[];
  existingAttachmentCount: number;
  maxBytes: number;
  sizeLimitLabel: string;
  acceptsFile: (file: File) => boolean;
  unsupportedFileError?: (file: File) => string | null;
}): { files: File[]; error: string | null } {
  const files: File[] = [];
  let nextAttachmentCount = input.existingAttachmentCount;
  let error: string | null = null;

  for (const file of input.files) {
    if (!input.acceptsFile(file)) {
      error = input.unsupportedFileError?.(file) ?? error;
      continue;
    }
    if (file.size > input.maxBytes) {
      error = `'${file.name}' exceeds the ${input.sizeLimitLabel} attachment limit.`;
      continue;
    }
    if (nextAttachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`;
      break;
    }

    files.push(file);
    nextAttachmentCount += 1;
  }

  return { files, error };
}

// Converts File objects into the exact attachment draft shape used by the chat composer.
export function buildComposerImageAttachmentsFromFiles(input: {
  files: readonly File[];
  existingAttachmentCount: number;
}): ComposerImageBuildResult {
  const result = collectComposerAttachmentFiles({
    files: input.files,
    existingAttachmentCount: input.existingAttachmentCount,
    maxBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
    sizeLimitLabel: IMAGE_SIZE_LIMIT_LABEL,
    acceptsFile: (file) => file.type.startsWith("image/"),
    unsupportedFileError: (file) =>
      `Unsupported file type for '${file.name}'. Please attach image files only.`,
  });

  const images = result.files.map<ComposerImageAttachment>((file) => ({
    type: "image",
    id: randomUUID(),
    name: file.name || "image",
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
  }));

  return { images, error: result.error };
}

// Converts non-image File objects into in-memory file attachment drafts.
export function buildComposerFileAttachmentsFromFiles(input: {
  files: readonly File[];
  existingAttachmentCount: number;
}): ComposerFileBuildResult {
  const result = collectComposerAttachmentFiles({
    files: input.files,
    existingAttachmentCount: input.existingAttachmentCount,
    maxBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES,
    sizeLimitLabel: FILE_SIZE_LIMIT_LABEL,
    acceptsFile: (file) => !file.type.startsWith("image/"),
  });

  const files = result.files.map<ComposerFileAttachment>((file) => ({
    type: "file",
    id: randomUUID(),
    name: file.name || "attachment",
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    file,
  }));

  return { files, error: result.error };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read attachment data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read attachment."));
    });
    reader.readAsDataURL(file);
  });
}

export function cloneComposerImageAttachment(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

// Provider-specific prompt massaging. Claude prompt-injected efforts must be
// applied before filtering skill/mention references and before dispatch.
export function formatOutgoingComposerPrompt(params: {
  provider: ProviderKind;
  model: string | null;
  effort: string | null;
  text: string;
}): string {
  const caps = getModelCapabilities(params.provider, params.model);
  if (params.effort && caps.promptInjectedEffortLevels.includes(params.effort)) {
    return applyClaudePromptEffortPrefix(params.text, params.effort as ClaudeCodeEffort | null);
  }
  return params.text;
}

export function resolvePromptEffortFromModelSelection(
  modelSelection: ModelSelection,
): string | null {
  switch (modelSelection.provider) {
    case "codex":
      return modelSelection.options?.reasoningEffort ?? null;
    case "claudeAgent":
      return modelSelection.options?.effort ?? null;
    case "cursor":
      return modelSelection.options?.reasoningEffort ?? null;
    case "gemini":
      return (
        modelSelection.options?.thinkingLevel ??
        (modelSelection.options?.thinkingBudget !== undefined
          ? String(modelSelection.options.thinkingBudget)
          : null)
      );
    case "grok":
    case "droid":
      return modelSelection.options?.reasoningEffort ?? null;
    case "pi":
      return modelSelection.options?.thinkingLevel ?? null;
    case "kilo":
    case "opencode":
      return null;
  }
}

export interface StreamingComposerAttachmentUploadInput {
  readonly threadId: ThreadId;
  readonly type: "file" | "image";
  readonly file: File;
}

export type StreamingComposerAttachmentUploader = (
  input: StreamingComposerAttachmentUploadInput,
) => Promise<StreamingAttachmentReference>;

function isStreamingAttachmentReference(
  value: unknown,
  expectedType: "file" | "image",
): value is StreamingAttachmentReference {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === expectedType &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.mimeType === "string" &&
    typeof candidate.sizeBytes === "number" &&
    typeof candidate.contentHash === "string" &&
    /^[a-f0-9]{64}$/i.test(candidate.contentHash) &&
    candidate.uploadMethod === "stream"
  );
}

export const uploadStreamingComposerAttachment: StreamingComposerAttachmentUploader = async ({
  threadId,
  type,
  file,
}) => {
  const params = new URLSearchParams({
    threadId,
    name: file.name || "attachment",
    mimeType: file.type || "application/octet-stream",
    sizeBytes: String(file.size),
  });
  const response = await fetch(resolveWsHttpUrl(`/api/attachments/upload?${params}`), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 500);
    throw new Error(detail || `Attachment upload failed (${response.status}).`);
  }
  const reference: unknown = await response.json();
  if (!isStreamingAttachmentReference(reference, type)) {
    throw new Error("The server returned an invalid attachment reference.");
  }
  return reference;
};

export async function buildUploadComposerAttachments(input: {
  images: ReadonlyArray<ComposerImageAttachment>;
  files?: ReadonlyArray<ComposerFileAttachment>;
  assistantSelections: ReadonlyArray<ComposerAssistantSelectionAttachment>;
  streaming?: {
    readonly threadId: ThreadId;
    readonly upload?: StreamingComposerAttachmentUploader;
  };
}): Promise<UploadChatAttachment[]> {
  const streamingUploader = input.streaming?.upload ?? uploadStreamingComposerAttachment;
  return Promise.all([
    ...input.assistantSelections.map((selection) =>
      Promise.resolve({
        type: "assistant-selection" as const,
        assistantMessageId: MessageId.makeUnsafe(selection.assistantMessageId),
        text: selection.text,
      }),
    ),
    ...input.images.map(async (image) =>
      input.streaming
        ? streamingUploader({
            threadId: input.streaming.threadId,
            type: "image",
            file: image.file,
          })
        : {
            type: "image" as const,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            dataUrl: await readFileAsDataUrl(image.file),
          },
    ),
    ...(input.files ?? []).map(async (file) =>
      input.streaming
        ? streamingUploader({
            threadId: input.streaming.threadId,
            type: "file",
            file: file.file,
          })
        : {
            type: "file" as const,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            dataUrl: await readFileAsDataUrl(file.file),
          },
    ),
  ]);
}
