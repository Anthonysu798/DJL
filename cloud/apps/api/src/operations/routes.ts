import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ADMIN_SESSION_COOKIE, type AdminAuth } from "../admin/AdminAuth.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import type { ServerOperations } from "./ServerOperations.ts";

function adminPrincipal(auth: AdminAuth) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const ctx = yield* RequestContext;
    const cookie = request.headers["cookie"]
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(ADMIN_SESSION_COOKIE + "="));
    let cookieToken: string | null = null;
    try {
      cookieToken = cookie
        ? decodeURIComponent(cookie.slice(ADMIN_SESSION_COOKIE.length + 1))
        : null;
    } catch {
      /* Malformed cookies are unauthenticated. */
    }
    const token = request.headers["authorization"]?.replace(/^Bearer\s+/i, "") ?? cookieToken;
    return yield* attempt(() => auth.resolve(token, ctx.ip), {
      status: 503,
      code: "session_unavailable",
      message: "Session verification is temporarily unavailable. Retry shortly.",
    });
  });
}

export function makeServerRoutes(auth: AdminAuth, operations: ServerOperations | undefined) {
  const principal = adminPrincipal(auth);
  const service = () => {
    if (!operations)
      throw new ApiError(503, "controller_unavailable", "VPS monitoring is not connected.");
    return operations;
  };
  const failure = {
    status: 500,
    code: "server_operation_error",
    message: "Server operation failed.",
  };
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/admin/v1/servers",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const query = new URL(request.url, "http://local").searchParams;
          return json(
            yield* attempt(() => service().overview(p, query.get("range") ?? "hour"), failure),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/servers/logs",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const query = new URL(request.url, "http://local").searchParams;
          return json(
            yield* attempt(() => service().logs(p, query.get("service") ?? "api"), failure),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/servers/operations",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const body = yield* readJson;
          return json(yield* attempt(() => service().submit(p, body), failure));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/servers/operations/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const params = yield* HttpRouter.params;
          return json(yield* attempt(() => service().receipt(p, params.id ?? ""), failure));
        }),
      ),
    ),
  );
}

export function makeOperationsSessionRoutes(auth: AdminAuth, secure: boolean) {
  const principal = adminPrincipal(auth);
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/admin/v1/me",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          return json({
            admin: { id: p.adminId, email: p.email, role: p.role, mfaVerified: p.mfaVerified },
          });
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/auth/logout",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          yield* attempt(() => auth.logout(p.sessionId), {
            status: 500,
            code: "logout_failed",
            message: "Sign-out failed.",
          });
          return HttpServerResponse.setHeader(
            json({ ok: true }),
            "set-cookie",
            ADMIN_SESSION_COOKIE +
              "=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0" +
              (secure ? "; Secure" : ""),
          );
        }),
      ),
    ),
  );
}
