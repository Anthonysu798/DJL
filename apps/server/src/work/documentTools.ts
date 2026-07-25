// FILE: documentTools.ts
// Purpose: Versioned Office/PDF deliverables with task-root confinement and atomic publication.

import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

import { validateOfficeArchive } from "./documentExtraction.ts";

const MAX_PDF_INPUTS = 50;
const MAX_PDF_PAGES = 1_000;
const MAX_CREATE_ROWS = 10_000;
const MAX_CREATE_SLIDES = 500;
const MAX_OFFICE_REPLACEMENTS = 100;
const MAX_OFFICE_CELL_UPDATES = 10_000;

export class WorkToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkToolValidationError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function rejectSymlinkComponents(root: string, candidate: string): Promise<void> {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new WorkToolValidationError("Symbolic links are not allowed in Work tool paths.");
    }
  }
}

export async function resolveAuthorizedInputPath(
  authorizedRoot: string,
  requestedPath: string,
  authorizedInputFiles: ReadonlyArray<string> = [],
): Promise<string> {
  const root = await realpath(authorizedRoot);
  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(root, requestedPath);
  if (isInside(root, candidate)) {
    await rejectSymlinkComponents(root, candidate);
    const canonical = await realpath(candidate);
    if (!isInside(root, canonical)) {
      throw new WorkToolValidationError("The requested file escapes this task's authorized root.");
    }
    return canonical;
  }
  if (!path.isAbsolute(requestedPath)) {
    throw new WorkToolValidationError("The requested file is outside this task's authorized root.");
  }
  const candidateInfo = await lstat(candidate).catch(() => null);
  if (!candidateInfo?.isFile() || candidateInfo.isSymbolicLink()) {
    throw new WorkToolValidationError("The requested input is not a safe regular file.");
  }
  const canonical = await realpath(candidate);
  for (const allowedFile of authorizedInputFiles) {
    const allowedInfo = await lstat(allowedFile).catch(() => null);
    if (!allowedInfo?.isFile() || allowedInfo.isSymbolicLink()) continue;
    if (canonical === (await realpath(allowedFile))) return canonical;
  }
  throw new WorkToolValidationError("The requested file is outside this task's authorized inputs.");
}

function safeBaseName(value: string): string {
  const safe = value
    .normalize("NFKC")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safe || "deliverable";
}

async function nextVersionedOutputPath(input: {
  readonly authorizedRoot: string;
  readonly requestedName: string;
  readonly extension: string;
}): Promise<string> {
  const root = await realpath(input.authorizedRoot);
  const deliverablesDir = path.join(root, "Deliverables");
  try {
    const existing = await lstat(deliverablesDir);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new WorkToolValidationError("The task Deliverables path is not a safe directory.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await mkdir(deliverablesDir, { recursive: false });
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
      const existing = await lstat(deliverablesDir);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new WorkToolValidationError("The task Deliverables path is not a safe directory.");
      }
    }
  }
  await rejectSymlinkComponents(root, deliverablesDir);
  const extension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;
  const requestedWithoutExtension = input.requestedName
    .toLowerCase()
    .endsWith(extension.toLowerCase())
    ? input.requestedName.slice(0, -extension.length)
    : input.requestedName;
  const base = safeBaseName(requestedWithoutExtension);
  for (let version = 1; version <= 10_000; version += 1) {
    const candidate = path.join(deliverablesDir, `${base}-v${version}${extension}`);
    try {
      await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new WorkToolValidationError("No deliverable version is available.");
}

function nextCollisionPath(outputPath: string): string {
  const extension = path.extname(outputPath);
  const withoutExtension = outputPath.slice(0, -extension.length);
  const match = /^(.*)-v([1-9][0-9]*)$/.exec(withoutExtension);
  if (!match) {
    throw new WorkToolValidationError("The deliverable path is not versioned.");
  }
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version) || version >= 10_000) {
    throw new WorkToolValidationError("No deliverable version is available.");
  }
  return `${match[1]}-v${version + 1}${extension}`;
}

