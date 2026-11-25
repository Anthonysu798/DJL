// FILE: vendor-starter-skills.ts
// Purpose: Copies the third-party starter skills (packages/starter-skills/sources.json) from
//          their pinned upstream commits into packages/starter-skills/skills, adding the
//          upstream LICENSE when the skill folder has none, and records each folder's hash.
// Usage:  bun scripts/vendor-starter-skills.ts          # fetch pinned commits, write folders
//         bun scripts/vendor-starter-skills.ts --check  # offline: verify folders match hashes

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  hashSkillFolder,
  sourceStarterSkillsDir,
  type StarterSkillSource,
} from "@djl/starter-skills/node";

const sourcesFile = path.join(sourceStarterSkillsDir, "..", "sources.json");
const sources = JSON.parse(readFileSync(sourcesFile, "utf8")) as Record<string, StarterSkillSource>;

const LICENSE_NAMES = ["LICENSE", "LICENSE.txt", "LICENSE.md"];

function check(): void {
  const problems: string[] = [];
  for (const [id, source] of Object.entries(sources)) {
    const folder = path.join(sourceStarterSkillsDir, id);
    if (!existsSync(path.join(folder, "SKILL.md"))) problems.push(`${id}: SKILL.md missing`);
    else if (!LICENSE_NAMES.some((name) => existsSync(path.join(folder, name))))
      problems.push(`${id}: LICENSE missing`);
    else if (hashSkillFolder(folder) !== source.sha256)
      problems.push(`${id}: files differ from ${source.repo}@${source.commit.slice(0, 7)}`);
  }
  if (problems.length > 0) {
    console.error(`Starter skills drifted:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${Object.keys(sources).length} starter skills match their pinned sources.`);
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "inherit"] });
}

function fetchCheckout(repo: string, commit: string, paths: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "djl-starter-skill-"));
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  git(dir, "sparse-checkout", "set", "--no-cone", "/LICENSE*", ...paths.map((p) => `/${p}/`));
  git(dir, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit);
  git(dir, "checkout", "-q", "FETCH_HEAD");
  return dir;
}

function vendor(): void {
  const byCheckout = new Map<string, string[]>();
  for (const [id, source] of Object.entries(sources)) {
    const key = `${source.repo}@${source.commit}`;
    byCheckout.set(key, [...(byCheckout.get(key) ?? []), id]);
  }
  for (const [key, ids] of byCheckout) {
    const [repo, commit] = key.split("@") as [string, string];
    const checkout = fetchCheckout(
      repo,
      commit,
      ids.map((id) => sources[id]!.path),
    );
    try {
      for (const id of ids) {
        const source = sources[id]!;
        const target = path.join(sourceStarterSkillsDir, id);
        rmSync(target, { recursive: true, force: true });
        cpSync(path.join(checkout, source.path), target, { recursive: true });
        if (!LICENSE_NAMES.some((name) => existsSync(path.join(target, name)))) {
          const upstream = LICENSE_NAMES.find((name) => existsSync(path.join(checkout, name)));
          if (!upstream) throw new Error(`${repo} has no LICENSE for ${id}`);
          cpSync(path.join(checkout, upstream), path.join(target, "LICENSE"));
        }
        sources[id] = { ...source, sha256: hashSkillFolder(target) };
        console.log(`vendored ${id} from ${repo}@${commit.slice(0, 7)}`);
      }
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  }
  writeFileSync(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`);
}

if (process.argv.includes("--check")) check();
else vendor();
