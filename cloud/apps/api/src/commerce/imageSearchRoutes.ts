import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { idParam } from "../http/decode.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import type { CommerceImageSearchService } from "./ImageSearchService.ts";
import type { CommerceImageUploads } from "./CommerceImageUploads.ts";

export interface CommerceImageSearchRouteDeps {
  readonly imageSearch: Pick<CommerceImageSearchService, "search">;
  readonly principals: PrincipalResolver;
}

export interface CommerceImageUploadRouteDeps {
  readonly imageUploads: Pick<CommerceImageUploads, "create" | "complete">;
  readonly principals: PrincipalResolver;
}

const requireImageBuyer = (principals: PrincipalResolver) =>
  Effect.gen(function* () {
    const principal = yield* requirePrincipal(principals);
    if (!principal.emailVerified)
      return yield* Effect.fail(
        new ApiError(
          403,
          "email_verification_required",
          "Verify your email before commerce operations.",
        ),
      );
    return principal;
  });

type ScopedBuyer = {
  readonly resolve: (headers: Headers, write: boolean) => Promise<{ readonly id: string }>;
};

const requireScopedImageBuyer = (buyer: ScopedBuyer) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { id } = yield* attempt(() => buyer.resolve(new Headers(request.headers), true), {
      status: 503,
      code: "commerce_auth_failed",
      message: "Shop session unavailable.",
    });
    return { userId: id, emailVerified: true };
  });

type ImageBuyer = ReturnType<typeof requireImageBuyer> | ReturnType<typeof requireScopedImageBuyer>;
type ImagePrefix = "/v1/commerce" | "/v1/shop/commerce";

// Storage errors may contain signed URLs. Report a stable error without logging the cause.
const upload = <T>(perform: () => Promise<T>) =>
  Effect.tryPromise({
    try: perform,
    catch: (cause) =>
      cause instanceof ApiError
        ? cause
        : new ApiError(503, "image_search_unavailable", "Image search is not available."),
  });

export function makeCommerceImageUploadRoutes(deps: CommerceImageUploadRouteDeps) {
  return imageUploadRoutes(deps, requireImageBuyer(deps.principals), "/v1/commerce");
}

function imageUploadRoutes(
  deps: Pick<CommerceImageUploadRouteDeps, "imageUploads">,
  buyer: ImageBuyer,
  prefix: ImagePrefix,
) {
  return Layer.mergeAll(
    HttpRouter.add(
      "POST",
      `${prefix}/image-uploads`,
      handle(
        Effect.gen(function* () {
          const p = yield* buyer;
          const body = yield* readJson;
          return json(yield* upload(() => deps.imageUploads.create(p, body)), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      `${prefix}/image-uploads/:id/complete`,
      handle(
        Effect.gen(function* () {
          const p = yield* buyer;
          const id = yield* idParam("id");
          const body = yield* readJson;
          return json(yield* upload(() => deps.imageUploads.complete(p, id, body)));
        }),
      ),
    ),
  );
}

export function makeCommerceImageSearchRoutes(deps: CommerceImageSearchRouteDeps) {
  return imageSearchRoute(deps, requireImageBuyer(deps.principals), "/v1/commerce");
}

export function makeScopedCommerceImageRoutes(
  deps: Pick<CommerceImageSearchRouteDeps, "imageSearch"> &
    Pick<CommerceImageUploadRouteDeps, "imageUploads"> & { readonly buyer: ScopedBuyer },
) {
  const buyer = requireScopedImageBuyer(deps.buyer);
  return Layer.mergeAll(
    imageUploadRoutes(deps, buyer, "/v1/shop/commerce"),
    imageSearchRoute(deps, buyer, "/v1/shop/commerce"),
  );
}

function imageSearchRoute(
  deps: Pick<CommerceImageSearchRouteDeps, "imageSearch">,
  buyer: ImageBuyer,
  prefix: ImagePrefix,
) {
  return HttpRouter.add(
    "POST",
    `${prefix}/image-search`,
    handle(
      Effect.gen(function* () {
        const principal = yield* buyer;
        const context = yield* RequestContext;
        const body = yield* readJson;
        let pending: ReturnType<CommerceImageSearchService["search"]> | undefined;
        const result = yield* attempt(
          (signal) =>
            (pending = deps.imageSearch.search(principal, body, {
              signal,
              traceId: context.traceId,
            })),
          {
            status: 503,
            code: "image_search_unavailable",
            message: "Image search is not available. Use text search instead.",
          },
        ).pipe(
          // tryPromise aborts the provider but does not await its asynchronous finally.
          // Keep shared services alive for cleanup without allowing a stuck dependency to hang exit.
          Effect.onInterrupt(() =>
            Effect.promise(async () => {
              if (!pending) return;
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  pending.then(
                    () => undefined,
                    () => undefined,
                  ),
                  new Promise<void>((resolve) => {
                    timer = setTimeout(() => {
                      console.warn(
                        JSON.stringify({
                          level: "warn",
                          msg: "commerce_image_cleanup_timeout",
                          traceId: context.traceId,
                        }),
                      );
                      resolve();
                    }, 2_000);
                  }),
                ]);
              } finally {
                clearTimeout(timer);
              }
            }),
          ),
        );
        return json(result);
      }),
    ),
  );
}
