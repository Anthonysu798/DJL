import { describe, expect, it } from "vitest";

import { createAnthropicAdapter, toAnthropicRequest } from "./anthropic.ts";
import { CircuitBreaker } from "./breaker.ts";
import { KeyRing } from "./keys.ts";
import { createOpenAiCompatibleAdapter } from "./openaiCompatible.ts";
import { ProviderError } from "./types.ts";

function sseResponse(events: readonly string[], init: ResponseInit = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(new TextEncoder().encode(e));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    ...init,
  });
}

async function collect<T>(iter: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe("OpenAI-compatible adapter", () => {
  it("streams chunks and the trailing usage, and stops on [DONE]", async () => {
    const calls: { headers: Headers; body: string }[] = [];
    const adapter = createOpenAiCompatibleAdapter({
      id: "openai",
      baseUrl: "https://api.test/v1",
      keys: new KeyRing("k1", null),
      fetchImpl: async (_url, init) => {
        calls.push({ headers: new Headers(init?.headers), body: String(init?.body) });
        return sseResponse([
          'data: {"id":"c1","choices":[{"delta":{"role":"assistant","content":"Hel"},"finish_reason":null}]}\n\n',
          'data: {"id":"c1","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
          'data: {"id":"c1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":4}}}\n\n',
          "data: [DONE]\n\n",
          'data: {"id":"ignored"}\n\n',
        ]);
      },
    });
    const chunks = await collect(
      adapter.chatStream(
        { model: "gpt-x", messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      ),
    );
    expect(chunks.map((c) => c.delta.content ?? "").join("")).toBe("Hello");
    expect(chunks.at(-1)?.usage).toEqual({
      input_tokens: 10,
      output_tokens: 2,
      cached_input_tokens: 4,
    });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer k1");
    expect(JSON.parse(calls[0]!.body).stream_options.include_usage).toBe(true);
  });

  it("switches to the fallback key on 401 and classifies errors", async () => {
    let n = 0;
    const adapter = createOpenAiCompatibleAdapter({
      id: "openrouter",
      baseUrl: "https://or.test/v1",
      keys: new KeyRing("bad", "good"),
      fetchImpl: async (_url, init) => {
        n += 1;
        const auth = new Headers(init?.headers).get("authorization");
        if (auth === "Bearer bad") return new Response("nope", { status: 401 });
        return new Response(JSON.stringify({ data: [{ b64_json: "AAA" }] }), { status: 200 });
      },
    });
    const result = await adapter.generateImage(
      { model: "flux", prompt: "a cat", n: 1 },
      new AbortController().signal,
    );
    expect(result.count).toBe(1);
    expect(n).toBe(2);
    const rateLimited = createOpenAiCompatibleAdapter({
      id: "openai",
      baseUrl: "x",
      keys: new KeyRing("k", null),
      fetchImpl: async () => new Response("slow down", { status: 429 }),
    });
    await expect(
      rateLimited.embed({ model: "e", input: ["a"] }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  });

  it("sends image edits as multipart with the source image as a file", async () => {
    let seen: { url: string; headers: Headers; form: FormData } | null = null;
    const adapter = createOpenAiCompatibleAdapter({
      id: "openai",
      baseUrl: "https://api.test/v1",
      keys: new KeyRing("k1", null),
      fetchImpl: async (url, init) => {
        seen = {
          url: String(url),
          headers: new Headers(init?.headers),
          form: init?.body as FormData,
        };
        return new Response(JSON.stringify({ data: [{ b64_json: "QUJD" }] }), { status: 200 });
      },
    });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await adapter.editImage(
      {
        model: "gpt-image-1",
        prompt: "make it blue",
        image: { bytes, mimeType: "image/png" },
        n: 1,
      },
      new AbortController().signal,
    );
    expect(result).toEqual({ images: [{ b64_json: "QUJD" }], count: 1 });
    expect(seen!.url).toBe("https://api.test/v1/images/edits");
    expect(seen!.headers.get("content-type")).toBeNull(); // fetch sets the multipart boundary
    expect(seen!.form.get("prompt")).toBe("make it blue");
    const image = seen!.form.get("image") as File;
    expect(image.type).toBe("image/png");
    expect(image.name).toBe("image.png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
  });
});

describe("Anthropic adapter", () => {
  it("translates system, tools, tool results, and images", () => {
    const body = toAnthropicRequest({
      model: "claude",
      max_tokens: 100,
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "d",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        },
      ],
      messages: [
        { role: "system", content: "be brief" },
        {
          role: "user",
          content: [
            { type: "text", text: "see" },
            { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
          ],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "t1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
          ],
        },
        { role: "tool", tool_call_id: "t1", content: "42" },
      ],
    });
    expect(body.system).toBe("be brief");
    expect(body.messages[0]?.content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "QUJD" },
    });
    expect(body.messages[1]?.content[0]).toMatchObject({
      type: "tool_use",
      id: "t1",
      name: "lookup",
      input: { q: "x" },
    });
    expect(body.messages[2]?.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "t1",
      content: "42",
    });
    expect(body.tools?.[0]?.name).toBe("lookup");
  });

  it("streams text and tool calls as OpenAI-shaped chunks with usage on message_delta", async () => {
    const adapter = createAnthropicAdapter({
      keys: new KeyRing("k", null),
      fetchImpl: async () =>
        sseResponse([
          'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","usage":{"input_tokens":7,"cache_read_input_tokens":0}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu1","name":"lookup"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"x\\"}"}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]),
    });
    const chunks = await collect(
      adapter.chatStream(
        { model: "claude", messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      ),
    );
    expect(chunks.find((c) => c.delta.content)?.delta.content).toBe("Hi");
    const args = chunks
      .flatMap((c) => c.delta.tool_calls ?? [])
      .map((t) => t.function?.arguments ?? "")
      .join("");
    expect(args).toBe('{"q":"x"}');
    const last = chunks.at(-1)!;
    expect(last.finish_reason).toBe("tool_calls");
    expect(last.usage).toEqual({ input_tokens: 7, output_tokens: 9, cached_input_tokens: 0 });
  });

  it("maps overloaded errors as retryable provider errors", async () => {
    const adapter = createAnthropicAdapter({
      keys: new KeyRing("k", null),
      fetchImpl: async () => new Response("overloaded", { status: 529 }),
    });
    await expect(
      collect(adapter.chatStream({ model: "c", messages: [] }, new AbortController().signal)),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("circuit breaker", () => {
  it("opens after the threshold, half-opens after the window, closes on success", () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 3, windowMs: 1000, openMs: 500 }, () => t);
    expect(b.allow()).toBe(true);
    b.failure();
    b.failure();
    expect(b.state()).toBe("closed");
    b.failure();
    expect(b.state()).toBe("open");
    expect(b.allow()).toBe(false);
    t = 600;
    expect(b.state()).toBe("half_open");
    expect(b.allow()).toBe(true); // one probe
    expect(b.allow()).toBe(false); // second waits
    b.success();
    expect(b.state()).toBe("closed");
  });
});
