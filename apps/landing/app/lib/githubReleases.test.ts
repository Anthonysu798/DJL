import { describe, expect, it } from "vitest";
import { fetchChangelogReleases, parseReleaseNotes } from "./githubReleases";

// Verbatim structure of the real v0.5.7 release body, including the trailing block the release
// workflow appends and GitHub's own generated sections. Testing against invented shapes is how a
// changelog silently renders half of every entry as boilerplate.
const V057_BODY = `DJL v0.5.7

### Added

- Added streamlined local-model setup with hardware-aware recommendations, measured generation speed, and installed-model management for Ollama and LM Studio.
- Added a sidebar update indicator when a new DJL desktop version is ready.
- Added verifiable build provenance for desktop installers.

### Fixed

- Fixed local-model capability routing so chat-only models receive no work tools while capable models continue through the OpenCode tool harness.
- Fixed desktop release validation to enforce the current 13-asset public release contract in required CI.

### Changed

- Simplified local-model installation to one recommended action, with additional models and runtimes available under advanced choices.


---

DJL desktop installers for macOS Apple Silicon, macOS Intel, and Windows x64. macOS
installers are Developer ID signed, notarized, and stapled. The Windows installer is
intentionally unsigned and may trigger Microsoft SmartScreen. Verify \`SHA256SUMS\` before
installing.


## What's Changed
* Add sidebar desktop update action by @Anthonysu798 in https://github.com/Anthonysu798/DJL/pull/1
* Fix document render resume race by @Anthonysu798 in https://github.com/Anthonysu798/DJL/pull/3

## New Contributors
* @Anthonysu798 made their first contribution in https://github.com/Anthonysu798/DJL/pull/1

**Full Changelog**: https://github.com/Anthonysu798/DJL/compare/v0.5.6...v0.5.7`;

// The first public release differs in every way that matters: prose intro over two paragraphs, a
// non-canonical "Highlights" heading, and a markdown download table.
const V056_BODY = `DJL v0.5.6

First public release of the DJL desktop app.

DJL is a local-first desktop workspace for coding agents. It brings chats, terminals, browser
previews, diffs, Git operations, provider sessions, and task handoffs into one focused application.

### Highlights

- Use your existing Codex, Claude Code, Gemini, OpenCode, Cursor, Grok, Kilo Code, and Pi accounts.
- Run parallel tasks across projects and isolated Git worktrees.

### Downloads

| Platform | Architecture | Asset |
| --- | --- | --- |
| macOS | Apple Silicon | \`DJL-0.5.6-arm64.dmg\` |
| Windows | x64 | \`DJL-0.5.6-x64.exe\` |


---

DJL desktop installers for macOS Apple Silicon, macOS Intel, and Windows x64.

**Full Changelog**: https://github.com/Anthonysu798/DJL/commits/v0.5.6`;

describe("parseReleaseNotes — v0.5.7 (the canonical shape)", () => {
  const parsed = parseReleaseNotes(V057_BODY, "0.5.7");

  it("keeps the three headings in order and nothing else", () => {
    expect(parsed.sections.map((s) => s.heading)).toEqual(["Added", "Fixed", "Changed"]);
  });

  it("drops the title echo instead of repeating the version as prose", () => {
    expect(parsed.intro).toEqual([]);
  });

  it("reads bullets under each heading", () => {
    expect(parsed.sections[0]?.items).toHaveLength(3);
    expect(parsed.sections[0]?.items[1]).toBe(
      "Added a sidebar update indicator when a new DJL desktop version is ready.",
    );
    expect(parsed.sections[2]?.items).toHaveLength(1);
  });

  it("cuts the appended installer notice and GitHub's generated sections", () => {
    const rendered = JSON.stringify(parsed);
    expect(rendered).not.toContain("SmartScreen");
    expect(rendered).not.toContain("What's Changed");
    expect(rendered).not.toContain("New Contributors");
    expect(rendered).not.toContain("Full Changelog");
    // The PR bullets live under those headings and must not leak in as loose items either.
    expect(rendered).not.toContain("pull/1");
  });
});

describe("parseReleaseNotes — v0.5.6 (prose, a non-canonical heading, a table)", () => {
  const parsed = parseReleaseNotes(V056_BODY, "0.5.6");

  it("keeps both intro paragraphs separate rather than merging them", () => {
    expect(parsed.intro).toHaveLength(2);
    expect(parsed.intro[0]).toBe("First public release of the DJL desktop app.");
  });

  it("rejoins a hard-wrapped paragraph into one string", () => {
    expect(parsed.intro[1]).toContain("coding agents. It brings chats, terminals, browser previews");
    expect(parsed.intro[1]).not.toContain("\n");
  });

  it("handles a heading outside Added/Fixed/Changed", () => {
    expect(parsed.sections.map((s) => s.heading)).toEqual(["Highlights"]);
  });

  it("drops the Downloads section rather than rendering a broken table", () => {
    expect(parsed.sections.map((s) => s.heading)).not.toContain("Downloads");
    expect(JSON.stringify(parsed)).not.toContain("arm64.dmg");
  });
});

describe("parseReleaseNotes — degenerate input", () => {
  it("returns empty structures rather than throwing", () => {
    for (const body of [null, undefined, "", "   \n  \n"]) {
      expect(parseReleaseNotes(body, "1.0.0")).toEqual({ intro: [], sections: [] });
    }
  });

  it("strips a bare version echo in either form", () => {
    expect(parseReleaseNotes("v2.0.0\n\n### Added\n\n- One", "2.0.0").intro).toEqual([]);
    expect(parseReleaseNotes("2.0.0\n\n### Added\n\n- One", "2.0.0").intro).toEqual([]);
  });
});

describe("fetchChangelogReleases", () => {
  const release = (over: Record<string, unknown> = {}) => ({
    tag_name: "v1.2.3",
    body: "DJL v1.2.3\n\n### Added\n\n- Something",
    html_url: "https://github.com/Anthonysu798/DJL/releases/tag/v1.2.3",
    published_at: "2026-07-30T03:10:50Z",
    draft: false,
    prerelease: false,
    ...over,
  });

  const stub = (payload: unknown, ok = true) => async () => ({ ok, json: async () => payload });

  it("excludes drafts, which are failed or in-progress releases", async () => {
    const result = await fetchChangelogReleases(
      stub([release(), release({ tag_name: "v9.9.9", draft: true })]),
    );

    expect(result.map((r) => r.version)).toEqual(["1.2.3"]);
  });

  it("keeps prereleases but flags them so the page can mark them", async () => {
    const result = await fetchChangelogReleases(
      stub([release({ tag_name: "v2.0.0-rc.1", prerelease: true })]),
    );

    expect(result[0]?.version).toBe("2.0.0-rc.1");
    expect(result[0]?.prerelease).toBe(true);
  });

  it("skips entries whose tag is not a version", async () => {
    const result = await fetchChangelogReleases(stub([release({ tag_name: "nightly" }), release()]));

    expect(result.map((r) => r.version)).toEqual(["1.2.3"]);
  });

  it("returns an empty list rather than failing the page", async () => {
    expect(await fetchChangelogReleases(stub(null, false))).toEqual([]);
    expect(await fetchChangelogReleases(stub({ message: "rate limited" }))).toEqual([]);
    expect(
      await fetchChangelogReleases(async () => {
        throw new Error("network down");
      }),
    ).toEqual([]);
  });
});
