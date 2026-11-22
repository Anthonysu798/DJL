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

  it("accepts source files as plain text under their own extension", () => {
    const header = new TextEncoder().encode('def greet(name):\n    return f"Hi {name}"\n');
    for (const declaredMimeType of ["text/x-python", "application/octet-stream", ""]) {
      expect(detectUploadedMediaType({ name: "greet.py", declaredMimeType, header })).toEqual({
        type: "file",
        mediaType: "text/plain",
        extension: ".py",
      });
    }
    expect(
      detectUploadedMediaType({
        name: "notes.md",
        declaredMimeType: "text/markdown",
        header: new TextEncoder().encode("# Notes"),
      }),
    ).toMatchObject({ mediaType: "text/plain", extension: ".md" });
    expect(() =>
      detectUploadedMediaType({
        name: "tool.py",
        declaredMimeType: "text/x-python",
        header: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]),
      }),
    ).toThrow(/Unsupported document format/);
    expect(() =>
      detectUploadedMediaType({
        name: "page.html",
        declaredMimeType: "text/html",
        header: new TextEncoder().encode("<script>alert(1)</script>"),
      }),
    ).toThrow(/Unsupported document format/);
    expect(() =>
      detectUploadedMediaType({
        name: "main.ts",
        declaredMimeType: "video/mp2t",
        header: new TextEncoder().encode("export const a = 1;"),
      }),
    ).toThrow(/does not match/);
  });

  it("reports an unsupported upload as a failure and keeps no partial file", async () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-stream-upload-type-"));
    try {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]);
      // `flip` succeeds with a failure's error; a defect would still reject.
      const error = await Effect.runPromise(
        persistStreamingAttachment({
          attachmentsDir,
          threadId: "thread-1",
          name: "bundle.bin",
          declaredMimeType: "application/octet-stream",
          expectedSizeBytes: bytes.byteLength,
          stream: Stream.make(bytes),
        }).pipe(Effect.flip, Effect.provide(NodeServices.layer)),
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/ZIP-based document format/);
      expect(fs.readdirSync(attachmentsDir)).toEqual([]);
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

describe("social video attachment detection", () => {
  it("recognizes MP4 bytes as a media file instead of rejecting it as a document", () => {
    const header = Buffer.from([
      0,
      0,
      0,
      24,
      ...Buffer.from("ftypisom"),
      0,
      0,
      0,
      1,
      ...Buffer.from("isommp42"),
    ]);
    expect(
      detectUploadedMediaType({ name: "clip.mp4", declaredMimeType: "video/mp4", header }),
    ).toEqual({ type: "file", mediaType: "video/mp4", extension: ".mp4" });
  });
  it("does not accept an image container as video or a mismatched video extension", () => {
    const image = Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypavif"), 0, 0, 0, 0]);
    expect(() =>
      detectUploadedMediaType({ name: "clip.mp4", declaredMimeType: "video/mp4", header: image }),
    ).toThrow();
    const mp4 = Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypisom"), 0, 0, 0, 0]);
    expect(() =>
      detectUploadedMediaType({ name: "clip.webm", declaredMimeType: "video/webm", header: mp4 }),
    ).toThrow();
  });
});
