import { describe, expect, it } from "vitest";
import {
  formatGroupItemId,
  nextGroupHandle,
  parseGroupMentions,
  parseGroupMessageId,
} from "./groupChat";

const handles = ["Claude", "Claude2", "Codex", "审稿人"];

describe("parseGroupMentions", () => {
  it("matches case-insensitively and prefers the longest handle", () => {
    expect(parseGroupMentions("@claude2 and @CODEX please", handles)).toEqual({
      all: false,
      handles: ["Claude2", "Codex"],
    });
  });
  it("accepts trailing punctuation and non-Latin handles", () => {
    expect(parseGroupMentions("@Claude, what about @审稿人?", handles).handles).toEqual([
      "Claude",
      "审稿人",
    ]);
  });
  it("ignores e-mail addresses and unknown names", () => {
    expect(parseGroupMentions("mail a@claude.com or @Nobody", handles)).toEqual({
      all: false,
      handles: [],
    });
  });
  it("ignores handles inside links and paths", () => {
    expect(
      parseGroupMentions("see medium.com/@Claude/post and C:\\@Codex", handles).handles,
    ).toEqual([]);
  });
  it("does not match a handle that is only the start of a longer word", () => {
    expect(parseGroupMentions("@Claudette hi", handles).handles).toEqual([]);
  });
  it("matches a handle followed directly by Chinese text", () => {
    expect(parseGroupMentions("@审稿人请看一下，@Codex你也看", handles).handles).toEqual([
      "审稿人",
      "Codex",
    ]);
    expect(parseGroupMentions("@所有人 仅回复收到", handles, ["所有人"]).all).toBe(true);
  });
  it("recognises @all in any case and deduplicates", () => {
    expect(parseGroupMentions("@All @Codex @codex", handles)).toEqual({
      all: true,
      handles: ["Codex"],
    });
  });
});

describe("nextGroupHandle", () => {
  it("builds unique handles without spaces", () => {
    expect(nextGroupHandle("Qwen Code", [])).toBe("QwenCode");
    expect(nextGroupHandle("Claude", ["Claude"])).toBe("Claude2");
    expect(nextGroupHandle("Claude", ["claude", "Claude2"])).toBe("Claude3");
    expect(nextGroupHandle("all", [])).toBe("all2");
  });
});

describe("group message ids", () => {
  it("round-trips a member id through a thread message id", () => {
    const itemId = formatGroupItemId("m1", "r9");
    expect(itemId).toBe("gm.m1.r9");
    expect(parseGroupMessageId(`assistant:turn-7:${itemId}`)).toEqual({
      memberId: "m1",
      replyId: "r9",
    });
    expect(parseGroupMessageId("assistant:turn-7:assistant-abc")).toBeNull();
  });
});
