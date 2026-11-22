import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { CloudSocialReviewLinkInput, CloudSocialReviewFeedbackInput } from "@djl/contracts/cloud";
import { requirePrincipal, type PrincipalResolver } from "../../auth/guard.ts";
import { decodeBody, idParam } from "../../http/decode.ts";
import { attempt as rawAttempt, handle } from "../../http/handle.ts";
import { json } from "../../http/json.ts";
import { ApiError } from "../../http/errors.ts";
import { hashIp } from "../../audit/AuditLog.ts";
import { RequestContext } from "../../http/context.ts";
import type { RateLimiter } from "../../gateway/RateLimiter.ts";
import type { ReviewLinkService } from "./ReviewLinkService.ts";

const FAIL = { status: 500, code: "social_review_error", message: "Social review request failed." };
// Never log database parameters, reviewer content, or opaque tokens on unexpected failures.
const attempt = <A>(fn: () => Promise<A>) =>
  rawAttempt(async () => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(FAIL.status, FAIL.code, FAIL.message);
    }
  }, FAIL);
const token = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return request.headers["x-review-token"] ?? "";
});
const privateResponse = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.setHeaders(response, {
    "cache-control": "no-store, private",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "x-content-type-options": "nosniff",
  });
export function makeReviewLinkRoutes(deps: {
  reviewLinks: ReviewLinkService;
  principals: PrincipalResolver;
  limiter: RateLimiter;
  ipSalt: string;
  socialWebPublicUrl: string;
}) {
  const principal = requirePrincipal(deps.principals);
  const publicLimit = (kind: "read" | "feedback") =>
    Effect.gen(function* () {
      const context = yield* RequestContext;
      const ipHash = yield* Effect.promise(() => hashIp(context.ip, deps.ipSalt));
      const result = yield* attempt(() =>
        deps.limiter.hit(
          `social-review:${kind}:${ipHash ?? "unknown"}`,
          kind === "feedback" ? 10 : 120,
          60,
        ),
      );
      if (!result.allowed)
        return yield* Effect.fail(
          new ApiError(429, "rate_limited", "Too many review requests. Try again shortly."),
        );
    });
  return Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/v1/social/drafts/:id/review-links",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const body = yield* decodeBody(CloudSocialReviewLinkInput);
          const created = yield* attempt(() => deps.reviewLinks.create(p, id, body));
          return json(
            { ...created, reviewUrl: new URL(created.reviewPath, deps.socialWebPublicUrl).href },
            201,
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/drafts/:id/review-links",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.reviewLinks.list(p, id)));
        }),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/v1/social/review-links/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.reviewLinks.revoke(p, id)));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/review",
      handle(
        Effect.gen(function* () {
          yield* publicLimit("read");
          const value = yield* token;
          return privateResponse(json(yield* attempt(() => deps.reviewLinks.read(value))));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/social/review/feedback",
      handle(
        Effect.gen(function* () {
          yield* publicLimit("feedback");
          const value = yield* token;
          const body = yield* decodeBody(CloudSocialReviewFeedbackInput);
          return privateResponse(
            json(yield* attempt(() => deps.reviewLinks.submit(value, body)), 201),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/review/media/:index",
      handle(
        Effect.gen(function* () {
          yield* publicLimit("read");
          const value = yield* token;
          const params = yield* HttpRouter.params;
          const index = /^\d{1,2}$/.test(params.index ?? "") ? Number(params.index) : -1;
          const result = yield* attempt(() => deps.reviewLinks.media(value, index));
          return privateResponse(
            HttpServerResponse.uint8Array(result.bytes, { contentType: result.mimeType }),
          );
        }),
      ),
    ),
  );
}
