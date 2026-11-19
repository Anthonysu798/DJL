import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  isSafeRegularAttachmentPath,
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../attachmentStore";
export async function scopedAttachmentInputFiles(scope: {
  threadId: string;
  attachmentsRoot?: string;
}): Promise<string[]> {
  if (!scope.attachmentsRoot) return [];
  const expectedThreadSegment = toSafeThreadAttachmentSegment(String(scope.threadId));
  if (!expectedThreadSegment) return [];
  const entries = await readdir(scope.attachmentsRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.slice(0, 10_000)) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const attachmentId = parseAttachmentIdFromRelativePath(entry.name);
    if (
      !attachmentId ||
      parseThreadSegmentFromAttachmentId(attachmentId) !== expectedThreadSegment
    ) {
      continue;
    }
    const candidate = path.join(scope.attachmentsRoot, entry.name);
    if (
      isSafeRegularAttachmentPath({
        attachmentsDir: scope.attachmentsRoot,
        candidatePath: candidate,
      })
    ) {
      files.push(candidate);
    }
  }
  return files;
}
