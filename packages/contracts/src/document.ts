// FILE: document.ts
// Purpose: Schemas for immutable uploads and provider-neutral document normalization.

import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

export const STREAMING_UPLOAD_MAX_FILES_PER_TURN = 20;
export const STREAMING_UPLOAD_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const STREAMING_UPLOAD_MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export const DocumentArtifactId = TrimmedNonEmptyString.pipe(Schema.brand("DocumentArtifactId"));
export type DocumentArtifactId = typeof DocumentArtifactId.Type;

export const WorkPreparationJobId = TrimmedNonEmptyString.pipe(
  Schema.brand("WorkPreparationJobId"),
);
export type WorkPreparationJobId = typeof WorkPreparationJobId.Type;

const AttachmentReferenceId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export const AttachmentContentHash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/i));
export type AttachmentContentHash = typeof AttachmentContentHash.Type;
const AttachmentName = TrimmedNonEmptyString.check(Schema.isMaxLength(255));
const MediaType = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
const StreamingAttachmentFields = {
  id: AttachmentReferenceId,
  name: AttachmentName,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(STREAMING_UPLOAD_MAX_FILE_BYTES)),
  contentHash: AttachmentContentHash,
  uploadMethod: Schema.Literal("stream"),
} as const;

export const StreamingImageAttachmentReference = Schema.Struct({
  type: Schema.Literal("image"),
  ...StreamingAttachmentFields,
  mimeType: MediaType.check(Schema.isPattern(/^image\//i)),
});
export type StreamingImageAttachmentReference = typeof StreamingImageAttachmentReference.Type;

export const StreamingFileAttachmentReference = Schema.Struct({
  type: Schema.Literal("file"),
  ...StreamingAttachmentFields,
  mimeType: MediaType,
});
export type StreamingFileAttachmentReference = typeof StreamingFileAttachmentReference.Type;

export const StreamingAttachmentReference = Schema.Union([
  StreamingImageAttachmentReference,
  StreamingFileAttachmentReference,
]);
export type StreamingAttachmentReference = typeof StreamingAttachmentReference.Type;

export const DocumentExtractionMethod = Schema.Literals(["native", "ocr", "hybrid"]);
export type DocumentExtractionMethod = typeof DocumentExtractionMethod.Type;

const UnitInterval = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1),
);

export const DocumentBoundingBox = Schema.Struct({
  x: UnitInterval,
  y: UnitInterval,
  width: UnitInterval,
  height: UnitInterval,
});
export type DocumentBoundingBox = typeof DocumentBoundingBox.Type;

export const DocumentLocator = Schema.Struct({
  page: Schema.optional(PositiveInt),
  sheet: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  cellRange: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  slide: Schema.optional(PositiveInt),
  paragraph: Schema.optional(PositiveInt),
  boundingBox: Schema.optional(DocumentBoundingBox),
});
export type DocumentLocator = typeof DocumentLocator.Type;

const DocumentCell = Schema.String.check(Schema.isMaxLength(32_000));
const DocumentTable = Schema.Array(
  Schema.Array(DocumentCell).check(Schema.isMaxLength(1_000)),
).check(Schema.isMaxLength(10_000));

export const DocumentBlock = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  kind: Schema.Literals(["text", "table", "image"]),
  text: Schema.String.check(Schema.isMaxLength(500_000)),
  table: Schema.optional(DocumentTable),
  locator: DocumentLocator,
  confidence: UnitInterval,
});
export type DocumentBlock = typeof DocumentBlock.Type;

export const DocumentArtifact = Schema.Struct({
  id: DocumentArtifactId,
  threadId: ThreadId,
  projectId: ProjectId,
  attachmentId: AttachmentReferenceId,
  originalName: AttachmentName,
  contentHash: AttachmentContentHash,
  detectedMediaType: MediaType,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(STREAMING_UPLOAD_MAX_FILE_BYTES)),
  extractionMethod: DocumentExtractionMethod,
  blocks: Schema.Array(DocumentBlock).check(Schema.isMaxLength(50_000)),
  warnings: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(
    Schema.isMaxLength(100),
  ),
  schemaVersion: Schema.Literal(1),
  engineVersion: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  createdAt: IsoDateTime,
});
export type DocumentArtifact = typeof DocumentArtifact.Type;

// Browser-facing document previews deliberately omit hashes, attachment ids, filesystem paths,
// and the full normalized artifact. This keeps the authenticated UI response useful for review
// while bounding both content size and accidental exposure.
export const DocumentArtifactPreviewBlock = Schema.Struct({
  id: DocumentBlock.fields.id,
  kind: DocumentBlock.fields.kind,
  text: Schema.String.check(Schema.isMaxLength(4_000)),
  locator: DocumentLocator,
  confidence: DocumentBlock.fields.confidence,
});
export type DocumentArtifactPreviewBlock = typeof DocumentArtifactPreviewBlock.Type;

export const DocumentArtifactPreview = Schema.Struct({
  id: DocumentArtifactId,
  originalName: AttachmentName,
  extractionMethod: DocumentExtractionMethod,
  blocks: Schema.Array(DocumentArtifactPreviewBlock).check(Schema.isMaxLength(100)),
  warnings: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(
    Schema.isMaxLength(100),
  ),
  engineVersion: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  createdAt: IsoDateTime,
});
export type DocumentArtifactPreview = typeof DocumentArtifactPreview.Type;

