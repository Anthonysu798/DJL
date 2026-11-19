// FILE: groupOutputs.ts
// Purpose: Finds the images and documents a group member produced during its turn and adds them
//          to its answer as markdown, so the chat shows the picture or a link to the file.
// Layer: Native harness (group)

import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { markdownImagePath } from "../../../codexGeneratedImages";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".csv",
]);
const SKIPPED_FOLDERS = new Set(["node_modules", "dist", "build", "out-tsc", "target"]);
const MAX_DEPTH = 4;
const MAX_ENTRIES = 4000;
const MAX_OUTPUTS = 12;

const isImage = (path: string) => IMAGE_EXTENSIONS.has(extname(path).toLowerCase());

/** Images and documents under `cwd` that were written at or after `sinceMs`. */
export async function findNewOutputs(cwd: string, sinceMs: number): Promise<string[]> {
  const found: string[] = [];
  let seen = 0;
  const walk = async (folder: string, depth: number): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if ((seen += 1) > MAX_ENTRIES) return;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !entry.name.startsWith(".") && !SKIPPED_FOLDERS.has(entry.name))
          await walk(path, depth + 1);
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      if (!IMAGE_EXTENSIONS.has(extension) && !DOCUMENT_EXTENSIONS.has(extension)) continue;
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs >= sinceMs) found.push(path);
    }
  };
  await walk(cwd, 0);
  return found.toSorted().slice(0, MAX_OUTPUTS);
}

/** `text` followed by one markdown image or link per output it does not already show. */
export function withOutputs(text: string, outputs: readonly string[]): string {
  const unique = [...new Set(outputs)].filter((path) => !text.includes(`](${path})`));
  const images = unique.filter(isImage);
  const documents = unique.filter((path) => !isImage(path));
  const label = (path: string) => basename(path).replace(/[[\]]/g, "");
  return [
    text,
    ...images.map((path) => `![${label(path)}](${markdownImagePath(path)})`),
    ...documents.map((path) => `[${label(path)}](${markdownImagePath(path)})`),
  ]
    .filter(Boolean)
    .join("\n\n");
}
