import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import skills from "../../packages/multipost/src/skills.json" with { type: "json" };

export function multiPostExtraResources(repoRoot: string) {
  return [
    {
      from: path.join(repoRoot, "packages/multipost/skills"),
      to: "multipost/skills",
      filter: ["**/SKILL.md"],
    },
    { from: path.join(repoRoot, "docs/licenses/MULTIPOST_LICENSE"), to: "multipost/LICENSE" },
    {
      from: path.join(repoRoot, "packages/multipost/vendor/TURNDOWN_LICENSE"),
      to: "multipost/TURNDOWN_LICENSE",
    },
  ];
}
export function findPackagedMultiPostRoots(distDir: string, productName = "DJL") {
  return readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => [
      path.join(distDir, entry.name, "resources", "multipost"),
      path.join(distDir, entry.name, `${productName}.app`, "Contents", "Resources", "multipost"),
    ])
    .filter((candidate) => existsSync(candidate));
}
export function verifyMultiPostResources(root: string) {
  for (const [name, skill] of Object.entries(skills)) {
    const file = path.join(root, "skills", name, "SKILL.md");
    if (!lstatSync(file).isFile() || readFileSync(file, "utf8") !== skill.markdown)
      throw new Error(`Missing or changed MultiPost skill: ${name}`);
  }
  for (const [file, marker] of [
    ["LICENSE", "Apache License"],
    ["TURNDOWN_LICENSE", "MIT License"],
  ]) {
    if (!readFileSync(path.join(root, file!), "utf8").includes(marker!))
      throw new Error(`Missing MultiPost license: ${file}`);
  }
}
