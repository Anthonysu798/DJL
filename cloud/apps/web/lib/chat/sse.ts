/** Minimal text/event-stream parser (WHATWG rules for `event`, `data`, `id`, comments). */
export interface SseMessage {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = stream
    .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>)
    .getReader();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let id: string | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let newline: number;
      while ((newline = buffer.search(/\r\n|\r|\n/)) !== -1) {
        // A trailing "\r" may be the first half of "\r\n"; wait for the next chunk.
        if (newline === buffer.length - 1 && buffer.endsWith("\r")) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
        if (line === "") {
          if (data.length > 0) yield { event: event || "message", data: data.join("\n"), id };
          event = "";
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
        else if (field === "id") id = value;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Encodes one SSE message; used by the mock API. */
export const formatSse = (event: string, data: unknown, id?: string | number) =>
  `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
