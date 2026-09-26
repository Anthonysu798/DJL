/**
 * Native app browser sign-in (see NativeAuthService):
 *   POST /v1/native-auth/codes  signed-in browser (cookie + CSRF) mints a code
 *   POST /v1/native-auth/token  the app redeems code + verifier for a session
 */
import { CloudNativeAuthorizeRequest, CloudNativeTokenInput } from "@synara/contracts/cloud";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import type { PrincipalResolver } from "../auth/guard.ts";
import { requirePrincipal } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import type { NativeAuthService } from "./NativeAuthService.ts";

export interface NativeAuthRouteDeps {
  readonly nativeAuth: NativeAuthService;
  readonly principals: PrincipalResolver;
}

const FAILURE = { status: 500, code: "native_auth_failed", message: "Sign-in failed." };

function decodeBody<A>(decode: (input: unknown) => A) {
  return Effect.flatMap(readJson, (body) =>
    Effect.try({
      try: () => decode(body),
      catch: () => new ApiError(400, "bad_request", "The sign-in request is malformed."),
    }),
  );
}

export function makeNativeAuthRoutes(deps: NativeAuthRouteDeps) {
  const codes = HttpRouter.add(
    "POST",
    "/v1/native-auth/codes",
    handle(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        // Minting turns a browser session into a new device session, so a bearer
        // credential (a leaked access token, say) must never be able to do it.
        if (request.headers["authorization"])
          return yield* Effect.fail(
            new ApiError(403, "browser_session_required", "Approve sign-in from the browser."),
          );
        const principal = yield* requirePrincipal(deps.principals);
        const input = yield* decodeBody(Schema.decodeUnknownSync(CloudNativeAuthorizeRequest));
        const result = yield* attempt(() => deps.nativeAuth.issueCode(principal, input), FAILURE);
        return json(result, 201);
      }),
    ),
  );

  const token = HttpRouter.add(
    "POST",
    "/v1/native-auth/token",
    handle(
      Effect.gen(function* () {
        const ctx = yield* RequestContext;
        const input = yield* decodeBody(Schema.decodeUnknownSync(CloudNativeTokenInput));
        const result = yield* attempt(
          () => deps.nativeAuth.exchange(input, { ip: ctx.ip, userAgent: ctx.userAgent }),
          FAILURE,
        );
        return json(result);
      }),
    ),
  );

  return Layer.mergeAll(codes, token);
}
