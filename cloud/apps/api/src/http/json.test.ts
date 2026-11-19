import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";

import { ApiError, errorResponse } from "./errors.ts";
import { json, readJson } from "./json.ts";

const limit = 256 * 1024;
const encoder = new TextEncoder();

function trackedBody(bytes: Uint8Array, chunkBytes = 16 * 1024) {
  let producedBytes = 0;
  let finalChunkProduced = false;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (producedBytes === bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(producedBytes + chunkBytes, bytes.byteLength);
        controller.enqueue(bytes.subarray(producedBytes, end));
        producedBytes = end;
        finalChunkProduced = end === bytes.byteLength;
      },
      cancel: cancelled,
    },
    { highWaterMark: 0 },
  );
  return {
    body,
    cancelled,
    producedBytes: () => producedBytes,
    finalChunkProduced: () => finalChunkProduced,
  };
}

function post(raw?: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1/json", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(raw === undefined ? {} : { body: raw }),
    ...(typeof raw === "object" ? { duplex: "half" as const } : {}),
  });
}

function fixture() {
  const received = vi.fn<(value: unknown) => void>();
  const parse = readJson.pipe(
    Effect.map((value) => {
      received(value);
      return json({ parsed: true });
    }),
    Effect.catchIf(
      (error): error is ApiError => error instanceof ApiError,
      (error) =>
        Effect.succeed(errorResponse(error.status, error.code, error.message, "json-unit")),
    ),
  );
  const router = HttpRouter.toWebHandler(
    Layer.mergeAll(
      HttpRouter.add("POST", "/json", parse),
      HttpRouter.add("GET", "/bigint", Effect.succeed(json({ amount: 12345678901234567890n }))),
    ),
    { disableLogger: true },
  );
  return { received, handler: router.handler, dispose: router.dispose };
}

describe("JSON body byte limit and existing error contract", () => {
  it("stops and releases an oversized headerless stream before its final chunk", async () => {
    const f = fixture();
    const chunkBytes = 16 * 1024;
    const raw = JSON.stringify({ value: "x".repeat(1024 * 1024) });
    const source = trackedBody(encoder.encode(raw), chunkBytes);
    const request = post(source.body);
    expect(request.headers.has("content-length")).toBe(false);
    try {
      const response = await f.handler(request);
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("payload_too_large");
      expect(f.received).not.toHaveBeenCalled();
      // Permit bounded adapter read-ahead, not zero overshoot or a timing-dependent assertion.
      expect(source.producedBytes()).toBeLessThanOrEqual(limit + 4 * chunkBytes);
      expect(source.finalChunkProduced()).toBe(false);
      expect(source.cancelled).toHaveBeenCalledOnce();
      expect(source.body.locked).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it("rejects headerless UTF-8 bytes above the limit even when UTF-16 length is below it", async () => {
    const f = fixture();
    const raw = JSON.stringify({ value: "中".repeat(100000) });
    const source = trackedBody(encoder.encode(raw));
    const request = post(source.body);
    expect(raw.length).toBeLessThan(limit);
    expect(encoder.encode(raw).byteLength).toBeGreaterThan(limit);
    expect(request.headers.has("content-length")).toBe(false);
    try {
      const response = await f.handler(request);
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("payload_too_large");
      expect(f.received).not.toHaveBeenCalled();
      expect(source.body.locked).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it("accepts an ASCII JSON stream at the exact byte limit", async () => {
    const f = fixture();
    const value = "x".repeat(limit - encoder.encode(JSON.stringify({ value: "" })).byteLength);
    const raw = JSON.stringify({ value });
    const source = trackedBody(encoder.encode(raw));
    expect(encoder.encode(raw).byteLength).toBe(limit);
    try {
      const response = await f.handler(post(source.body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ parsed: true });
      expect(f.received).toHaveBeenCalledExactlyOnceWith({ value });
      expect(source.producedBytes()).toBe(limit);
      expect(source.body.locked).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it("accepts exact-limit UTF-8 and preserves characters split across source chunks", async () => {
    const f = fixture();
    const paddingBytes = limit - encoder.encode(JSON.stringify({ value: "" })).byteLength;
    const value = "中".repeat(Math.floor(paddingBytes / 3)) + "x".repeat(paddingBytes % 3);
    const raw = JSON.stringify({ value });
    // The first byte boundary is inside the first three-byte character; later boundaries split more.
    const chunkBytes = 1025;
    const source = trackedBody(encoder.encode(raw), chunkBytes);
    expect(encoder.encode(raw).byteLength).toBe(limit);
    expect((chunkBytes - encoder.encode('{"value":"').byteLength) % 3).not.toBe(0);
    try {
      const response = await f.handler(post(source.body));
      expect(response.status).toBe(200);
      expect(f.received).toHaveBeenCalledExactlyOnceWith({ value });
      expect(source.body.locked).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it("preserves Fetch text decoding of a leading UTF-8 BOM split across chunks", async () => {
    const f = fixture();
    const source = trackedBody(encoder.encode('\uFEFF{"value":"BOM fixture"}'), 2);
    try {
      const response = await f.handler(post(source.body));
      expect(response.status).toBe(200);
      expect(f.received).toHaveBeenCalledExactlyOnceWith({ value: "BOM fixture" });
      expect(source.body.locked).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it("preserves replacement decoding of malformed UTF-8 inside a JSON string", async () => {
    const f = fixture();
    const bytes = Uint8Array.from([
      ...encoder.encode('{"value":"'),
      0xc3,
      0x28,
      ...encoder.encode('"}'),
    ]);
    const source = trackedBody(bytes, 1);
    try {
      const response = await f.handler(post(source.body));
      expect(response.status).toBe(200);
      expect(f.received).toHaveBeenCalledExactlyOnceWith({ value: "\uFFFD(" });
      expect(source.body.locked).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it.each([undefined, ""])("keeps empty body %j as bad_json", async (raw) => {
    const f = fixture();
    try {
      const response = await f.handler(post(raw));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad_json");
      expect(f.received).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });

  it("keeps malformed JSON as bad_json", async () => {
    const f = fixture();
    try {
      const response = await f.handler(post('{"value":'));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad_json");
      expect(f.received).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });

  it("keeps a source read failure as bad_body without leaking the source error", async () => {
    const f = fixture();
    const source = new ReadableStream<Uint8Array>(
      { pull: (controller) => controller.error(new Error("synthetic-json-source-failure")) },
      { highWaterMark: 0 },
    );
    try {
      const response = await f.handler(post(source));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("bad_body");
      expect(JSON.stringify(body)).not.toContain("synthetic-json-source-failure");
      expect(f.received).not.toHaveBeenCalled();
      expect(source.locked).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it("rejects an oversized Content-Length before pulling the source", async () => {
    const f = fixture();
    const source = trackedBody(encoder.encode("{}"));
    try {
      const response = await f.handler(post(source.body, { "content-length": String(limit + 1) }));
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("payload_too_large");
      expect(source.producedBytes()).toBe(0);
      expect(source.finalChunkProduced()).toBe(false);
      expect(source.body.locked).toBe(false);
      expect(f.received).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });

  it("leaves bigint JSON responses and their cache policy unchanged", async () => {
    const f = fixture();
    try {
      const response = await f.handler(new Request("http://127.0.0.1/bigint"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ amount: "12345678901234567890" });
    } finally {
      await f.dispose();
    }
  });
});
