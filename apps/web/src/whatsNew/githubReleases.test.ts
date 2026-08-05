import { describe, expect, it } from "vitest";

import {
  GITHUB_RELEASE_CACHE_TTL_MS,
  parseGithubReleasePayload,
  parseReleaseNotes,
  readGithubReleaseCache,
  refreshGithubReleases,
  selectLatestStableRelease,
} from "./githubReleases";

const V059_BODY = `DJL v0.5.9

### Added

- Added guided first-run setup and multilingual recommendations for choosing between local and API models.
- Added a grounded local-model workflow that connects visible tools, project memory, and preparation state before changes are proposed.

### Fixed

- Improved tool selection and tool-call recovery across local and hosted models, including DeepSeek text-form tool calls and web research.
- Fixed streamed assistant responses so partial text remains complete and correctly ordered while a turn is running.
- Hid desktop update and task-panel controls when those actions are unavailable.

### Changed

- Made switching providers and models clearer in the composer and settings, with stronger guidance for model capabilities and tradeoffs.
- Improved local-model runtime lifecycle handling and grounded-work reliability.

---

DJL desktop installers for macOS Apple Silicon, macOS Intel, and Windows x64.

## What's Changed
* Improve model onboarding by @Anthonysu798 in https://github.com/Anthonysu798/DJL/pull/9

**Full Changelog**: https://github.com/Anthonysu798/DJL/compare/v0.5.8...v0.5.9`;

const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: "v0.5.9",
  body: V059_BODY,
  html_url: "https://github.com/Anthonysu798/DJL/releases/tag/v0.5.9",
  published_at: "2026-08-02T06:17:26Z",
  draft: false,
  prerelease: false,
  ...overrides,
});

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set("djl:github-releases:v1", initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("GitHub release notes", () => {
  it("parses the real v0.5.9 structure and removes generated boilerplate", () => {
    const notes = parseReleaseNotes(V059_BODY, "0.5.9");

    expect(notes.intro).toEqual([]);
    expect(notes.sections.map((section) => section.heading)).toEqual(["Added", "Fixed", "Changed"]);
    expect(notes.sections[1]?.items).toHaveLength(3);
    expect(JSON.stringify(notes)).not.toContain("What's Changed");
    expect(JSON.stringify(notes)).not.toContain("Full Changelog");
  });

  it("excludes drafts, retains prereleases, and selects the newest stable release", () => {
    const releases = parseGithubReleasePayload([
      release({ tag_name: "v0.6.0-rc.1", prerelease: true }),
      release({ tag_name: "v9.0.0", draft: true }),
      release(),
      release({ tag_name: "nightly" }),
    ]);

    expect(releases?.map((entry) => entry.version)).toEqual(["0.6.0-rc.1", "0.5.9"]);
    expect(selectLatestStableRelease(releases ?? [])?.version).toBe("0.5.9");
  });
});

describe("GitHub release cache", () => {
  it("distinguishes a fresh cache from a stale cache at ten minutes", () => {
    const cached = JSON.stringify({
      fetchedAt: 1_000,
      releases: parseGithubReleasePayload([release()]),
    });
    const storage = memoryStorage(cached);

    expect(readGithubReleaseCache(storage, 1_000 + GITHUB_RELEASE_CACHE_TTL_MS - 1)?.fresh).toBe(
      true,
    );
    expect(readGithubReleaseCache(storage, 1_000 + GITHUB_RELEASE_CACHE_TTL_MS)?.fresh).toBe(false);
  });

  it("refreshes stale data and stores only a validated response", async () => {
    const storage = memoryStorage();
    const releases = await refreshGithubReleases(
      storage,
      async () => ({ ok: true, json: async () => [release()] }) as Response,
      42,
    );

    expect(releases[0]?.version).toBe("0.5.9");
    expect(readGithubReleaseCache(storage, 42)?.releases[0]?.version).toBe("0.5.9");
  });

  it("never overwrites a valid cache after malformed, rate-limit, or network failures", async () => {
    const cached = JSON.stringify({
      fetchedAt: 1_000,
      releases: parseGithubReleasePayload([release()]),
    });
    const storage = memoryStorage(cached);

    await expect(
      refreshGithubReleases(
        storage,
        async () => ({ ok: true, json: async () => ({ message: "bad" }) }) as Response,
        2_000,
      ),
    ).rejects.toThrow();
    await expect(
      refreshGithubReleases(storage, async () => ({ ok: false, status: 403 }) as Response, 2_000),
    ).rejects.toThrow();
    await expect(
      refreshGithubReleases(
        storage,
        async () => {
          throw new Error("offline");
        },
        2_000,
      ),
    ).rejects.toThrow("offline");

    expect(readGithubReleaseCache(storage, 2_000)?.releases[0]?.version).toBe("0.5.9");
  });

  it("recovers from an initial offline failure when Retry later succeeds", async () => {
    const storage = memoryStorage();
    await expect(
      refreshGithubReleases(
        storage,
        async () => {
          throw new Error("offline");
        },
        1_000,
      ),
    ).rejects.toThrow("offline");
    expect(readGithubReleaseCache(storage, 1_000)).toBeNull();

    await refreshGithubReleases(
      storage,
      async () => ({ ok: true, json: async () => [release()] }) as Response,
      2_000,
    );
    expect(readGithubReleaseCache(storage, 2_000)?.releases[0]?.version).toBe("0.5.9");
  });
});
