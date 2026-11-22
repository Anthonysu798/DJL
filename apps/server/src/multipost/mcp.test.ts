import { describe, it, expect } from "vitest";
import { MultiPostMcpServer } from "./mcp";
const scope = { workspaceId: "fixture", threadId: "chat", authorizedRoot: "/tmp" };
describe("DJL multipost mcp", () => {
  it("has its own authenticated endpoint and never exposes a human approval tool", async () => {
    const calls: unknown[] = [];
    const server = new MultiPostMcpServer({
      command: async (s, c, a) => {
        calls.push([s, c, a]);
        return { capabilities: [], accounts: [] };
      },
    });
    try {
      const registration = await server.register(scope);
      const rpc = (
        method: string,
        params: unknown,
        token = registration.bearerToken,
        origin?: string,
      ) =>
        fetch(registration.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(origin ? { Origin: origin } : {}),
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
      expect((await rpc("tools/list", {}, "wrong")).status).toBe(401);
      expect(
        (await rpc("tools/list", {}, registration.bearerToken, "https://evil.example")).status,
      ).toBe(403);
      const initialized = (await (await rpc("initialize", {})).json()) as {
        result: { serverInfo: unknown };
      };
      expect(initialized.result.serverInfo).toMatchObject({
        name: "djl-multipost",
        title: "DJL multipost mcp",
      });
      const listed = (await (await rpc("tools/list", {})).json()) as {
        result: { tools: { name: string }[] };
      };
      expect(
        listed.result.tools.some((x: { name: string }) => x.name === "djl_multipost_submit"),
      ).toBe(true);
      expect(
        listed.result.tools.some((x: { name: string }) => /approve|create_grant/.test(x.name)),
      ).toBe(false);
      await rpc("tools/call", {
        name: "djl_multipost_submit",
        arguments: { draftId: "draft", revision: 1 },
      });
      expect(calls[0]).toEqual([
        scope,
        { action: "submit-draft", draftId: "draft", revision: 1 },
        "agent",
      ]);
      const rejected = (await (
        await rpc("tools/call", {
          name: "djl_multipost_draft",
          arguments: { action: "approve-draft", draftId: "draft", revision: 1 },
        })
      ).json()) as { result: { isError: boolean } };
      expect(rejected.result.isError).toBe(true);
      server.unregister(registration.bearerToken);
      expect((await rpc("tools/list", {})).status).toBe(401);
    } finally {
      await server.close();
    }
  });
});

describe("one-prompt posting tool", () => {
  it("turns a single djl_multipost_post call into one post command from the agent", async () => {
    const calls: unknown[] = [];
    const server = new MultiPostMcpServer({
      command: async (s, c, a) => {
        calls.push([s, c, a]);
        return {
          drafts: [],
          jobs: [],
          posted: true,
          needsApproval: false,
          skipped: [],
          message: "Queued for Personal.",
        };
      },
    });
    try {
      const registration = await server.register(scope);
      const rpc = (method: string, params: unknown) =>
        fetch(registration.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${registration.bearerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }).then((response) => response.json());
      const listed = (await rpc("tools/list", {})) as {
        result: { tools: { name: string; inputSchema: { required?: string[] } }[] };
      };
      const tool = listed.result.tools.find((x) => x.name === "djl_multipost_post");
      expect(tool?.inputSchema.required).toEqual(["text"]);
      expect(listed.result.tools.some((x) => /autopilot/.test(x.name))).toBe(false);
      const called = (await rpc("tools/call", {
        name: "djl_multipost_post",
        arguments: { text: "Hello", media: ["made.png"], accountIds: ["a"] },
      })) as { result: { isError: boolean; structuredContent: { message: string } } };
      expect(calls[0]).toEqual([
        scope,
        { action: "quick-post", post: { text: "Hello", media: ["made.png"], accountIds: ["a"] } },
        "agent",
      ]);
      expect(called.result).toMatchObject({
        isError: false,
        structuredContent: { message: "Queued for Personal." },
      });
    } finally {
      await server.close();
    }
  });
});
