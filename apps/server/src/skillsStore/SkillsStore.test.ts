import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SkillsStoreCatalogEntry, SkillsStoreCatalogFile } from "@djl/contracts";
import { hashSkillFolder } from "@djl/starter-skills/node";
import { beforeEach, describe, expect, it } from "vitest";

import { SkillsStore } from "./SkillsStore";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const MIT = "MIT License\n\nPermission is hereby granted, free of charge, to any person";

type RepoFiles = Record<string, { content: string; mode?: string }>;
interface FakeRepo {
  head: string;
  commits: Record<string, RepoFiles>;
}

function makeGitHub(repos: Record<string, FakeRepo>, extra: Record<string, unknown> = {}) {
  const requests: string[] = [];
  const fetch = async (url: string) => {
    requests.push(url);
    if (url in extra) {
      const body = extra[url];
      return new Response(typeof body === "string" ? body : JSON.stringify(body));
    }
    const api = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(.+)$/.exec(url);
    if (api) {
      const repo = repos[api[1]!];
      if (!repo) return new Response("", { status: 404 });
      if (api[2] === "commits/HEAD") return new Response(repo.head);
      const tree = /^git\/trees\/([0-9a-f]{40})\?recursive=1$/.exec(api[2]!);
      const files = tree ? repo.commits[tree[1]!] : undefined;
      if (!files) return new Response("", { status: 404 });
      return new Response(
        JSON.stringify({
          tree: Object.entries(files).map(([filePath, file]) => ({
            path: filePath,
            mode: file.mode ?? "100644",
            type: "blob",
            size: Buffer.byteLength(file.content),
          })),
        }),
      );
    }
    const raw =
      /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(url);
    const file = raw ? repos[raw[1]!]?.commits[raw[2]!]?.[decodeURIComponent(raw[3]!)] : undefined;
    return file ? new Response(file.content) : new Response("", { status: 404 });
  };
  return { fetch, requests };
}

/** The hash the curation script would record for a skill folder's files. */
function hashOf(files: RepoFiles, prefix: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "djl-hash-"));
  for (const [filePath, file] of Object.entries(files)) {
    if (!filePath.startsWith(prefix)) continue;
    const target = path.join(folder, filePath.slice(prefix.length));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  return hashSkillFolder(folder);
}

const designFiles: RepoFiles = {
  LICENSE: { content: MIT },
  "skills/polish/SKILL.md": { content: "---\nname: polish\ndescription: Polish UI\n---\n# Polish" },
  "skills/polish/reference.md": { content: "details" },
};
const toolFiles: RepoFiles = {
  "LICENSE.md": { content: MIT },
  "skills/runner/SKILL.md": { content: "---\nname: runner\n---\n# Runner" },
  "skills/runner/run.sh": { content: "echo hi", mode: "100755" },
};

const catalogEntry = (
  overrides: Partial<SkillsStoreCatalogEntry> = {},
): SkillsStoreCatalogEntry => ({
  id: "acme/design/polish",
  name: "polish",
  repo: "acme/design",
  path: "skills/polish",
  commit: COMMIT_A,
  sha256: hashOf(designFiles, "skills/polish/"),
  license: "MIT",
  category: "design",
  summary: { en: "Polish UI" },
  hasScripts: false,
  ...overrides,
});

