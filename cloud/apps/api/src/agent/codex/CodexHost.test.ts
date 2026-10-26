import { describe, expect, it, vi } from "vitest";
import { CodexHost } from "./CodexHost.ts";
import { ScopedGateway } from "./ScopedGateway.ts";
import type { TaskHarnessInput } from "../AgentRunner.ts";

function fixture() {
  const addParts = vi.fn(async () => {});
  const append = vi.fn(async () => {});
  const input = {
    run: { id: "run", model: "bound", messageId: "reply", spentMicro: 0n, toolCalls: 0 },
    facts: { principal: { userId: "user", orgId: "org" } },
    signal: new AbortController().signal,
    messages: [{ role: "user", content: "write a file" }],
    parts: [],
    cap: 100n,
    deadline: Date.now() + 30_000,
    limits: { maxSteps: 25, maxToolCalls: 50, maxWallMs: 30_000 },
    log: { append },
    cancelRequested: async () => false,
    addParts,
    recordUsage: async () => {},
    beginStep: async () => {},
    recordToolCall: async () => {},
  } as unknown as TaskHarnessInput;
  return { input, addParts, append };
}

describe("Codex cloud task orchestration", () => {
  it("maps native command and message items into the existing DJL run stream, then revokes the runtime credential", async () => {
    const { input, addParts, append } = fixture();
    const gateway = new ScopedGateway({ responsesStream: vi.fn() });
    let token = "";
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const path = String(url);
      const body = JSON.parse(String(options?.body));
      calls.push(path);
      if (path.endsWith("/start")) {
        token = body.gatewayToken;
        return Response.json({ sessionId: "session" });
      }
      if (path.endsWith("/events"))
        return Response.json({
          events: [
            {
              seq: 1,
              method: "item/started",
              params: { item: { id: "command", type: "commandExecution", command: "echo hello" } },
            },
            {
              seq: 2,
              method: "item/completed",
              params: {
                item: {
                  id: "command",
                  type: "commandExecution",
                  status: "completed",
                  aggregatedOutput: "hello",
                },
              },
            },
            {
              seq: 3,
              method: "item/agentMessage/delta",
              params: { itemId: "message", delta: "Done" },
            },
            {
              seq: 4,
              method: "item/completed",
              params: { item: { id: "message", type: "agentMessage", text: "Done" } },
            },
            { seq: 5, method: "turn/completed", params: { turn: { status: "completed" } } },
          ],
        });
      if (body.method === "thread/list") return Response.json({ data: [] });
      if (body.method === "thread/start") return Response.json({ thread: { id: "thread" } });
      return Response.json({});
    }) as unknown as typeof fetch;
    const host = new CodexHost({
      baseUrl: "http://broker",
      controlToken: "control",
      gateway,
      authorize: async (facts) => facts,
      resolveModel: async (model) => model,
      allowedOrgs: new Set(["org"]),
      fetchImpl,
    });
    expect(await host.execute(input)).toEqual({ status: "succeeded" });
    expect(addParts.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        [
          {
            type: "tool_result",
            toolCallId: "command",
            name: "commandExecution",
            content: "hello",
            isError: false,
          },
        ],
        [{ type: "text", text: "Done" }],
      ]),
    );
    expect(append).toHaveBeenCalledWith("text.delta", { messageId: "reply", text: "Done" });
    expect(calls.at(-1)).toBe("http://broker/runs/session/stop");
    expect(
      (
        await gateway.handle(
          new Request("http://worker/v1/responses", {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: JSON.stringify({ model: "bound", input: "hi" }),
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("cancels promptly while waiting for native events and cleans up the container", async () => {
    const { input } = fixture();
    const stopped: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, options?: RequestInit) => {
      const path = String(url);
      const body = JSON.parse(String(options?.body));
      if (path.endsWith("/events"))
        return new Promise<Response>((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        );
      if (path.endsWith("/start")) return Response.json({ sessionId: "session" });
      if (path.endsWith("/stop")) stopped.push(path);
      if (body.method === "thread/list") return Response.json({ data: [] });
      if (body.method === "thread/start") return Response.json({ thread: { id: "thread" } });
      return Response.json({});
    }) as typeof fetch;
    const host = new CodexHost({
      baseUrl: "http://broker",
      controlToken: "control",
      gateway: new ScopedGateway({ responsesStream: vi.fn() }),
      authorize: async (facts) => facts,
      resolveModel: async (model) => model,
      allowedOrgs: new Set(["org"]),
      fetchImpl,
    });
    expect(await host.execute({ ...input, cancelRequested: async () => true })).toEqual({
      status: "cancelled",
    });
    expect(stopped).toHaveLength(1);
  });
});
