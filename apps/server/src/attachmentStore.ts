import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import type { ChatAttachment } from "@synara/contracts";

import {
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { inferAttachmentExtension, inferImageExtension } from "./imageMime.ts";

const ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS = 80;
const ATTACHMENT_ID_THREAD_SEGMENT_PATTERN = "[a-z0-9_]+(?:-[a-z0-9_]+)*";
const ATTACHMENT_ID_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ATTACHMENT_ID_PATTERN = new RegExp(
  `^(${ATTACHMENT_ID_THREAD_SEGMENT_PATTERN})-(${ATTACHMENT_ID_UUID_PATTERN})$`,
  "i",
);

export function toSafeThreadAttachmentSegment(threadId: string): string | null {
  const segment = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  if (segment.length === 0) {
    return null;
  }
  return segment;
}

export function createAttachmentId(threadId: string): string | null {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return null;
  }
  return `${threadSegment}-${randomUUID()}`;
}

export function parseThreadSegmentFromAttachmentId(attachmentId: string): string | null {
  const normalizedId = normalizeAttachmentRelativePath(attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  const match = normalizedId.match(ATTACHMENT_ID_PATTERN);
  if (!match) {
    return null;
  }
  return match[1]?.toLowerCase() ?? null;
}

export function attachmentRelativePath(attachment: ChatAttachment): string {
  switch (attachment.type) {
    case "image": {
      const extension = inferImageExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
    case "file": {
      const extension = inferAttachmentExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
    case "assistant-selection":
      return `${attachment.id}.bin`;
  }
}

export function resolveAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly attachment: ChatAttachment;
}): string | null {
  return resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: attachmentRelativePath(input.attachment),
  });
}

export function isSafeRegularAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly candidatePath: string;
}): boolean {
  try {
    const lexicalRoot = path.resolve(input.attachmentsDir);
    const root = realpathSync(input.attachmentsDir);
    const lexicalCandidate = path.resolve(input.candidatePath);
    if (!lexicalCandidate.startsWith(`${lexicalRoot}${path.sep}`)) return false;
    const stat = lstatSync(lexicalCandidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const realCandidate = realpathSync(lexicalCandidate);
    return realCandidate.startsWith(`${root}${path.sep}`);
  } catch {
    return false;
  }
}

export function resolveAttachmentPathById(input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}): string | null {
  const normalizedId = normalizeAttachmentRelativePath(input.attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  const escapedId = normalizedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidateNames = readdirSync(input.attachmentsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && new RegExp(`^${escapedId}\\.[a-z0-9]{1,8}$`, "i").test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  if (candidateNames.length !== 1) {
    return null;
  }
  const candidate = resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: candidateNames[0]!,
  });
  if (!candidate) return null;
  return isSafeRegularAttachmentPath({
    attachmentsDir: input.attachmentsDir,
    candidatePath: candidate,
  })
    ? candidate
    : null;
}

export function parseAttachmentIdFromRelativePath(relativePath: string): string | null {
  const normalized = normalizeAttachmentRelativePath(relativePath);
  if (!normalized || normalized.includes("/")) {
    return null;
  }
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return null;
  }
  const id = normalized.slice(0, extensionIndex);
  return id.length > 0 && !id.includes(".") ? id : null;
}
