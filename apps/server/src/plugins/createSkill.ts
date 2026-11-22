// FILE: createSkill.ts
// Purpose: Writes a skill the user typed in to DJL's own skills folder, the one every agent's
//          skill list already reads from.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PluginCreateSkillInput } from "@synara/contracts";

const MAX_INSTRUCTIONS = 24_000;

/** The folder is already taken, so the skill there is not DJL's to remove later. */
export class SkillExistsError extends Error {}

export async function createSkill(
  skillsDir: string,
  input: PluginCreateSkillInput,
): Promise<{ name: string; path: string }> {
  const name = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  if (!name) throw new Error("Give the skill a name made of letters or numbers.");
  // One line with no characters that need escaping: DJL's own reader and the agents' YAML
  // readers treat escapes differently, and a plain quoted value reads the same in all of them.
  const description = input.description
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .replace(/\\/g, "/")
    .trim();
  const instructions = input.instructions.trim();
  if (!description) throw new Error("Describe when the skill should be used.");
  if (!instructions) throw new Error("Write the instructions the agent should follow.");
  if (instructions.length > MAX_INSTRUCTIONS) {
    throw new Error(`Keep the instructions under ${MAX_INSTRUCTIONS.toLocaleString()} characters.`);
  }
  const directory = join(skillsDir, name);
  try {
    await mkdir(skillsDir, { recursive: true });
    // Not recursive: an existing folder means a skill of that name is already there.
    await mkdir(directory);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SkillExistsError(`A skill named "${name}" already exists.`);
    }
    throw cause;
  }
  const path = join(directory, "SKILL.md");
  await writeFile(
    path,
    `---\nname: ${name}\ndescription: "${description}"\n---\n\n${instructions}\n`,
    { flag: "wx" },
  );
  return { name, path };
}
