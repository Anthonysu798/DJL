// FILE: document.test.ts
// Purpose: Contract coverage for immutable uploads and normalized document artifacts.

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DocumentArtifact,
  DocumentArtifactId,
  DocumentRenderEvent,
  DocumentRendererStatus,
  RenderedDocumentPreview,
  WorkListPreparedDocumentsResult,
  WorkGetDocumentRenderResult,
  WorkRequestDocumentRenderInput,
  WorkPreviewDocumentInput,
  WorkPreviewDocumentResult,
  WorkResolveArtifactPathInput,
  WorkResolveArtifactPathResult,
  STREAMING_UPLOAD_MAX_FILE_BYTES,
  StreamingAttachmentReference,
} from "./document";

const decodeReference = Schema.decodeUnknownEffect(StreamingAttachmentReference);
const decodeArtifact = Schema.decodeUnknownEffect(DocumentArtifact);
const decodePreparedDocuments = Schema.decodeUnknownEffect(WorkListPreparedDocumentsResult);
const decodeWorkDocumentPreviewInput = Schema.decodeUnknownEffect(WorkPreviewDocumentInput);
const decodeWorkDocumentPreviewResult = Schema.decodeUnknownEffect(WorkPreviewDocumentResult);
const decodeWorkArtifactPathInput = Schema.decodeUnknownEffect(WorkResolveArtifactPathInput);
const decodeWorkArtifactPathResult = Schema.decodeUnknownEffect(WorkResolveArtifactPathResult);
const decodeRendererStatus = Schema.decodeUnknownEffect(DocumentRendererStatus);
const decodeRenderedPreview = Schema.decodeUnknownEffect(RenderedDocumentPreview);
const decodeRenderRequest = Schema.decodeUnknownEffect(WorkRequestDocumentRenderInput);
const decodeRenderResult = Schema.decodeUnknownEffect(WorkGetDocumentRenderResult);
const decodeRenderEvent = Schema.decodeUnknownEffect(DocumentRenderEvent);

