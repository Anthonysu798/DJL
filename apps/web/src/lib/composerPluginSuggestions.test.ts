import type { PluginCatalogEntry, PluginsSnapshot } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import { composerPluginSuggestions } from "./composerPluginSuggestions";

const entry = (id: string, extra: Partial<PluginCatalogEntry> = {}): PluginCatalogEntry => ({
  id,
  name: id,
  displayName: id.toUpperCase(),
  shortDescription: `About ${id}`,
  category: "Test",
  featured: false,
  builtIn: false,
  developer: "Test",
  version: "1.0.0",
  capabilities: [],
  examplePrompts: [],
  apps: [
    {
      id,
      name: id,
      transport: { type: "http", url: `https://${id}.example/mcp` },
      auth: "oauth",
    },
  ],
  skills: [],
  ...extra,
});

const snapshot = (overrides: Partial<PluginsSnapshot> = {}): PluginsSnapshot => ({
  sources: [
    {
      id: "djl",
      kind: "djl",
      name: "DJL",
      plugins: [
        entry("linear"),
        entry("notion"),
        entry("sentry"),
        entry("djl-word", { name: "word", builtIn: true, apps: [] }),
        entry("djl-multipost", { name: "multipost", builtIn: true, apps: [] }),
      ],
    },
  ],
  installed: [
    { pluginId: "linear", enabled: true, installedAt: "2026-11-20T00:00:00.000Z" },
    { pluginId: "notion", enabled: true, installedAt: "2026-11-20T00:00:00.000Z" },
    { pluginId: "sentry", enabled: false, installedAt: "2026-11-20T00:00:00.000Z" },
  ],
  connections: [
    { pluginId: "linear", appId: "linear", state: "connected" },
    { pluginId: "notion", appId: "notion", state: "expired" },
    { pluginId: "sentry", appId: "sentry", state: "connected" },
  ],
  ...overrides,
});

const ids = () => composerPluginSuggestions(snapshot()).map((item) => item.plugin.id);

describe("composerPluginSuggestions", () => {
  it("offers connected, enabled plugins and DJL's own document plugins", () => {
    expect(ids()).toEqual(["linear", "djl-word"]);
  });

  it("mentions a plugin by its DJL path so the server can resolve it", () => {
    const [linear] = composerPluginSuggestions(snapshot());
    expect(linear?.mention).toEqual({ name: "linear", path: "plugin://djl-plugin/linear" });
    expect(linear?.plugin.interface?.displayName).toBe("LINEAR");
  });

  it("carries the site whose icon is each plugin's logo", () => {
    const logos = composerPluginSuggestions(
      snapshot({
        sources: [
          {
            id: "djl",
            kind: "djl",
            name: "DJL",
            plugins: [
              entry("linear", { websiteUrl: "https://linear.app" }),
              entry("djl-word", {
                name: "word",
                builtIn: true,
                apps: [],
                iconDomain: "word.cloud.microsoft",
              }),
              entry("djl-notes", { name: "notes", builtIn: true, apps: [] }),
            ],
          },
        ],
      }),
    ).map((item) => [item.plugin.id, item.plugin.interface?.websiteUrl]);

    expect(logos).toEqual([
      ["linear", "https://linear.app"],
      ["djl-word", "word.cloud.microsoft"],
      ["djl-notes", undefined],
    ]);
  });
});
