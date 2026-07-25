import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DocumentRenderManager,
  DocumentRendererError,
  type LibreOfficeCommandRunner,
} from "./documentRenderer";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = path.join(
    process.cwd(),
    ".tmp-document-renderer-tests",
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

async function pdfBytes(pageCount = 2): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([612, 792]).drawText(`Page ${index + 1}`);
  }
  return document.save();
}

async function docxBytes(input?: { externalRelationship?: boolean; macro?: boolean }) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Hello DJL</w:t></w:r></w:p></w:body></w:document>',
  );
  zip.file(
    "word/_rels/document.xml.rels",
    input?.externalRelationship
      ? '<Relationships><Relationship Id="rId1" Target="https://example.com/pixel" TargetMode="External"/></Relationships>'
      : "<Relationships/>",
  );
  if (input?.macro) zip.file("word/vbaProject.bin", "not-a-real-macro");
  return zip.generateAsync({ type: "uint8array" });
}

async function waitUntilReady(manager: DocumentRenderManager, threadId: string, renderId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await manager.getRender({ threadId: threadId as never, renderId });
    if (result.state === "ready" || result.state === "failed") return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("render did not finish");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DocumentRenderManager", () => {
  it("registers a native PDF without invoking LibreOffice", async () => {
    const root = await temporaryRoot();
    const sourcePath = path.join(root, "source.pdf");
    await writeFile(sourcePath, await pdfBytes(3));
    const runCommand = vi.fn<LibreOfficeCommandRunner>();
    const manager = new DocumentRenderManager({
      stateRoot: path.join(root, "state"),
      renderer: async () => ({ binaryPath: "/unused/soffice", version: "test-1" }),
      runCommand,
    });

    const requested = await manager.requestRender({
      threadId: "thread-1" as never,
      filePath: sourcePath,
    });
    const result = await waitUntilReady(manager, "thread-1", requested.renderId);

    expect(result.state).toBe("ready");
    expect(result.preview?.pageCount).toBe(3);
    expect(result.preview?.sourceType).toBe("pdf");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("sanitizes external Office relationships before conversion", async () => {
    const root = await temporaryRoot();
    const sourcePath = path.join(root, "source.docx");
    await writeFile(sourcePath, await docxBytes({ externalRelationship: true }));
    let convertedInput = "";
    const runCommand: LibreOfficeCommandRunner = async (_binary, args) => {
      const inputPath = args.at(-1)!;
      const sanitized = await JSZip.loadAsync(await readFile(inputPath));
      convertedInput = await sanitized.file("word/_rels/document.xml.rels")!.async("text");
      const outputDir = args[args.indexOf("--outdir") + 1]!;
      await writeFile(path.join(outputDir, `${path.parse(inputPath).name}.pdf`), await pdfBytes(2));
      return { code: 0, stdout: "", stderr: "" };
    };
    const manager = new DocumentRenderManager({
      stateRoot: path.join(root, "state"),
      renderer: async () => ({ binaryPath: "/test/soffice", version: "test-1" }),
      runCommand,
    });

    const requested = await manager.requestRender({
      threadId: "thread-1" as never,
      filePath: sourcePath,
    });
    const result = await waitUntilReady(manager, "thread-1", requested.renderId);

    expect(result.state).toBe("ready");
    expect(convertedInput).not.toContain('TargetMode="External"');
    expect(result.preview?.warnings).toContain(
      "External Office relationships were removed before rendering.",
    );
  });

  it("reuses cached conversion output and restores metadata after restart", async () => {
    const root = await temporaryRoot();
    const sourcePath = path.join(root, "deck.pptx");
    await writeFile(sourcePath, await docxBytes());
    const runCommand = vi.fn<LibreOfficeCommandRunner>(async (_binary, args) => {
      const inputPath = args.at(-1)!;
      const outputDir = args[args.indexOf("--outdir") + 1]!;
      await writeFile(path.join(outputDir, `${path.parse(inputPath).name}.pdf`), await pdfBytes(4));
      return { code: 0, stdout: "", stderr: "" };
    });
    const options = {
      stateRoot: path.join(root, "state"),
      renderer: async () => ({ binaryPath: "/test/soffice", version: "test-1" }),
      runCommand,
    };
    const first = new DocumentRenderManager(options);
    const requested = await first.requestRender({
      threadId: "thread-1" as never,
      filePath: sourcePath,
    });
    const result = await waitUntilReady(first, "thread-1", requested.renderId);
    expect(result.preview?.presentationMode).toBe("slides");

    const restarted = new DocumentRenderManager(options);
    const restored = await restarted.getRender({
      threadId: "thread-1" as never,
      renderId: requested.renderId,
    });
    expect(restored.state).toBe("ready");

    const secondRequest = await restarted.requestRender({
      threadId: "thread-2" as never,
      filePath: sourcePath,
    });
    const second = await waitUntilReady(restarted, "thread-2", secondRequest.renderId);
    expect(second.preview?.pageCount).toBe(4);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("rejects macro-enabled Office inputs before conversion", async () => {
    const root = await temporaryRoot();
    const sourcePath = path.join(root, "unsafe.docx");
    await writeFile(sourcePath, await docxBytes({ macro: true }));
    const manager = new DocumentRenderManager({
      stateRoot: path.join(root, "state"),
      renderer: async () => ({ binaryPath: "/test/soffice", version: "test-1" }),
      runCommand: vi.fn(),
    });

    const requested = await manager.requestRender({
      threadId: "thread-1" as never,
      filePath: sourcePath,
    });
    const result = await waitUntilReady(manager, "thread-1", requested.renderId);

    expect(result.state).toBe("failed");
    expect(result.error).toContain("Macro-enabled");
  });

  it("confines render lookup to the owning thread", async () => {
    const root = await temporaryRoot();
    const sourcePath = path.join(root, "source.pdf");
    await writeFile(sourcePath, await pdfBytes(1));
    const manager = new DocumentRenderManager({
      stateRoot: path.join(root, "state"),
      renderer: async () => ({ binaryPath: "/unused/soffice", version: "test-1" }),
    });
    const requested = await manager.requestRender({
      threadId: "thread-1" as never,
      filePath: sourcePath,
    });
    await waitUntilReady(manager, "thread-1", requested.renderId);

    await expect(
      manager.getRender({ threadId: "thread-2" as never, renderId: requested.renderId }),
    ).rejects.toBeInstanceOf(DocumentRendererError);
  });
});
