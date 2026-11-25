// FILE: starterSkills.ts
// Purpose: Finds DJL's bundled starter skills (the ones the new-chat topics attach) and turns
//          their `djl-starter://<id>` references into real SKILL.md paths, so the usual skill
//          inlining reads them for every provider.
// Layer: Server provider helper. Desktop passes the folder as DJL_STARTER_SKILLS_DIR (inside the
//        app's resources when packaged); a source checkout falls back to the package folder.

import { existsSync } from "node:fs";
import * as nodePath from "node:path";

import type { ProviderSkillReference } from "@djl/contracts";
import { starterSkillIdFromPath, STARTER_SKILL_PATH_PREFIX } from "@djl/starter-skills";
import { sourceStarterSkillsDir } from "@djl/starter-skills/node";

/** The bundled folder, or null. A set but empty DJL_STARTER_SKILLS_DIR turns them off. */
export function starterSkillsDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.DJL_STARTER_SKILLS_DIR;
  const dir = configured === undefined ? sourceStarterSkillsDir : configured.trim();
  return dir && existsSync(dir) ? dir : null;
}

/**
 * Replaces `djl-starter://<id>` paths with the bundled SKILL.md path. References that cannot
 * be resolved (unknown id, or no bundled folder in this build) are dropped and reported.
 */
export function resolveStarterSkillReferences(
  skills: ReadonlyArray<ProviderSkillReference>,
  dir: string | null = starterSkillsDir(),
): { skills: ProviderSkillReference[]; missing: string[] } {
  const resolved: ProviderSkillReference[] = [];
  const missing: string[] = [];
  for (const skill of skills) {
    if (!skill.path.startsWith(STARTER_SKILL_PATH_PREFIX)) {
      resolved.push(skill);
      continue;
    }
    const id = starterSkillIdFromPath(skill.path);
    const file = id && dir ? nodePath.join(dir, id, "SKILL.md") : null;
    if (!file || !existsSync(file)) {
      missing.push(skill.path);
      continue;
    }
    if (!resolved.some((existing) => existing.path === file)) {
      resolved.push({ name: skill.name, path: file });
    }
  }
  return { skills: resolved, missing };
}

/** True for a SKILL.md inside the bundled starter folder. */
export function isStarterSkillPath(path: string, dir: string | null = starterSkillsDir()): boolean {
  if (!dir) return false;
  const relative = nodePath.relative(dir, path);
  return relative !== "" && !relative.startsWith("..") && !nodePath.isAbsolute(relative);
}
