import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  HOME_TOPIC_SKILLS,
  STARTER_SKILL_IDS,
  starterSkillIdFromPath,
  starterSkillPath,
  withStarterSkills,
} from "./index";
import { hashSkillFolder, sourceStarterSkillsDir, type StarterSkillSource } from "./node";

const sources = JSON.parse(
  readFileSync(path.join(sourceStarterSkillsDir, "..", "sources.json"), "utf8"),
) as Record<string, StarterSkillSource>;

describe("starter skills", () => {
  it("has a SKILL.md whose name matches its folder for every id", () => {
    for (const id of STARTER_SKILL_IDS) {
      const file = path.join(sourceStarterSkillsDir, id, "SKILL.md");
      expect(existsSync(file), id).toBe(true);
      expect(readFileSync(file, "utf8"), id).toMatch(new RegExp(`^---\\nname: ${id}\\n`));
    }
  });

  it("only attaches known skills to topics, and every id is used", () => {
    const used = new Set(Object.values(HOME_TOPIC_SKILLS).flat());
    expect([...used].toSorted()).toEqual([...STARTER_SKILL_IDS].toSorted());
  });

  it("keeps every third-party skill licensed and identical to its pinned commit", () => {
    for (const [id, source] of Object.entries(sources)) {
      const folder = path.join(sourceStarterSkillsDir, id);
      expect(["Apache-2.0", "MIT"], id).toContain(source.license);
      expect(
        ["LICENSE", "LICENSE.txt"].some((name) => existsSync(path.join(folder, name))),
        id,
      ).toBe(true);
      expect(hashSkillFolder(folder), id).toBe(source.sha256);
    }
  });

  it("round-trips the virtual path", () => {
    expect(starterSkillIdFromPath(starterSkillPath("pptx"))).toBe("pptx");
    expect(starterSkillIdFromPath("djl-starter://nope")).toBeNull();
    expect(starterSkillIdFromPath("/Users/me/.claude/skills/pptx/SKILL.md")).toBeNull();
  });
});

describe("withStarterSkills", () => {
  it("appends pinned skills once, after the ones the prompt mentions", () => {
    const mentioned = [{ name: "grill-me", path: "/u/.claude/skills/grill-me/SKILL.md" }];
    expect(withStarterSkills(mentioned, ["pptx", "theme-factory"])).toEqual([
      mentioned[0],
      { name: "pptx", path: "djl-starter://pptx" },
      { name: "theme-factory", path: "djl-starter://theme-factory" },
    ]);
    expect(withStarterSkills([{ name: "pptx", path: "/x/pptx/SKILL.md" }], ["pptx"])).toHaveLength(
      1,
    );
    expect(withStarterSkills(mentioned, [])).toEqual(mentioned);
  });
});
