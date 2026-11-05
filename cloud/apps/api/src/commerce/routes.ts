import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import type { CommerceAdminPermission } from "@djl/domain";
import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { ADMIN_SESSION_COOKIE, requirePermission, type AdminAuth } from "../admin/AdminAuth.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import { CommerceService, commerceId, type CommerceActor } from "./CommerceService.ts";

export interface CommerceRouteDeps {
  readonly commerce: CommerceService;
  readonly principals: PrincipalResolver;
  readonly adminAuth: AdminAuth;
}
const failure = { status: 500, code: "commerce_error", message: "Commerce operation failed." };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "bad_request", "JSON object required.");
  return value as Record<string, unknown>;
}
function adminCookie(header: string | undefined) {
  const raw = header
    ?.split(";")
    .find((part) => part.trim().startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.trim()
    .slice(ADMIN_SESSION_COOKIE.length + 1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export interface ScopedCommerceRouteDeps {
  readonly commerce: CommerceService;
  readonly buyer: {
    readonly resolve: (headers: Headers, write: boolean) => Promise<{ id: string }>;
  };
}

type Call = (
  actor: CommerceActor,
  body: Record<string, unknown>,
  params: Readonly<Record<string, string | undefined>>,
) => Promise<unknown>;
type CommercePrefix = "/v1/commerce" | "/v1/shop/commerce";
type IdentifyBuyer = (
  write: boolean,
) => Effect.Effect<string, ApiError, HttpServerRequest.HttpServerRequest>;
const id = (params: Readonly<Record<string, string | undefined>>) => commerceId(params["id"]);

function makeUserRoute(prefix: CommercePrefix, identify: IdentifyBuyer) {
  return (method: "GET" | "POST" | "PATCH", path: string, call: Call) =>
    HttpRouter.add(
      method,
      `${prefix}${path}`,
      handle(
        Effect.gen(function* () {
          const actorId = yield* identify(method !== "GET");
          const ctx = yield* RequestContext;
          const params = yield* HttpRouter.params;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const input =
            method === "GET"
              ? {
                  page:
                    new URL(request.url, "http://commerce").searchParams.get("page") ?? undefined,
                  from:
                    new URL(request.url, "http://commerce").searchParams.get("from") ?? undefined,
                  to: new URL(request.url, "http://commerce").searchParams.get("to") ?? undefined,
                  attention:
                    new URL(request.url, "http://commerce").searchParams.get("attention") ??
                    undefined,
                  status:
                    new URL(request.url, "http://commerce").searchParams.get("status") ?? undefined,
                  ...(path === "/me"
                    ? {
                        referralSummary: new URL(
                          request.url,
                          "http://commerce",
                        ).searchParams.getAll("referralSummary"),
                      }
                    : {}),
                }
              : yield* readJson;
          return json(
            yield* attempt(
              () =>
                call({ id: actorId, type: "user", traceId: ctx.traceId }, object(input), params),
              failure,
            ),
          );
        }),
      ),
    );
}

function makeBuyerRoutes(
  commerce: CommerceService,
  prefix: CommercePrefix,
  userRoute: ReturnType<typeof makeUserRoute>,
) {
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      `${prefix}/catalog`,
      handle(
        Effect.gen(function* () {
          return json(yield* attempt(() => commerce.catalog(), failure));
        }),
      ),
    ),
    userRoute("GET", "/me", async (a, b) => {
      const selector = b.referralSummary as readonly string[];
      if (selector.length === 0) return commerce.profile(a.id);
      if (selector.length !== 1 || selector[0] !== "1")
        throw new ApiError(400, "bad_request", "Invalid referral summary selector.");
      return { userId: a.id, referralSummary: await commerce.referralSummary(a.id) };
    }),
    userRoute("GET", "/favorites", (a) => commerce.favorites(a.id)),
    userRoute("POST", "/favorites/:id", (a, b, p) =>
      commerce.setFavorite(a, id(p), b.saved, b.expectedUserId),
    ),
    userRoute("POST", "/referrals/bind", (a, b) => commerce.bindReferral(a, b.code)),
    userRoute("GET", "/orders", (a, b) => commerce.listOrders(a.id, b.page)),
    userRoute("POST", "/orders", (a, b) => commerce.createOrder(a, b)),
    userRoute("POST", "/orders/recover", (a, b) => commerce.recoverOrder(a, b)),
    userRoute("POST", "/orders/:id/test-pay", (a, b, p) =>
      commerce.testPay(a, id(p), b.idempotencyKey),
    ),
    userRoute("POST", "/orders/:id/cancel", (a, b, p) =>
      commerce.cancelOrder(a, id(p), b.idempotencyKey),
    ),
    userRoute("POST", "/orders/:id/returns", (a, b, p) => commerce.requestReturn(a, id(p), b)),
    userRoute("GET", "/wallet", (a) => commerce.wallet(a.id)),
    userRoute("GET", "/wallet/entries", (a, b) => commerce.ledgerEntries(a.id, b.page)),
    userRoute("GET", "/withdrawals", (a, b) => commerce.listWithdrawals(a.id, b.page)),
    userRoute("POST", "/withdrawals", (a, b) => commerce.requestWithdrawal(a, b.idempotencyKey)),
  );
}

/** Explicit opt-in; never makes default Cloud authentication or Stripe routes reachable. */
export function makeScopedCommerceRoutes({ commerce, buyer }: ScopedCommerceRouteDeps) {
  if (commerce.mode !== "test" || commerce.paymentProvider !== "simulation")
    throw new Error("Scoped commerce routes require simulated TEST commerce.");
  const prefix = "/v1/shop/commerce";
  const userRoute = makeUserRoute(prefix, (write) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers))
        if (value !== undefined) headers.set(name, value);
      const session = yield* Effect.tryPromise({
        try: () => buyer.resolve(headers, write),
        catch: (cause) =>
          cause instanceof ApiError
            ? cause
            : new ApiError(500, "auth_failed", "Could not resolve shop session."),
      });
      return session.id;
    }),
  );
  return makeBuyerRoutes(commerce, prefix, userRoute);
}

