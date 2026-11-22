import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readSkillDescriptor } from "../provider/skillsCatalog";
import { createSkill } from "./createSkill";

const directories: string[] = [];
const skillsDir = async () => {
  const directory = await mkdtemp(join(tmpdir(), "djl-skills-"));
  directories.push(directory);
  return join(directory, "skills");
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createSkill", () => {
  it("writes a skill file that DJL's skill list reads back", async () => {
    const root = await skillsDir();
    const created = await createSkill(root, {
      name: "Release Notes!",
      description: 'Write "what changed"\nfor a release: short',
      instructions: "  Read the commits since the last tag.\nGroup them.  ",
    });
    expect(created).toEqual({
      name: "release-notes",
      path: join(root, "release-notes", "SKILL.md"),
    });
    expect(await readFile(created.path, "utf8")).toContain(
      "\n\nRead the commits since the last tag.\nGroup them.\n",
    );
    expect(await readSkillDescriptor({ skillPath: created.path, scope: "djl" })).toMatchObject({
      name: "release-notes",
      description: "Write 'what changed' for a release: short",
      enabled: true,
    });
  });

  it("never overwrites an existing skill", async () => {
    const root = await skillsDir();
    const input = { name: "notes", description: "Take notes", instructions: "First version" };
    const first = await createSkill(root, input);
    await expect(createSkill(root, { ...input, instructions: "Second" })).rejects.toThrow(
      "already exists",
    );
    expect(await readFile(first.path, "utf8")).toContain("First version");
  });

  it("refuses a skill with nothing usable in it", async () => {
    const root = await skillsDir();
    const base = { name: "x", description: "d", instructions: "i" };
    await expect(createSkill(root, { ...base, name: "!!!" })).rejects.toThrow("name");
    await expect(createSkill(root, { ...base, description: " \n " })).rejects.toThrow("Describe");
    await expect(createSkill(root, { ...base, instructions: "  " })).rejects.toThrow(
      "instructions",
    );
    await expect(createSkill(root, { ...base, instructions: "a".repeat(24_001) })).rejects.toThrow(
      "under",
    );
  });
});
