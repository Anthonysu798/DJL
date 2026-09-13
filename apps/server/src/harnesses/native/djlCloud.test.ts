import type { FetchLike } from "../../cloud/api";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderSessionStartInput } from "@synara/contracts";
import { ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

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
  await writeCloudSession(secretsDir, { apiBaseUrl: "https://cloud.test", token: "sess", userId: "u", email: "e@x.y", orgId: "o", createdAt: "x" });
});

const start: ProviderSessionStartInput = {
  threadId: ThreadId.makeUnsafe("thread-1"),
  cwd: process.cwd(),
  runtimeMode: "approval-required",
  modelSelection: { provider: "djlCloud", model: "gpt-5-mini" },
};

function sink() {
  const events: Record<string, unknown>[] = [];
  const s: NativeSink = { emit: (e) => void events.push(e), request: async () => "cancel", fail: () => {} };
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
        return new Response(JSON.stringify({ models: [{ id: "gpt-5-mini", provider: "openai", displayName: "GPT-5 mini", capabilities: ["text.chat", "tools"], contextWindow: 400000, maxOutputTokens: 1000, status: "active" }, { id: "img", provider: "openai", displayName: "Img", capabilities: ["image.generate"], contextWindow: null, maxOutputTokens: null, status: "active" }] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    const driver = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, sink().s);
    const { s, events } = sink();
    const driver2 = await createDjlCloudDriverFactory({ secretsDir, fetchImpl })(start, s);
    await driver2.send({ threadId: start.threadId, input: "hi there" });
    const text = events.filter((e) => e.type === "content.delta").map((e) => (e.payload as { delta: string }).delta).join("");
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
        fetchImpl: async () => new Response(JSON.stringify({ error: { code, message: "m", traceId: "t" } }), { status }),
      })(start, sink().s);
    await expect((await out(402, "insufficient_credits")).send({ threadId: start.threadId, input: "x" })).rejects.toThrow(/out of DJL Cloud credits/);
    await expect((await out(401, "unauthorized")).send({ threadId: start.threadId, input: "x" })).rejects.toThrow(/session expired/);
  });

  it("requires a stored session", async () => {
    const empty = await mkdtemp(join(tmpdir(), "djl-cloud-empty-"));
    await expect(createDjlCloudDriverFactory({ secretsDir: empty })(start, sink().s)).rejects.toThrow(/Sign in to DJL Cloud/);
  });
});
