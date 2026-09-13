/**
 * Request middleware: trace id, request context, CORS for trusted origins,
 * security headers, and a last-resort error envelope so no stack trace ever
 * reaches a client.
 */
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ApiEnv } from "../config/env.ts";
import { captureError, currentTraceId, httpRequests } from "../observability.ts";
import { RequestContext, clientIp, newTraceId } from "./context.ts";
import { errorResponse } from "./errors.ts";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site",
};

export function makeMiddleware(env: ApiEnv, region: string) {
  const trusted = new Set(env.trustedOrigins);
  return <E, R>(
    app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    Exclude<R, RequestContext> | HttpServerRequest.HttpServerRequest
  > =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const traceId =
        request.headers["x-trace-id"]?.slice(0, 64) ?? currentTraceId() ?? newTraceId();
      const origin = request.headers["origin"] ?? null;
      const corsHeaders: Record<string, string> = {};
      if (origin && trusted.has(origin)) {
        corsHeaders["access-control-allow-origin"] = origin;
        corsHeaders["access-control-allow-credentials"] = "true";
        corsHeaders["access-control-allow-headers"] =
          "authorization, content-type, x-trace-id, x-device-id";
        corsHeaders["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
        corsHeaders["access-control-max-age"] = "600";
        corsHeaders["vary"] = "Origin";
      }
      if (request.method === "OPTIONS") {
        return HttpServerResponse.empty({
          status: 204,
          headers: { ...SECURITY_HEADERS, ...corsHeaders },
        });
      }
      const context = {
        traceId,
        ip: clientIp(request.headers, request.remoteAddress ?? null),
        userAgent: request.headers["user-agent"] ?? null,
        region,
        startedAt: Date.now(),
      };
      const response = yield* (
        Effect.provideService(app, RequestContext, context) as Effect.Effect<
          HttpServerResponse.HttpServerResponse,
          E,
          Exclude<R, RequestContext>
        >
      ).pipe(
        Effect.catchCause((cause) => {
          console.error(
            JSON.stringify({ level: "error", traceId, msg: "unhandled", cause: String(cause) }),
          );
          captureError(new Error(String(cause)), {
            traceId,
            path: new URL(request.url, "http://x").pathname,
          });
          return Effect.succeed(errorResponse(500, "internal", "Something went wrong.", traceId));
        }),
      );
      const routeKey = new URL(request.url, "http://x").pathname.replace(/[0-9a-f-]{20,}/g, ":id");
      httpRequests.add(1, { route: routeKey, method: request.method, status: response.status });
      return HttpServerResponse.setHeaders(response, {
        ...SECURITY_HEADERS,
        ...corsHeaders,
        "x-trace-id": traceId,
      });
    });
}
