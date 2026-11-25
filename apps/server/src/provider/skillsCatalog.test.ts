// FILE: skillsCatalog.test.ts
// Purpose: Verifies the unified cross-provider skills catalog discovery, dedup
//          precedence, merge with provider-native results, and toggle filtering.
// Layer: Server provider tests

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ProviderSkillDescriptor } from "@djl/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSkillsCatalogCacheForTests,
  discoverSkillsCatalog,
  filterDisabledSkills,
  mergeSkillsIntoCatalog,
  parseSkillFrontmatter,
} from "./skillsCatalog.ts";

const descriptor = (name: string, scope: string): ProviderSkillDescriptor => ({
  name,
  path: `/tmp/${scope}/${name}/SKILL.md`,
  enabled: true,
  scope,
});

let root: string;
let homeDir: string;
let djlBaseDir: string;

async function writeSkill(skillDir: string, name: string, description: string): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---

# ${name}
`,
  );
}

beforeEach(() => {
  clearSkillsCatalogCacheForTests();
  // Most tests look at the user's own folders; the bundled starter skills have their own test.
  vi.stubEnv("DJL_STARTER_SKILLS_DIR", "");
  root = mkdtempSync(path.join(os.tmpdir(), "djl-skills-catalog-"));
  homeDir = path.join(root, "home");
  djlBaseDir = path.join(homeDir, ".djl");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("parseSkillFrontmatter", () => {
  it("parses scalar Agent Skill metadata", () => {
    expect(
      parseSkillFrontmatter(`---
name: check-code
description: "Review recent code changes"
disable-model-invocation: true
---

