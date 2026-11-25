import { Effect, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ApiError } from "./errors.ts";

const MAX_JSON_BYTES = 256 * 1024;

/**
 * A body is only read as JSON when it is declared as JSON. A browser sends
 * `text/plain` and form posts cross-origin without a preflight; `application/json` it cannot.
 */
export const requireJsonContentType = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const type = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json")
    return yield* Effect.fail(
      new ApiError(415, "unsupported_media_type", "Send the body as application/json."),
    );
});

/**
 * The raw body, failing with 413 once more than `maxBytes` arrive. Counts streamed bytes,
 * so a chunked body without a content-length cannot grow past the cap either.
 */
export const readBoundedBytes = (maxBytes: number) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const length = Number(request.headers["content-length"] ?? "0");
    if (length > maxBytes)
      return yield* Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
    const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
      Effect.mapError(() => new ApiError(400, "bad_body", "Could not read body.")),
    );
    const body = webRequest.body;
    if (body === null) return new Uint8Array();
    const raw = yield* Stream.runFoldEffect(
      Stream.fromReadableStream({
        evaluate: () => body,
        onError: () => new ApiError(400, "bad_body", "Could not read body."),
        releaseLockOnEnd: true,
      }),
      () => ({ chunks: [] as Uint8Array[], bytes: 0 }),
      (acc, chunk) => {
        if (chunk.byteLength > maxBytes - acc.bytes)
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
    return new Uint8Array(Buffer.concat(raw.chunks, raw.bytes));
  });

/** Parse a JSON body of at most `maxBytes`, or fail with a 400 ApiError (415 when not JSON). */
export const readJsonUpTo = (maxBytes: number) =>
  Effect.gen(function* () {
    yield* requireJsonContentType;
    const bytes = yield* readBoundedBytes(maxBytes);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      return yield* Effect.fail(new ApiError(400, "bad_json", "Body is not valid JSON."));
    }
  });

/** Parse a small JSON body or fail with a 400 ApiError (415 when it is not declared as JSON). */
export const readJson = readJsonUpTo(MAX_JSON_BYTES);

/** JSON response with bigint-safe serialization (microcredits as strings). */
export function json(body: unknown, status = 200) {
  const text = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return HttpServerResponse.text(text, {
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
  });
}
