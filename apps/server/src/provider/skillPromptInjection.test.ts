// FILE: skillPromptInjection.test.ts
// Purpose: Verifies which providers receive inlined portable skill instructions
//          and that the inline text respects the turn character budget.
// Layer: Server provider tests

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildInlineSkillInstructions,
  shouldInlineSkillForProvider,
} from "./skillPromptInjection.ts";

const djlSkillPath = "/Users/me/.djl/skills/reviewer/SKILL.md";
const codexSkillPath = "/Users/me/.codex/skills/reviewer/SKILL.md";
const claudeSkillPath = "/Users/me/.claude/skills/reviewer/SKILL.md";
const cursorSkillPath = "/Users/me/.cursor/skills/reviewer/SKILL.md";
const piSkillPath = "/Users/me/.pi/agent/skills/reviewer/SKILL.md";

describe("shouldInlineSkillForProvider", () => {
  it("inlines every skill for the native text-only bridges, including their own skills", () => {
    // The native Codex, Claude Code and Cursor bridges send no structured skill items.
    for (const provider of [
      "codex",
      "claudeAgent",
      "cursor",
      "doubao",
      "deepseek",
      "muse",
    ] as const) {
      expect(shouldInlineSkillForProvider(provider, djlSkillPath)).toBe(true);
      expect(shouldInlineSkillForProvider(provider, codexSkillPath)).toBe(true);
      expect(shouldInlineSkillForProvider(provider, claudeSkillPath)).toBe(true);
      expect(shouldInlineSkillForProvider(provider, cursorSkillPath)).toBe(true);
    }
  });

  it("inlines cross-provider paths for pi but not pi-native skills", () => {
    expect(shouldInlineSkillForProvider("pi", djlSkillPath)).toBe(true);
    expect(shouldInlineSkillForProvider("pi", claudeSkillPath)).toBe(true);
    expect(shouldInlineSkillForProvider("pi", piSkillPath)).toBe(false);
  });

  it("inlines DJL's bundled starter skills for pi too", () => {
    const starterDir = mkdtempSync(path.join(os.tmpdir(), "starter-inline-"));
    vi.stubEnv("DJL_STARTER_SKILLS_DIR", starterDir);
    try {
      expect(shouldInlineSkillForProvider("pi", path.join(starterDir, "pptx", "SKILL.md"))).toBe(
        true,
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(starterDir, { recursive: true, force: true });
    }
  });

  it("always inlines for providers without native skill support", () => {
    for (const provider of ["gemini", "grok", "kilo", "opencode"] as const) {
      expect(shouldInlineSkillForProvider(provider, djlSkillPath)).toBe(true);
      expect(shouldInlineSkillForProvider(provider, claudeSkillPath)).toBe(true);
    }
  });
});

describe("buildInlineSkillInstructions", () => {
  it("inlines skill content for non-native providers and skips unreadable paths", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "skill-inline-"));
    const skillDir = path.join(root, ".djl", "skills", "reviewer");
    try {
      await mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, "SKILL.md");
      await writeFile(skillPath, "# Reviewer\n\nAlways review carefully.");

      const text = await buildInlineSkillInstructions({
        provider: "gemini",
        skills: [
          { name: "reviewer", path: skillPath },
          { name: "missing", path: path.join(root, ".djl", "skills", "missing", "SKILL.md") },
        ],
        maxChars: 10_000,
      });

      expect(text).toContain('<skill name="reviewer"');
      expect(text).toContain("Always review carefully.");
      expect(text).not.toContain("missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("points the agent at the full file when a long skill is cut short", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "skill-inline-long-"));
    const skillPath = path.join(root, ".djl", "skills", "slides", "SKILL.md");
    try {
      await mkdir(path.dirname(skillPath), { recursive: true });
      await writeFile(skillPath, `# Slides\n\n${"x".repeat(30_000)}`);

      const text = await buildInlineSkillInstructions({
        provider: "claudeAgent",
        skills: [{ name: "slides", path: skillPath }],
        maxChars: 100_000,
      });

      expect(text).toContain(`read the rest of ${JSON.stringify(skillPath)} before you start`);
      expect(text.length).toBeLessThan(25_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns empty text when nothing fits in the budget", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "skill-inline-budget-"));
    const skillDir = path.join(root, ".djl", "skills", "reviewer");
    try {
      await mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, "SKILL.md");
      await writeFile(skillPath, "content".repeat(100));

      const text = await buildInlineSkillInstructions({
        provider: "gemini",
        skills: [{ name: "reviewer", path: skillPath }],
        maxChars: 50,
      });

      expect(text).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not inline djl-rooted skills for codex (covered by the extra skill root)", async () => {
    const text = await buildInlineSkillInstructions({
      provider: "codex",
      skills: [{ name: "reviewer", path: djlSkillPath }],
      maxChars: 10_000,
    });
    expect(text).toBe("");
  });
});
