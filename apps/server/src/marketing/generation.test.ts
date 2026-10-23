import { describe, it, expect } from "vitest";
import { parseGeneratedCopy, readGenerationStream } from "./generation";
describe("campaign generation", () => {
  it("rejects missing destinations and preserves quoted prices", () => {
    expect(() => parseGeneratedCopy('{"instagram":"Hello"}', ["instagram", "red"])).toThrow();
    expect(parseGeneratedCopy('{"instagram":"Rooms from $199"}', ["instagram"])).toEqual({
      instagram: "Rooms from $199",
    });
  });
  it("handles split SSE chunks and refuses provider errors", async () => {
    const content = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(content.slice(0, 17)));
        c.enqueue(new TextEncoder().encode(content.slice(17)));
        c.close();
      },
    });
    expect(await readGenerationStream(stream)).toBe("hello");
    const error = new Response('event: error\ndata: {"error":{"message":"Refused"}}\n\n');
    await expect(readGenerationStream(error.body!)).rejects.toThrow("Refused");
  });
});
