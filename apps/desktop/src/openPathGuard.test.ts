import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveOpenableDocument } from "./openPathGuard";

describe("resolveOpenableDocument", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "djl-open-path-")));
  const file = (name: string) => {
    const path = join(dir, name);
    writeFileSync(path, "content");
    return path;
  };

  it("returns the real path of a document, including through a link to one", async () => {
    const report = file("report.docx");
    expect(await resolveOpenableDocument(report)).toBe(report);
    const link = join(dir, "latest.docx");
    symlinkSync(report, link);
    expect(await resolveOpenableDocument(link)).toBe(report);
  });

  it("refuses a file the system would run", async () => {
    expect(await resolveOpenableDocument(file("setup.command"))).toBeNull();
  });

  it("refuses a link named like a document that points at something runnable", async () => {
    const script = file("payload.sh");
    const disguised = join(dir, "invoice.pdf");
    symlinkSync(script, disguised);
    expect(await resolveOpenableDocument(disguised)).toBeNull();
  });

  it("refuses a folder named like a document", async () => {
    const folder = join(dir, "bundle.pdf");
    mkdirSync(folder);
    expect(await resolveOpenableDocument(folder)).toBeNull();
  });

  it("refuses a path that does not exist", async () => {
    expect(await resolveOpenableDocument(join(dir, "missing.pdf"))).toBeNull();
  });
});
