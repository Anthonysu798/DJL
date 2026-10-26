import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import type { PrincipalResolver } from "../auth/guard.ts";
import { hashIp } from "../audit/AuditLog.ts";
import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { handle, attempt } from "../http/handle.ts";
import { RequestContext } from "../http/context.ts";
import { json, readJson } from "../http/json.ts";
import type { AnalyticsService } from "./AnalyticsService.ts";

export interface AnalyticsRouteDeps {
  readonly analytics: AnalyticsService;
  readonly principals: PrincipalResolver;
  readonly limiter: RateLimiter;
  readonly ipSalt: string;
}
const FAIL = {
  status: 503,
  code: "analytics_unavailable",
  message: "Analytics is temporarily unavailable.",
};
const body = readJson.pipe(
  Effect.flatMap((input) =>
    JSON.stringify(input).length > 16_384
      ? Effect.fail(new ApiError(413, "payload_too_large", "Analytics report is too large."))
      : Effect.succeed(input),
  ),
);

export function makeAnalyticsRoutes(deps: AnalyticsRouteDeps) {
  const limited = (key: string, limit: number, seconds: number) =>
    Effect.gen(function* () {
      const result = yield* attempt(
        () => deps.limiter.hit(`analytics:${key}`, limit, seconds),
        FAIL,
      );
      if (!result.allowed)
        return yield* Effect.fail(
          new ApiError(429, "rate_limited", "Analytics report limit reached."),
        );
    });
  const register = HttpRouter.add(
    "POST",
    "/v1/analytics/installations",
    handle(
      Effect.gen(function* () {
        const ctx = yield* RequestContext;
        const ip = yield* Effect.promise(() => hashIp(ctx.ip ?? "unknown", deps.ipSalt));
        yield* limited(`register:${ip}`, 30, 60);
        yield* limited(`register-hour:${ip}`, 300, 3600);
        const input = yield* body;
        return json(yield* attempt(() => deps.analytics.register(input), FAIL), 201);
      }),
    ),
  );
  const submit = HttpRouter.add(
    "POST",
    "/v1/analytics/events",
    handle(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const ctx = yield* RequestContext;
        const credential = request.headers["x-djl-installation"];
        if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential))
          return yield* Effect.fail(
            new ApiError(401, "installation_required", "Valid installation credential required."),
          );
        const ip = yield* Effect.promise(() => hashIp(ctx.ip ?? "unknown", deps.ipSalt));
        yield* limited(`events-ip:${ip}`, 240, 60);
        yield* limited(`events:${createHash("sha256").update(credential).digest("hex")}`, 20, 60);
        const hasAccount =
          Boolean(request.headers["authorization"]) ||
          /(?:^|;\s*)(?:__Secure-)?djl\.session_token=/.test(request.headers["cookie"] ?? "");
        const principal = hasAccount
          ? yield* attempt(
              () =>
                deps.principals.resolve({
                  headers: new Headers(request.headers as Record<string, string>),
                  requestedOrgId: null,
                }),
              { status: 401, code: "unauthorized", message: "Valid account sign-in required." },
            )
          : null;
        const input = yield* body;
        return json(
          yield* attempt(() => deps.analytics.ingest(credential, principal, input), FAIL),
        );
      }),
    ),
  );
  const update = HttpRouter.add(
    "PUT",
    "/v1/analytics/installation",
    handle(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const credential = request.headers["x-djl-installation"];
        if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential))
          return yield* Effect.fail(
            new ApiError(401, "installation_required", "Valid installation credential required."),
          );
        yield* limited(`metadata:${createHash("sha256").update(credential).digest("hex")}`, 10, 60);
        const input = yield* body;
        yield* attempt(() => deps.analytics.updateMetadata(credential, input), FAIL);
        return json({ updated: true });
      }),
    ),
  );
  return Layer.mergeAll(register, submit, update);
}
