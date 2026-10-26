import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import {
  CloudSocialOAuthStartInput,
  CloudSocialOAuthStatusQuery,
  CloudSocialDisconnectInput,
} from "@synara/contracts/cloud";
import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { decodeBody, decodeQuery, idParam } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import { ApiError } from "../http/errors.ts";
import type { SocialConnectionService } from "./SocialConnectionService.ts";

export interface SocialRouteDeps {
  readonly socialConnections: SocialConnectionService;
  readonly principals: PrincipalResolver;
  readonly socialWebPublicUrl?: string;
}
const FAIL = {
  status: 500,
  code: "social_error",
  message: "Social connection could not be completed.",
};
// Avoid generic attempt() logging database/provider exception messages with credentials.
const safe = <T>(fn: () => Promise<T>) =>
  attempt(async () => {
    try {
      return await fn();
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(500, FAIL.code, FAIL.message);
    }
  }, FAIL);
const Callback = Schema.Struct({
  state: Schema.String,
  code: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});
export function makeSocialRoutes(deps: SocialRouteDeps) {
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/v1/social/accounts/:id/creator-info",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const id = yield* idParam("id");
          return json(yield* safe(() => deps.socialConnections.creatorInfo(p, id)));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/accounts",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          return json(yield* safe(() => deps.socialConnections.list(p)));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/social/oauth/start",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const input = yield* decodeBody(CloudSocialOAuthStartInput);
          return json(yield* safe(() => deps.socialConnections.start(p, input)));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/oauth/status",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const input = yield* decodeQuery(CloudSocialOAuthStatusQuery);
          return json(yield* safe(() => deps.socialConnections.status(p, input.attemptId)));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/oauth/attempts",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const input = yield* decodeQuery(
            Schema.Struct({ threadId: Schema.String, campaignId: Schema.String }),
          );
          return json(
            yield* safe(() =>
              deps.socialConnections.listAttempts(p, input.threadId, input.campaignId),
            ),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/social/accounts/disconnect",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const input = yield* decodeBody(CloudSocialDisconnectInput);
          return json(yield* safe(() => deps.socialConnections.disconnect(p, input.accountId)));
        }),
      ),
    ),
    ...(["instagram", "tiktok"] as const).flatMap((provider) => [
      HttpRouter.add(
        "GET",
        `/v1/social/oauth/${provider}/callback`,
        handle(
          Effect.gen(function* () {
            const input = yield* decodeQuery(Callback);
            const staged = yield* safe(() => deps.socialConnections.stageCallback(provider, input));
            const target = new URL(
              "/social/connect",
              deps.socialWebPublicUrl ?? "http://localhost:3000",
            );
            target.search = new URLSearchParams({
              provider,
              continuation: staged.continuation,
            }).toString();
            return HttpServerResponse.text(
              "Sign in to DJL to finish connecting. No post has been published.",
              {
                status: 303,
                headers: {
                  location: target.toString(),
                  "cache-control": "no-store",
                  "referrer-policy": "no-referrer",
                  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
                },
              },
            );
          }),
        ),
      ),
      HttpRouter.add(
        "POST",
        `/v1/social/oauth/${provider}/continue`,
        handle(
          Effect.gen(function* () {
            const principal = yield* requirePrincipal(deps.principals);
            const input = yield* decodeBody(Schema.Struct({ continuation: Schema.String }));
            const result = yield* safe(() =>
              deps.socialConnections.continueCallback(principal, provider, input.continuation),
            );
            return json(result);
          }),
        ),
      ),
    ]),
  );
}
