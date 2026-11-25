// FILE: curate-skills-catalog.ts
// Purpose: Builds the Skills store's bundled catalog from scripts/skills-catalog/curated.ts:
//          pins each skill to its repo's current commit, checks the license, notes scripts, and
//          hashes the folder the way the store verifies installs. Skills that fail a check are
//          left out and reported. Built-in starter skills keep their pinned sources.json data.
// Usage: bun scripts/curate-skills-catalog.ts

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SkillsStoreCatalogEntry } from "@djl/contracts";
import {
  ACCEPTED_SKILL_LICENSES,
  downloadSkillFiles,
  fetchRepoText,
  findSkillPath,
  hashSkillFolder,
  identifyLicense,
  listRepoTree,
  planSkillFiles,
  resolveHeadCommit,
  skillFrontmatterName,
  sourceStarterSkillsDir,
  type StarterSkillSource,
} from "@djl/starter-skills/node";

import { CURATED_SKILLS } from "./skills-catalog/curated";

const output = path.join(import.meta.dirname, "..", "apps/server/src/skillsStore/catalog.json");
const starterSources = JSON.parse(
  readFileSync(path.join(sourceStarterSkillsDir, "..", "sources.json"), "utf8"),
) as Record<string, StarterSkillSource>;
const SCRIPT_FILE = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1|bat|cmd|exe)$/i;

function hasScriptFiles(folder: string): boolean {
  return readdirSync(folder, { recursive: true, withFileTypes: true }).some(
    (entry) => entry.isFile() && SCRIPT_FILE.test(entry.name),
  );
}

async function installCount(id: string): Promise<number | undefined> {
  const skill = id.split("/").at(-1)!;
  const response = await fetch(
    `https://skills.sh/api/search?q=${encodeURIComponent(skill)}&limit=20`,
  );
  if (!response.ok) return undefined;
  const body = (await response.json()) as { skills?: Array<{ id: string; installs: number }> };
  return body.skills?.find((entry) => entry.id === id)?.installs;
}

const entries: SkillsStoreCatalogEntry[] = [];
const skipped: string[] = [];
for (const curated of CURATED_SKILLS) {
  const [owner, repoName, skillId] = curated.id.split("/");
  const repo = `${owner}/${repoName}`;
  const installs = await installCount(curated.id).catch(() => undefined);
  try {
    if (curated.starterId) {
      const source = starterSources[curated.starterId];
      if (!source?.sha256) throw new Error(`starter skill ${curated.starterId} is not pinned`);
      entries.push({
        id: curated.id,
        name: skillId!,
        repo: source.repo,
        path: source.path,
        commit: source.commit,
        sha256: source.sha256,
        license: source.license,
        category: curated.category,
        summary: curated.summary,
        hasScripts: hasScriptFiles(path.join(sourceStarterSkillsDir, curated.starterId)),
        ...(installs !== undefined ? { installs } : {}),
        builtIn: true,
      });
      continue;
    }
    const commit = await resolveHeadCommit(fetch, repo);
    const tree = await listRepoTree(fetch, repo, commit);
    const skillPath = findSkillPath(tree, {
      skillId: skillId!,
      ...(curated.path ? { path: curated.path } : {}),
    });
    if (skillPath === null) throw new Error("no SKILL.md folder found");
    const plan = planSkillFiles(tree, skillPath);
    if (!plan.licensePath) throw new Error("no license file");
    const license = identifyLicense(await fetchRepoText(fetch, repo, commit, plan.licensePath));
    if (!(ACCEPTED_SKILL_LICENSES as ReadonlyArray<string>).includes(license))
      throw new Error(`license ${license} (${plan.licensePath}) is not accepted`);
    const folder = path.join(mkdtempSync(path.join(tmpdir(), "djl-curate-")), "skill");
    try {
      await downloadSkillFiles(fetch, { repo, commit, plan }, folder);
      const name = skillFrontmatterName(readFileSync(path.join(folder, "SKILL.md"), "utf8"));
      entries.push({
        id: curated.id,
        name: name ?? skillId!,
        repo,
        path: skillPath,
        commit,
        sha256: hashSkillFolder(folder),
        license,
        category: curated.category,
        summary: curated.summary,
        hasScripts: plan.scripts.length > 0,
        ...(installs !== undefined ? { installs } : {}),
      });
    } finally {
      rmSync(path.dirname(folder), { recursive: true, force: true });
    }
    console.log(`ok   ${curated.id} @ ${commit.slice(0, 7)} (${license})`);
  } catch (error) {
    skipped.push(`${curated.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const today = new Date();
const version = Number(
  `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`,
);
writeFileSync(output, `${JSON.stringify({ version, entries }, null, 2)}\n`);
console.log(`\nWrote ${entries.length} skills to ${path.relative(process.cwd(), output)}.`);
if (skipped.length > 0) console.log(`Left out:\n  ${skipped.join("\n  ")}`);
