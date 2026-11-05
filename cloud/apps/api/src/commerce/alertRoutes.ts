import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { ADMIN_SESSION_COOKIE, requirePermission, type AdminAuth } from "../admin/AdminAuth.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { CommerceAlertsService } from "./CommerceAlertsService.ts";

export interface CommerceAlertRouteDeps {
  readonly commerceAlerts: CommerceAlertsService;
  readonly adminAuth: AdminAuth;
}
function cookie(header: string | undefined): string | null {
  const value = header
    ?.split(";")
    .find((part) => part.trim().startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.trim()
    .slice(ADMIN_SESSION_COOKIE.length + 1);
  try {
    return value ? decodeURIComponent(value) : null;
  } catch {
    return null;
  }
}
/** No alert mutation or scanner trigger is exposed over HTTP. */
export function makeCommerceAlertRoutes(deps: CommerceAlertRouteDeps) {
  return HttpRouter.add(
    "GET",
    "/admin/v1/commerce/alerts",
    handle(
      Effect.gen(function* () {
        const ctx = yield* RequestContext;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const p = yield* attempt(
          () =>
            deps.adminAuth.resolve(
              request.headers["authorization"]?.replace(/^Bearer\s+/i, "") ??
                cookie(request.headers["cookie"]),
              ctx.ip,
            ),
          { status: 401, code: "unauthorized", message: "Administrator sign-in required." },
        );
        if (!p.mfaVerified)
          return yield* Effect.fail(
            new ApiError(403, "mfa_required", "Verified administrator MFA is required."),
          );
        yield* attempt(async () => requirePermission(p, "commerce.monitor.read"), {
          status: 403,
          code: "forbidden",
          message: "Commerce administrator required.",
        });
        const query = new URL(request.url, "http://commerce").searchParams;
        return json(
          yield* attempt(
            () =>
              deps.commerceAlerts.list({
                status: query.get("status") ?? undefined,
                cursor: query.get("cursor") ?? undefined,
              }),
            {
              status: 503,
              code: "commerce_alerts_unavailable",
              message: "Commerce monitoring is unavailable; no healthy result is available.",
            },
          ),
        );
      }),
    ),
  );
}
