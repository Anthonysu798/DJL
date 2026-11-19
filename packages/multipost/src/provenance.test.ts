import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import provenance from "../vendor/PROVENANCE.json";
import skills from "./skills.json";
const root = fileURLToPath(new URL("..", import.meta.url));
it("retains every pinned upstream source byte and license", () => {
  for (const [source, hash] of Object.entries(provenance.files)) {
    const file = source.replace(/^src\/sync\//, "vendor/sync/");
    expect(
      createHash("sha256")
        .update(readFileSync(path.join(root, file)))
        .digest("hex"),
      source,
    ).toBe(hash);
  }
  expect(readFileSync(path.join(root, "LICENSE"), "utf8")).toContain("Apache License");
});
it("packages five real Skills identical to their bundled definitions", () => {
  expect(Object.keys(skills)).toHaveLength(5);
  for (const [name, skill] of Object.entries(skills))
    expect(readFileSync(path.join(root, "skills", name, "SKILL.md"), "utf8")).toBe(skill.markdown);
});
