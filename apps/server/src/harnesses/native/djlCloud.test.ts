import type { FetchLike } from "../../cloud/api";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderSessionStartInput } from "@synara/contracts";
import { ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeCloudSession } from "../../cloud/session";
import { createDjlCloudDriverFactory } from "./djlCloud";
import type { NativeSink } from "./types";

const sse = (events: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const e of events) controller.enqueue(new TextEncoder().encode(e));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

let secretsDir = "";
beforeEach(async () => {
  secretsDir = await mkdtemp(join(tmpdir(), "djl-cloud-driver-"));
  await writeCloudSession(secretsDir, {
    apiBaseUrl: "https://cloud.test",
    token: "sess",
    userId: "u",
    email: "e@x.y",
    orgId: "o",
    createdAt: "x",
  });
});

const start: ProviderSessionStartInput = {
  threadId: ThreadId.makeUnsafe("thread-1"),
  cwd: process.cwd(),
  runtimeMode: "approval-required",
  modelSelection: { provider: "djlCloud", model: "gpt-5-mini" },
};

function sink() {
  const events: Record<string, unknown>[] = [];
  const s: NativeSink = {
    emit: (e) => void events.push(e),
    request: async () => "cancel",
    fail: () => {},
  };
  return { s, events };
}

describe("DJL Cloud driver", () => {
  it("streams assistant text deltas, keeps history, and lists models", async () => {
    const bodies: unknown[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/chat/completions")) {
        bodies.push(JSON.parse(String(init?.body)));
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sess");
        return sse([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
          'event: djl.usage\ndata: {"requestId":"r","settled":"12000","remaining":"999","cutOff":false}\n\n',
          "data: [DONE]\n\n",
        ]);
      }
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({
            models: [
              {
                id: "gpt-5-mini",
                provider: "openai",
                displayName: "GPT-5 mini",
                capabilities: ["text.chat", "tools"],
                contextWindow: 400000,
                maxOutputTokens: 1000,
                status: "active",
              },
              {
                id: "img",
                provider: "openai",
                displayName: "Img",
                capabilities: ["image.generate"],
                contextWindow: null,
                maxOutputTokens: null,
                status: "active",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    };
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, sink().s);
    const { s, events } = sink();
    const driver2 = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, s);
    await driver2.send({ threadId: start.threadId, input: "hi there" });
    const text = events
      .filter((e) => e.type === "content.delta")
      .map((e) => (e.payload as { delta: string }).delta)
      .join("");
    expect(text).toBe("Hello");
    expect(events.some((e) => e.type === "item.completed")).toBe(true);
    await driver2.send({ threadId: start.threadId, input: "again" });
    const second = bodies[1] as { messages: { role: string; content: string }[]; model: string };
    expect(second.model).toBe("gpt-5-mini");
    expect(second.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(second.messages[2]?.content).toBe("Hello");
    const models = await driver.models();
    expect(models.models.map((m) => m.slug)).toEqual(["gpt-5-mini"]);
    expect(models.models[0]?.supportsToolCalls).toBe(true);
  });

  it("surfaces credit exhaustion and expired sessions as readable errors", async () => {
    const out = async (status: number, code: string) =>
      createDjlCloudDriverFactory({
        secretsDir,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code, message: "m", traceId: "t" } }), { status }),
      })(start, sink().s);
    await expect(
      (await out(402, "insufficient_credits")).send({ threadId: start.threadId, input: "x" }),
    ).rejects.toThrow(/out of DJL Cloud credits/);
    await expect(
      (await out(401, "unauthorized")).send({ threadId: start.threadId, input: "x" }),
    ).rejects.toThrow(/session expired/);
  });

  it("requires a stored session", async () => {
    const empty = await mkdtemp(join(tmpdir(), "djl-cloud-empty-"));
    await expect(
      createDjlCloudDriverFactory({ secretsDir: empty })(start, sink().s),
    ).rejects.toThrow(/Sign in to DJL Cloud/);
  });
});

describe("marketing chat context", () => {
  it("preserves earlier facts and releases marketing tools when the route changes", async () => {
    const bodies: { messages: { content: string }[]; tools?: unknown }[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse([
        'data: {"choices":[{"delta":{"content":"Saved"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    };
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, sink().s, {
      name: "local",
      url: "http://127.0.0.1:9999/mcp",
      bearerToken: "test-only",
    });
    await driver.send({ threadId: start.threadId, input: "Our room price is $199, no discount." });
    await driver.send({
      threadId: start.threadId,
      input: "Use those facts for Instagram",
      workTurnPolicy: {
        route: "marketing",
        visibleTools: ["djl_marketing_status", "djl_prepare_marketing"],
        requireSuccessfulTool: true,
        evidenceRequired: true,
        instructionScope: "authorized-root",
      },
    });
    expect(bodies[1]!.messages.some((m) => m.content.includes("$199"))).toBe(true);
    await driver.send({
      threadId: start.threadId,
      input: "Now explain binary search",
      workTurnPolicy: {
        route: "coding",
        visibleTools: [],
        requireSuccessfulTool: false,
        evidenceRequired: false,
        instructionScope: "authorized-root",
      },
    });
    expect(bodies[2]!.tools).toBeUndefined();
  });
});

it("reports a failed marketing tool as failed in the chat activity", async () => {
  let round = 0;
  const fetchImpl: FetchLike = async () => {
    round++;
    return round === 1
      ? sse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"failed-call","function":{"name":"djl_prepare_marketing","arguments":"{}"}}]}}]}\n\n',
          "data: [DONE]\n\n",
        ])
      : sse([
          'data: {"choices":[{"delta":{"content":"The media could not be prepared."}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
  };
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        result: { isError: true, content: [{ type: "text", text: "Invalid media" }] },
      }),
    ),
  );
  try {
    const captured = sink();
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, captured.s, {
      name: "scoped",
      url: "http://127.0.0.1:9999/mcp",
      bearerToken: "fixture-token",
    });
    await driver.send({
      threadId: start.threadId,
      input: "Prepare a marketing campaign",
      workTurnPolicy: {
        route: "marketing",
        visibleTools: ["djl_prepare_marketing"],
        requireSuccessfulTool: true,
        evidenceRequired: true,
        instructionScope: "authorized-root",
      },
    });
    expect(captured.events).toContainEqual(
      expect.objectContaining({
        type: "item.completed",
        payload: expect.objectContaining({ status: "failed" }),
      }),
    );
  } finally {
    network.mockRestore();
  }
});
