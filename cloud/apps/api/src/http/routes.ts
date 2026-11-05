/**
 * HTTP routes. Each route is an HttpRouter layer, mirroring the open-source
 * server. Better Auth is mounted by converting the Effect request to a web
 * Request and the auth Response back.
 */
import { Effect, Layer } from "effect";
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { makeAccountRoutes, type AccountDeps } from "../account/routes.ts";
import { makeClientConfigRoutes, type ClientConfigDeps } from "../client-config/routes.ts";
import { makeImageRoutes, type ImageRouteDeps } from "../images/routes.ts";
import { makeNotificationRoutes, type NotificationRouteDeps } from "../notifications/routes.ts";
import { makeBillingRoutes, type BillingRouteDeps } from "../billing/routes.ts";
import {
  makeCommerceRoutes,
  makeScopedCommerceRoutes,
  type CommerceRouteDeps,
} from "../commerce/routes.ts";
import { makeCommerceAlertRoutes, type CommerceAlertRouteDeps } from "../commerce/alertRoutes.ts";
import {
  makeCommerceAddressLookupRoutes,
  type CommerceAddressLookupRouteDeps,
} from "../commerce/addressLookupRoutes.ts";
import {
  makeCommerceReconciliationRoutes,
  type CommerceReconciliationRouteDeps,
} from "../commerce/reconciliationRoutes.ts";
import {
  makeCommercePaymentRoutes,
  type CommercePaymentRouteDeps,
} from "../commerce/paymentRoutes.ts";
import {
  makeCommerceImageSearchRoutes,
  makeCommerceImageUploadRoutes,
  makeScopedCommerceImageRoutes,
  type CommerceImageSearchRouteDeps,
  type CommerceImageUploadRouteDeps,
} from "../commerce/imageSearchRoutes.ts";
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
import type { createCommerceAuth } from "../auth/commerceAuth.ts";
import { createCommerceCsrf } from "../auth/commerceCsrf.ts";
import type { ApiEnv } from "../config/env.ts";
import { RequestContext } from "./context.ts";
import { errorResponse, unauthorized } from "./errors.ts";
import { attempt, handle } from "./handle.ts";
import { json } from "./json.ts";

/**
 * Auth endpoints return finite bodies. Read them before handing off to the
 * platform adapter: the web → Effect → web stream bridge can crash Windows
 * Bun during concurrent session/catalog reloads. Keep the upstream MIME type,
 * status and cookies. Chat and gateway streaming use separate routes.
 */
export async function fromWebKeepingType(
  response: Response,
): Promise<HttpServerResponse.HttpServerResponse> {
  const bytes = response.body ? new Uint8Array(await response.arrayBuffer()) : null;
  const converted = HttpServerResponse.fromWeb(
    new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  );
  return bytes === null
    ? converted
    : HttpServerResponse.setBody(
        converted,
        HttpBody.uint8Array(
          bytes,
          response.headers.get("content-type") ?? "application/octet-stream",
        ),
      );
}

export interface RouteDeps
  extends
    AccountDeps,
    BillingRouteDeps,
    CommerceRouteDeps,
    CommerceAlertRouteDeps,
    CommerceReconciliationRouteDeps,
    CommercePaymentRouteDeps,
    CommerceImageSearchRouteDeps,
    CommerceImageUploadRouteDeps,
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
    PushRouteDeps,
    NotificationRouteDeps,
    ImageRouteDeps {
  readonly env: ApiEnv;
  readonly auth: DjlAuth;
  readonly addressLookup?: CommerceAddressLookupRouteDeps["addressLookup"];
  readonly testCommerceAuth?: ReturnType<typeof createCommerceAuth>;
  readonly readiness: { readonly ready: () => Promise<boolean> };
  readonly version: string;
  readonly clientConfig: ClientConfigDeps;
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
      return yield* Effect.promise(() =>
        fromWebKeepingType(new Response(response.body, { status: response.status, headers })),
      );
    }),
  );

  const shopAuth = deps.testCommerceAuth;
  const shopCsrf = shopAuth
    ? createCommerceCsrf(shopAuth, deps.env.webPublicUrl, deps.env.betterAuthSecret)
    : undefined;
  const shopAuthRoutes =
    shopAuth && shopCsrf
      ? Layer.mergeAll(
          HttpRouter.add(
            "*",
            "/v1/shop/auth/*",
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              const webRequest = yield* HttpServerRequest.toWeb(request);
              return yield* Effect.promise(async () =>
                fromWebKeepingType(await shopAuth.handle(webRequest)),
              );
            }),
          ),
          HttpRouter.add(
            "GET",
            "/v1/shop/account",
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              const ctx = yield* RequestContext;
              const webRequest = yield* HttpServerRequest.toWeb(request);
              const buyer = yield* Effect.promise(() => shopAuth.buyer(webRequest.headers));
              if (!buyer) return unauthorized(ctx.traceId);
              const { id, email, emailVerified } = buyer;
              const wallet = yield* Effect.promise(() => deps.commerce.wallet(id));
              return HttpServerResponse.jsonUnsafe(
                { user: { id, email, emailVerified }, wallet },
                { headers: { "cache-control": "no-store" } },
              );
            }),
          ),
          HttpRouter.add(
            "GET",
            "/v1/shop/csrf",
            handle(
              Effect.gen(function* () {
                const request = yield* HttpServerRequest.HttpServerRequest;
                return json(
                  yield* attempt(() => shopCsrf.issue(new Headers(request.headers)), {
                    status: 503,
                    code: "commerce_auth_failed",
                    message: "Shop session unavailable.",
                  }),
                );
              }),
            ),
          ),
          makeScopedCommerceRoutes({ commerce: deps.commerce, buyer: shopCsrf }),
          makeScopedCommerceImageRoutes({
            imageSearch: deps.imageSearch,
            imageUploads: deps.imageUploads,
            buyer: shopCsrf,
          }),
        )
      : Layer.empty;

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
    makeClientConfigRoutes(deps.clientConfig),
    makeNotificationRoutes(deps),
    makeImageRoutes(deps),
    authRoutes,
    shopAuthRoutes,
    makeAccountRoutes(deps),
    makeBillingRoutes(deps),
    makeCommerceRoutes(deps),
    makeCommerceAlertRoutes(deps),
    makeCommerceReconciliationRoutes(deps),
    makeCommercePaymentRoutes(deps),
    makeCommerceImageSearchRoutes(deps),
    makeCommerceImageUploadRoutes(deps),
    makeCommerceAddressLookupRoutes({
      ...(deps.addressLookup ? { addressLookup: deps.addressLookup } : {}),
      principals: deps.principals,
      addressLookupLimiter: deps.limiter,
    }),
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
