import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { CloudSocialTrackingLinkInput } from "../../../../../../packages/contracts/src/cloud/trackingLinks.ts";
import { countsAsTrackingOpen } from "../../../../../packages/domain/src/social/trackingLinks.ts";
import { requirePrincipal, type PrincipalResolver } from "../../auth/guard.ts";
import { hashIp } from "../../audit/AuditLog.ts";
import type { RateLimiter } from "../../gateway/RateLimiter.ts";
import { RequestContext } from "../../http/context.ts";
import { decodeBody, idParam } from "../../http/decode.ts";
import { ApiError } from "../../http/errors.ts";
import { attempt as rawAttempt, handle } from "../../http/handle.ts";
import { json } from "../../http/json.ts";
import type { TrackingLinkService } from "./TrackingLinkService.ts";
const FAIL = {
  status: 500,
  code: "social_tracking_error",
  message: "The tracking link request failed.",
};
const attempt = <A>(fn: () => Promise<A>) =>
  rawAttempt(async () => {
    try {
      return await fn();
    } catch (error) {
      throw error instanceof ApiError ? error : new ApiError(FAIL.status, FAIL.code, FAIL.message);
    }
  }, FAIL);
export function makeTrackingLinkRoutes(deps: {
  trackingLinks: TrackingLinkService;
  principals: PrincipalResolver;
  limiter: RateLimiter;
  ipSalt: string;
  socialWebPublicUrl: string;
}) {
  const principal = requirePrincipal(deps.principals);
  const withPublicUrl = (link: Awaited<ReturnType<TrackingLinkService["get"]>>) => ({
    ...link,
    trackingUrl: new URL(link.publicPath, deps.socialWebPublicUrl).href,
  });
  const open = handle(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const params = yield* HttpRouter.params;
      const slug = params.slug ?? "";
      if (!/^[A-Za-z0-9_-]{22}$/.test(slug))
        return yield* Effect.fail(
          new ApiError(
            404,
            "tracking_link_unavailable",
            "This tracking link is unavailable or expired.",
          ),
        );
      const context = yield* RequestContext;
      const ipHash = yield* Effect.promise(() => hashIp(context.ip, deps.ipSalt));
      // This ephemeral abuse counter is separate from persisted UTC-day link-open totals.
      const limit = yield* attempt(() =>
        deps.limiter.hit(`tracking-open:${slug}:${ipHash ?? "unknown"}`, 120, 60),
      );
      if (!limit.allowed)
        return yield* Effect.fail(
          new ApiError(429, "rate_limited", "Too many link requests. Try again shortly."),
        );
      const target = yield* attempt(() =>
        deps.trackingLinks.open(slug, countsAsTrackingOpen(request.method, request.headers)),
      );
      return HttpServerResponse.empty({
        status: 302,
        headers: {
          location: target,
          "cache-control": "no-store, private",
          "referrer-policy": "no-referrer",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      });
    }),
  );
  return Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/v1/social/tracking-links",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const limit = yield* attempt(() =>
            deps.limiter.hit(`tracking-create:${p.orgId}:${p.userId}`, 20, 3600),
          );
          if (!limit.allowed)
            return yield* Effect.fail(
              new ApiError(
                429,
                "rate_limited",
                "Too many tracking links created. Try again later.",
              ),
            );
          const input = yield* decodeBody(CloudSocialTrackingLinkInput);
          const created = yield* attempt(() => deps.trackingLinks.create(p, input));
          const link = withPublicUrl(created.link);
          return json({ ...created, link, trackingUrl: link.trackingUrl }, 201);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/tracking-links",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const query = new URL(request.url, "http://localhost").searchParams;
          const links = yield* attempt(() =>
            deps.trackingLinks.list(p, {
              campaignId: query.get("campaignId") ?? undefined,
              threadId: query.get("threadId") ?? undefined,
            }),
          );
          return json(links.map(withPublicUrl));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/tracking-links/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(withPublicUrl(yield* attempt(() => deps.trackingLinks.get(p, id))));
        }),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/v1/social/tracking-links/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.trackingLinks.revoke(p, id)));
        }),
      ),
    ),
    HttpRouter.addAll([
      HttpRouter.route("GET", "/v1/social/tracking-links/:slug/open", open),
      HttpRouter.route("HEAD", "/v1/social/tracking-links/:slug/open", open),
    ]),
  );
}
