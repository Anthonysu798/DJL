// FILE: workDocumentPreview.ts
// Purpose: Resolve and safely normalize a task-scoped Word deliverable for the Work UI.

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  STREAMING_UPLOAD_MAX_FILE_BYTES,
  type DocumentArtifact,
  type DocumentArtifactPreview,
  type ProjectId,
  type ProjectKind,
  type ThreadId,
  type WorkPreviewDocumentResult,
} from "@synara/contracts";

import { normalizeDocument } from "./documentExtraction";
import { WorkToolValidationError } from "./documentTools";
import { resolveWorkArtifactPath } from "./workArtifactPath";

export function toDocumentArtifactPreview(artifact: DocumentArtifact): DocumentArtifactPreview {
  return {
    id: artifact.id,
    originalName: artifact.originalName,
    extractionMethod: artifact.extractionMethod,
    blocks: artifact.blocks.slice(0, 100).map((block) => ({
      id: block.id,
      kind: block.kind,
      text: block.text.slice(0, 4_000),
      locator: block.locator,
      confidence: block.confidence,
    })),
    warnings: artifact.warnings.slice(0, 100),
    engineVersion: artifact.engineVersion,
    createdAt: artifact.createdAt,
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".pdf"
    ? "application/pdf"
    : extension === ".docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : extension === ".xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : extension === ".pptx"
          ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          : extension === ".png"
            ? "image/png"
            : extension === ".jpg" || extension === ".jpeg"
              ? "image/jpeg"
              : extension === ".tif" || extension === ".tiff"
                ? "image/tiff"
                : extension === ".webp"
                  ? "image/webp"
                  : "text/plain";
}

export async function normalizeWorkDocumentFile(input: {
  readonly filePath: string;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly scopeId: string;
}): Promise<DocumentArtifact> {
  const info = await stat(input.filePath);
  if (!info.isFile()) {
    throw new WorkToolValidationError("The requested document is not a file.");
  }
  if (info.size > STREAMING_UPLOAD_MAX_FILE_BYTES) {
    throw new WorkToolValidationError("The requested document exceeds the 100 MiB Work limit.");
  }

  return normalizeDocument({
    filePath: input.filePath,
    attachment: {
      type: "file",
      id: `${input.scopeId}-${createHash("sha256").update(input.filePath).digest("hex").slice(0, 24)}` as never,
      name: path.basename(input.filePath),
      mimeType: mimeTypeForPath(input.filePath),
      sizeBytes: info.size,
    },
    jobId: `${input.scopeId}-${input.threadId}`,
    threadId: input.threadId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
  });
}

export async function previewWorkDocument(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectKind: ProjectKind;
  readonly projectWorkspaceRoot: string;
  readonly envMode: "local" | "worktree";
  readonly worktreePath: string | null;
  readonly requestedPath: string;
}): Promise<WorkPreviewDocumentResult> {
  const filePath = await resolveWorkArtifactPath(input);
  if (![".docx", ".pptx", ".pdf"].includes(path.extname(filePath).toLowerCase())) {
    throw new WorkToolValidationError(
      "Only DOCX, PPTX, and PDF files can be previewed in DJL Work.",
    );
  }

  const artifact = await normalizeWorkDocumentFile({
    filePath,
    threadId: input.threadId,
    projectId: input.projectId,
    scopeId: "preview",
  });

  return { artifact: toDocumentArtifactPreview(artifact) };
}
