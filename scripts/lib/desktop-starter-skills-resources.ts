import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { STARTER_SKILL_IDS } from "@djl/starter-skills";
import { hashSkillFolder, type StarterSkillSource } from "@djl/starter-skills/node";

/** Packaged as `<resources>/starter-skills/<id>/…`; desktop passes it as DJL_STARTER_SKILLS_DIR. */
export function starterSkillsExtraResources(repoRoot: string) {
  return [
    {
      from: path.join(repoRoot, "packages/starter-skills/skills"),
      to: "starter-skills",
      filter: ["**/*"],
    },
  ];
}

export function findPackagedStarterSkillsRoots(distDir: string, productName = "DJL") {
  return readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => [
      path.join(distDir, entry.name, "resources", "starter-skills"),
      path.join(
        distDir,
        entry.name,
        `${productName}.app`,
        "Contents",
        "Resources",
        "starter-skills",
      ),
    ])
    .filter((candidate) => existsSync(candidate));
}

/** Every topic skill is packaged, and third-party ones are byte-identical with their license. */
export function verifyStarterSkillsResources(root: string, repoRoot: string) {
  const sources = JSON.parse(
    readFileSync(path.join(repoRoot, "packages/starter-skills/sources.json"), "utf8"),
  ) as Record<string, StarterSkillSource>;
  for (const id of STARTER_SKILL_IDS) {
    if (!existsSync(path.join(root, id, "SKILL.md")))
      throw new Error(`Missing starter skill: ${id}`);
    const source = sources[id];
    if (source && hashSkillFolder(path.join(root, id)) !== source.sha256)
      throw new Error(`Packaged starter skill differs from its pinned source: ${id}`);
  }
}
