import { describe, expect, it } from "vitest";

import { decodePluginManifest, isAllowedPluginServerUrl } from "./plugins";

const valid = {
  id: "acme-tools",
  name: "acme",
  displayName: "Acme Tools",
  shortDescription: "Work with Acme",
  mcpServers: [{ name: "Acme", url: "https://mcp.acme.example/mcp" }],
};

describe("decodePluginManifest", () => {
  it("accepts a minimal manifest and keeps optional fields", () => {
    const result = decodePluginManifest({
      ...valid,
      websiteUrl: "https://acme.example",
      brandColor: "#1F6FEB",
      examplePrompts: ["List my Acme items"],
      skills: [{ name: "acme-report", description: "Weekly report", instructions: "Do it." }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe("acme-tools");
      expect(result.manifest.skills?.[0]?.name).toBe("acme-report");
    }
  });

  it("names every wrong field on its own line", () => {
    const result = decodePluginManifest({
      ...valid,
      id: "Acme Tools",
      displayName: "",
      mcpServers: [{ name: "Acme", url: "http://acme.example/mcp" }, { name: "B" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const lines = result.error.split("\n");
      expect(lines).toContain(
        "id: Use up to 63 lowercase letters, numbers and hyphens, starting with a letter or number",
      );
      expect(lines.some((line) => line.startsWith("displayName: "))).toBe(true);
      expect(lines).toContain(
        "mcpServers[0].url: Use an address that starts with https:// (http:// only for localhost)",
      );
      expect(lines).toContain("mcpServers[1].url: Missing key");
    }
  });

  it("refuses a plugin with nothing in it, duplicate server names, and non-objects", () => {
    expect(decodePluginManifest({ ...valid, mcpServers: [] })).toEqual({
      ok: false,
      error: "List at least one MCP server or skill",
    });
    expect(
      decodePluginManifest({
        ...valid,
        mcpServers: [
          { name: "Acme", url: "https://a.example/mcp" },
          { name: "acme", url: "https://b.example/mcp" },
        ],
      }),
    ).toEqual({ ok: false, error: "Give each MCP server its own name" });
    expect(decodePluginManifest("nope").ok).toBe(false);
    expect(decodePluginManifest({ ...valid, examplePrompts: ["a", "b", "c", "d"] }).ok).toBe(false);
  });
});

describe("isAllowedPluginServerUrl", () => {
  it("allows https anywhere and http only on this computer", () => {
    expect(isAllowedPluginServerUrl("https://x.example/mcp")).toBe(true);
    expect(isAllowedPluginServerUrl("http://localhost:8123/mcp")).toBe(true);
    expect(isAllowedPluginServerUrl("http://127.0.0.1/mcp")).toBe(true);
    expect(isAllowedPluginServerUrl("http://x.example/mcp")).toBe(false);
    expect(isAllowedPluginServerUrl("https://user:pw@x.example/mcp")).toBe(false);
    expect(isAllowedPluginServerUrl("not a url")).toBe(false);
  });
});
