import { describe, expect, it } from "vitest";

import { parseSse } from "./sse";

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      c.close();
    },
  });

describe("parseSse", () => {
  it("parses events split across chunks, CRLF endings, comments, and multi-line data", async () => {
    const out = [];
    for await (const m of parseSse(
      streamOf(
        ": keepalive\n\nid: 1\nevent: sta",
        'tus\ndata: {"a":1}\r',
        "\n\r\ndata: x\ndata: y\n\n",
      ),
    ))
      out.push(m);
    expect(out).toEqual([
      { event: "status", data: '{"a":1}', id: "1" },
      { event: "message", data: "x\ny", id: "1" },
    ]);
  });
});
