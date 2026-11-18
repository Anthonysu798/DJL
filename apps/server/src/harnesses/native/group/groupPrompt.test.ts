import { describe, expect, it } from "vitest";

import { buildMemberPrompt, selectMissed, type PromptLogEntry } from "./groupPrompt";

const claude = { id: "m1", handle: "Claude", providerName: "Claude", role: null };
const codex = { id: "m2", handle: "Codex", providerName: "Codex", role: "Reviewer" };
const base = {
  groupName: "Launch",
  self: claude,
  members: [claude, codex],
  skills: [
    {
      name: "release-notes",
      description: "Writes release notes",
      path: "/skills/release-notes/SKILL.md",
    },
  ],
  briefing: false,
  missed: [] as PromptLogEntry[],
  skipped: 0,
  message: { fromLabel: "User", text: "hello" },
  proposeOnly: false,
  attachments: [] as string[],
  pastedSkills: [] as { name: string; markdown: string }[],
};

describe("selectMissed", () => {
  it("keeps only the newest entries and counts the rest", () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      seq: i + 1,
      authorLabel: "User",
      text: `m${i + 1}`,
    }));
    const { missed, skipped } = selectMissed(entries, 40);
    expect(missed).toHaveLength(40);
    expect(missed[0]?.seq).toBe(261);
    expect(skipped).toBe(260);
    expect(selectMissed(entries.slice(0, 3), 40)).toEqual({
      missed: entries.slice(0, 3),
      skipped: 0,
    });
  });
});

describe("buildMemberPrompt", () => {
  it("includes the newest missed messages and says how many were skipped", () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      seq: i + 1,
      authorLabel: "User",
      text: `m${i + 1}`,
    }));
    const { missed, skipped } = selectMissed(entries, 40);
    const prompt = buildMemberPrompt({ ...base, missed, skipped });
    expect(prompt).toContain("260");
    expect(prompt).not.toContain("m260\n");
    expect(prompt).toContain("m261");
    expect(prompt).toContain("m300");
  });

  it("briefs on first wake only", () => {
    const first = buildMemberPrompt({ ...base, briefing: true });
    expect(first).toContain("Launch");
    expect(first).toContain("@Codex");
    expect(first).toContain("Reviewer");
    expect(first).toContain("release-notes: Writes release notes (/skills/release-notes/SKILL.md)");
    const later = buildMemberPrompt({ ...base, briefing: false });
    expect(later).not.toContain("release-notes");
    expect(later).not.toContain("Launch");
  });

  it("always ends with the new message and its author", () => {
    const prompt = buildMemberPrompt({
      ...base,
      message: { fromLabel: "Claude", text: "@Codex please review" },
      attachments: ["/tmp/a.png"],
    });
    expect(prompt.trimEnd().endsWith("@Codex please review")).toBe(true);
    expect(prompt).toContain("Claude");
  });

  it("lists attachment paths and pasted skills", () => {
    const prompt = buildMemberPrompt({
      ...base,
      attachments: ["/tmp/a.png"],
      pastedSkills: [{ name: "x", markdown: "# X skill" }],
    });
    expect(prompt).toContain("/tmp/a.png");
    expect(prompt).toContain("# X skill");
  });

  it("says when files and commands are unavailable", () => {
    expect(buildMemberPrompt({ ...base, proposeOnly: true })).toMatch(/propose/i);
    expect(buildMemberPrompt({ ...base, proposeOnly: false })).not.toMatch(/propose/i);
  });
});