describe("SkillsStore", () => {
  let skillsDir: string;
  let stateDir: string;
  let repos: Record<string, FakeRepo>;

  beforeEach(() => {
    const root = mkdtempSync(path.join(tmpdir(), "djl-skills-store-"));
    skillsDir = path.join(root, "skills");
    stateDir = path.join(root, "state");
    repos = {
      "acme/design": { head: COMMIT_A, commits: { [COMMIT_A]: designFiles } },
      "acme/tools": { head: COMMIT_A, commits: { [COMMIT_A]: toolFiles } },
    };
  });

  const makeStore = (
    entries: SkillsStoreCatalogEntry[] = [catalogEntry()],
    extra: Record<string, unknown> = {},
    remoteCatalogUrl: string | null = null,
  ) => {
    const github = makeGitHub(repos, extra);
    const bundled: SkillsStoreCatalogFile = { version: 1, entries };
    return {
      github,
      store: new SkillsStore({
        skillsDir,
        stateDir,
        bundled,
        fetch: github.fetch,
        remoteCatalogUrl,
      }),
    };
  };

  it("installs a reviewed skill into its own folder and lists it", async () => {
    const { store } = makeStore();
    const result = await store.install({ id: "acme/design/polish" });
    expect(result.status).toBe("done");
    const folder = path.join(skillsDir, "acme--polish");
    expect(readFileSync(path.join(folder, "SKILL.md"), "utf8")).toContain("# Polish");
    expect(readFileSync(path.join(folder, "reference.md"), "utf8")).toBe("details");
    // The repo-root license travels with the copy.
    expect(readFileSync(path.join(folder, "LICENSE"), "utf8")).toBe(MIT);
    const snapshot = await store.snapshot();
    expect(snapshot.installed).toEqual([
      expect.objectContaining({
        id: "acme/design/polish",
        name: "polish",
        source: "curated",
        license: "MIT",
        commit: COMMIT_A,
        edited: false,
        updateAvailable: false,
      }),
    ]);
  });

  it("refuses a download that differs from the reviewed version", async () => {
    repos["acme/design"]!.commits[COMMIT_A] = {
      ...designFiles,
      "skills/polish/SKILL.md": { content: "---\nname: polish\n---\n# Tampered" },
    };
    const { store } = makeStore();
    await expect(store.install({ id: "acme/design/polish" })).rejects.toThrow(/reviewed/);
    expect(existsSync(path.join(skillsDir, "acme--polish"))).toBe(false);
    expect((await store.snapshot()).installed).toEqual([]);
  });

  it("asks before installing a skill with scripts, then installs the latest commit", async () => {
    const { store } = makeStore([]);
    expect(await store.install({ id: "acme/tools/runner" })).toEqual({
      status: "needsConsent",
      reason: "scripts",
      files: ["run.sh"],
    });
    expect(existsSync(path.join(skillsDir, "acme--runner"))).toBe(false);
    const result = await store.install({ id: "acme/tools/runner", allowScripts: true });
    expect(result.status).toBe("done");
    expect(readFileSync(path.join(skillsDir, "acme--runner", "LICENSE.md"), "utf8")).toBe(MIT);
    expect((await store.snapshot()).installed[0]).toEqual(
      expect.objectContaining({ source: "search", license: "MIT", commit: COMMIT_A }),
    );
  });

  it("will not install a skill without a license", async () => {
    repos["acme/bare"] = {
      head: COMMIT_A,
      commits: { [COMMIT_A]: { "SKILL.md": { content: "# Bare" } } },
    };
    const { store } = makeStore([]);
    await expect(store.install({ id: "acme/bare/bare" })).rejects.toThrow(/no license/);
  });

  it("offers reviewed updates and asks before replacing the user's edits", async () => {
    const { store } = makeStore();
    await store.install({ id: "acme/design/polish" });
    writeFileSync(path.join(skillsDir, "acme--polish", "SKILL.md"), "# My own version");

    const newFiles: RepoFiles = {
      ...designFiles,
      "skills/polish/SKILL.md": { content: "---\nname: polish\n---\n# Polish v2" },
    };
    repos["acme/design"]!.commits[COMMIT_B] = newFiles;
    const updated = makeStore([
      catalogEntry({ commit: COMMIT_B, sha256: hashOf(newFiles, "skills/polish/") }),
    ]).store;
    expect((await updated.snapshot()).installed[0]).toEqual(
      expect.objectContaining({ edited: true, updateAvailable: true }),
    );
    expect(await updated.install({ id: "acme/design/polish" })).toEqual({
      status: "needsConsent",
      reason: "edits",
      files: [],
    });
    expect((await updated.install({ id: "acme/design/polish", overwriteEdits: true })).status).toBe(
      "done",
    );
    expect(readFileSync(path.join(skillsDir, "acme--polish", "SKILL.md"), "utf8")).toContain(
      "Polish v2",
    );
    expect((await updated.snapshot()).installed[0]).toEqual(
      expect.objectContaining({ commit: COMMIT_B, edited: false, updateAvailable: false }),
    );
  });

  it("removes only skills it installed and never overwrites the user's own folder", async () => {
    mkdirSync(path.join(skillsDir, "acme--polish"), { recursive: true });
    writeFileSync(path.join(skillsDir, "acme--polish", "SKILL.md"), "# Mine");
    const { store } = makeStore();
    await expect(store.install({ id: "acme/design/polish" })).rejects.toThrow(/already exists/);
    await expect(store.remove("acme/design/polish")).rejects.toThrow(/did not install/);
    expect(readFileSync(path.join(skillsDir, "acme--polish", "SKILL.md"), "utf8")).toBe("# Mine");

    await store.install({ id: "acme/tools/runner", allowScripts: true });
    const after = await store.remove("acme/tools/runner");
    expect(after.installed).toEqual([]);
    expect(existsSync(path.join(skillsDir, "acme--runner"))).toBe(false);
  });

  it("does not install skills that come with DJL", async () => {
    const { store } = makeStore([catalogEntry({ builtIn: true })]);
    await expect(store.install({ id: "acme/design/polish" })).rejects.toThrow(/comes with DJL/);
  });

  it("maps skills.sh search results and caches them", async () => {
    const searchUrl = "https://skills.sh/api/search?q=polish&limit=30";
    const { store, github } = makeStore([], {
      [searchUrl]: {
        skills: [
          { id: "acme/design/polish", source: "acme/design", name: "polish", installs: 12 },
          { id: "docs.example.com/guide", source: "docs.example.com", name: "guide", installs: 3 },
        ],
      },
    });
    const results = await store.search("Polish");
    expect(results).toEqual([
      {
        id: "acme/design/polish",
        name: "polish",
        repo: "acme/design",
        installs: 12,
        installable: true,
      },
      {
        id: "docs.example.com/guide",
        name: "guide",
        repo: "docs.example.com",
        installs: 3,
        installable: false,
      },
    ]);
    await store.search("polish");
    expect(github.requests.filter((url) => url === searchUrl)).toHaveLength(1);
  });

  it("uses a newer online catalog and ignores an older or broken one", async () => {
    const remote = "https://example.com/catalog.json";
    const newer = makeStore(
      [catalogEntry()],
      {
        [remote]: { version: 2, entries: [catalogEntry({ id: "acme/design/other" })] },
      },
      remote,
    ).store;
    expect((await newer.catalog()).map((entry) => entry.id)).toEqual(["acme/design/other"]);

    const older = makeStore(
      [catalogEntry()],
      {
        [remote]: { version: 0, entries: [] },
      },
      remote,
    ).store;
    expect((await older.catalog()).map((entry) => entry.id)).toEqual(["acme/design/polish"]);

    const broken = makeStore([catalogEntry()], { [remote]: "{not json" }, remote).store;
    expect((await broken.catalog()).map((entry) => entry.id)).toEqual(["acme/design/polish"]);
  });

  it("previews SKILL.md from the reviewed commit", async () => {
    const { store } = makeStore();
    expect(await store.preview("acme/design/polish")).toContain("# Polish");
    await expect(store.preview("../../etc")).rejects.toThrow(/not a skill id/);
  });
});
