import { describe, expect, it } from "vitest";

import { resolveDjlPluginMentions } from "./pluginMentions";

describe("resolveDjlPluginMentions", () => {
  it("replaces a DJL plugin mention with an instruction naming its tool server", () => {
    const other = { name: "notes", path: "plugin://notes@personal" };
    const resolved = resolveDjlPluginMentions({
      messageText: "@linear list my issues",
      mentions: [{ name: "linear", path: "plugin://djl-plugin/linear" }, other],
      keep: 1,
    });
    expect(resolved.mentions).toEqual([other]);
    expect(resolved.keep).toBe(1);
    expect(resolved.messageText).toContain("@linear list my issues\n\nDJL selected plugin");
    expect(resolved.messageText).toContain('"djl_linear"');
  });

  it("gives a document plugin's own instructions instead of naming a tool server", () => {
    const resolved = resolveDjlPluginMentions({
      messageText: "@word write a proposal",
      mentions: [{ name: "word", path: "plugin://djl-plugin/djl-word" }],
    });
    expect(resolved.mentions).toEqual([]);
    expect(resolved.messageText).toContain("python-docx");
    expect(resolved.messageText).not.toContain("MCP server");
  });

  it("leaves a turn without DJL plugin mentions untouched", () => {
    const input = { messageText: "hi", mentions: [{ name: "x", path: "plugin://x@y" }] };
    expect(resolveDjlPluginMentions(input)).toBe(input);
    const bare = { messageText: "hi" };
    expect(resolveDjlPluginMentions(bare)).toBe(bare);
  });
});
