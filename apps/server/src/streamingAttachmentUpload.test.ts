// FILE: streamingAttachmentUpload.test.ts
// Purpose: Verifies bounded, content-addressed streaming upload persistence and MIME checks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  attachmentIdForContentHash,
  collectBoundedStream,
  detectUploadedMediaType,
  persistStreamingAttachment,
} from "./streamingAttachmentUpload";

describe("streaming attachment uploads", () => {
  it("rejects an over-limit in-memory body while reading the stream", async () => {
    await expect(
      Effect.runPromise(
        collectBoundedStream(
          Stream.fromIterable([new TextEncoder().encode("abc"), new TextEncoder().encode("def")]),
          5,
        ),
      ),
    ).rejects.toThrow(/too large/i);
  });

  it("detects supported content and rejects a MIME mismatch", () => {
    const pdfHeader = new TextEncoder().encode("%PDF-1.7\n");
    expect(
      detectUploadedMediaType({
        name: "report.pdf",
        declaredMimeType: "application/pdf",
        header: pdfHeader,
      }),
    ).toMatchObject({ mediaType: "application/pdf", extension: ".pdf", type: "file" });

    expect(() =>
      detectUploadedMediaType({
        name: "report.pdf",
        declaredMimeType: "image/png",
        header: pdfHeader,
      }),
    ).toThrow(/MIME type/i);
  });

  it("derives a deterministic thread-scoped id from the full content hash", () => {
    const hash = "0123456789abcdef".repeat(4);
    expect(attachmentIdForContentHash("Thread / One", hash)).toBe(
      "thread-one-01234567-89ab-cdef-0123-456789abcdef",
    );
  });

  it("streams to an immutable content-addressed file", async () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-stream-upload-"));
    try {
      const bytes = new TextEncoder().encode("%PDF-1.7\nhello");
      const reference = await Effect.runPromise(
        persistStreamingAttachment({
          attachmentsDir,
          threadId: "thread-1",
          name: "report.pdf",
          declaredMimeType: "application/pdf",
          expectedSizeBytes: bytes.byteLength,
          stream: Stream.fromIterable([bytes.slice(0, 5), bytes.slice(5)]),
        }).pipe(Effect.provide(NodeServices.layer)),
      );

      expect(reference).toMatchObject({
        type: "file",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        uploadMethod: "stream",
      });
      expect(reference.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.readFileSync(path.join(attachmentsDir, `${reference.id}.pdf`))).toEqual(
        Buffer.from(bytes),
      );
      expect(fs.readdirSync(attachmentsDir).some((entry) => entry.endsWith(".upload"))).toBe(false);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("removes the partial upload when the streamed limit is exceeded", async () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-stream-upload-limit-"));
    try {
      await expect(
        Effect.runPromise(
          persistStreamingAttachment({
            attachmentsDir,
            threadId: "thread-1",
            name: "notes.txt",
            declaredMimeType: "text/plain",
            expectedSizeBytes: 5,
            maxBytes: 4,
            stream: Stream.make(new TextEncoder().encode("hello")),
          }).pipe(Effect.provide(NodeServices.layer)),
        ),
      ).rejects.toThrow(/too large/i);
      expect(fs.readdirSync(attachmentsDir)).toEqual([]);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });
});
