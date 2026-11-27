import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
} from "@djl/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildComposerFileAttachmentsFromFiles,
  buildComposerImageAttachmentsFromFiles,
  buildUploadComposerAttachments,
  COMPOSER_ATTACHMENT_ACCEPT,
  DATA_URL_FILE_MAX_BYTES,
  DATA_URL_IMAGE_MAX_BYTES,
  FILE_SIZE_LIMIT_LABEL,
  partitionComposerAttachmentFiles,
} from "./composerSend";

function fileOfSize(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

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

  it("keeps data URL attachment limits under the contract's data URL caps", () => {
    // Contract caps (packages/contracts/src/orchestration.ts) and the longest allowed MIME type.
    const header = `data:${"a".repeat(100)};base64,`.length;
    const dataUrlChars = (bytes: number) => header + 4 * Math.ceil(bytes / 3);

    expect(dataUrlChars(DATA_URL_IMAGE_MAX_BYTES)).toBeLessThanOrEqual(14_000_000);
    expect(dataUrlChars(DATA_URL_IMAGE_MAX_BYTES + 3)).toBeGreaterThan(14_000_000);
    expect(dataUrlChars(DATA_URL_FILE_MAX_BYTES)).toBeLessThanOrEqual(35_000_000);
    expect(dataUrlChars(DATA_URL_FILE_MAX_BYTES + 3)).toBeGreaterThan(35_000_000);
  });

  it("rejects images and files too large to send as data URLs at attach time", () => {
    const image = buildComposerImageAttachmentsFromFiles({
      files: [fileOfSize("huge.png", "image/png", DATA_URL_IMAGE_MAX_BYTES + 1)],
      existingAttachmentCount: 0,
    });
    expect(image.images).toEqual([]);
    expect(image.error).toBe("'huge.png' exceeds the 10MB attachment limit.");

    const file = buildComposerFileAttachmentsFromFiles({
      files: [fileOfSize("huge.pdf", "application/pdf", DATA_URL_FILE_MAX_BYTES + 1)],
      existingAttachmentCount: 0,
    });
    expect(file.files).toEqual([]);
    expect(file.error).toBe("'huge.pdf' exceeds the 25MB attachment limit.");
  });

  it("keeps the upload limit for streamed Studio attachments", () => {
    const image = buildComposerImageAttachmentsFromFiles({
      files: [fileOfSize("huge.png", "image/png", DATA_URL_IMAGE_MAX_BYTES + 1)],
      existingAttachmentCount: 0,
      streaming: true,
    });
    expect(image.error).toBeNull();
    expect(image.images).toHaveLength(1);

    const file = buildComposerFileAttachmentsFromFiles({
      files: [fileOfSize("huge.pdf", "application/pdf", PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1)],
      existingAttachmentCount: 0,
      streaming: true,
    });
    expect(file.files).toEqual([]);
    expect(file.error).toBe(`'huge.pdf' exceeds the ${FILE_SIZE_LIMIT_LABEL} attachment limit.`);
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
