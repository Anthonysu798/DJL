import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@synara/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildComposerFileAttachmentsFromFiles,
  buildComposerImageAttachmentsFromFiles,
  buildUploadComposerAttachments,
  COMPOSER_ATTACHMENT_ACCEPT,
  partitionComposerAttachmentFiles,
} from "./composerSend";

describe("composerSend attachment builders", () => {
  const originalCreateObjectUrl = URL.createObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
  });

  it("partitions mixed Work document and image selections", () => {
    const imageFile = new File(["png"], "scan.png", { type: "image/png" });
    const officeFile = new File(["docx"], "proposal.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(partitionComposerAttachmentFiles([officeFile, imageFile])).toEqual({
      images: [imageFile],
      files: [officeFile],
    });
    expect(COMPOSER_ATTACHMENT_ACCEPT).toContain("image/*");
    expect(COMPOSER_ATTACHMENT_ACCEPT).toContain(".pdf");
    expect(COMPOSER_ATTACHMENT_ACCEPT).toContain(".docx");
    expect(COMPOSER_ATTACHMENT_ACCEPT).toContain(".xlsx");
    expect(COMPOSER_ATTACHMENT_ACCEPT).toContain(".pptx");
  });

  it("keeps image-specific unsupported-file errors while sharing cap handling", () => {
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const imageFile = new File(["png"], "screen.png", { type: "image/png" });

    const result = buildComposerImageAttachmentsFromFiles({
      files: [textFile, imageFile],
      existingAttachmentCount: 0,
    });

    expect(result.error).toBe(
      "Unsupported file type for 'notes.txt'. Please attach image files only.",
    );
    expect(result.images).toEqual([
      expect.objectContaining({
        type: "image",
        name: "screen.png",
        mimeType: "image/png",
        previewUrl: "blob:screen.png",
      }),
    ]);
  });

  it("builds generic file attachments and skips images without an error", () => {
    const imageFile = new File(["png"], "screen.png", { type: "image/png" });
    const unknownFile = new File(["data"], "payload.bin", { type: "" });

    const result = buildComposerFileAttachmentsFromFiles({
      files: [imageFile, unknownFile],
      existingAttachmentCount: 0,
    });

    expect(result.error).toBeNull();
    expect(result.files).toEqual([
      expect.objectContaining({
        type: "file",
        name: "payload.bin",
        mimeType: "application/octet-stream",
        sizeBytes: unknownFile.size,
        file: unknownFile,
      }),
    ]);
  });

  it("enforces the shared attachment count cap for generic files", () => {
    const result = buildComposerFileAttachmentsFromFiles({
      files: [new File(["data"], "notes.txt", { type: "text/plain" })],
      existingAttachmentCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
    });

    expect(result.files).toEqual([]);
    expect(result.error).toBe(
      `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
    );
  });

  it("streams Work files and images after the task exists", async () => {
    const imageFile = new File(["png"], "scan.png", { type: "image/png" });
    const officeFile = new File(["docx"], "proposal.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const upload = vi.fn(async ({ file, type }: { file: File; type: "file" | "image" }) => ({
      type,
      id: `uploaded-${file.name}`,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      contentHash: "a".repeat(64),
      uploadMethod: "stream" as const,
    }));

    const result = await buildUploadComposerAttachments({
      images: [
        {
          type: "image",
          id: "draft-image",
          name: imageFile.name,
          mimeType: imageFile.type,
          sizeBytes: imageFile.size,
          previewUrl: "blob:scan",
          file: imageFile,
        },
      ],
      files: [
        {
          type: "file",
          id: "draft-file",
          name: officeFile.name,
          mimeType: officeFile.type,
          sizeBytes: officeFile.size,
          file: officeFile,
        },
      ],
      assistantSelections: [],
      streaming: { threadId: "thread-1" as never, upload },
    });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ threadId: "thread-1", file: imageFile, type: "image" }),
    );
    expect(upload).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ threadId: "thread-1", file: officeFile, type: "file" }),
    );
    expect(result).toEqual([
      expect.objectContaining({ id: "uploaded-scan.png", uploadMethod: "stream" }),
      expect.objectContaining({ id: "uploaded-proposal.docx", uploadMethod: "stream" }),
    ]);
  });
});