async function publishAtomic(outputPath: string, bytes: Uint8Array): Promise<string> {
  const tempPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, bytes, { flag: "wx", mode: 0o600 });
    let candidate = outputPath;
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      try {
        // A hard link is an atomic, no-overwrite publication on the same filesystem.
        // Concurrent tool calls therefore get distinct versions instead of clobbering files.
        await link(tempPath, candidate);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        candidate = nextCollisionPath(candidate);
      }
    }
    throw new WorkToolValidationError("No deliverable version is available.");
  } finally {
    await rm(tempPath, { force: true });
  }
}

function wrapPdfLine(text: string, maxChars = 88): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

async function createPdfBytes(title: string, paragraphs: readonly string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 744;
  page.drawText(title.slice(0, 180), {
    x: 54,
    y,
    size: 18,
    font: bold,
    color: rgb(0.08, 0.1, 0.14),
  });
  y -= 32;
  for (const paragraph of paragraphs) {
    for (const line of wrapPdfLine(paragraph)) {
      if (y < 54) {
        page = pdf.addPage([612, 792]);
        y = 744;
      }
      page.drawText(line, { x: 54, y, size: 10.5, font, color: rgb(0.08, 0.1, 0.14) });
      y -= 15;
    }
    y -= 9;
  }
  pdf.setTitle(title);
  pdf.setCreator("DJL Work");
  return pdf.save({ useObjectStreams: false });
}

function safeSpreadsheetValue(value: unknown): string | number | boolean | Date | null {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  ) {
    return value;
  }
  const text = String(value ?? "");
  // Keep untrusted data as literal text rather than a formula when the file is opened.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export type OfficeDeliverableFormat = "docx" | "xlsx" | "pptx" | "pdf";

export interface OfficeTextReplacement {
  readonly find: string;
  readonly replace: string;
  readonly caseSensitive?: boolean;
}

export interface OfficeCellUpdate {
  readonly sheet: string;
  readonly cell: string;
  readonly value?: unknown;
  readonly formula?: string;
}

export interface OfficeRowsAppend {
  readonly sheet: string;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

export async function createOfficeDeliverable(input: {
  readonly authorizedRoot: string;
  readonly format: OfficeDeliverableFormat;
  readonly name: string;
  readonly title: string;
  readonly paragraphs?: ReadonlyArray<string>;
  readonly rows?: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly slides?: ReadonlyArray<{ readonly title: string; readonly body: string }>;
}): Promise<{ readonly path: string; readonly format: OfficeDeliverableFormat }> {
  const outputPath = await nextVersionedOutputPath({
    authorizedRoot: input.authorizedRoot,
    requestedName: input.name,
    extension: input.format,
  });
  const paragraphs = input.paragraphs ?? [];
  let bytes: Uint8Array;
  switch (input.format) {
    case "docx": {
      const document = new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: input.title, heading: HeadingLevel.TITLE }),
              ...paragraphs.map(
                (text) =>
                  new Paragraph({ children: [new TextRun({ text: text.slice(0, 100_000) })] }),
              ),
            ],
          },
        ],
        creator: "DJL Work",
        title: input.title,
      });
      bytes = await Packer.toBuffer(document);
      break;
    }
    case "xlsx": {
      const rows = input.rows ?? [];
      if (rows.length > MAX_CREATE_ROWS) {
        throw new WorkToolValidationError(`Spreadsheets are limited to ${MAX_CREATE_ROWS} rows.`);
      }
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "DJL Work";
      const sheet = workbook.addWorksheet("Work Output");
      for (const row of rows) sheet.addRow(row.map(safeSpreadsheetValue));
      if (rows.length > 0) {
        const header = sheet.getRow(1);
        header.font = { bold: true };
        header.alignment = { vertical: "middle" };
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        for (
          let columnIndex = 1;
          columnIndex <= Math.max(...rows.map((row) => row.length));
          columnIndex += 1
        ) {
          const column = sheet.getColumn(columnIndex);
          column.width = Math.min(
            60,
            Math.max(12, ...column.values.map((value) => String(value ?? "").length + 2)),
          );
        }
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: rows[0]?.length ?? 1 },
        };
      }
      bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
      break;
    }
    case "pptx": {
      const slides = input.slides ?? [{ title: input.title, body: paragraphs.join("\n\n") }];
      if (slides.length > MAX_CREATE_SLIDES) {
        throw new WorkToolValidationError(
          `Presentations are limited to ${MAX_CREATE_SLIDES} slides.`,
        );
      }
      const presentation = new PptxGenJS();
      presentation.author = "DJL Work";
      presentation.subject = input.title;
      presentation.title = input.title;
      presentation.layout = "LAYOUT_WIDE";
      presentation.theme = {
        headFontFace: "Aptos Display",
        bodyFontFace: "Aptos",
      };
      for (const source of slides) {
        const slide = presentation.addSlide();
        slide.background = { color: "F7F8FA" };
        slide.addText(source.title.slice(0, 240), {
          x: 0.7,
          y: 0.55,
          w: 11.8,
          h: 0.7,
          fontSize: 26,
          bold: true,
          color: "18202A",
          margin: 0,
        });
        slide.addText(source.body.slice(0, 20_000), {
          x: 0.72,
          y: 1.55,
          w: 11.6,
          h: 5.2,
          fontSize: 16,
          color: "303A46",
          valign: "top",
          breakLine: false,
          margin: 0.04,
        });
      }
      bytes = (await presentation.write({ outputType: "uint8array" })) as Uint8Array;
      break;
    }
    case "pdf":
      bytes = await createPdfBytes(input.title, paragraphs);
      break;
  }
  const publishedPath = await publishAtomic(outputPath, bytes);
  return { path: publishedPath, format: input.format };
}

