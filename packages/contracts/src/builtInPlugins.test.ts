import { COMPUTER_PLUGIN_MENTION, COMPUTER_SKILLS } from "./builtInPlugins";
import { describe, expect, it } from "vitest";
import {
  SOCIAL_PLUGIN_MENTION,
  SOCIAL_SKILLS,
  mcpMention,
  resolveBuiltInPluginReferences,
} from "./builtInPlugins";

describe("DJL plugin references", () => {
  it("injects social publishing guidance and removes virtual native references", () => {
    const input = resolveBuiltInPluginReferences({
      messageText: "Prepare a post",
      mentions: [SOCIAL_PLUGIN_MENTION],
      skills: [SOCIAL_SKILLS[1]!],
    });
    // One call posts; the chat already shows the result, so no second preview and no long reply.
    expect(input.messageText).toContain("call djl_multipost_post once");
    expect(input.messageText).toContain("do not also call djl_prepare_marketing");
    expect(input.messageText).toContain("one short sentence");
    expect(input.messageText).toContain("never ask the user to sign in to DJL Cloud");
    expect(input.messageText).not.toContain("djl_prepare_social_publish");
    expect(input.messageText).not.toContain("resume after OAuth");
    expect(input.messageText).toContain("OAuth authorization is not consent");
    expect(input.mentions).toEqual([]);
    expect(input.skills).toEqual([]);
  });
  it("keeps a selected MCP's parent plugin and preserves ordinary references", () => {
    const parent = { name: "calendar", path: "plugin://calendar@personal" };
    const file = { name: "notes", path: "/notes.md" };
    const skill = { name: "custom", path: "/skills/custom/SKILL.md" };
    const result = resolveBuiltInPluginReferences({
      messageText: "Read events",
      mentions: [mcpMention("Calendar / events", parent), file],
      skills: [skill],
    });
    expect(result.messageText).toContain('"Calendar / events"');
    expect(result.mentions).toEqual([
      { name: "mcp:Calendar / events (calendar@personal)", path: parent.path },
      file,
    ]);
    expect(result.skills).toEqual([skill]);
  });
  it("distinguishes identically named MCPs from different parent plugins", () => {
    const alpha = mcpMention("search", { name: "alpha", path: "plugin://alpha@market" });
    const beta = mcpMention("search", { name: "beta", path: "plugin://beta@market" });
    expect(alpha.name).not.toBe(beta.name);
    expect(
      resolveBuiltInPluginReferences({ messageText: "Use both", mentions: [alpha, beta] }).mentions,
    ).toHaveLength(2);
  });

  it("resolves the built-in MCP without sending a fake file to a provider", () => {
    const result = resolveBuiltInPluginReferences({
      messageText: "Show drafts",
      mentions: [mcpMention("DJL Social", SOCIAL_PLUGIN_MENTION)],
    });
    expect(result.messageText).toContain("djl_social_status");
    expect(result.mentions).toEqual([]);
  });
  it("ignores malformed virtual references and leaves plain text alone", () => {
    const input = {
      messageText: "@social is plain text",
      mentions: [{ name: "bad", path: "plugin://djl-mcp/%/bad" }],
    };
    expect(resolveBuiltInPluginReferences(input)).toEqual({
      messageText: input.messageText,
      mentions: [],
    });
  });
});

it("injects scoped computer guidance without leaking virtual skill paths to a harness", () => {
  const result = resolveBuiltInPluginReferences({
    messageText: "Inspect an app",
    mentions: [COMPUTER_PLUGIN_MENTION],
    skills: [COMPUTER_SKILLS[0]!],
  });
  expect(result.mentions).toEqual([]);
  expect(result.skills).toEqual([]);
  expect(result.messageText).toContain("djl_computer_status");
  expect(result.messageText).toContain("never fall back to global events");
  expect(result.messageText).toContain("do not retry around Stop");
});

it("uses a supplied computer target without requiring app discovery", () => {
  for (const references of [
    { mentions: [COMPUTER_PLUGIN_MENTION] },
    { skills: [COMPUTER_SKILLS[0]!] },
  ]) {
    const result = resolveBuiltInPluginReferences({
      messageText: "Use the supplied bundle/PID/window only. No discovery.",
      ...references,
    });
    expect(result.messageText).toContain("Use the supplied bundle/PID/window directly");
    expect(result.messageText).toContain("Do not enumerate apps when the user forbids discovery");
    expect(result.messageText).not.toContain("then djl_computer_apps");
  }
});

it("limits recorded-activity guidance to the explicitly selected history skill", () => {
  const selected = resolveBuiltInPluginReferences({
    messageText: "Review recorded activity",
    skills: [COMPUTER_SKILLS[1]!],
  });
  expect(selected.skills).toEqual([]);
  expect(selected.messageText).toContain("djl_computer_activity");
  expect(selected.messageText).toContain("generic plugin selection");
  expect(selected.messageText).toContain("not time spent or inferred intent");
  expect(selected.messageText).toContain("djl_computer_history separately");
  const generic = resolveBuiltInPluginReferences({
    messageText: "Inspect an app",
    mentions: [COMPUTER_PLUGIN_MENTION],
  });
  expect(generic.messageText).not.toContain("djl_computer_activity");
});
