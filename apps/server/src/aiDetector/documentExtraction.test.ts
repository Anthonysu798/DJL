import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { DocumentOcrRequiredError, extractDetectorDocument } from "../work/documentExtraction";

async function docxBytes(
  text: string,
  compression: "DEFLATE" | "STORE" = "DEFLATE",
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array", compression });
}

async function pdfBytes(text?: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  if (text) {
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x: 48, y: 720, size: 12, font });
  }
  return document.save();
}

async function multilinePdfBytes(lines: readonly string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [index, line] of lines.entries()) {
    page.drawText(line, { x: 48, y: 720 - index * 28, size: 12, font });
  }
  return document.save();
}

describe("AI detector document extraction", () => {
  it("honors cancellation before beginning document extraction", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      extractDetectorDocument({
        bytes: new TextEncoder().encode("Private text that must not be processed after cancel."),
        filename: "cancelled.txt",
        mediaType: "text/plain",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("extracts pasted text and TXT input without touching disk", async () => {
    const bytes = new TextEncoder().encode("A private English writing sample.");
    await expect(
      extractDetectorDocument({ bytes, filename: "sample.txt", mediaType: "text/plain" }),
    ).resolves.toMatchObject({
      kind: "text",
      text: "A private English writing sample.",
    });
  });

  it("rejects oversized extracted TXT instead of silently truncating it", async () => {
    const bytes = new TextEncoder().encode("A".repeat(500_001));
    await expect(
      extractDetectorDocument({ bytes, filename: "oversized.txt", mediaType: "text/plain" }),
    ).rejects.toMatchObject({ code: "archive_limit" });
  });

  it("rejects malformed UTF-8 instead of analyzing replacement characters", async () => {
    await expect(
      extractDetectorDocument({
        bytes: new Uint8Array([0xc3, 0x28]),
        filename: "malformed.txt",
        mediaType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "invalid_document" });
  });

  it("extracts DOCX paragraphs with bounded archive parsing", async () => {
    await expect(
      extractDetectorDocument({
        bytes: await docxBytes("Local DOCX prose"),
        filename: "sample.docx",
      }),
    ).resolves.toMatchObject({ kind: "docx", text: "Local DOCX prose" });
  });

  it("preserves spaces between DOCX text runs", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p></w:body></w:document>',
    );

    await expect(
      extractDetectorDocument({
        bytes: await zip.generateAsync({ type: "uint8array", compression: "STORE" }),
        filename: "runs.docx",
      }),
    ).resolves.toMatchObject({ text: "Hello world" });
  });

  it("preserves DOCX tabs and explicit line breaks", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      "<w:document><w:body><w:p><w:r><w:t>Column A</w:t><w:tab/><w:t>Column B</w:t><w:br/><w:t>Next line</w:t></w:r></w:p></w:body></w:document>",
    );

    await expect(
      extractDetectorDocument({
        bytes: await zip.generateAsync({ type: "uint8array", compression: "STORE" }),
        filename: "layout.docx",
      }),
    ).resolves.toMatchObject({ text: "Column A\tColumn B\nNext line" });
  });

  it("rejects invalid DOCX numeric character entities as a malformed document", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      "<w:document><w:body><w:p><w:r><w:t>Invalid &#99999999; entity</w:t></w:r></w:p></w:body></w:document>",
    );

    await expect(
      extractDetectorDocument({
        bytes: await zip.generateAsync({ type: "uint8array", compression: "STORE" }),
        filename: "invalid-entity.docx",
      }),
    ).rejects.toMatchObject({ code: "invalid_document" });
  });

  it("rejects an oversized DOCX paragraph instead of silently truncating it", async () => {
    await expect(
      extractDetectorDocument({
        bytes: await docxBytes("A".repeat(500_001), "STORE"),
        filename: "oversized.docx",
      }),
    ).rejects.toMatchObject({ code: "archive_limit" });
  });

  it("extracts text-based PDF and rejects image-only PDF with an OCR-required error", async () => {
    await expect(
      extractDetectorDocument({ bytes: await pdfBytes("Local PDF prose"), filename: "sample.pdf" }),
    ).resolves.toMatchObject({ kind: "pdf", text: expect.stringContaining("Local PDF prose") });

    await expect(
      extractDetectorDocument({ bytes: await pdfBytes(), filename: "scan.pdf" }),
    ).rejects.toBeInstanceOf(DocumentOcrRequiredError);
  });

  it("preserves PDF line boundaries needed for headings and exclusion routing", async () => {
    const first = "Document heading";
    const second = "This is a full prose sentence on the next visual line of the PDF document.";
    const extracted = await extractDetectorDocument({
      bytes: await multilinePdfBytes([first, second]),
      filename: "layout.pdf",
    });

    expect(extracted.text).toBe(`${first}\n${second}`);
  });

  it("rejects malformed and highly compressed Office archives", async () => {
    await expect(
      extractDetectorDocument({ bytes: new Uint8Array([1, 2, 3]), filename: "broken.docx" }),
    ).rejects.toMatchObject({ code: "invalid_archive" });
    await expect(
      extractDetectorDocument({
        bytes: await docxBytes("A".repeat(100_000)),
        filename: "bomb.docx",
      }),
    ).rejects.toMatchObject({ code: "archive_limit" });
  });

  it("rejects same-size Office entry corruption using the ZIP CRC", async () => {
    const bytes = Buffer.from(await docxBytes("Verified local DOCX prose", "STORE"));
    const proseOffset = bytes.indexOf("Verified local DOCX prose");
    expect(proseOffset).toBeGreaterThan(0);
    bytes[proseOffset] = bytes[proseOffset]! ^ 1;

    await expect(
      extractDetectorDocument({ bytes, filename: "corrupt.docx" }),
    ).rejects.toMatchObject({ code: "invalid_archive" });
  });
});
