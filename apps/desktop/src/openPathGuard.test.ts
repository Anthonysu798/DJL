import * as FS from "node:fs";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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

  it("refuses a document that was swapped for a link after its path was resolved", async () => {
    const script = file("swap-payload.sh");
    const swapped = join(dir, "swapped.pdf");
    symlinkSync(script, swapped);
    // The agent can replace the file between the two checks; simulate the first one having
    // seen a real file at this path.
    const realpath = vi.spyOn(FS.promises, "realpath").mockResolvedValueOnce(swapped);
    try {
      expect(await resolveOpenableDocument(swapped)).toBeNull();
    } finally {
      realpath.mockRestore();
    }
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
