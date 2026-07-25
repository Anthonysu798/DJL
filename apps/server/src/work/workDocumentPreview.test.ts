import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";

import { ProjectId, ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import { previewWorkDocument } from "./workDocumentPreview";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function storedZip(entries: ReadonlyArray<{ name: string; text: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.text);
    const checksum = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + data.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function managedTask() {
  const projectWorkspaceRoot = mkdtempSync(path.join(tmpdir(), "djl-work-preview-"));
  roots.push(projectWorkspaceRoot);
  const threadId = ThreadId.makeUnsafe("thread-preview-1");
  const projectId = ProjectId.makeUnsafe("project-preview-1");
  const taskRoot = resolveThreadWorkspaceCwd({
    thread: { id: threadId, projectId, envMode: "local", worktreePath: null },
    projects: [{ id: projectId, kind: "studio", workspaceRoot: projectWorkspaceRoot }],
  })!;
  mkdirSync(path.join(taskRoot, "Deliverables"), { recursive: true });
  return { projectWorkspaceRoot, threadId, projectId, taskRoot };
}

describe("previewWorkDocument", () => {
  it("returns bounded DOCX paragraphs from the authorized task workspace", async () => {
    const task = managedTask();
    const documentPath = path.join(task.taskRoot, "Deliverables", "essay-v1.docx");
    writeFileSync(
      documentPath,
      storedZip([
        {
          name: "word/document.xml",
          text: "<w:document><w:body><w:p><w:r><w:t>Essay title</w:t></w:r></w:p><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p></w:body></w:document>",
        },
      ]),
    );

    const result = await previewWorkDocument({
      ...task,
      projectKind: "studio",
      envMode: "local",
      worktreePath: null,
      requestedPath: "Deliverables/essay-v1.docx",
    });

    expect(result.artifact.originalName).toBe("essay-v1.docx");
    expect(result.artifact.blocks.map((block) => block.text)).toEqual([
      "Essay title",
      "First paragraph",
    ]);
    expect(result.artifact).not.toHaveProperty("contentHash");
  });

  it("accepts an absolute DOCX path only when it remains inside the task workspace", async () => {
    const task = managedTask();
    const documentPath = path.join(task.taskRoot, "Deliverables", "essay-v1.docx");
    writeFileSync(
      documentPath,
      storedZip([
        {
          name: "word/document.xml",
          text: "<w:document><w:body><w:p><w:r><w:t>Absolute path</w:t></w:r></w:p></w:body></w:document>",
        },
      ]),
    );

    const result = await previewWorkDocument({
      ...task,
      projectKind: "studio",
      envMode: "local",
      worktreePath: null,
      requestedPath: realpathSync(documentPath),
    });

    expect(result.artifact.blocks[0]?.text).toBe("Absolute path");
  });

  it("rejects traversal and symlink escapes before document extraction", async () => {
    const task = managedTask();
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "djl-work-preview-outside-"));
    roots.push(outsideRoot);
    const outsideDocument = path.join(outsideRoot, "outside.docx");
    writeFileSync(outsideDocument, storedZip([{ name: "word/document.xml", text: "outside" }]));
    symlinkSync(outsideDocument, path.join(task.taskRoot, "Deliverables", "alias.docx"));
    const base = {
      ...task,
      projectKind: "studio" as const,
      envMode: "local" as const,
      worktreePath: null,
    };

    await expect(
      previewWorkDocument({ ...base, requestedPath: "../../outside.docx" }),
    ).rejects.toThrow(/outside this task/i);
    await expect(
      previewWorkDocument({ ...base, requestedPath: "Deliverables/alias.docx" }),
    ).rejects.toThrow(/symbolic links|outside this task/i);
  });

  it("rejects missing, oversized, macro-enabled, and malformed DOCX files", async () => {
    const task = managedTask();
    const base = {
      ...task,
      projectKind: "studio" as const,
      envMode: "local" as const,
      worktreePath: null,
    };
    const oversized = path.join(task.taskRoot, "Deliverables", "oversized.docx");
    writeFileSync(oversized, "");
    truncateSync(oversized, 100 * 1024 * 1024 + 1);
    writeFileSync(
      path.join(task.taskRoot, "Deliverables", "macro.docx"),
      storedZip([
        { name: "word/document.xml", text: "<w:document/>" },
        { name: "word/vbaProject.bin", text: "macro" },
      ]),
    );
    writeFileSync(path.join(task.taskRoot, "Deliverables", "malformed.docx"), "not a zip");

    await expect(
      previewWorkDocument({ ...base, requestedPath: "Deliverables/missing.docx" }),
    ).rejects.toThrow();
    await expect(
      previewWorkDocument({ ...base, requestedPath: "Deliverables/oversized.docx" }),
    ).rejects.toThrow(/100 MiB/i);
    await expect(
      previewWorkDocument({ ...base, requestedPath: "Deliverables/macro.docx" }),
    ).rejects.toMatchObject({ code: "macro_rejected" });
    await expect(
      previewWorkDocument({ ...base, requestedPath: "Deliverables/malformed.docx" }),
    ).rejects.toMatchObject({ code: "invalid_archive" });
  });

  it("ignores external DOCX relationships and reports them to the preview", async () => {
    const task = managedTask();
    writeFileSync(
      path.join(task.taskRoot, "Deliverables", "external.docx"),
      storedZip([
        {
          name: "word/document.xml",
          text: "<w:document><w:body><w:p><w:r><w:t>Safe body</w:t></w:r></w:p></w:body></w:document>",
        },
        {
          name: "word/_rels/document.xml.rels",
          text: '<Relationships><Relationship Target="https://example.com/pixel" TargetMode="External" /></Relationships>',
        },
      ]),
    );

    const result = await previewWorkDocument({
      ...task,
      projectKind: "studio",
      envMode: "local",
      worktreePath: null,
      requestedPath: "Deliverables/external.docx",
    });

    expect(result.artifact.blocks[0]?.text).toBe("Safe body");
    expect(result.artifact.warnings).toContain(
      "External Office relationships were ignored and were not fetched.",
    );
  });
});
