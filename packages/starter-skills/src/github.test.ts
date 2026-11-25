import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  downloadSkillFiles,
  findSkillPath,
  identifyLicense,
  planSkillFiles,
  resolveHeadCommit,
  skillFrontmatterName,
  type RepoTreeEntry,
} from "./github";

const blob = (p: string, mode = "100644", size = 10): RepoTreeEntry => ({
  path: p,
  mode,
  type: "blob",
  size,
});

const tree: RepoTreeEntry[] = [
  blob("LICENSE"),
  blob("README.md"),
  blob("skills/frontend-design/SKILL.md"),
  blob("skills/frontend-design/reference/tokens.md"),
  blob("skills/pdf/SKILL.md"),
  blob("skills/pdf/scripts/fill.py"),
  blob("skills/pdf/run", "100755"),
  blob("skills/pdf/LICENSE.txt"),
  blob("deep/nested/frontend-design/SKILL.md"),
];

describe("finding a skill in a repo", () => {
  it("uses the given folder, else the shallowest folder named after the skill", () => {
    expect(findSkillPath(tree, { skillId: "x", path: "skills/pdf" })).toBe("skills/pdf");
    expect(findSkillPath(tree, { skillId: "x", path: "skills/missing" })).toBeNull();
    expect(findSkillPath(tree, { skillId: "frontend-design" })).toBe("skills/frontend-design");
    expect(findSkillPath(tree, { skillId: "nothing" })).toBeNull();
    expect(findSkillPath([blob("SKILL.md")], { skillId: "anything" })).toBe("");
  });
});

describe("planning the download", () => {
  it("lists the skill's files, its scripts, and prefers its own license", () => {
    const plan = planSkillFiles(tree, "skills/pdf");
    expect(plan.files.map((file) => file.path)).toEqual([
      "LICENSE.txt",
      "SKILL.md",
      "run",
      "scripts/fill.py",
    ]);
    expect(plan.scripts).toEqual(["run", "scripts/fill.py"]);
    expect(plan.licensePath).toBe("skills/pdf/LICENSE.txt");
    expect(planSkillFiles(tree, "skills/frontend-design").licensePath).toBe("LICENSE");
  });

  it("refuses symlinks, submodules, missing SKILL.md and oversized folders", () => {
    expect(() => planSkillFiles([blob("s/SKILL.md"), blob("s/link", "120000")], "s")).toThrow(
      /symbolic link/,
    );
    expect(() =>
      planSkillFiles(
        [blob("s/SKILL.md"), { path: "s/vendor", mode: "160000", type: "commit" }],
        "s",
      ),
    ).toThrow(/another repository/);
    expect(() => planSkillFiles([blob("s/notes.md")], "s")).toThrow(/no SKILL\.md/);
    expect(() =>
      planSkillFiles([blob("s/SKILL.md"), blob("s/big.bin", "100644", 11 * 1024 * 1024)], "s"),
    ).toThrow(/too large/);
  });
});

describe("licenses and names", () => {
  it("recognises common licenses", () => {
    expect(identifyLicense("Apache License\n  Version 2.0, January 2004")).toBe("Apache-2.0");
    expect(identifyLicense("Permission is hereby granted, free of charge, to any person")).toBe(
      "MIT",
    );
    expect(identifyLicense("All rights reserved.")).toBe("Other");
  });

  it("reads the frontmatter name", () => {
    expect(skillFrontmatterName("---\nname: pdf\ndescription: x\n---\n# PDF")).toBe("pdf");
    expect(skillFrontmatterName("# no frontmatter")).toBeNull();
  });
});

describe("talking to GitHub", () => {
  const COMMIT = "a".repeat(40);

  it("resolves the default branch commit and refuses redirects", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const sha = await resolveHeadCommit(async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(COMMIT);
    }, "owner/repo");
    expect(sha).toBe(COMMIT);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/owner/repo/commits/HEAD");
    expect(calls[0]!.init?.redirect).toBe("error");
    await expect(resolveHeadCommit(async () => new Response(COMMIT), "../etc")).rejects.toThrow(
      /not a GitHub repository/,
    );
  });

  it("downloads only the planned files into the folder", async () => {
    const destination = path.join(mkdtempSync(path.join(tmpdir(), "djl-skill-")), "out");
    const plan = planSkillFiles(
      [blob("skills/a/SKILL.md", "100644", 5), blob("skills/a/ref/x.md", "100644", 1)],
      "skills/a",
    );
    const urls: string[] = [];
    await downloadSkillFiles(
      async (url) => {
        urls.push(url);
        return new Response(url.endsWith("SKILL.md") ? "# Hi!" : "x");
      },
      { repo: "o/r", commit: COMMIT, plan },
      destination,
    );
    expect(urls.toSorted()).toEqual([
      `https://raw.githubusercontent.com/o/r/${COMMIT}/skills/a/SKILL.md`,
      `https://raw.githubusercontent.com/o/r/${COMMIT}/skills/a/ref/x.md`,
    ]);
    expect(readFileSync(path.join(destination, "SKILL.md"), "utf8")).toBe("# Hi!");
    expect(readFileSync(path.join(destination, "ref", "x.md"), "utf8")).toBe("x");
  });

  it("stops a file that is bigger than GitHub's tree said", async () => {
    const destination = path.join(mkdtempSync(path.join(tmpdir(), "djl-skill-")), "out");
    const plan = planSkillFiles([blob("SKILL.md", "100644", 2)], "");
    await expect(
      downloadSkillFiles(
        async () => new Response("way too long"),
        { repo: "o/r", commit: COMMIT, plan },
        destination,
      ),
    ).rejects.toThrow(/too large/);
  });
});

describe("compressed downloads", () => {
  it("judges a file by its decoded size, not the compressed length", async () => {
    const destination = path.join(mkdtempSync(path.join(tmpdir(), "djl-skill-")), "out");
    const plan = planSkillFiles([blob("SKILL.md", "100644", 3)], "");
    await downloadSkillFiles(
      async () =>
        new Response("abc", { headers: { "content-length": "99", "content-encoding": "gzip" } }),
      { repo: "o/r", commit: "b".repeat(40), plan },
      destination,
    );
    expect(readFileSync(path.join(destination, "SKILL.md"), "utf8")).toBe("abc");
  });

  it("refuses a file whose size differs from GitHub's file list", async () => {
    const destination = path.join(mkdtempSync(path.join(tmpdir(), "djl-skill-")), "out");
    const plan = planSkillFiles([blob("SKILL.md", "100644", 5)], "");
    await expect(
      downloadSkillFiles(
        async () => new Response("abc"),
        { repo: "o/r", commit: "b".repeat(40), plan },
        destination,
      ),
    ).rejects.toThrow(/does not match/);
  });
});
