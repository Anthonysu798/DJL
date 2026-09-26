import { Effect } from "effect";
import type { HttpServerResponse } from "effect/unstable/http";

import { RequestContext } from "./context.ts";
import { ApiError, errorResponse } from "./errors.ts";

/** Turn ApiError failures into the JSON envelope; anything else reaches the 500 handler. */
export function handle<R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, ApiError, R>,
) {
  return Effect.gen(function* () {
    const ctx = yield* RequestContext;
    return yield* effect.pipe(
      Effect.catchIf(
        (e): e is ApiError => e instanceof ApiError,
        (e) => Effect.succeed(errorResponse(e.status, e.code, e.message, ctx.traceId)),
      ),
    );
  });
}

/**
 * Run a promise-returning service call, passing ApiErrors through and hiding everything else.
 * `signal` aborts when the request is interrupted (the client disconnected).
 */
export function attempt<A>(
  fn: (signal: AbortSignal) => Promise<A>,
  fallback: { readonly status: number; readonly code: string; readonly message: string },
) {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => {
      if (e instanceof ApiError) return e;
      console.error(
        JSON.stringify({
          level: "error",
          msg: fallback.code,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      return new ApiError(fallback.status, fallback.code, fallback.message);
    },
  });
}
