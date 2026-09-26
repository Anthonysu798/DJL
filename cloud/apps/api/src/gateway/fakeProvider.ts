/**
 * Deterministic provider for tests and local development. Echoes the last
 * user message in chunks; special prompts drive edge cases:
 *   "refuse"       → finish_reason content_filter
 *   "long:<n>"     → n chunks of 40 characters (for cut-off tests)
 *   "fail"         → retryable provider error before any output
 *   "tool"         → a tool call
 *   "hang"         → (images) never finishes until the request is aborted
 * Generated and edited images are a tiny valid PNG so callers can store them.
 */
import {
  ProviderError,
  type ChatChunk,
  type ChatRequest,
  type ProviderAdapter,
} from "@djl/providers";

/** Like fetch: rejects on abort, including a signal that was aborted before the call. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new Error("aborted"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

/** A 1x1 transparent PNG. */
export const FAKE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export function createFakeProvider(): ProviderAdapter {
  return {
    id: "openai",
    async *chatStream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
      const last = req.messages.toReversed().find((m) => m.role === "user");
      const text = typeof last?.content === "string" ? last.content : "hello";
      const id = `fake-${crypto.randomUUID().slice(0, 8)}`;
      if (text === "fail")
        throw new ProviderError("openai", 503, "unavailable", "fake outage", true);
      yield { id, delta: { role: "assistant" }, finish_reason: null };
      if (text.startsWith("long:")) {
        const n = Number(text.slice(5));
        for (let i = 0; i < n; i += 1) {
          if (signal.aborted) return;
          yield { id, delta: { content: "x".repeat(40) }, finish_reason: null };
        }
        yield {
          id,
          delta: {},
          finish_reason: "stop",
          usage: { input_tokens: 5, output_tokens: n * 10, cached_input_tokens: 0 },
        };
        return;
      }
      if (text === "tool") {
        yield {
          id,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: '{"q":"x"}' },
              },
            ],
          },
          finish_reason: null,
        };
        yield {
          id,
          delta: {},
          finish_reason: "tool_calls",
          usage: { input_tokens: 8, output_tokens: 6, cached_input_tokens: 0 },
        };
        return;
      }
      if (text === "refuse") {
        yield {
          id,
          delta: { content: "I can't help with that." },
          finish_reason: "content_filter",
          usage: { input_tokens: 4, output_tokens: 6, cached_input_tokens: 0 },
        };
        return;
      }
      const reply = `echo: ${text}`;
      for (let i = 0; i < reply.length; i += 6) {
        if (signal.aborted) return;
        yield { id, delta: { content: reply.slice(i, i + 6) }, finish_reason: null };
      }
      yield {
        id,
        delta: {},
        finish_reason: "stop",
        usage: {
          input_tokens: Math.ceil(text.length / 4) + 4,
          output_tokens: Math.ceil(reply.length / 4),
          cached_input_tokens: 0,
        },
      };
    },
    async generateImage(req, signal) {
      if (req.prompt === "fail")
        throw new ProviderError("openai", 503, "unavailable", "fake outage", true);
      if (req.prompt === "hang") await untilAborted(signal);
      return {
        images: Array.from({ length: req.n }, () => ({ b64_json: FAKE_PNG_BASE64 })),
        count: req.n,
      };
    },
    async editImage(req, signal) {
      if (req.prompt === "fail")
        throw new ProviderError("openai", 503, "unavailable", "fake outage", true);
      if (req.prompt === "hang") await untilAborted(signal);
      return {
        images: Array.from({ length: req.n }, () => ({ b64_json: FAKE_PNG_BASE64 })),
        count: req.n,
      };
    },
    async embed(req) {
      return {
        embeddings: req.input.map((s) => [s.length / 100, 0.5, -0.25]),
        usage: { input_tokens: req.input.reduce((a, s) => a + Math.ceil(s.length / 4), 0) },
      };
    },
  };
}
