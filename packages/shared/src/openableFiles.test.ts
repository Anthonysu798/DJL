import { describe, expect, it } from "vitest";

import { isOpenableDocumentPath } from "./openableFiles";

describe("isOpenableDocumentPath", () => {
  it.each([
    "Outbox/Quarterly report.docx",
    "/Users/me/Budget.XLSX",
    "slides.pptx",
    "summary.pdf",
    "notes.md",
    "data.csv",
    "chart.png",
    "photo.JPG",
    "clip.mp4",
  ])("lets %s open in its own app", (path) => {
    expect(isOpenableDocumentPath(path)).toBe(true);
  });

  it.each([
    // Anything the system would run rather than display.
    "Invoice.pdf.command",
    "Setup.app",
    "run.sh",
    "tool.exe",
    "script.scpt",
    "shortcut.lnk",
    "page.html",
    "drawing.svg",
    "macro.docm",
    "archive.zip",
    "Makefile",
    ".pdf",
  ])("keeps %s to Show in folder", (path) => {
    expect(isOpenableDocumentPath(path)).toBe(false);
  });
});