function decodeOfficeXml(value: string): string {
  return value
    .replace(/&#(x?[0-9a-f]+);/gi, (_match, raw: string) => {
      const radix = raw.toLowerCase().startsWith("x") ? 16 : 10;
      const digits = radix === 16 ? raw.slice(1) : raw;
      const codePoint = Number.parseInt(digits, radix);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    })
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function encodeOfficeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function replaceLiteral(
  value: string,
  replacement: OfficeTextReplacement,
): { readonly text: string; readonly count: number } {
  if (replacement.caseSensitive) {
    const pieces = value.split(replacement.find);
    return { text: pieces.join(replacement.replace), count: pieces.length - 1 };
  }
  const pattern = new RegExp(replacement.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let count = 0;
  return {
    text: value.replace(pattern, () => {
      count += 1;
      return replacement.replace;
    }),
    count,
  };
}

function updateParagraphText(
  paragraphXml: string,
  textTag: "w:t" | "a:t",
  replacements: ReadonlyArray<OfficeTextReplacement>,
  replacementCounts: number[],
): string {
  const textNodePattern = new RegExp(
    `(<${textTag}(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/${textTag}>)`,
    "gi",
  );
  const matches = [...paragraphXml.matchAll(textNodePattern)];
  if (matches.length === 0) return paragraphXml;
  const originalSegments = matches.map((match) => decodeOfficeXml(match[2] ?? ""));
  let updated = originalSegments.join("");
  let changed = false;
  for (let index = 0; index < replacements.length; index += 1) {
    const result = replaceLiteral(updated, replacements[index]!);
    if (result.count > 0) {
      replacementCounts[index] = (replacementCounts[index] ?? 0) + result.count;
      updated = result.text;
      changed = true;
    }
  }
  if (!changed) return paragraphXml;

  let offset = 0;
  const redistributed = originalSegments.map((segment, index) => {
    if (index === originalSegments.length - 1) return updated.slice(offset);
    const next = updated.slice(offset, offset + segment.length);
    offset += segment.length;
    return next;
  });
  let nodeIndex = 0;
  return paragraphXml.replace(
    textNodePattern,
    (_match, open: string, _body: string, close: string) => {
      const value = redistributed[nodeIndex] ?? "";
      nodeIndex += 1;
      return `${open}${encodeOfficeXml(value)}${close}`;
    },
  );
}

function applyOfficeTextReplacements(input: {
  readonly xml: string;
  readonly paragraphTag: "w:p" | "a:p";
  readonly textTag: "w:t" | "a:t";
  readonly replacements: ReadonlyArray<OfficeTextReplacement>;
  readonly replacementCounts: number[];
}): string {
  const paragraphPattern = new RegExp(
    `<${input.paragraphTag}\\b[\\s\\S]*?<\\/${input.paragraphTag}>`,
    "gi",
  );
  return input.xml.replace(paragraphPattern, (paragraph) =>
    updateParagraphText(paragraph, input.textTag, input.replacements, input.replacementCounts),
  );
}

async function removeExternalOfficeRelationships(zip: JSZip): Promise<number> {
  let removed = 0;
  const externalRelationship =
    /<Relationship\b(?=[^>]*\bTargetMode\s*=\s*["']External["'])[^>]*\/>/gi;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.toLowerCase().endsWith(".rels")) continue;
    const xml = await entry.async("string");
    const sanitized = xml.replace(externalRelationship, () => {
      removed += 1;
      return "";
    });
    if (sanitized !== xml) zip.file(name, sanitized);
  }
  return removed;
}

function validateTextReplacements(
  replacements: ReadonlyArray<OfficeTextReplacement> | undefined,
): ReadonlyArray<OfficeTextReplacement> {
  const values = replacements ?? [];
  if (values.length > MAX_OFFICE_REPLACEMENTS) {
    throw new WorkToolValidationError(
      `Office modifications are limited to ${MAX_OFFICE_REPLACEMENTS} replacements.`,
    );
  }
  for (const replacement of values) {
    if (
      replacement.find.length === 0 ||
      replacement.find.length > 10_000 ||
      replacement.replace.length > 100_000
    ) {
      throw new WorkToolValidationError("Office text replacements exceed safe limits.");
    }
  }
  return values;
}

function safeFormula(rawFormula: string): string {
  const formula = rawFormula.trim().replace(/^=/, "");
  if (
    formula.length === 0 ||
    formula.length > 8_192 ||
    /(?:https?:|file:|mhtml:|\\\\|\||\[[^\]]+\]|\b(?:WEBSERVICE|HYPERLINK|RTD|CALL|EXEC|IMPORTXML|FILTERXML)\s*\()/i.test(
      formula,
    )
  ) {
    throw new WorkToolValidationError(
      "Spreadsheet formulas cannot use external workbooks, network functions, or executable links.",
    );
  }
  return formula;
}

/**
 * Creates a versioned copy while preserving the source package. DOCX/PPTX
 * support bounded text replacement; XLSX supports bounded cell and row edits.
 * The source is never overwritten, and external Office relationships are
 * removed before publication.
 */
export async function modifyOfficeDeliverable(input: {
  readonly authorizedRoot: string;
  readonly authorizedInputFiles?: ReadonlyArray<string>;
  readonly inputPath: string;
  readonly name: string;
  readonly replacements?: ReadonlyArray<OfficeTextReplacement>;
  readonly cellUpdates?: ReadonlyArray<OfficeCellUpdate>;
  readonly appendRows?: ReadonlyArray<OfficeRowsAppend>;
}): Promise<{
  readonly path: string;
  readonly format: Exclude<OfficeDeliverableFormat, "pdf">;
  readonly replacementsApplied: number;
  readonly externalRelationshipsRemoved: number;
}> {
  const inputPath = await resolveAuthorizedInputPath(
    input.authorizedRoot,
    input.inputPath,
    input.authorizedInputFiles,
  );
  const extension = path.extname(inputPath).toLowerCase();
  if (extension !== ".docx" && extension !== ".xlsx" && extension !== ".pptx") {
    throw new WorkToolValidationError("Only DOCX, XLSX, and PPTX files can be modified.");
  }
  const sourceBytes = new Uint8Array(await readFile(inputPath));
  validateOfficeArchive(sourceBytes);
  const zip = await JSZip.loadAsync(sourceBytes, { checkCRC32: true });
  const externalRelationshipsRemoved = await removeExternalOfficeRelationships(zip);
  const replacements = validateTextReplacements(input.replacements);
  const replacementCounts = replacements.map(() => 0);
  let outputBytes: Uint8Array;

  if (extension === ".xlsx") {
    if (replacements.length > 0) {
      throw new WorkToolValidationError(
        "Use explicit cell updates for spreadsheets instead of global text replacement.",
      );
    }
    const sanitizedSource = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(sanitizedSource) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const cellUpdates = input.cellUpdates ?? [];
    const appendRows = input.appendRows ?? [];
    const appendedRowCount = appendRows.reduce((total, entry) => total + entry.rows.length, 0);
    if (cellUpdates.length + appendedRowCount > MAX_OFFICE_CELL_UPDATES) {
      throw new WorkToolValidationError(
        `Spreadsheet modifications are limited to ${MAX_OFFICE_CELL_UPDATES} cells or rows.`,
      );
    }
    for (const update of cellUpdates) {
      const sheet = workbook.getWorksheet(update.sheet);
      if (!sheet)
        throw new WorkToolValidationError(`Spreadsheet sheet '${update.sheet}' was not found.`);
      if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/i.test(update.cell)) {
        throw new WorkToolValidationError(`Spreadsheet cell '${update.cell}' is invalid.`);
      }
      const hasFormula = typeof update.formula === "string";
      const hasValue = Object.hasOwn(update, "value");
      if (hasFormula === hasValue) {
        throw new WorkToolValidationError(
          `Cell '${update.cell}' must provide exactly one of value or formula.`,
        );
      }
      sheet.getCell(update.cell).value = hasFormula
        ? { formula: safeFormula(update.formula!) }
        : safeSpreadsheetValue(update.value);
    }
    for (const append of appendRows) {
      const sheet = workbook.getWorksheet(append.sheet);
      if (!sheet)
        throw new WorkToolValidationError(`Spreadsheet sheet '${append.sheet}' was not found.`);
      for (const row of append.rows) sheet.addRow(row.map(safeSpreadsheetValue));
    }
    workbook.creator = "DJL Work";
    workbook.modified = new Date();
    outputBytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  } else {
    if ((input.cellUpdates?.length ?? 0) > 0 || (input.appendRows?.length ?? 0) > 0) {
      throw new WorkToolValidationError("Cell and row edits are supported only for XLSX files.");
    }
    if (replacements.length === 0) {
      throw new WorkToolValidationError("Provide at least one text replacement.");
    }
    const partPattern =
      extension === ".docx"
        ? /^word\/(?:document|header\d+|footer\d+)\.xml$/i
        : /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !partPattern.test(name)) continue;
      const xml = await entry.async("string");
      zip.file(
        name,
        applyOfficeTextReplacements({
          xml,
          paragraphTag: extension === ".docx" ? "w:p" : "a:p",
          textTag: extension === ".docx" ? "w:t" : "a:t",
          replacements,
          replacementCounts,
        }),
      );
    }
    const missing = replacements.filter(
      (_replacement, index) => (replacementCounts[index] ?? 0) === 0,
    );
    if (missing.length > 0) {
      throw new WorkToolValidationError(
        `Text to replace was not found: ${missing.map((entry) => JSON.stringify(entry.find)).join(", ")}.`,
      );
    }
    outputBytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  validateOfficeArchive(outputBytes);
  const outputPath = await nextVersionedOutputPath({
    authorizedRoot: input.authorizedRoot,
    requestedName: input.name,
    extension,
  });
  const publishedPath = await publishAtomic(outputPath, outputBytes);
  return {
    path: publishedPath,
    format: extension.slice(1) as Exclude<OfficeDeliverableFormat, "pdf">,
    replacementsApplied: replacementCounts.reduce((total, count) => total + count, 0),
    externalRelationshipsRemoved,
  };
}

