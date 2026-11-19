import { expect, it } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  findPackagedMultiPostRoots,
  multiPostExtraResources,
  verifyMultiPostResources,
} from "./desktop-multipost-resources";
it.each(["mac-arm64/DJL.app/Contents/Resources", "win-unpacked/resources"])(
  "verifies real skill/license bytes in %s and rejects a missing skill",
  (layout) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "djl-multipost-package-"));
    try {
      const resources = path.join(root, layout);
      mkdirSync(resources, { recursive: true });
      for (const entry of multiPostExtraResources(path.resolve(import.meta.dirname, "../..")))
        cpSync(entry.from, path.join(resources, entry.to), { recursive: true });
      expect(findPackagedMultiPostRoots(root)).toEqual([path.join(resources, "multipost")]);
      expect(() => verifyMultiPostResources(path.join(resources, "multipost"))).not.toThrow();
      unlinkSync(path.join(resources, "multipost/skills/multipost-publish/SKILL.md"));
      expect(() => verifyMultiPostResources(path.join(resources, "multipost"))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