# Check Code
`),
    ).toEqual({
      name: "check-code",
      description: "Review recent code changes",
      "disable-model-invocation": true,
    });
  });
});

describe("discoverSkillsCatalog", () => {
  it("creates the DJL skills folder on first discovery", async () => {
    await discoverSkillsCatalog({ homeDir, djlBaseDir });
    await expect(access(path.join(djlBaseDir, "skills"))).resolves.toBeUndefined();
  });

  it("aggregates skills from djl and provider home folders with origin scopes", async () => {
    await writeSkill(path.join(djlBaseDir, "skills", "portable"), "portable", "DJL skill");
    await writeSkill(path.join(homeDir, ".codex", "skills", "codex-only"), "codex-only", "Codex");
    await writeSkill(
      path.join(homeDir, ".claude", "skills", "claude-only"),
      "claude-only",
      "Claude",
    );
    await writeSkill(
      path.join(homeDir, ".cursor", "skills", "cursor-only"),
      "cursor-only",
      "Cursor",
    );
    await writeSkill(
      path.join(homeDir, ".gemini", "skills", "gemini-only"),
      "gemini-only",
      "Gemini",
    );
    await writeSkill(path.join(homeDir, ".grok", "skills", "grok-only"), "grok-only", "Grok");
    await writeSkill(path.join(homeDir, ".kilo", "skills", "kilo-only"), "kilo-only", "Kilo");
    await writeSkill(
      path.join(homeDir, ".config", "opencode", "skills", "opencode-only"),
      "opencode-only",
      "OpenCode",
    );
    await writeSkill(path.join(homeDir, ".pi", "agent", "skills", "pi-only"), "pi-only", "Pi");

    const skills = await discoverSkillsCatalog({ homeDir, djlBaseDir });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));

    expect(byName.get("portable")?.scope).toBe("djl");
    expect(byName.get("codex-only")?.scope).toBe("codex");
    expect(byName.get("claude-only")?.scope).toBe("claude");
    expect(byName.get("cursor-only")?.scope).toBe("cursor");
    expect(byName.get("gemini-only")?.scope).toBe("gemini");
    expect(byName.get("grok-only")?.scope).toBe("grok");
    expect(byName.get("kilo-only")?.scope).toBe("kilo");
    expect(byName.get("opencode-only")?.scope).toBe("opencode");
    expect(byName.get("pi-only")?.scope).toBe("pi");
  });

  it("adds skills from enabled Claude Code plugins as plugin:skill", async () => {
    const pluginsDir = path.join(homeDir, ".claude", "plugins");
    const enabledInstall = path.join(pluginsDir, "cache", "mkt", "superpowers", "7.0.2");
    const disabledInstall = path.join(pluginsDir, "cache", "mkt", "ralph", "1.0.0");
    const otherProject = path.join(root, "other-project");
    const projectInstall = path.join(pluginsDir, "cache", "mkt", "local-only", "1.0.0");
    await writeSkill(
      path.join(enabledInstall, "skills", "brainstorming"),
      "brainstorming",
      "Ideas",
    );
    await writeSkill(path.join(disabledInstall, "skills", "loop"), "loop", "Loop");
    await writeSkill(path.join(projectInstall, "skills", "scoped"), "scoped", "Project only");
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(
      path.join(pluginsDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "superpowers@mkt": [{ scope: "user", installPath: enabledInstall }],
          "ralph@mkt": [{ scope: "user", installPath: disabledInstall }],
          "local-only@mkt": [
            { scope: "project", projectPath: otherProject, installPath: projectInstall },
          ],
        },
      }),
    );
    await writeFile(
      path.join(homeDir, ".claude", "settings.json"),
      JSON.stringify({
        enabledPlugins: { "superpowers@mkt": true, "ralph@mkt": false, "local-only@mkt": true },
      }),
    );

    const skills = await discoverSkillsCatalog({ homeDir, djlBaseDir, cwd: root });
    const plugin = skills.find((skill) => skill.name === "superpowers:brainstorming");

    expect(plugin).toMatchObject({
      scope: "claude",
      plugin: "superpowers",
      interface: { displayName: "brainstorming" },
    });
    expect(skills.some((skill) => skill.name === "ralph:loop")).toBe(false);
    // A project-scoped plugin only applies inside its own project.
    expect(skills.some((skill) => skill.name === "local-only:scoped")).toBe(false);
  });

  it("follows symlinked skill directories from provider homes", async () => {
    const realSkillDir = path.join(root, "linked-skills", "check-code");
    await writeSkill(realSkillDir, "check-code", "Linked Claude skill");
    await mkdir(path.join(homeDir, ".claude", "skills"), { recursive: true });
    await symlink(realSkillDir, path.join(homeDir, ".claude", "skills", "check-code"), "dir");

    const skills = await discoverSkillsCatalog({
      homeDir,
      djlBaseDir,
      includeDuplicateOrigins: true,
    });

    const linkedSkill = skills.find((skill) => skill.name === "check-code");
    expect(linkedSkill?.scope).toBe("claude");
    expect(linkedSkill?.path).toContain(path.join(".claude", "skills", "check-code", "SKILL.md"));
  });

  it("can include duplicate skill names from different origins for settings", async () => {
    await writeSkill(path.join(homeDir, ".codex", "skills", "reviewer"), "reviewer", "Codex");
    await writeSkill(path.join(homeDir, ".claude", "skills", "reviewer"), "reviewer", "Claude");

    const defaultCatalog = await discoverSkillsCatalog({ homeDir, djlBaseDir });
    expect(defaultCatalog.filter((skill) => skill.name === "reviewer")).toHaveLength(1);
    expect(defaultCatalog.find((skill) => skill.name === "reviewer")?.scope).toBe("codex");

    const settingsCatalog = await discoverSkillsCatalog({
      homeDir,
      djlBaseDir,
      includeDuplicateOrigins: true,
    });
    expect(settingsCatalog.filter((skill) => skill.name === "reviewer")).toHaveLength(2);
    expect(settingsCatalog.map((skill) => skill.scope).toSorted()).toEqual(["claude", "codex"]);
  });

  it("prefers the provider-native copy and falls back to DJL for that provider", async () => {
    await writeSkill(path.join(djlBaseDir, "skills", "shared"), "shared", "DJL copy");
    await writeSkill(path.join(homeDir, ".codex", "skills", "shared"), "shared", "Codex copy");
    await writeSkill(path.join(homeDir, ".gemini", "skills", "shared"), "shared", "Gemini copy");
    await writeSkill(path.join(djlBaseDir, "skills", "only-djl"), "only-djl", "Fallback");

    const codexView = await discoverSkillsCatalog({ homeDir, djlBaseDir, provider: "codex" });
    const codexShared = codexView.find((skill) => skill.name === "shared");
    expect(codexShared?.scope).toBe("codex");
    expect(codexShared?.path).toContain(path.join(".codex", "skills"));
    expect(codexView.some((skill) => skill.name === "only-djl")).toBe(true);

    // A provider without its own copy resolves the DJL fallback.
    const claudeView = await discoverSkillsCatalog({
      homeDir,
      djlBaseDir,
      provider: "claudeAgent",
    });
    const claudeShared = claudeView.find((skill) => skill.name === "shared");
    expect(claudeShared?.scope).toBe("djl");

    const geminiView = await discoverSkillsCatalog({
      homeDir,
      djlBaseDir,
      provider: "gemini",
    });
    const geminiShared = geminiView.find((skill) => skill.name === "shared");
    expect(geminiShared?.scope).toBe("gemini");
  });

  it("uses documented provider alias roots before DJL fallbacks", async () => {
    await writeSkill(path.join(djlBaseDir, "skills", "shared"), "shared", "DJL copy");
    await writeSkill(path.join(homeDir, ".agents", "skills", "shared"), "shared", "Agents alias");
    await writeSkill(path.join(homeDir, ".gemini", "skills", "shared"), "shared", "Gemini copy");

    const geminiView = await discoverSkillsCatalog({
      homeDir,
      djlBaseDir,
      provider: "gemini",
    });

    expect(geminiView.find((skill) => skill.name === "shared")?.scope).toBe("agents");
  });

  it("uses provider-native roots before shared aliases for Grok and Pi", async () => {
    await writeSkill(path.join(djlBaseDir, "skills", "shared"), "shared", "DJL copy");
    await writeSkill(path.join(homeDir, ".agents", "skills", "shared"), "shared", "Agents alias");
    await writeSkill(path.join(homeDir, ".grok", "skills", "shared"), "shared", "Grok copy");
    await writeSkill(path.join(homeDir, ".pi", "agent", "skills", "shared"), "shared", "Pi copy");

    const grokView = await discoverSkillsCatalog({
      homeDir,
      djlBaseDir,
      provider: "grok",
    });
    const piView = await discoverSkillsCatalog({
      homeDir,
      djlBaseDir,
      provider: "pi",
    });

    expect(grokView.find((skill) => skill.name === "shared")?.scope).toBe("grok");
    expect(piView.find((skill) => skill.name === "shared")?.scope).toBe("pi");
  });

  it("discovers Pi direct markdown skills from Pi roots", async () => {
    const piRoot = path.join(homeDir, ".pi", "agent", "skills");
    await mkdir(piRoot, { recursive: true });
    await writeFile(
      path.join(piRoot, "direct-review.md"),
      `---
