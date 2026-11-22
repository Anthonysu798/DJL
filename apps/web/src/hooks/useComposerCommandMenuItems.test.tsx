import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProviderKind } from "@djl/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useComposerCommandMenuItems } from "./useComposerCommandMenuItems";
import { groupCommandItems } from "../components/chat/ComposerCommandMenu";

function discover(query: string, kind: "mention" | "skill" = "mention") {
  const captured: { items: ReturnType<typeof useComposerCommandMenuItems> } = { items: [] };
  const providers: ProviderKind[] = ["codex", "claudeAgent", "cursor", "grok"];
  function Probe() {
    captured.items = useComposerCommandMenuItems({
      composerTrigger: { kind, query, rangeStart: 0, rangeEnd: query.length + 1 },
      provider: "codex",
      providerPlugins: [],
      providerNativeCommands: [],
      providerSkills: [],
      workspaceEntries: [],
      searchableModelOptions: [],
      agentModelOptions: providers.map((provider) => ({
        provider,
        providerLabel: provider,
        slug: `${provider}-model`,
        name: `${provider} Model`,
        searchSlug: provider,
        searchName: provider,
        searchProvider: provider,
        searchUpstreamProvider: "",
      })),
      supportsFastSlashCommand: false,
      canOfferCompactCommand: false,
      canOfferReviewCommand: false,
      canOfferForkCommand: false,
      canOfferSideCommand: false,
      canOfferExportCommand: false,
      dynamicAgents: [],
    });
    return null;
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>,
  );
  return captured.items;
}

describe("Agent mode mention picker", () => {
  it("offers all providers while the current provider is Codex", () => {
    expect(
      discover("").flatMap((item) => (item.type === "handoff-model" ? [item.provider] : [])),
    ).toEqual(["codex", "claudeAgent", "cursor", "grok"]);
  });
  it("searches other providers and retains the exact model", () => {
    expect(discover("claude")).toEqual([
      expect.objectContaining({
        type: "handoff-model",
        provider: "claudeAgent",
        model: "claudeAgent-model",
      }),
    ]);
  });
  it("keeps handoffs separate from existing subagent directives and local mentions", () => {
    const groups = groupCommandItems(discover(""), "mention", true);
    expect(groups[0]?.id).toBe("agent-models");
    expect(
      groups
        .find((group) => group.id === "subagents")
        ?.items.every((item) => item.type === "agent"),
    ).toBe(true);
    expect(groups.find((group) => group.id === "local")?.items[0]?.type).toBe("local-root");
  });
});

describe("bundled social discovery", () => {
  it("offers Social Media without provider plugins", () => {
    expect(discover("social")).toContainEqual(
      expect.objectContaining({
        type: "plugin",
        mention: { name: "social", path: "plugin://djl/social" },
      }),
    );
  });
  it("offers runnable built-in skills with the dollar trigger", () => {
    expect(discover("social-publish", "skill")).toContainEqual(
      expect.objectContaining({
        type: "skill",
        skill: expect.objectContaining({ path: "builtin://djl/social/publish" }),
      }),
    );
  });
});

it("offers the native Computer Use plugin and skill", () => {
  expect(discover("computer")).toContainEqual(
    expect.objectContaining({
      type: "plugin",
      mention: { name: "computer", path: "plugin://djl/computer-use" },
    }),
  );
  expect(discover("computer-use", "skill")).toContainEqual(
    expect.objectContaining({
      type: "skill",
      skill: expect.objectContaining({ path: "builtin://djl/computer-use/operate" }),
    }),
  );
});