export function makeCommerceRoutes(deps: CommerceRouteDeps) {
  const prefix = "/v1/commerce";
  const userRoute = makeUserRoute(prefix, (write) =>
    Effect.gen(function* () {
      const p = yield* requirePrincipal(deps.principals);
      if (write && !p.emailVerified)
        return yield* Effect.fail(
          new ApiError(
            403,
            "email_verification_required",
            "Verify your email before commerce operations.",
          ),
        );
      return p.userId;
    }),
  );
  const adminRoute = (
    method: "GET" | "POST" | "PATCH",
    path: string,
    permission: CommerceAdminPermission,
    call: Call,
  ) =>
    HttpRouter.add(
      method,
      `/admin/v1/commerce${path}`,
      handle(
        Effect.gen(function* () {
          const ctx = yield* RequestContext;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const token =
            request.headers["authorization"]?.replace(/^Bearer\s+/i, "") ??
            adminCookie(request.headers["cookie"]);
          const p = yield* attempt(() => deps.adminAuth.resolve(token, ctx.ip), {
            status: 401,
            code: "unauthorized",
            message: "Admin sign-in required.",
          });
          if (!p.mfaVerified)
            return yield* Effect.fail(
              new ApiError(403, "mfa_required", "Verified administrator MFA is required."),
            );
          yield* attempt(async () => requirePermission(p, permission), failure);
          const params = yield* HttpRouter.params;
          const input =
            method === "GET"
              ? {
                  page:
                    new URL(request.url, "http://commerce").searchParams.get("page") ?? undefined,
                  from:
                    new URL(request.url, "http://commerce").searchParams.get("from") ?? undefined,
                  to: new URL(request.url, "http://commerce").searchParams.get("to") ?? undefined,
                  attention:
                    new URL(request.url, "http://commerce").searchParams.get("attention") ??
                    undefined,
                  status:
                    new URL(request.url, "http://commerce").searchParams.get("status") ?? undefined,
                }
              : yield* readJson;
          return json(
            yield* attempt(
              () =>
                call({ id: p.adminId, type: "admin", traceId: ctx.traceId }, object(input), params),
              failure,
            ),
          );
        }),
      ),
    );
  return Layer.mergeAll(
    makeBuyerRoutes(deps.commerce, prefix, userRoute),
    userRoute("GET", "/supplier/products", (a, b) => deps.commerce.supplierProducts(a.id, b.page)),
    userRoute("GET", "/supplier/orders", (a, b) => deps.commerce.supplierOrders(a.id, b.page)),
    userRoute("GET", "/supplier/:id/statement", (a, b, p) =>
      deps.commerce.supplierStatement(a, id(p), { from: b.from, to: b.to, page: b.page }),
    ),
    userRoute("PATCH", "/supplier/products/:id/stock", (a, b, p) =>
      deps.commerce.updateStock(a, id(p), b.stock),
    ),
    userRoute("POST", "/supplier/items/:id/ship", (a, b, p) => deps.commerce.ship(a, id(p), b)),
    userRoute("POST", "/supplier/items/:id/accept", (a, _b, p) => deps.commerce.accept(a, id(p))),
    userRoute("POST", "/supplier/items/:id/issues", (a, b, p) =>
      deps.commerce.reportSupplierIssue(a, id(p), b),
    ),
    adminRoute("GET", "/suppliers", "commerce.read", () => deps.commerce.adminSuppliers()),
    adminRoute("GET", "/suppliers/:id/statement", "commerce.finance.read", (a, b, p) =>
      deps.commerce.supplierStatement(a, id(p), { from: b.from, to: b.to, page: b.page }),
    ),
    adminRoute("POST", "/suppliers/:id/payment-records", "commerce.finance.write", (a, b, p) =>
      deps.commerce.recordSupplierPaymentDocument(a, id(p), b),
    ),
    adminRoute("GET", "/suppliers/:id/payment-records", "commerce.finance.read", (a, b, p) =>
      deps.commerce.listSupplierPaymentDocuments(a, id(p), b.page),
    ),
    adminRoute(
      "GET",
      "/suppliers/:id/payment-records/by-operation/:operationId",
      "commerce.finance.read",
      (a, _b, p) => deps.commerce.getSupplierPaymentDocument(a, id(p), p.operationId ?? ""),
    ),
    adminRoute("POST", "/suppliers", "commerce.catalog.write", (a, b) =>
      deps.commerce.createSupplier(a, b),
    ),
    adminRoute("GET", "/suppliers/:id/members", "commerce.read", (_a, b, p) =>
      deps.commerce.adminSupplierMembers(id(p), b.page),
    ),
    adminRoute("POST", "/suppliers/:id/members", "commerce.catalog.write", (a, b, p) =>
      deps.commerce.addSupplierMember(a, id(p), b.userId, b.reason),
    ),
    adminRoute(
      "POST",
      "/suppliers/:id/members/:userId/revoke",
      "commerce.catalog.write",
      (a, b, p) => deps.commerce.revokeSupplierMember(a, id(p), commerceId(p["userId"]), b.reason),
    ),
    adminRoute("POST", "/suppliers/:id/status", "commerce.catalog.write", (a, b, p) =>
      deps.commerce.setSupplierActive(a, id(p), b.active, b.reason),
    ),
    adminRoute("GET", "/catalog", "commerce.read", (_a, b) => deps.commerce.adminCatalog(b.page)),
    adminRoute("POST", "/catalog", "commerce.catalog.write", (a, b) =>
      deps.commerce.saveProduct(a, b),
    ),
    adminRoute("POST", "/catalog/import", "commerce.catalog.write", (a, b) =>
      deps.commerce.importCatalog(a, b),
    ),
    adminRoute("PATCH", "/catalog/:id", "commerce.catalog.write", (a, b, p) =>
      deps.commerce.saveProduct(a, b, id(p)),
    ),
    adminRoute("GET", "/orders", "commerce.read", (_a, b) =>
      deps.commerce.adminOrders(b.page, b.attention),
    ),
    adminRoute("GET", "/orders/:id", "commerce.read", (_a, _b, p) =>
      deps.commerce.adminOrder(id(p)),
    ),
    adminRoute("GET", "/ledger", "commerce.finance.read", (_a, b) =>
      deps.commerce.ledgerEntries(undefined, b.page),
    ),
    adminRoute("POST", "/items/:id/deliver", "commerce.fulfillment.write", (a, b, p) =>
      deps.commerce.deliver(a, id(p), b.reason),
    ),
    adminRoute("POST", "/items/:id/case", "commerce.support.write", (a, b, p) => {
      if (!Object.hasOwn(b, "reviewedClose")) {
        if (b.open === false)
          throw new ApiError(
            409,
            "commerce_case_review_required",
            "Read and review the current case before closing it.",
          );
        return deps.commerce.setOpenCase(a, id(p), b.open, b.reason);
      }
      const review = object(b.reviewedClose);
      if (
        Object.keys(b).length !== 1 ||
        Object.keys(review).length !== 2 ||
        !Object.hasOwn(review, "reason") ||
        !Object.hasOwn(review, "revision")
      )
        throw new ApiError(400, "bad_request", "Invalid reviewed close request.");
      return deps.commerce.setOpenCase(a, id(p), false, review.reason, review.revision);
    }),
    adminRoute("POST", "/items/:id/refund", "commerce.finance.write", (a, b, p) =>
      deps.commerce.refund(a, id(p), b),
    ),
    adminRoute("POST", "/commissions/release", "commerce.finance.write", (a, b) =>
      deps.commerce.releaseCommissions(a, b.reason),
    ),
    adminRoute("GET", "/withdrawals/:id", "commerce.finance.read", (_a, _b, p) =>
      deps.commerce.adminWithdrawal(id(p)),
    ),
    adminRoute("GET", "/withdrawals", "commerce.finance.read", (_a, b) =>
      deps.commerce.listWithdrawals(undefined, b.page, b.status),
    ),
    adminRoute("POST", "/withdrawals/:id/approve", "commerce.finance.write", (a, b, p) =>
      deps.commerce.reviewWithdrawal(a, id(p), "approve", b),
    ),
    adminRoute("POST", "/withdrawals/:id/start-payment", "commerce.finance.write", (a, b, p) =>
      deps.commerce.reviewWithdrawal(a, id(p), "start_payment", b),
    ),
    adminRoute(
      "POST",
      "/withdrawals/:id/mark-payment-unknown",
      "commerce.finance.write",
      (a, b, p) => deps.commerce.reviewWithdrawal(a, id(p), "mark_unknown", b),
    ),
    adminRoute(
      "POST",
      "/withdrawals/:id/confirm-payment-success",
      "commerce.finance.write",
      (a, b, p) => deps.commerce.reviewWithdrawal(a, id(p), "confirm_payment_success", b),
    ),
    adminRoute("POST", "/withdrawals/:id/record", "commerce.finance.write", (a, b, p) =>
      deps.commerce.reviewWithdrawal(a, id(p), "record", b),
    ),
    adminRoute("POST", "/withdrawals/:id/reject", "commerce.finance.write", (a, b, p) =>
      deps.commerce.reviewWithdrawal(a, id(p), "reject", b),
    ),
  );
}
