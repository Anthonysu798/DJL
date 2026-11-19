import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import type { CommerceAdminPermission } from "@djl/domain";

import { ADMIN_SESSION_COOKIE, requirePermission, type AdminAuth } from "../admin/AdminAuth.ts";
import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import { commerceId, type CommerceActor } from "./CommerceService.ts";
import type { CommercePaymentService } from "./CommercePaymentService.ts";

export const COMMERCE_STRIPE_TEST_WEBHOOK_PATH = "/v1/commerce/webhooks/stripe-test";
const MAX_WEBHOOK_BYTES = 256 * 1024;
export interface CommercePaymentRouteDeps {
  readonly commercePayments: Pick<
    CommercePaymentService,
    | "checkout"
    | "status"
    | "cancel"
    | "requestRefund"
    | "reconcile"
    | "handleWebhook"
    | "listExternalRefunds"
    | "externalRefundDetail"
    | "observeExternalRefund"
    | "allocateExternalRefund"
  >;
  readonly principals: PrincipalResolver;
  readonly adminAuth: AdminAuth;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "bad_request", "JSON object required.");
  return value as Record<string, unknown>;
}
function safe<A>(
  fn: () => Promise<A>,
  fallback = {
    status: 503,
    code: "commerce_payment_unavailable",
    message: "Test payment service is unavailable. Check its status before retrying.",
  },
) {
  return Effect.tryPromise({
    try: fn,
    catch: (error) =>
      error instanceof ApiError
        ? error
        : new ApiError(fallback.status, fallback.code, fallback.message),
  });
}
function adminCookie(header: string | undefined) {
  const encoded = header
    ?.split(";")
    .find((part) => part.trim().startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.trim()
    .slice(ADMIN_SESSION_COOKIE.length + 1);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function makeCommercePaymentRoutes(deps: CommercePaymentRouteDeps) {
  type Call = (actor: CommerceActor, id: string, body: Record<string, unknown>) => Promise<unknown>;
  const userRoute = (method: "GET" | "POST", path: string, call: Call) =>
    HttpRouter.add(
      method,
      `/v1/commerce${path}`,
      handle(
        Effect.gen(function* () {
          const principal = yield* requirePrincipal(deps.principals);
          if (method !== "GET" && !principal.emailVerified)
            return yield* Effect.fail(
              new ApiError(
                403,
                "email_verification_required",
                "Verify your email before commerce operations.",
              ),
            );
          const context = yield* RequestContext;
          const params = yield* HttpRouter.params;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body =
            method === "GET"
              ? {
                  page:
                    new URL(request.url, "http://commerce").searchParams.get("page") ?? undefined,
                }
              : yield* readJson;
          return json(
            yield* safe(() =>
              call(
                { id: principal.userId, type: "user", traceId: context.traceId },
                params["id"] === undefined ? "" : commerceId(params["id"]),
                object(body),
              ),
            ),
          );
        }),
      ),
    );
  const adminRoute = (
    method: "GET" | "POST",
    path: string,
    permission: CommerceAdminPermission,
    call: Call,
  ) =>
    HttpRouter.add(
      method,
      `/admin/v1/commerce${path}`,
      handle(
        Effect.gen(function* () {
          const context = yield* RequestContext;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const token =
            request.headers["authorization"]?.replace(/^Bearer\s+/i, "") ??
            adminCookie(request.headers["cookie"]);
          const principal = yield* safe(() => deps.adminAuth.resolve(token, context.ip), {
            status: 401,
            code: "unauthorized",
            message: "Admin sign-in required.",
          });
          if (!principal.mfaVerified)
            return yield* Effect.fail(
              new ApiError(403, "mfa_required", "Verified administrator MFA is required."),
            );
          yield* safe(async () => requirePermission(principal, permission));
          const params = yield* HttpRouter.params;
          const body =
            method === "GET"
              ? {
                  page:
                    new URL(request.url, "http://commerce").searchParams.get("page") ?? undefined,
                }
              : yield* readJson;
          return json(
            yield* safe(() =>
              call(
                { id: principal.adminId, type: "admin", traceId: context.traceId },
                params["id"] === undefined ? "" : commerceId(params["id"]),
                object(body),
              ),
            ),
          );
        }),
      ),
    );
  const webhook = HttpRouter.add(
    "POST",
    COMMERCE_STRIPE_TEST_WEBHOOK_PATH,
    handle(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const context = yield* RequestContext;
        const signature = request.headers["stripe-signature"];
        if (!signature || signature.length > 4096)
          return yield* Effect.fail(
            new ApiError(400, "commerce_bad_signature", "Webhook signature failed."),
          );
        if (Number(request.headers["content-length"] ?? 0) > MAX_WEBHOOK_BYTES)
          return yield* Effect.fail(
            new ApiError(413, "payload_too_large", "Webhook body is too large."),
          );
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
          Effect.mapError(() => new ApiError(400, "bad_body", "Could not read webhook body.")),
        );
        let payload = "";
        const body = webRequest.body;
        if (body !== null) {
          const raw = yield* Stream.runFoldEffect(
            Stream.fromReadableStream({
              evaluate: () => body,
              onError: () => new ApiError(400, "bad_body", "Could not read webhook body."),
              releaseLockOnEnd: true,
            }),
            () => ({ chunks: [] as Uint8Array[], bytes: 0 }),
            (acc, chunk) => {
              if (chunk.byteLength > MAX_WEBHOOK_BYTES - acc.bytes)
                return Effect.fail(
                  new ApiError(413, "payload_too_large", "Webhook body is too large."),
                );
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
          payload = Buffer.concat(raw.chunks, raw.bytes).toString("utf8");
        }
        return json(
          yield* safe(() =>
            deps.commercePayments.handleWebhook(payload, signature, context.traceId),
          ),
        );
      }),
    ),
  );
  return Layer.mergeAll(
    userRoute("POST", "/orders/:id/checkout", (actor, id, body) =>
      deps.commercePayments.checkout(actor, id, body.idempotencyKey),
    ),
    userRoute("GET", "/orders/:id/payment", (actor, id) =>
      deps.commercePayments.status(id, actor.id),
    ),
    userRoute("POST", "/orders/:id/checkout/cancel", (actor, id, body) =>
      deps.commercePayments.cancel(actor, id, body.idempotencyKey),
    ),
    adminRoute("GET", "/orders/:id/payment", "commerce.finance.read", (_actor, id) =>
      deps.commercePayments.status(id),
    ),
    adminRoute(
      "POST",
      "/orders/:id/payment/reconcile",
      "commerce.finance.write",
      (actor, id, body) => deps.commercePayments.reconcile(actor, id, body.reason),
    ),
    adminRoute("POST", "/items/:id/provider-refunds", "commerce.finance.write", (actor, id, body) =>
      deps.commercePayments.requestRefund(actor, id, body),
    ),
    adminRoute("GET", "/orders/:id/external-refunds", "commerce.finance.read", (_actor, id, body) =>
      deps.commercePayments.listExternalRefunds(id, body.page),
    ),
    adminRoute("GET", "/external-refunds/:id", "commerce.finance.read", (_actor, id) =>
      deps.commercePayments.externalRefundDetail(id),
    ),
    adminRoute("POST", "/external-refunds/observe", "commerce.finance.write", (actor, _id, body) =>
      deps.commercePayments.observeExternalRefund(actor, body.sourceEventId, body.reason),
    ),
    adminRoute(
      "POST",
      "/external-refunds/:id/allocate",
      "commerce.finance.write",
      (actor, id, body) => deps.commercePayments.allocateExternalRefund(actor, id, body),
    ),
    webhook,
  );
}
