/**
 * DJL-side account security routes (Better Auth serves /v1/auth/*):
 *   GET    /v1/csrf  double-submit token for cookie-authenticated mutations
 *   DELETE /v1/me    delete the signed-in account (soft delete, 30-day purge)
 */
import type { DjlDatabase } from "@djl/db";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { hashIp } from "../audit/AuditLog.ts";
import { RequestContext } from "../http/context.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import { csrfCookie, csrfTokenFor } from "../security/csrf.ts";
import { deleteOwnAccount } from "./accountDeletion.ts";
import type { DjlAuth } from "./auth.ts";
import { requirePrincipal, type PrincipalResolver } from "./guard.ts";

export interface AuthRouteDeps {
  readonly db: DjlDatabase;
  readonly auth: DjlAuth;
  readonly principals: PrincipalResolver;
  readonly ipSalt: string;
  readonly secureCookies: boolean;
}

export function makeAuthRoutes(deps: AuthRouteDeps) {
  const csrf = HttpRouter.add(
    "GET",
    "/v1/csrf",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const token = csrfTokenFor(request.headers["cookie"]);
      return HttpServerResponse.setHeader(
        json({ token }),
        "set-cookie",
        csrfCookie(token, deps.secureCookies),
      );
    }),
  );

  const deleteAccount = HttpRouter.add(
    "DELETE",
    "/v1/me",
    handle(
      Effect.gen(function* () {
        const principal = yield* requirePrincipal(deps.principals);
        const ctx = yield* RequestContext;
        const ipHash = yield* Effect.promise(() => hashIp(ctx.ip, deps.ipSalt));
        yield* attempt(
          () =>
            deleteOwnAccount({
              db: deps.db,
              auth: deps.auth,
              userId: principal.userId,
              ipHash,
              traceId: ctx.traceId,
            }),
          { status: 500, code: "delete_failed", message: "Could not delete the account." },
        );
        return json({ deleted: true });
      }),
    ),
  );

  return Layer.mergeAll(csrf, deleteAccount);
}
