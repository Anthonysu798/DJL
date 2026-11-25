import type { ChatRequest } from "@djl/providers";
import { describe, expect, it } from "vitest";

import { estimateInput } from "./routing.ts";

const base: ChatRequest = { model: "m", messages: [{ role: "user", content: "hi" }] };
const tokens = (request: ChatRequest) => estimateInput(request).tokens;

describe("estimateInput", () => {
  it("counts everything that is sent upstream, not just message text", () => {
    const plain = tokens(base);
    const big = "x".repeat(404_000);
    // Each of these is forwarded to the provider and billed as input.
    const withTools = tokens({
      ...base,
      tools: [{ type: "function", function: { name: "lookup", description: big } }],
    });
    const withSchema = tokens({
      ...base,
      response_format: { type: "json_schema", json_schema: { description: big } },
    });
    const withToolCall = tokens({
      ...base,
      messages: [
        ...base.messages,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "lookup", arguments: big } },
          ],
        },
      ],
    });
    const withFilePart = tokens({
      ...base,
      messages: [{ role: "user", content: [{ type: "file", file: { file_data: big } }] as never }],
    });
    for (const counted of [withTools, withSchema, withToolCall, withFilePart])
      expect(counted - plain).toBeGreaterThanOrEqual(404_000 / 3);
  });

  it("does not under-count CJK text", () => {
    const cjk = "你".repeat(1000);
    const delta = tokens({ ...base, messages: [{ role: "user", content: cjk }] }) - tokens(base);
    expect(delta).toBeGreaterThanOrEqual(1000);
  });

  it("counts an image part as a flat amount, whatever its bytes, and keeps the rest of the part", () => {
    const image = (url: string, extra: Record<string, unknown> = {}): ChatRequest => ({
      ...base,
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url }, ...extra }] as never },
      ],
    });
    const small = estimateInput(image("https://example.test/a.png"));
    const large = estimateInput(image(`data:image/png;base64,${"A".repeat(1_000_000)}`));
    expect(large).toEqual(small);
    expect(small.tokens - tokens(base)).toBeGreaterThanOrEqual(1_600);
    // Text smuggled next to the image is still counted.
    const padded = estimateInput(image("https://example.test/a.png", { text: "y".repeat(30_000) }));
    expect(padded.tokens - small.tokens).toBeGreaterThanOrEqual(10_000);
    expect(padded.chars - small.chars).toBeGreaterThanOrEqual(30_000);
  });
});