async function loadPdfWithinRoot(
  root: string,
  requestedPath: string,
  authorizedInputFiles?: ReadonlyArray<string>,
): Promise<PDFDocument> {
  const inputPath = await resolveAuthorizedInputPath(root, requestedPath, authorizedInputFiles);
  if (path.extname(inputPath).toLowerCase() !== ".pdf") {
    throw new WorkToolValidationError("Only PDF inputs are accepted for this operation.");
  }
  return PDFDocument.load(await readFile(inputPath), {
    ignoreEncryption: false,
    throwOnInvalidObject: true,
    updateMetadata: false,
  });
}

export async function mergePdfDeliverable(input: {
  readonly authorizedRoot: string;
  readonly authorizedInputFiles?: ReadonlyArray<string>;
  readonly inputPaths: ReadonlyArray<string>;
  readonly name: string;
}): Promise<{ readonly path: string; readonly pageCount: number }> {
  if (input.inputPaths.length < 2 || input.inputPaths.length > MAX_PDF_INPUTS) {
    throw new WorkToolValidationError(`PDF merge accepts 2 to ${MAX_PDF_INPUTS} files.`);
  }
  const output = await PDFDocument.create();
  let pageCount = 0;
  for (const requestedPath of input.inputPaths) {
    const source = await loadPdfWithinRoot(
      input.authorizedRoot,
      requestedPath,
      input.authorizedInputFiles,
    );
    pageCount += source.getPageCount();
    if (pageCount > MAX_PDF_PAGES) {
      throw new WorkToolValidationError(`Merged PDFs are limited to ${MAX_PDF_PAGES} pages.`);
    }
    const pages = await output.copyPages(source, source.getPageIndices());
    for (const page of pages) output.addPage(page);
  }
  output.setCreator("DJL Work");
  const outputPath = await nextVersionedOutputPath({
    authorizedRoot: input.authorizedRoot,
    requestedName: input.name,
    extension: ".pdf",
  });
  const publishedPath = await publishAtomic(
    outputPath,
    await output.save({ useObjectStreams: false }),
  );
  return { path: publishedPath, pageCount };
}

