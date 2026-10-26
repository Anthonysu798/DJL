import { describe, expect, it } from "vitest";
import { responseChunk, validateResponseRequest } from "./responses.ts";

describe("Responses protocol", () => {
  it("accepts workspace namespaces and refuses hosted tools inside them", () => {
    const base = { model: "m", input: "hi" };
    expect(
      validateResponseRequest({
        ...base,
        tools: [
          {
            type: "namespace",
            name: "functions",
            tools: [{ type: "function", name: "exec_command", parameters: {} }],
          },
        ],
      }).tools,
    ).toHaveLength(1);
    expect(() =>
      validateResponseRequest({
        ...base,
        tools: [{ type: "namespace", name: "hosted", tools: [{ type: "web_search" }] }],
      }),
    ).toThrow();
  });
  it("accepts native Codex client metadata without forwarding workstation details upstream", () => {
    const request = validateResponseRequest({
      model: "m",
      input: "hi",
      client_metadata: { runtime: "codex", thread: "local-thread" },
    });
    expect(request).not.toHaveProperty("client_metadata");
  });
  it("keeps native function, custom-tool, and reasoning events intact", () => {
    const event = {
      type: "response.function_call_arguments.delta",
      delta: '{"x":1}',
      item_id: "fc_1",
      output_index: 0,
    };
    expect(responseChunk(event).responseEvent).toEqual(event);
    expect(
      responseChunk({ type: "response.reasoning_text.delta", delta: "thinking" }).delta.content,
    ).toBe("thinking");
  });
  it("accounts for cached inputs and reasoning output from upstream usage", () => {
    const chunk = responseChunk({
      type: "response.completed",
      response: {
        id: "resp_1",
        usage: {
          input_tokens: 100,
          output_tokens: 40,
          input_tokens_details: { cached_tokens: 30 },
        },
      },
    });
    expect(chunk.usage).toEqual({ input_tokens: 70, output_tokens: 40, cached_input_tokens: 30 });
  });
  it("rejects corrupt upstream usage rather than treating it as free", () => {
    for (const usage of [
      { input_tokens: -1, output_tokens: 1 },
      { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } },
    ])
      expect(() => responseChunk({ type: "response.completed", response: { usage } })).toThrow();
  });
  it("forces stateless streaming and refuses hosted tools and provider overrides", () => {
    const base = { model: "test", input: "hello", stream: true, store: false };
    expect(validateResponseRequest(base).store).toBe(false);
    for (const extra of [
      { store: true },
      { stream: false },
      { previous_response_id: "other-account" },
      { provider: { order: ["other"] } },
      { tools: [{ type: "web_search" }] },
    ])
      expect(() => validateResponseRequest({ ...base, ...extra })).toThrow();
  });
  it("validates finite positive output limits and the input shape", () => {
    for (const extra of [
      { max_output_tokens: -10 },
      { max_output_tokens: 1.2 },
      { input: null },
      { model: "" },
    ])
      expect(() => validateResponseRequest({ model: "m", input: "hi", ...extra })).toThrow();
  });
});
