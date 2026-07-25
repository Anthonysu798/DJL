import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";

import {
  comparePdfDeliverable,
  createOfficeDeliverable,
  mergePdfDeliverable,
  modifyOfficeDeliverable,
  redactPdfDeliverable,
  resolveAuthorizedInputPath,
  splitPdfDeliverable,
  WorkToolValidationError,
} from "./documentTools";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "djl-work-tools-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("documentTools", () => {
  it("creates versioned Word, Excel, PowerPoint, and PDF deliverables", async () => {
    const root = makeRoot();
    const docx = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "docx",
      name: "quarterly-report",
      title: "Quarterly Report",
      paragraphs: ["Revenue increased."],
    });
    const xlsx = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "xlsx",
      name: "quarterly-report",
      title: "Quarterly Report",
      rows: [
        ["Metric", "Value"],
        ["Revenue", 42],
        ["Unsafe", '=HYPERLINK("https://example.com")'],
      ],
    });
    const pptx = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "pptx",
      name: "quarterly-report",
      title: "Quarterly Report",
      slides: [{ title: "Summary", body: "Revenue increased." }],
    });
    const pdf = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "pdf",
      name: "quarterly-report",
      title: "Quarterly Report",
      paragraphs: ["Revenue increased."],
    });
    const docxV2 = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "docx",
      name: "quarterly-report",
      title: "Quarterly Report",
      paragraphs: ["Second version."],
    });

    expect(docx.path).toMatch(/quarterly-report-v1\.docx$/);
    expect(docxV2.path).toMatch(/quarterly-report-v2\.docx$/);
    expect(readFileSync(docx.path).subarray(0, 2).toString()).toBe("PK");
    expect(readFileSync(pptx.path).subarray(0, 2).toString()).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsx.path);
    expect(workbook.getWorksheet("Work Output")?.getCell("B2").value).toBe(42);
    expect(workbook.getWorksheet("Work Output")?.getCell("B3").value).toBe(
      '\'=HYPERLINK("https://example.com")',
    );
    expect((await PDFDocument.load(readFileSync(pdf.path))).getPageCount()).toBe(1);
  });

  it("publishes concurrent deliverables without overwriting another version", async () => {
    const root = makeRoot();
    const outputs = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createOfficeDeliverable({
          authorizedRoot: root,
          format: "pdf",
          name: "concurrent-report",
          title: `Concurrent report ${index + 1}`,
          paragraphs: [`Unique content ${index + 1}`],
        }),
      ),
    );

    expect(new Set(outputs.map((output) => output.path)).size).toBe(8);
    await Promise.all(
      outputs.map(async (output) => {
        expect((await PDFDocument.load(readFileSync(output.path))).getPageCount()).toBe(1);
      }),
    );
  });

  it("merges, splits, and securely rebuilds redacted PDFs", async () => {
    const root = makeRoot();
    const first = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "pdf",
      name: "first",
      title: "First",
      paragraphs: ["Customer secret-123"],
    });
    const second = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "pdf",
      name: "second",
      title: "Second",
      paragraphs: ["Public content"],
    });

    const merged = await mergePdfDeliverable({
      authorizedRoot: root,
      inputPaths: [first.path, second.path],
      name: "combined",
    });
    expect(merged.pageCount).toBe(2);
    expect((await PDFDocument.load(readFileSync(merged.path))).getPageCount()).toBe(2);

    const split = await splitPdfDeliverable({
      authorizedRoot: root,
      inputPath: merged.path,
      name: "combined",
      pages: [2],
    });
    expect(split.paths).toHaveLength(1);
    expect((await PDFDocument.load(readFileSync(split.paths[0]!))).getPageCount()).toBe(1);

    const redacted = await redactPdfDeliverable({
      authorizedRoot: root,
      inputPath: first.path,
      name: "first-redacted",
      searchTerms: ["secret-123"],
    });
    expect(redacted.mode).toBe("secure-rebuild");
    expect(readFileSync(redacted.path).includes(Buffer.from("secret-123"))).toBe(false);
  });

  it("creates versioned modified copies without overwriting Office originals", async () => {
    const root = makeRoot();
    const docx = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "docx",
      name: "brief",
      title: "Client Brief",
      paragraphs: ["The launch date is Monday."],
    });
    const xlsx = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "xlsx",
      name: "forecast",
      title: "Forecast",
      rows: [
        ["Metric", "Value"],
        ["Revenue", 42],
      ],
    });
    const pptx = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "pptx",
      name: "launch",
      title: "Launch",
      slides: [{ title: "Timeline", body: "Launch on Monday" }],
    });
    const originalDocx = readFileSync(docx.path);

    const modifiedDocx = await modifyOfficeDeliverable({
      authorizedRoot: root,
      inputPath: docx.path,
      name: "brief",
      replacements: [{ find: "Monday", replace: "Friday" }],
    });
    const modifiedXlsx = await modifyOfficeDeliverable({
      authorizedRoot: root,
      inputPath: xlsx.path,
      name: "forecast",
      cellUpdates: [
        { sheet: "Work Output", cell: "B2", value: 84 },
        { sheet: "Work Output", cell: "B3", formula: "SUM(B2, 16)" },
      ],
      appendRows: [{ sheet: "Work Output", rows: [["Margin", "=1+1"]] }],
    });
    const modifiedPptx = await modifyOfficeDeliverable({
      authorizedRoot: root,
      inputPath: pptx.path,
      name: "launch",
      replacements: [{ find: "Monday", replace: "Friday" }],
    });

    expect(modifiedDocx.path).toMatch(/brief-v2\.docx$/);
    expect(readFileSync(docx.path)).toEqual(originalDocx);
    const modifiedDocxZip = await JSZip.loadAsync(readFileSync(modifiedDocx.path));
    const modifiedPptxZip = await JSZip.loadAsync(readFileSync(modifiedPptx.path));
    expect(await modifiedDocxZip.file("word/document.xml")?.async("string")).toContain("Friday");
    expect(await modifiedPptxZip.file("ppt/slides/slide1.xml")?.async("string")).toContain(
      "Friday",
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(modifiedXlsx.path);
    const sheet = workbook.getWorksheet("Work Output");
    expect(sheet?.getCell("A1").font.bold).toBe(true);
    expect(sheet?.getCell("B2").value).toBe(84);
    expect(sheet?.getCell("B3").value).toMatchObject({ formula: "SUM(B2, 16)" });
    expect(sheet?.getCell("B4").value).toBe("'=1+1");
  });

  it("creates a cited PDF comparison report", async () => {
    const root = makeRoot();
    const before = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "pdf",
      name: "policy-before",
      title: "Policy",
      paragraphs: ["Retention is thirty days."],
    });
    const after = await createOfficeDeliverable({
      authorizedRoot: root,
      format: "pdf",
      name: "policy-after",
      title: "Policy",
      paragraphs: ["Retention is ninety days."],
    });

    const comparison = await comparePdfDeliverable({
      authorizedRoot: root,
      beforePath: before.path,
      afterPath: after.path,
      name: "policy-comparison",
    });

    expect(comparison.identical).toBe(false);
    expect(comparison.changedPages).toEqual([1]);
    expect((await PDFDocument.load(readFileSync(comparison.path))).getPageCount()).toBeGreaterThan(
      0,
    );
  });

  it("rejects traversal and symlink escapes independently", async () => {
    const root = makeRoot();
    const outside = makeRoot();
    mkdirSync(path.join(outside, "nested"));
    symlinkSync(path.join(outside, "nested"), path.join(root, "escape"));

    await expect(resolveAuthorizedInputPath(root, "../outside.txt")).rejects.toBeInstanceOf(
      WorkToolValidationError,
    );
    await expect(resolveAuthorizedInputPath(root, "escape/file.pdf")).rejects.toBeInstanceOf(
      WorkToolValidationError,
    );
  });
});