export async function splitPdfDeliverable(input: {
  readonly authorizedRoot: string;
  readonly authorizedInputFiles?: ReadonlyArray<string>;
  readonly inputPath: string;
  readonly name: string;
  readonly pages?: ReadonlyArray<number>;
}): Promise<{ readonly paths: string[] }> {
  const source = await loadPdfWithinRoot(
    input.authorizedRoot,
    input.inputPath,
    input.authorizedInputFiles,
  );
  const selected = input.pages ?? source.getPageIndices().map((index) => index + 1);
  const unique = [...new Set(selected)];
  if (
    unique.length === 0 ||
    unique.length > MAX_PDF_PAGES ||
    unique.some((page) => !Number.isInteger(page) || page < 1 || page > source.getPageCount())
  ) {
    throw new WorkToolValidationError("The requested PDF page selection is invalid.");
  }
  const paths: string[] = [];
  for (const pageNumber of unique) {
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(source, [pageNumber - 1]);
    if (page) output.addPage(page);
    const outputPath = await nextVersionedOutputPath({
      authorizedRoot: input.authorizedRoot,
      requestedName: `${input.name}-page-${pageNumber}`,
      extension: ".pdf",
    });
    const publishedPath = await publishAtomic(
      outputPath,
      await output.save({ useObjectStreams: false }),
    );
    paths.push(publishedPath);
  }
  return { paths };
}

