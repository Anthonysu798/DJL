import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { ADMIN_SESSION_COOKIE, requirePermission, type AdminAuth } from "../admin/AdminAuth.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import { CSRF_COOKIE, CSRF_HEADER, readCookie } from "../security/csrf.ts";
import type { CommerceReconciliationService } from "./CommerceReconciliationService.ts";

export const COMMERCE_RECONCILIATION_PATH = "/admin/v1/commerce/reconciliation/compare";
export interface CommerceReconciliationRouteDeps {
  readonly commerceReconciliation: CommerceReconciliationService;
  readonly adminAuth: AdminAuth;
  readonly trustedOrigins: readonly string[];
  readonly adminMfaRequired: boolean;
}

/** POST uploads are compared in memory; no statement, audit, business or financial record is written. */
export function makeCommerceReconciliationRoutes(deps: CommerceReconciliationRouteDeps) {
  const trusted = new Set(deps.trustedOrigins);
  return HttpRouter.add(
    "POST",
    COMMERCE_RECONCILIATION_PATH,
    handle(
      Effect.gen(function* () {
        if (!deps.adminMfaRequired)
          return yield* Effect.fail(
            new ApiError(
              503,
              "commerce_reconciliation_disabled",
              "Manual TEST comparison requires the verified administrator MFA policy.",
            ),
          );
        const request = yield* HttpServerRequest.HttpServerRequest;
        const context = yield* RequestContext;
        const authorization = request.headers["authorization"];
        const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
        if (authorization && !bearer)
          return yield* Effect.fail(
            new ApiError(401, "unauthorized", "Administrator sign-in required."),
          );
        const cookie = readCookie(request.headers["cookie"], ADMIN_SESSION_COOKIE);
        let token = bearer ?? null;
        if (!authorization && cookie)
          try {
            token = decodeURIComponent(cookie);
          } catch {
            /* invalid cookie remains unauthenticated */
          }
        const principal = yield* Effect.tryPromise({
          try: () => deps.adminAuth.resolve(token, context.ip),
          catch: () => new ApiError(401, "unauthorized", "Administrator sign-in required."),
        });
        if (!principal.mfaVerified)
          return yield* Effect.fail(
            new ApiError(403, "mfa_required", "Verified administrator MFA is required."),
          );
        yield* Effect.try({
          try: () => requirePermission(principal, "commerce.finance.read"),
          catch: () => new ApiError(403, "forbidden", "Commerce administrator required."),
        });
        if (!bearer) {
          const origin = request.headers["origin"];
          if (!origin || !trusted.has(origin))
            return yield* Effect.fail(
              new ApiError(403, "csrf_origin", "A trusted administrator origin is required."),
            );
          const expected = readCookie(request.headers["cookie"], CSRF_COOKIE);
          const presented = request.headers[CSRF_HEADER];
          if (
            !expected ||
            !presented ||
            !/^[A-Za-z0-9_-]{43}$/.test(expected) ||
            !/^[A-Za-z0-9_-]{43}$/.test(presented) ||
            !timingSafeEqual(Buffer.from(expected), Buffer.from(presented))
          )
            return yield* Effect.fail(
              new ApiError(403, "csrf_token", "A valid CSRF token is required."),
            );
        }
        const body = yield* readJson;
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length !== 1 ||
          !("csv" in body)
        )
          return yield* Effect.fail(
            new ApiError(
              400,
              "commerce_reconciliation_csv_invalid",
              "Supply only the TEST CSV text.",
            ),
          );
        const report = yield* Effect.tryPromise({
          try: () => deps.commerceReconciliation.compare(body.csv),
          catch: (error) =>
            error instanceof ApiError
              ? error
              : new ApiError(
                  503,
                  "commerce_reconciliation_unavailable",
                  "TEST comparison could not be completed. No verified difference report is available.",
                ),
        });
        return json({ report });
      }),
    ),
  );
}
