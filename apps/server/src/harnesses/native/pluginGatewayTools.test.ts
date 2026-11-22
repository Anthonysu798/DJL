import { afterEach, describe, expect, it, vi } from "vitest";

import { listPluginGatewayTools, pluginFunctionName } from "./pluginGatewayTools";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plugin gateway tool names", () => {
  it("keeps a valid name and makes a shortened or reshaped one unique", () => {
    expect(pluginFunctionName("djl_linear", "create_issue")).toBe("djl_linear__create_issue");
    const server = `djl_${"a".repeat(60)}`;
    const long = pluginFunctionName(server, "one");
    expect(long).toMatch(/^djl_a{51}_[0-9a-f]{8}$/);
    expect(long).not.toBe(pluginFunctionName(server, "two"));
    expect(pluginFunctionName("djl_x", "a.b")).not.toBe(pluginFunctionName("djl_x", "a_b"));
  });

  it("withholds both tools when two would share a name", async () => {
    const tools: Record<string, string[]> = {
      "http://127.0.0.1:9999/mcp/one": ["c", "kept"],
      "http://127.0.0.1:9999/mcp/two": ["b__c"],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { id?: string; method: string };
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result =
        body.method === "tools/list"
          ? { tools: tools[String(url)]!.map((name) => ({ name })) }
          : {};
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        headers: { "content-type": "application/json" },
      });
    });
    const listed = await listPluginGatewayTools({
      bearerToken: "test-only",
      servers: [
        { name: "djl_a__b", url: "http://127.0.0.1:9999/mcp/one" },
        { name: "djl_a", url: "http://127.0.0.1:9999/mcp/two" },
      ],
    });
    expect(listed.map((tool) => tool.name)).toEqual(["djl_a__b__kept"]);
  });
});