async function extractPdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // PDF.js transfers its input buffer to the worker and may detach it. Pass a
  // private copy so validation cannot invalidate bytes awaiting publication.
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const document = await task.promise;
  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new WorkToolValidationError(`PDFs are limited to ${MAX_PDF_PAGES} pages.`);
    }
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
          .filter(Boolean)
          .join(" "),
      );
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

export async function comparePdfDeliverable(input: {
  readonly authorizedRoot: string;
  readonly authorizedInputFiles?: ReadonlyArray<string>;
  readonly beforePath: string;
  readonly afterPath: string;
  readonly name: string;
}): Promise<{
  readonly path: string;
  readonly identical: boolean;
  readonly changedPages: number[];
}> {
  const beforePath = await resolveAuthorizedInputPath(
    input.authorizedRoot,
    input.beforePath,
    input.authorizedInputFiles,
  );
  const afterPath = await resolveAuthorizedInputPath(
    input.authorizedRoot,
    input.afterPath,
    input.authorizedInputFiles,
  );
  if (
    path.extname(beforePath).toLowerCase() !== ".pdf" ||
    path.extname(afterPath).toLowerCase() !== ".pdf"
  ) {
    throw new WorkToolValidationError("PDF comparison accepts only PDF inputs.");
  }
  const [beforePages, afterPages] = await Promise.all([
    extractPdfPageTexts(new Uint8Array(await readFile(beforePath))),
    extractPdfPageTexts(new Uint8Array(await readFile(afterPath))),
  ]);
  const pageCount = Math.max(beforePages.length, afterPages.length);
  const changedPages: number[] = [];
  const report: string[] = [
    `Before: ${path.basename(beforePath)}`,
    `After: ${path.basename(afterPath)}`,
  ];
  for (let index = 0; index < pageCount; index += 1) {
    const before = (beforePages[index] ?? "").replace(/\s+/g, " ").trim();
    const after = (afterPages[index] ?? "").replace(/\s+/g, " ").trim();
    if (before === after) continue;
    const pageNumber = index + 1;
    changedPages.push(pageNumber);
    report.push(
      `Page ${pageNumber} changed. [Source: ${path.basename(beforePath)}, page ${pageNumber}] Before: ${before.slice(0, 2_000) || "(missing page)"}`,
      `[Source: ${path.basename(afterPath)}, page ${pageNumber}] After: ${after.slice(0, 2_000) || "(missing page)"}`,
    );
  }
  if (changedPages.length === 0) report.push("No extracted-text differences were found.");
  const outputPath = await nextVersionedOutputPath({
    authorizedRoot: input.authorizedRoot,
    requestedName: input.name,
    extension: ".pdf",
  });
  const publishedPath = await publishAtomic(
    outputPath,
    await createPdfBytes("DJL Work PDF comparison", report),
  );
  return { path: publishedPath, identical: changedPages.length === 0, changedPages };
}

