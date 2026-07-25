import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAttachmentId,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
  isSafeRegularAttachmentPath,
} from "./attachmentStore.ts";

describe("attachmentStore", () => {
  it("sanitizes thread ids when creating attachment ids", () => {
    const attachmentId = createAttachmentId("thread.folder/unsafe space");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }

    const threadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    expect(threadSegment).toBeTruthy();
    expect(threadSegment).toMatch(/^[a-z0-9_-]+$/i);
    expect(threadSegment).not.toContain(".");
    expect(threadSegment).not.toContain("%");
    expect(threadSegment).not.toContain("/");
  });

  it("parses exact thread segments from attachment ids without prefix collisions", () => {
    const fooId = "foo-00000000-0000-4000-8000-000000000001";
    const fooBarId = "foo-bar-00000000-0000-4000-8000-000000000002";

    expect(parseThreadSegmentFromAttachmentId(fooId)).toBe("foo");
    expect(parseThreadSegmentFromAttachmentId(fooBarId)).toBe("foo-bar");
  });

  it("normalizes created thread segments to lowercase", () => {
    const attachmentId = createAttachmentId("Thread.Foo");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }
    expect(parseThreadSegmentFromAttachmentId(attachmentId)).toBe("thread-foo");
  });

  it("resolves attachment path by id using the extension that exists on disk", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-attachment-store-"));
    try {
      const attachmentId = "thread-1-attachment";
      const pngPath = path.join(attachmentsDir, `${attachmentId}.png`);
      fs.writeFileSync(pngPath, Buffer.from("hello"));

      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId,
      });
      expect(resolved).toBe(pngPath);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("resolves immutable Office and PDF attachments without a fixed extension allowlist", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-attachment-store-"));
    try {
      const attachmentId = "thread-1-00000000-0000-4000-8000-000000000001";
      const pdfPath = path.join(attachmentsDir, `${attachmentId}.pdf`);
      fs.writeFileSync(pdfPath, "%PDF-1.7");

      expect(resolveAttachmentPathById({ attachmentsDir, attachmentId })).toBe(pdfPath);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("returns null when no attachment file exists for the id", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-attachment-store-"));
    try {
      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId: "thread-1-missing",
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("rejects symlinked attachment paths that escape the attachment root", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-attachment-store-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-attachment-outside-"));
    try {
      const outsidePath = path.join(outsideDir, "secret.pdf");
      const linkedPath = path.join(attachmentsDir, "thread-1-linked.pdf");
      fs.writeFileSync(outsidePath, "secret");
      fs.symlinkSync(outsidePath, linkedPath);

      expect(isSafeRegularAttachmentPath({ attachmentsDir, candidatePath: linkedPath })).toBe(
        false,
      );
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
