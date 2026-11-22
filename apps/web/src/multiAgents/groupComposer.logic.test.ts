import { GroupId, GroupMemberId, ProjectId, ThreadId, type Group } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import type { GroupChatRow, GroupMemberRow } from "./groupChat.logic";
import {
  activeMentionQuery,
  answeredUserText,
  askAgainText,
  askAnotherText,
  composerTokens,
  insertMention,
  insertSkillToken,
  mentionMenuItems,
  referencedSkills,
  replyToText,
} from "./groupComposer.logic";

const groupId = GroupId.makeUnsafe("g1");
const member = (id: string, handle: string, position: number) => ({
  id: GroupMemberId.makeUnsafe(id),
  groupId,
  provider: "claudeAgent" as const,
  handle,
  role: null,
  model: null,
  position,
});
const group: Group = {
  id: groupId,
  threadId: ThreadId.makeUnsafe("t1"),
  projectId: ProjectId.makeUnsafe("p1"),
  name: "Launch",
  folder: "/tmp/g1",
  folderIsAuto: true,
  hopLimit: 6,
  skipAllWarning: false,
  pendingHandoffs: [],
  members: [member("m1", "Claude", 0), member("m2", "Claude2", 1), member("m3", "Codex", 2)],
  createdAt: 1,
  updatedAt: 1,
};
const claudeRow: GroupMemberRow = {
  kind: "member",
  id: "reply-1",
  memberId: GroupMemberId.makeUnsafe("m1"),
  handle: "Claude",
  provider: "claudeAgent",
  role: null,
  text: "It is 4.",
  status: "ok",
  error: null,
  files: [],
  commands: [],
};
const codex = group.members[2]!;

describe("mention menu", () => {
  it("offers All first and filters by prefix", () => {
    expect(mentionMenuItems(group, "").map((item) => item.handle)).toEqual([
      "all",
      "Claude",
      "Claude2",
      "Codex",
    ]);
    expect(mentionMenuItems(group, "cl").map((item) => item.handle)).toEqual(["Claude", "Claude2"]);
    expect(mentionMenuItems(group, "a").map((item) => item.handle)).toEqual(["all"]);
  });
  it("finds the mention being typed at the cursor", () => {
    expect(activeMentionQuery("hi @Cl", 6)).toEqual({ start: 3, query: "Cl" });
    expect(activeMentionQuery("hi @", 4)).toEqual({ start: 3, query: "" });
    expect(activeMentionQuery("mail a@b", 8)).toBeNull();
    expect(activeMentionQuery("medium.com/@Cl", 14)).toBeNull();
    expect(activeMentionQuery("@Claude done", 12)).toBeNull();
  });
  it("replaces the typed mention with the chosen handle", () => {
    expect(insertMention("hi @Cl there", { start: 3, query: "Cl" }, "Claude")).toEqual({
      text: "hi @Claude  there",
      cursor: 11,
    });
  });
});

describe("reply actions", () => {
  it("builds the three reply actions", () => {
    expect(askAgainText(claudeRow, "what is 2+2?")).toBe("@Claude what is 2+2?");
    expect(replyToText({ ...claudeRow, text: "x".repeat(400) })).toBe(
      `@Claude\n> ${"x".repeat(280)}\n\n`,
    );
    expect(askAnotherText(claudeRow, codex, "Please check this answer from Claude.")).toBe(
      "@Codex Please check this answer from Claude.\n> It is 4.",
    );
  });
  it("quotes multi-line answers line by line", () => {
    expect(replyToText({ ...claudeRow, text: "a\nb" })).toBe("@Claude\n> a\n> b\n\n");
  });
  it("replaces the typed $query with the chosen skill", () => {
    expect(
      insertSkillToken("use $fro please", { rangeStart: 4, rangeEnd: 8 }, "frontend-design"),
    ).toEqual({ text: "use $frontend-design  please", cursor: 21 });
  });
  it("sends only the chosen skills still named in the text", () => {
    const design = { name: "frontend-design", path: "/s/fd/SKILL.md" };
    const review = { name: "review", path: "/s/review/SKILL.md" };
    expect(referencedSkills("please $frontend-design now", [design, review])).toEqual([design]);
    expect(referencedSkills("$frontend-designer", [design])).toEqual([]);
    expect(referencedSkills("end with $review", [design, review])).toEqual([review]);
  });
  it("marks mentions and chosen skills so the composer can colour them", () => {
    expect(
      composerTokens("hi @claude and @all, use $review. mail a@claude.dev @Claudette", {
        handles: ["Claude", "Codex"],
        skillNames: ["review"],
      }),
    ).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", text: "@claude" },
      { kind: "text", text: " and " },
      { kind: "mention", text: "@all" },
      { kind: "text", text: ", use " },
      { kind: "skill", text: "$review" },
      { kind: "text", text: ". mail a@claude.dev @Claudette" },
    ]);
    expect(composerTokens("", { handles: ["Claude"], skillNames: [] })).toEqual([]);
  });
  it("finds the user message a reply answered", () => {
    const rows: GroupChatRow[] = [
      { kind: "user", id: "u1", text: "first question", images: [], fileNames: [] },
      { ...claudeRow, id: "reply-1" },
      { kind: "user", id: "u2", text: "second question", images: [], fileNames: [] },
      { ...claudeRow, id: "reply-2" },
    ];
    expect(answeredUserText(rows, "reply-2")).toBe("second question");
    expect(answeredUserText(rows, "reply-1")).toBe("first question");
    expect(answeredUserText(rows, "missing")).toBe("");
  });
});
