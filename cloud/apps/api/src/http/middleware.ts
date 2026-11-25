/**
 * Request middleware: trace id, request context, CORS for trusted origins,
 * CSRF checks for cookie-authenticated mutations, security headers, and a
 * last-resort error envelope so no stack trace ever reaches a client.
 */
import { Cause, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ApiEnv } from "../config/env.ts";
import { isScopedCommercePath } from "../auth/commerceCsrf.ts";
import { captureError, currentTraceId, httpRequests } from "../observability.ts";
import { csrfRefusal } from "../security/csrf.ts";
import { RequestContext, clientIp, newTraceId } from "./context.ts";
import { errorResponse } from "./errors.ts";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site",
  // The API serves JSON only; nothing it returns may run script or be framed.
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "x-permitted-cross-domain-policies": "none",
};

const CSRF_MESSAGES = {
  csrf_origin: "This request did not come from a DJL page.",
  csrf_token: "Your page is out of date. Reload and try again.",
} as const;

/**
 * The path as the router will match it. The router ignores letter case, repeated and
 * trailing slashes, percent-encoding of plain characters, and anything after `;`, so
 * `/ADMIN//v1/x` reaches the `/admin/v1/x` handler. Every guard below decides on this
 * form; deciding on the raw path would let those spellings walk past the guard.
 */
export function routedPath(url: string): string {
  const path = (url.startsWith("/") ? url : url.replace(/^https?:\/\/[^/]*\/?/, "/"))
    .replace(/\/\/+/g, "/")
    .split(/[?;#]/)[0]!
    .replace(/(.)\/$/, "$1");
  try {
    return decodeURI(path).toLowerCase();
  } catch {
    return path.toLowerCase(); // malformed encoding: the router matches no route
  }
}

/**
 * The route shape for metrics and error reports, never a path value: only short plain
 * route words survive, so ids, hashes, and secrets such as share tokens are dropped.
 */
export const routeLabel = (path: string) =>
  path
    .split("/")
    .map((segment) =>
      segment.length <= 32 && /^([a-z]+(-[a-z]+)*\d?)?$/.test(segment) ? segment : ":id",
    )
    .join("/");

export function makeMiddleware(env: ApiEnv, region: string, scopedShopOrigin?: string) {
  const trusted = new Set(env.trustedOrigins);
  const adminOrigin = new URL(env.adminPublicUrl).origin;
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
      const path = routedPath(request.url);
      const scoped =
        scopedShopOrigin !== undefined &&
        (isScopedCommercePath(path) || path === "/v1/shop/csrf" || path === "/v1/shop/account");
      const corsHeaders: Record<string, string> = {};
      // Credentialed CORS on the admin API is for the admin console alone.
      const corsAllowed = (o: string) =>
        scoped
          ? o === scopedShopOrigin
          : path.startsWith("/admin/")
            ? o === adminOrigin
            : trusted.has(o);
      if (origin && corsAllowed(origin)) {
        corsHeaders["access-control-allow-origin"] = origin;
        corsHeaders["access-control-allow-credentials"] = "true";
        corsHeaders["access-control-allow-headers"] = scoped
          ? "content-type, x-trace-id, x-csrf-token"
          : "authorization, content-type, x-trace-id, x-device-id, x-org-id, x-csrf-token, x-review-token";
        corsHeaders["access-control-expose-headers"] = scoped
          ? "x-trace-id"
          : "x-trace-id, set-auth-token, set-auth-jwt";
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
      // The mounted Shop auth/resources have their own exact Origin and write-token gates.
      const csrf = scoped
        ? null
        : csrfRefusal(
            { method: request.method, path, headers: request.headers },
            trusted,
            adminOrigin,
          );
      if (csrf) {
        return HttpServerResponse.setHeaders(
          errorResponse(403, csrf, CSRF_MESSAGES[csrf], traceId),
          { ...SECURITY_HEADERS, ...corsHeaders },
        );
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
          if (Cause.hasInterruptsOnly(cause))
            return Effect.failCause(
              Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)),
            );
          console.error(
            JSON.stringify({ level: "error", traceId, msg: "unhandled", cause: String(cause) }),
          );
          captureError(new Error(String(cause)), {
            traceId,
            path: routeLabel(path),
          });
          return Effect.succeed(errorResponse(500, "internal", "Something went wrong.", traceId));
        }),
      );
      httpRequests.add(1, {
        route: routeLabel(path),
        method: request.method,
        status: response.status,
      });
      return HttpServerResponse.setHeaders(response, {
        ...SECURITY_HEADERS,
        ...corsHeaders,
        "x-trace-id": traceId,
      });
    });
}
