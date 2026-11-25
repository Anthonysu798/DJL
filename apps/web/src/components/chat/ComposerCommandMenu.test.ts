import { SOCIAL_PLUGIN, SOCIAL_PLUGIN_MENTION, mcpMention } from "@djl/contracts";
import type { ProviderSkillDescriptor, ServerRecord } from "@djl/contracts";
import { describe, expect, it } from "vitest";
import { orderSkillsByGroup, resolveSkillOrigin, skillGroupKey } from "~/lib/skillOrigin";
import { groupCommandItems, type ComposerCommandItem } from "./ComposerCommandMenu";

describe("groupCommandItems", () => {
  it("groups mention suggestions as plugins, servers, local, then subagents", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "agent:codex:mini",
        type: "agent",
        provider: "codex",
        alias: "mini",
        color: "violet",
        label: "@mini",
        description: "GPT-5.4 Mini",
      },
      {
        id: "path:file:/workspace/AGENTS.md",
        type: "path",
        path: "/workspace/AGENTS.md",
        pathKind: "file",
        label: "AGENTS.md",
        description: "/workspace",
      },
      {
        id: "plugin:github",
        type: "plugin",
        plugin: {
          id: "plugin/github",
          name: "GitHub",
          source: {
            type: "local",
            path: "/test/plugins/github",
          },
          interface: {
            displayName: "GitHub",
            shortDescription: "Triage PRs and CI",
          },
          installed: true,
          enabled: true,
          installPolicy: "AVAILABLE",
          authPolicy: "ON_USE",
        },
        mention: {
          name: "GitHub",
          path: "plugin://GitHub@codex",
        },
        label: "GitHub",
        description: "Triage PRs and CI",
      },
      {
        id: "local-root",
        type: "local-root",
        label: "@local",
        description: "Browse folders on this computer",
      },
      {
        id: "server:srv-hk",
        type: "server",
        server: {
          id: "srv-hk" as ServerRecord["id"],
          name: "hk-edge",
          host: "edge.example.test",
          port: 22,
          username: "deploy",
          auth: { type: "agent" },
          tags: [],
          permissionTier: "approve-each",
          notes: "",
          source: "manual",
          createdAt: 0,
          updatedAt: 0,
        },
        mention: { name: "hk-edge", path: "ssh://srv-hk" },
        label: "hk-edge",
        description: "deploy@edge.example.test",
        tierLabel: "Approve each",
      },
    ];

    expect(groupCommandItems(items, "mention", true)).toEqual([
      {
        id: "plugins",
        labelKey: "commandMenu.groups.plugins",
        items: [items[2]],
      },
      {
        id: "servers",
        labelKey: "commandMenu.groups.servers",
        items: [items[4]],
      },
      {
        id: "local",
        labelKey: "commandMenu.groups.local",
        items: [items[1], items[3]],
      },
      {
        id: "subagents",
        labelKey: "commandMenu.groups.subagents",
        items: [items[0]],
      },
    ]);
  });

  it("groups slash-menu skills separately from app and provider commands", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "slash:review",
        type: "slash-command",
        command: "review",
        label: "/review",
        description: "Review changes",
        source: "app",
      },
      {
        id: "provider-command:codex:help",
        type: "provider-native-command",
        provider: "codex",
        command: "help",
        label: "/help",
        description: "Show help",
      },
      {
        id: "skill:/workspace/.codex/skills/check-code/SKILL.md",
        type: "skill",
        skill: {
          name: "check-code",
          description: "Review recent code changes",
          path: "/workspace/.codex/skills/check-code/SKILL.md",
          enabled: true,
          scope: "project",
        },
        group: "codex",
        label: "check-code",
        description: "Review recent code changes",
      },
    ];

    expect(groupCommandItems(items, "slash-command", true)).toEqual([
      {
        id: "built-in",
        labelKey: "commandMenu.groups.builtIn",
        items: [items[0]],
      },
      {
        id: "provider",
        labelKey: "commandMenu.groups.provider",
        items: [items[1]],
      },
      {
        id: "skills",
        labelKey: "commandMenu.groups.skills",
        items: [items[2]],
      },
    ]);
  });
});

const skill = (
  name: string,
  scope: string,
  path: string,
  plugin?: string,
): ProviderSkillDescriptor => ({
  name,
  path,
  enabled: true,
  scope,
  ...(plugin ? { plugin } : {}),
});

describe("$ skill groups", () => {
  it("puts the provider's own skills first, then built-in, Claude, Codex and shared", () => {
    const skills = [
      skill("share", "agents", "/h/.agents/skills/share/SKILL.md"),
      skill("social-publish", "built-in", "builtin://djl/social/publish"),
      skill("check-code", "codex", "/h/.codex/skills/check-code/SKILL.md"),
      skill(
        "superpowers:brainstorming",
        "claude",
        "/p/skills/brainstorming/SKILL.md",
        "superpowers",
      ),
      skill("frontend", "claude", "/h/.claude/skills/frontend/SKILL.md"),
    ];
    const items = orderSkillsByGroup(
      skills.map(
        (entry): Extract<ComposerCommandItem, { type: "skill" }> => ({
          id: `skill:${entry.path}`,
          type: "skill",
          skill: entry,
          group: skillGroupKey(resolveSkillOrigin(entry), "claudeAgent"),
          label: entry.name,
          description: entry.name,
        }),
      ),
      (item) => item.group,
    );

    const groups = groupCommandItems(items, "skill", true, "claudeAgent");
    expect(groups.map((group) => [group.id, group.items.map((item) => item.label)])).toEqual([
      ["suggested", ["superpowers:brainstorming", "frontend"]],
      ["builtin", ["social-publish"]],
      ["codex", ["check-code"]],
      ["shared", ["share"]],
    ]);
    expect(groups[0]?.labelValues).toEqual({ provider: "Claude" });
  });

  it("treats project .claude skills as Claude and Doubao chats as Claude Code", () => {
    const origin = resolveSkillOrigin(
      skill("lint", "project", "/repo/.claude/skills/lint/SKILL.md"),
    );
    expect(origin).toMatchObject({ kind: "claude", provider: "claudeAgent", project: true });
    expect(skillGroupKey(origin, "doubao")).toBe("suggested");
    expect(skillGroupKey(origin, "codex")).toBe("claude");
  });
});

it("groups MCP references separately from plugins", () => {
  const items: ComposerCommandItem[] = [
    {
      id: "social",
      type: "plugin",
      plugin: SOCIAL_PLUGIN,
      mention: SOCIAL_PLUGIN_MENTION,
      label: "Social Media",
      description: "Draft posts",
    },
    {
      id: "mcp-social",
      type: "plugin",
      plugin: SOCIAL_PLUGIN,
      mention: mcpMention("DJL Work Tools", SOCIAL_PLUGIN_MENTION),
      label: "DJL Work Tools",
      description: "Social tools",
    },
  ];
  expect(
    groupCommandItems(items, "mention", true).map((group) => ({
      id: group.id,
      items: group.items.map((item) => item.id),
    })),
  ).toEqual([
    { id: "plugins", items: ["social"] },
    { id: "mcp", items: ["mcp-social"] },
  ]);
});
