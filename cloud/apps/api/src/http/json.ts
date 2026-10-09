import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ApiError } from "./errors.ts";

const MAX_JSON_BYTES = 256 * 1024;

/** Parse a small JSON body or fail with a 400 ApiError. */
export const readJson = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const length = Number(request.headers["content-length"] ?? "0");
  if (length > MAX_JSON_BYTES)
    return yield* Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
  const text = yield* request.text.pipe(
    Effect.mapError(() => new ApiError(400, "bad_body", "Could not read body.")),
  );
  if (text.length > MAX_JSON_BYTES)
    return yield* Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
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
