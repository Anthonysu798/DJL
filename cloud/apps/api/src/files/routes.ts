import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { CloudFilePresignInput } from "@synara/contracts/cloud";

import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { decodeBody, idParam } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { FileService } from "./FileService.ts";

export interface FileRouteDeps {
  readonly files: FileService;
  readonly principals: PrincipalResolver;
}

const FAIL = { status: 500, code: "file_error", message: "File request failed." };

export function makeFileRoutes(deps: FileRouteDeps) {
  const principal = requirePrincipal(deps.principals);
  return Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/v1/files",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const input = yield* decodeBody(CloudFilePresignInput);
          return json(yield* attempt(() => deps.files.create(p, input), FAIL), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/files/:id/complete",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.files.complete(p, id), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/files/:id/url",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.files.downloadUrl(p, id), FAIL));
        }),
      ),
    ),
  );
}
