import { Effect, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ApiError } from "./errors.ts";

const MAX_JSON_BYTES = 256 * 1024;

/** Parse a small JSON body or fail with a 400 ApiError. */
export const readJson = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const length = Number(request.headers["content-length"] ?? "0");
  if (length > MAX_JSON_BYTES)
    return yield* Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
  const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
    Effect.mapError(() => new ApiError(400, "bad_body", "Could not read body.")),
  );
  const body = webRequest.body;
  let text = "";
  if (body !== null) {
    const raw = yield* Stream.runFoldEffect(
      Stream.fromReadableStream({
        evaluate: () => body,
        onError: () => new ApiError(400, "bad_body", "Could not read body."),
        releaseLockOnEnd: true,
      }),
      () => ({ chunks: [] as Uint8Array[], bytes: 0 }),
      (acc, chunk) => {
        if (chunk.byteLength > MAX_JSON_BYTES - acc.bytes)
          return Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
        if (chunk.byteLength > 0) acc.chunks.push(chunk);
        acc.bytes += chunk.byteLength;
        return Effect.succeed(acc);
      },
    ).pipe(
      Effect.ensuring(
        Effect.tryPromise({
          try: () => body.cancel(),
          catch: () => undefined,
        }).pipe(Effect.ignore),
      ),
    );
    text = new TextDecoder().decode(Buffer.concat(raw.chunks, raw.bytes));
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return yield* Effect.fail(new ApiError(400, "bad_json", "Body is not valid JSON."));
  }
});

/** JSON response with bigint-safe serialization (microcredits as strings). */
export function json(body: unknown, status = 200) {
  const text = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return HttpServerResponse.text(text, {
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
  });
}