describe("document contracts", () => {
  it("bounds native document renderer status and download metadata", async () => {
    const status = await Effect.runPromise(
      decodeRendererStatus({
        state: "not_installed",
        installAvailable: true,
        version: "24.8.5",
        rendererVersion: null,
        downloadSizeBytes: 212_000_000,
        detail: "Install the local document viewer to preview Office files.",
      }),
    );

    expect(status.state).toBe("not_installed");
    expect(status.downloadSizeBytes).toBe(212_000_000);
  });

  it("carries only thread-scoped inputs into native rendering", async () => {
    const input = await Effect.runPromise(
      decodeRenderRequest({
        threadId: "thread-1",
        path: "Deliverables/report-v1.docx",
      }),
    );

    expect(input).toEqual({
      threadId: "thread-1",
      path: "Deliverables/report-v1.docx",
    });
  });

  it("exposes bounded native preview metadata without filesystem paths", async () => {
    const preview = await Effect.runPromise(
      decodeRenderedPreview({
        renderId: "render-1",
        originalName: "board-deck.pptx",
        sourceType: "pptx",
        presentationMode: "slides",
        pageCount: 12,
        byteSize: 4_096,
        previewUrl: "/api/work/document-previews/render-1",
        previewGrant: "opaque-preview-grant",
        grantExpiresAt: "2026-07-14T12:00:00.000Z",
        rendererVersion: "libreoffice-24.8.5",
        warnings: ["Two fonts were substituted."],
      }),
    );

    expect(preview.presentationMode).toBe("slides");
    expect(preview).not.toHaveProperty("path");

    const result = await Effect.runPromise(decodeRenderResult({ state: "ready", preview }));
    expect(result.preview?.renderId).toBe("render-1");
  });

  it("decodes bounded render progress events", async () => {
    const event = await Effect.runPromise(
      decodeRenderEvent({
        threadId: "thread-1",
        renderId: "render-1",
        state: "rendering",
        progress: 0.5,
        message: "Rendering document pages",
      }),
    );

    expect(event.progress).toBe(0.5);
  });

  it("carries only a thread-scoped artifact reference into path resolution", async () => {
    const input = await Effect.runPromise(
      decodeWorkArtifactPathInput({
        threadId: "thread-1",
        path: "Deliverables/report-v1.pdf",
      }),
    );
    const result = await Effect.runPromise(
      decodeWorkArtifactPathResult({ path: "/tmp/work/Deliverables/report-v1.pdf" }),
    );

    expect(input.path).toBe("Deliverables/report-v1.pdf");
    expect(result.path).toBe("/tmp/work/Deliverables/report-v1.pdf");
  });

  it("bounds a thread-scoped document preview response", async () => {
    const input = await Effect.runPromise(
      decodeWorkDocumentPreviewInput({
        threadId: "thread-1",
        path: "Deliverables/report-v1.docx",
      }),
    );
    const result = await Effect.runPromise(
      decodeWorkDocumentPreviewResult({
        artifact: {
          id: "artifact-preview-1",
          originalName: "report-v1.docx",
          extractionMethod: "native",
          warnings: [],
          blocks: [
            {
              id: "block-1",
              kind: "text",
              text: "Executive summary",
              locator: { paragraph: 1 },
              confidence: 1,
            },
          ],
          engineVersion: "djl-native-test",
          createdAt: "2026-07-13T00:00:00.000Z",
        },
      }),
    );

    expect(input.path).toBe("Deliverables/report-v1.docx");
    expect(result.artifact.blocks[0]?.locator.paragraph).toBe(1);
  });

  it("accepts an immutable streaming attachment reference", async () => {
    const reference = await Effect.runPromise(
      decodeReference({
        type: "file",
        id: "thread-1-00000000-0000-4000-8000-000000000001",
        name: "quarterly-report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 42,
        contentHash: "a".repeat(64),
        uploadMethod: "stream",
      }),
    );

    expect(reference.contentHash).toHaveLength(64);
    expect(reference.uploadMethod).toBe("stream");
  });

  it("rejects streaming references above the per-file limit", async () => {
    await expect(
      Effect.runPromise(
        decodeReference({
          type: "file",
          id: "thread-1-00000000-0000-4000-8000-000000000001",
          name: "too-large.pdf",
          mimeType: "application/pdf",
          sizeBytes: STREAMING_UPLOAD_MAX_FILE_BYTES + 1,
          contentHash: "b".repeat(64),
          uploadMethod: "stream",
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("preserves cited page, table, and bounding-box structure", async () => {
    const artifactId = DocumentArtifactId.makeUnsafe("artifact-1");
    const artifact = await Effect.runPromise(
      decodeArtifact({
        id: artifactId,
        threadId: "thread-1",
        projectId: "project-1",
        attachmentId: "thread-1-00000000-0000-4000-8000-000000000001",
        originalName: "scan.pdf",
        contentHash: "c".repeat(64),
        detectedMediaType: "application/pdf",
        sizeBytes: 100,
        extractionMethod: "hybrid",
        blocks: [
          {
            id: "block-1",
            kind: "table",
            text: "Revenue | 10",
            table: [["Revenue", "10"]],
            locator: {
              page: 2,
              boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.3 },
            },
            confidence: 0.93,
          },
        ],
        warnings: [],
        schemaVersion: 1,
        engineVersion: "native-test-1",
        createdAt: "2026-07-13T00:00:00.000Z",
      }),
    );

    expect(artifact.blocks[0]?.locator.page).toBe(2);
    expect(artifact.blocks[0]?.table?.[0]).toEqual(["Revenue", "10"]);
  });

  it("exposes only bounded document previews to the Work UI", async () => {
    const result = await Effect.runPromise(
      decodePreparedDocuments({
        artifacts: [
          {
            id: "artifact-1",
            originalName: "scan.pdf",
            extractionMethod: "ocr",
            warnings: ["Low-confidence OCR on page 2"],
            blocks: [
              {
                id: "block-1",
                kind: "text",
                text: "Quarterly revenue was 10.",
                locator: { page: 2 },
                confidence: 0.61,
              },
            ],
            engineVersion: "paddle-test-1",
            createdAt: "2026-07-13T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(result.artifacts[0]?.blocks[0]?.locator.page).toBe(2);
    expect(result.artifacts[0]?.warnings[0]).toContain("Low-confidence");
  });
});
