import { expect, it } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  findPackagedStarterSkillsRoots,
  starterSkillsExtraResources,
  verifyStarterSkillsResources,
} from "./desktop-starter-skills-resources";

const repoRoot = path.resolve(import.meta.dirname, "../..");

it.each(["mac-arm64/DJL.app/Contents/Resources", "win-unpacked/resources"])(
  "finds and verifies packaged starter skills in %s and rejects a missing license",
  (layout) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "djl-starter-skills-package-"));
    try {
      const resources = path.join(root, layout);
      mkdirSync(resources, { recursive: true });
      for (const entry of starterSkillsExtraResources(repoRoot))
        cpSync(entry.from, path.join(resources, entry.to), { recursive: true });
      const packaged = path.join(resources, "starter-skills");
      expect(findPackagedStarterSkillsRoots(root)).toEqual([packaged]);
      expect(() => verifyStarterSkillsResources(packaged, repoRoot)).not.toThrow();
      unlinkSync(path.join(packaged, "frontend-design/LICENSE.txt"));
      expect(() => verifyStarterSkillsResources(packaged, repoRoot)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
