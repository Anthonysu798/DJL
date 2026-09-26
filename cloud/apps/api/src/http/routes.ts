/**
 * HTTP routes. Each route is an HttpRouter layer, mirroring the open-source
 * server. Better Auth is mounted by converting the Effect request to a web
 * Request and the auth Response back.
 */
import { Effect, Layer, Stream } from "effect";
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { makeAccountRoutes, type AccountDeps } from "../account/routes.ts";
import { makeBillingRoutes, type BillingRouteDeps } from "../billing/routes.ts";
import { makeChatRoutes, type ChatRouteDeps } from "../chat/routes.ts";
import { makeFileRoutes, type FileRouteDeps } from "../files/routes.ts";
import { makeAdminRoutes, type AdminRouteDeps } from "../admin/routes.ts";
import { makeAuthRoutes, type AuthRouteDeps } from "../auth/routes.ts";
import { makeGatewayRoutes, type GatewayRouteDeps } from "../gateway/routes.ts";
import { makePushRoutes, type PushRouteDeps } from "../push/routes.ts";
import { makeRunRoutes, type RunRouteDeps } from "../runs/routes.ts";
import { makeShareRoutes, type ShareRouteDeps } from "../shares/routes.ts";
import { makeNativeAuthRoutes, type NativeAuthRouteDeps } from "../nativeAuth/routes.ts";
import { makeSyncRoutes, type SyncRouteDeps } from "../sync/routes.ts";
import { makeTrialRoutes, type TrialRouteDeps } from "../trial/routes.ts";
import { makeUsageRoutes, type UsageRouteDeps } from "../usage/routes.ts";
import type { DjlAuth } from "../auth/auth.ts";
import type { ApiEnv } from "../config/env.ts";
import { RequestContext } from "./context.ts";
import { errorResponse } from "./errors.ts";

/**
 * `HttpServerResponse.fromWeb` keeps status, headers, and every Set-Cookie,
 * but labels the body application/octet-stream, which web clients (Better
 * Auth's included) then refuse to parse as JSON. Re-attach the body with the
 * upstream Content-Type.
 */
function fromWebKeepingType(response: Response): HttpServerResponse.HttpServerResponse {
  const converted = HttpServerResponse.fromWeb(response);
  const contentType = response.headers.get("content-type");
  if (!response.body || !contentType) return converted;
  const body = Stream.fromReadableStream({ evaluate: () => response.body!, onError: (e) => e });
  return HttpServerResponse.setBody(converted, HttpBody.stream(body, contentType));
}

export interface RouteDeps
  extends
    AccountDeps,
    BillingRouteDeps,
    TrialRouteDeps,
    GatewayRouteDeps,
    AdminRouteDeps,
    SyncRouteDeps,
    UsageRouteDeps,
    ChatRouteDeps,
    FileRouteDeps,
    ShareRouteDeps,
    RunRouteDeps,
    AuthRouteDeps,
    NativeAuthRouteDeps,
    PushRouteDeps {
  readonly env: ApiEnv;
  readonly auth: DjlAuth;
  readonly readiness: { readonly ready: () => Promise<boolean> };
  readonly version: string;
}

export function makeRoutes(deps: RouteDeps) {
  const health = HttpRouter.add(
    "GET",
    "/health",
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { ok: true, version: deps.version, env: deps.env.env },
        {
          headers: { "cache-control": "no-store" },
        },
      ),
    ),
  );

  const ready = HttpRouter.add(
    "GET",
    "/ready",
    Effect.gen(function* () {
      const ok = yield* Effect.promise(() => deps.readiness.ready());
      return HttpServerResponse.jsonUnsafe(
        { ready: ok },
        { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
      );
    }),
  );

  const authRoutes = HttpRouter.add(
    "*",
    "/v1/auth/*",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const ctx = yield* RequestContext;
      const webRequest = yield* HttpServerRequest.toWeb(request);
      const response = yield* Effect.promise(() => deps.auth.handler(webRequest)).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      if (!response)
        return errorResponse(500, "auth_unavailable", "Authentication service error.", ctx.traceId);
      const headers = new Headers(response.headers);
      headers.set("x-trace-id", ctx.traceId);
      return fromWebKeepingType(new Response(response.body, { status: response.status, headers }));
    }),
  );

  const fallback = HttpRouter.add(
    "*",
    "/*",
    Effect.gen(function* () {
      const ctx = yield* RequestContext;
      return errorResponse(404, "not_found", "Not found.", ctx.traceId);
    }),
  );

  return Layer.mergeAll(
    health,
    ready,
    authRoutes,
    makeAccountRoutes(deps),
    makeBillingRoutes(deps),
    makeTrialRoutes(deps),
    makeGatewayRoutes(deps),
    makeAdminRoutes(deps),
    makeSyncRoutes(deps),
    makeUsageRoutes(deps),
    makeChatRoutes(deps),
    makeFileRoutes(deps),
    makeShareRoutes(deps),
    makeRunRoutes(deps),
    makeAuthRoutes(deps),
    makeNativeAuthRoutes(deps),
    makePushRoutes(deps),
    fallback,
  );
}