export const WorkListPreparedDocumentsInput = Schema.Struct({
  threadId: ThreadId,
});
export type WorkListPreparedDocumentsInput = typeof WorkListPreparedDocumentsInput.Type;

export const WorkListPreparedDocumentsResult = Schema.Struct({
  artifacts: Schema.Array(DocumentArtifactPreview).check(Schema.isMaxLength(20)),
});
export type WorkListPreparedDocumentsResult = typeof WorkListPreparedDocumentsResult.Type;

export const WorkPreviewDocumentInput = Schema.Struct({
  threadId: ThreadId,
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type WorkPreviewDocumentInput = typeof WorkPreviewDocumentInput.Type;

export const WorkPreviewDocumentResult = Schema.Struct({
  artifact: DocumentArtifactPreview,
});
export type WorkPreviewDocumentResult = typeof WorkPreviewDocumentResult.Type;

export const DocumentRendererState = Schema.Literals([
  "unavailable",
  "not_installed",
  "installing",
  "ready",
  "unhealthy",
]);
export type DocumentRendererState = typeof DocumentRendererState.Type;

export const DocumentRenderJobState = Schema.Literals([
  "queued",
  "rendering",
  "ready",
  "failed",
  "cancelled",
]);
export type DocumentRenderJobState = typeof DocumentRenderJobState.Type;

export const DocumentRenderId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type DocumentRenderId = typeof DocumentRenderId.Type;

export const DocumentRendererStatus = Schema.Struct({
  state: DocumentRendererState,
  installAvailable: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  rendererVersion: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  downloadSizeBytes: Schema.optional(
    NonNegativeInt.check(Schema.isLessThanOrEqualTo(2 * 1024 * 1024 * 1024)),
  ),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type DocumentRendererStatus = typeof DocumentRendererStatus.Type;

export const RenderedDocumentPreview = Schema.Struct({
  renderId: DocumentRenderId,
  originalName: AttachmentName,
  sourceType: Schema.Literals(["docx", "pptx", "pdf"]),
  presentationMode: Schema.Literals(["document", "slides"]),
  pageCount: PositiveInt.check(Schema.isLessThanOrEqualTo(5_000)),
  byteSize: NonNegativeInt.check(Schema.isLessThanOrEqualTo(2 * 1024 * 1024 * 1024)),
  previewUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
  previewGrant: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  grantExpiresAt: IsoDateTime,
  rendererVersion: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  warnings: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(
    Schema.isMaxLength(100),
  ),
});
export type RenderedDocumentPreview = typeof RenderedDocumentPreview.Type;

export const WorkRequestDocumentRenderInput = Schema.Struct({
  threadId: ThreadId,
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type WorkRequestDocumentRenderInput = typeof WorkRequestDocumentRenderInput.Type;

export const WorkRequestDocumentRenderResult = Schema.Struct({
  renderId: DocumentRenderId,
  state: DocumentRenderJobState,
});
export type WorkRequestDocumentRenderResult = typeof WorkRequestDocumentRenderResult.Type;

export const WorkGetDocumentRenderInput = Schema.Struct({
  threadId: ThreadId,
  renderId: DocumentRenderId,
});
export type WorkGetDocumentRenderInput = typeof WorkGetDocumentRenderInput.Type;

export const WorkGetDocumentRenderResult = Schema.Struct({
  state: DocumentRenderJobState,
  preview: Schema.optional(RenderedDocumentPreview),
  error: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type WorkGetDocumentRenderResult = typeof WorkGetDocumentRenderResult.Type;

export const WorkCancelDocumentRenderInput = WorkGetDocumentRenderInput;
export type WorkCancelDocumentRenderInput = typeof WorkCancelDocumentRenderInput.Type;

export const WorkCancelDocumentRenderResult = Schema.Struct({
  renderId: DocumentRenderId,
  state: Schema.Literal("cancelled"),
});
export type WorkCancelDocumentRenderResult = typeof WorkCancelDocumentRenderResult.Type;

export const DocumentRenderEvent = Schema.Struct({
  threadId: ThreadId,
  renderId: DocumentRenderId,
  state: DocumentRenderJobState,
  progress: Schema.optional(UnitInterval),
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type DocumentRenderEvent = typeof DocumentRenderEvent.Type;

export const WorkResolveArtifactPathInput = Schema.Struct({
  threadId: ThreadId,
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type WorkResolveArtifactPathInput = typeof WorkResolveArtifactPathInput.Type;

export const WorkResolveArtifactPathResult = Schema.Struct({
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(32_768)),
});
export type WorkResolveArtifactPathResult = typeof WorkResolveArtifactPathResult.Type;

export const WorkPreparationJobStatus = Schema.Literals([
  "queued",
  "processing",
  "needs_input",
  "completed",
  "failed",
]);
export type WorkPreparationJobStatus = typeof WorkPreparationJobStatus.Type;

export const DocumentIntelligenceState = Schema.Literals([
  "unavailable",
  "not_installed",
  "ready",
  "unhealthy",
]);
export type DocumentIntelligenceState = typeof DocumentIntelligenceState.Type;

export const DocumentIntelligenceStatus = Schema.Struct({
  state: DocumentIntelligenceState,
  installAvailable: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  engineVersion: Schema.NullOr(TrimmedNonEmptyString),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type DocumentIntelligenceStatus = typeof DocumentIntelligenceStatus.Type;
