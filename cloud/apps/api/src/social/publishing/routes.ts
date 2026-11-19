import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import {
  CloudSocialDraftInput,
  CloudSocialDraftEdit,
  CloudSocialRevisionInput,
  CloudSocialTaskAction,
} from "@synara/contracts/cloud";
import { requirePrincipal, type PrincipalResolver } from "../../auth/guard.ts";
import { decodeBody, idParam } from "../../http/decode.ts";
import { attempt as rawAttempt, handle } from "../../http/handle.ts";
import { json } from "../../http/json.ts";
import { ApiError } from "../../http/errors.ts";
import type { PublishingService } from "./PublishingService.ts";
// Database exceptions may include caption parameters; do not pass them to generic logging.
const attempt = <A>(
  fn: () => Promise<A>,
  fallback: { status: number; code: string; message: string },
) =>
  rawAttempt(async () => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(fallback.status, fallback.code, fallback.message);
    }
  }, fallback);
const FAIL = {
  status: 500,
  code: "social_publish_error",
  message: "Social publishing request failed.",
};
export function makePublishingRoutes(deps: {
  publishing: PublishingService;
  principals: PrincipalResolver;
}) {
  const principal = requirePrincipal(deps.principals);
  return Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/v1/social/drafts",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const body = yield* decodeBody(CloudSocialDraftInput);
          return json(yield* attempt(() => deps.publishing.create(p, body), FAIL), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/drafts",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const threadId =
            new URL(request.url, "http://localhost").searchParams.get("threadId") ?? "";
          return json(yield* attempt(() => deps.publishing.list(p, threadId), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/tasks/:id/metrics",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.publishing.metrics(p, id), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/drafts/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.publishing.get(p, id), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "PUT",
      "/v1/social/drafts/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const body = yield* decodeBody(CloudSocialDraftEdit);
          return json(yield* attempt(() => deps.publishing.edit(p, id, body.revision, body), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/social/drafts/:id/confirm",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const body = yield* decodeBody(CloudSocialRevisionInput);
          return json(yield* attempt(() => deps.publishing.confirm(p, id, body.revision), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/social/tasks/:id/action",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const body = yield* decodeBody(CloudSocialTaskAction);
          return json(
            yield* attempt(() => deps.publishing.action(p, id, body.revision, body.action), FAIL),
          );
        }),
      ),
    ),
  );
}
