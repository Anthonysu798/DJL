import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { CloudCreateImageInput, CloudImagesQuery } from "@synara/contracts/cloud";
import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { decodeBody, decodeQuery, idParam } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { ImageService } from "./ImageService.ts";
const FAIL = { status: 500, code: "image_error", message: "Couldn't load images." };
export interface ImageRouteDeps {
  readonly images: ImageService;
  readonly principals: PrincipalResolver;
}
export function makeImageRoutes(deps: ImageRouteDeps) {
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/v1/images",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const query = yield* decodeQuery(CloudImagesQuery);
          return json(yield* attempt(() => deps.images.list(p, query.cursor), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/conversations/:id/images",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const id = yield* idParam("id");
          const body = yield* decodeBody(CloudCreateImageInput);
          return json(
            yield* attempt(
              () =>
                deps.images.create(
                  { principal: p, traceId: crypto.randomUUID(), ipHash: null, deviceId: null },
                  id,
                  body,
                ),
              FAIL,
            ),
          );
        }),
      ),
    ),
  );
}