name: direct-review
description: Direct Pi markdown skill
---

# Direct Review
`,
    );

    const skills = await discoverSkillsCatalog({ homeDir, djlBaseDir });

    const directSkill = skills.find((skill) => skill.name === "direct-review");
    expect(directSkill?.scope).toBe("pi");
    expect(directSkill?.path).toContain(path.join(".pi", "agent", "skills", "direct-review.md"));
  });

  it("serves cached results within the TTL and rescans on forceReload", async () => {
    await writeSkill(path.join(djlBaseDir, "skills", "first"), "first", "First skill");

    const initial = await discoverSkillsCatalog({ homeDir, djlBaseDir });
    expect(initial.map((skill) => skill.name)).toEqual(["first"]);

    // A skill added after the first scan is invisible to the cached entry...
    await writeSkill(path.join(djlBaseDir, "skills", "second"), "second", "Second skill");
    const cached = await discoverSkillsCatalog({ homeDir, djlBaseDir });
    expect(cached.map((skill) => skill.name)).toEqual(["first"]);

    // ...but forceReload bypasses the cache and refreshes it.
    const reloaded = await discoverSkillsCatalog({ homeDir, djlBaseDir, forceReload: true });
    expect(reloaded.map((skill) => skill.name).toSorted()).toEqual(["first", "second"]);
  });

  it("includes project-level .djl skills when a cwd is provided", async () => {
    const cwd = path.join(root, "repo", "packages", "web");
    await mkdir(cwd, { recursive: true });
    await writeSkill(
      path.join(root, "repo", ".djl", "skills", "repo-skill"),
      "repo-skill",
      "Project skill",
    );

    const skills = await discoverSkillsCatalog({ cwd, homeDir, djlBaseDir });
    expect(skills.find((skill) => skill.name === "repo-skill")?.scope).toBe("project");
  });

  it("keeps home origins when the cwd lives under the home dir", async () => {
    // The home dir is an ancestor of the cwd here, so home skill folders are
    // reachable as "project" roots too; they must keep their true origin.
    const cwd = path.join(homeDir, "projects", "app");
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(homeDir, ".codex", "skills", "from-codex"), "from-codex", "Codex");
    await writeSkill(path.join(djlBaseDir, "skills", "portable"), "portable", "DJL");

    const skills = await discoverSkillsCatalog({ cwd, homeDir, djlBaseDir });

    const names = skills.map((skill) => skill.name);
    expect(names.filter((name) => name === "from-codex")).toHaveLength(1);
    expect(skills.find((skill) => skill.name === "from-codex")?.scope).toBe("codex");
    expect(skills.find((skill) => skill.name === "portable")?.scope).toBe("djl");
  });

  it("dedupes same-named skills within a root deterministically", async () => {
    await writeSkill(path.join(djlBaseDir, "skills", "zeta"), "twin", "Copy in zeta");
    await writeSkill(path.join(djlBaseDir, "skills", "alpha"), "twin", "Copy in alpha");

    const skills = await discoverSkillsCatalog({ homeDir, djlBaseDir });
    const twins = skills.filter((skill) => skill.name === "twin");
    expect(twins).toHaveLength(1);
    expect(twins[0]?.path).toContain(path.join("skills", "alpha"));
  });
});

describe("mergeSkillsIntoCatalog", () => {
  it("keeps provider-native entries and appends catalog-only entries", () => {
    const merged = mergeSkillsIntoCatalog({
      native: [descriptor("shared", "codex-native")],
      catalog: [descriptor("Shared", "djl"), descriptor("extra", "djl")],
    });
    expect(merged).toHaveLength(2);
    expect(merged.find((skill) => skill.name.toLowerCase() === "shared")?.scope).toBe(
      "codex-native",
    );
    expect(merged.some((skill) => skill.name === "extra")).toBe(true);
  });
});

describe("filterDisabledSkills", () => {
  it("filters disabled skills case-insensitively", () => {
    const skills: ProviderSkillDescriptor[] = [
      { name: "Reviewer", path: "/tmp/a/SKILL.md", enabled: true },
      { name: "writer", path: "/tmp/b/SKILL.md", enabled: true },
    ];
    expect(filterDisabledSkills(skills, ["reviewer"]).map((skill) => skill.name)).toEqual([
      "writer",
    ]);
    expect(filterDisabledSkills(skills, [])).toHaveLength(2);
  });
});

it("does not scan or initialize filesystem skills in Computer QA", async () => {
  await writeSkill(
    path.join(homeDir, ".codex", "skills", "unrelated"),
    "unrelated",
    "Synthetic unrelated skill",
  );
  vi.stubEnv("DJL_COMPUTER_QA_PROFILE", "1");
  expect(await discoverSkillsCatalog({ homeDir, djlBaseDir })).toEqual([]);
  await expect(access(path.join(djlBaseDir, "skills"))).rejects.toThrow();
});

it("lists DJL's bundled starter skills after the user's own, but not in settings", async () => {
  const starter = path.join(root, "starter");
  await writeSkill(path.join(starter, "frontend-design"), "frontend-design", "Bundled");
  await writeSkill(path.join(djlBaseDir, "skills", "mine"), "mine", "Mine");
  vi.stubEnv("DJL_STARTER_SKILLS_DIR", starter);

  const skills = await discoverSkillsCatalog({ homeDir, djlBaseDir });
  expect(skills.map((skill) => [skill.name, skill.scope])).toEqual([
    ["mine", "djl"],
    ["frontend-design", "built-in"],
  ]);
  const settings = await discoverSkillsCatalog({
    homeDir,
    djlBaseDir,
    includeDuplicateOrigins: true,
  });
  expect(settings.map((skill) => skill.name)).toEqual(["mine"]);
});
