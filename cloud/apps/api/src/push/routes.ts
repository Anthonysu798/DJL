import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { CloudPushTokenInput } from "@synara/contracts/cloud";

import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { decodeBody } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import type { PushTokenService } from "./PushTokenService.ts";

export interface PushRouteDeps {
  readonly pushTokens: PushTokenService;
  readonly principals: PrincipalResolver;
}

const FAIL = { status: 500, code: "push_error", message: "Could not register the device." };

export function makePushRoutes(deps: PushRouteDeps) {
  return Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/v1/devices/push-token",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const input = yield* decodeBody(CloudPushTokenInput);
          yield* attempt(() => deps.pushTokens.register(p, input), FAIL);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
  );
}
