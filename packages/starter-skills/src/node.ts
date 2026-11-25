// FILE: node.ts
// Purpose: Node-only helpers for the bundled starter skills: where the folders live in this
//          checkout, and a stable content hash used to prove the vendored copies never drift
//          from the pinned upstream commits in `sources.json`.
// Layer: Shared package (Node). The browser-safe ids live in `index.ts`.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The `skills/` folder of this package, when running from a source checkout. */
export const sourceStarterSkillsDir = fileURLToPath(new URL("../skills", import.meta.url));

export interface StarterSkillSource {
  readonly repo: string;
  readonly commit: string;
  readonly path: string;
  readonly license: "Apache-2.0" | "MIT";
  readonly sha256?: string;
}

function listFiles(root: string, dir = ""): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return listFiles(root, relative);
      return entry.isFile() ? [relative] : [];
    })
    .toSorted();
}

/** Hash of every file path and its bytes, independent of file system order. */
export function hashSkillFolder(folder: string): string {
  const hash = createHash("sha256");
  for (const file of listFiles(folder)) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(path.join(folder, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function hasSkillFile(root: string, id: string): boolean {
  return existsSync(path.join(root, id, "SKILL.md"));
}

export * from "./github.ts";