function redactLiteral(text: string, term: string): string {
  if (!term) return text;
  return text.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[REDACTED]");
}

export async function redactPdfDeliverable(input: {
  readonly authorizedRoot: string;
  readonly authorizedInputFiles?: ReadonlyArray<string>;
  readonly inputPath: string;
  readonly name: string;
  readonly searchTerms: ReadonlyArray<string>;
}): Promise<{
  readonly path: string;
  readonly pageCount: number;
  readonly mode: "secure-rebuild";
}> {
  const terms = input.searchTerms.map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0 || terms.length > 100) {
    throw new WorkToolValidationError("Provide between 1 and 100 redaction terms.");
  }
  const inputPath = await resolveAuthorizedInputPath(
    input.authorizedRoot,
    input.inputPath,
    input.authorizedInputFiles,
  );
  const originalBytes = new Uint8Array(await readFile(inputPath));
  const pageTexts = await extractPdfPageTexts(originalBytes);
  const redactedPages = pageTexts.map((pageText) =>
    terms.reduce((text, term) => redactLiteral(text, term), pageText),
  );
  // Rebuild from extracted text. This intentionally trades layout fidelity for
  // verifiable removal instead of drawing cosmetic rectangles over source text.
  const rebuilt = await createPdfBytes("Redacted copy", redactedPages);
  const validationText = (await extractPdfPageTexts(rebuilt)).join("\n").toLowerCase();
  for (const term of terms) {
    if (validationText.includes(term.toLowerCase())) {
      throw new WorkToolValidationError(`Redaction validation failed for '${term}'.`);
    }
  }
  const outputPath = await nextVersionedOutputPath({
    authorizedRoot: input.authorizedRoot,
    requestedName: input.name,
    extension: ".pdf",
  });
  const publishedPath = await publishAtomic(outputPath, rebuilt);
  return { path: publishedPath, pageCount: redactedPages.length, mode: "secure-rebuild" };
}
