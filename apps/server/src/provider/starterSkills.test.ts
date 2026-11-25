import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isStarterSkillPath,
  resolveStarterSkillReferences,
  starterSkillsDir,
} from "./starterSkills.ts";

let root: string;

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "djl-starter-skills-"));
  await mkdir(path.join(root, "pptx"), { recursive: true });
  await writeFile(path.join(root, "pptx", "SKILL.md"), "---\nname: pptx\n---\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("starterSkillsDir", () => {
  it("uses the configured folder, can be turned off, and falls back to the source checkout", () => {
    expect(starterSkillsDir({ DJL_STARTER_SKILLS_DIR: root })).toBe(root);
    expect(starterSkillsDir({ DJL_STARTER_SKILLS_DIR: "" })).toBeNull();
    expect(starterSkillsDir({ DJL_STARTER_SKILLS_DIR: path.join(root, "missing") })).toBeNull();
    expect(starterSkillsDir({})).toMatch(/packages[\\/]starter-skills[\\/]skills$/);
  });
});

describe("resolveStarterSkillReferences", () => {
  it("maps starter ids to bundled files and keeps other skills untouched", () => {
    const own = { name: "mine", path: "/Users/me/.claude/skills/mine/SKILL.md" };
    expect(
      resolveStarterSkillReferences(
        [
          own,
          { name: "pptx", path: "djl-starter://pptx" },
          { name: "pptx", path: "djl-starter://pptx" },
        ],
        root,
      ),
    ).toEqual({
      skills: [own, { name: "pptx", path: path.join(root, "pptx", "SKILL.md") }],
      missing: [],
    });
  });

  it("drops unknown ids and skills missing from this build", () => {
    expect(
      resolveStarterSkillReferences(
        [
          { name: "nope", path: "djl-starter://nope" },
          { name: "xlsx", path: "djl-starter://xlsx" },
        ],
        root,
      ),
    ).toEqual({ skills: [], missing: ["djl-starter://nope", "djl-starter://xlsx"] });
    expect(
      resolveStarterSkillReferences([{ name: "pptx", path: "djl-starter://pptx" }], null).missing,
    ).toEqual(["djl-starter://pptx"]);
  });
});

it("recognises files inside the bundled folder only", () => {
  expect(isStarterSkillPath(path.join(root, "pptx", "SKILL.md"), root)).toBe(true);
  expect(isStarterSkillPath("/Users/me/.pi/agent/skills/pptx/SKILL.md", root)).toBe(false);
  expect(isStarterSkillPath(path.join(root, "pptx", "SKILL.md"), null)).toBe(false);
});
