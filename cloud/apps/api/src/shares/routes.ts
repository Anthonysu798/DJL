import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { CloudCreateShareInput } from "@synara/contracts/cloud";

import { hashIp } from "../audit/AuditLog.ts";
import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { RequestContext } from "../http/context.ts";
import { decodeBody, idParam } from "../http/decode.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { ShareService } from "./ShareService.ts";

export interface ShareRouteDeps {
  readonly shares: ShareService;
  readonly principals: PrincipalResolver;
  readonly limiter: RateLimiter;
  readonly ipSalt: string;
}

const FAIL = { status: 500, code: "share_error", message: "Share request failed." };
/** Public share views per client IP per minute. */
const PUBLIC_VIEWS_PER_MINUTE = 60;

export function makeShareRoutes(deps: ShareRouteDeps) {
  const principal = requirePrincipal(deps.principals);
  return Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/v1/conversations/:id/shares",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const input = yield* decodeBody(CloudCreateShareInput);
          return json(yield* attempt(() => deps.shares.create(p, id, input), FAIL), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/shares",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          return json(yield* attempt(() => deps.shares.list(p), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/v1/shares/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json({ share: yield* attempt(() => deps.shares.revoke(p, id), FAIL) });
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/public/shares/:token",
      handle(
        Effect.gen(function* () {
          const ctx = yield* RequestContext;
          const params = yield* HttpRouter.params;
          const ipHash = yield* Effect.promise(() => hashIp(ctx.ip, deps.ipSalt));
          const limit = yield* Effect.promise(() =>
            deps.limiter.hit(`share:ip:${ipHash ?? "unknown"}`, PUBLIC_VIEWS_PER_MINUTE, 60),
          );
          if (!limit.allowed)
            return yield* Effect.fail(new ApiError(429, "rate_limited", "Too many requests."));
          const view = yield* attempt(() => deps.shares.view(params.token ?? ""), FAIL);
          return HttpServerResponse.setHeader(json(view), "x-robots-tag", "noindex, nofollow");
        }),
      ),
    ),
  );
}
