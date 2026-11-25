import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ServerConfig } from "../config";
import { ServerAuth } from "../auth/Services/ServerAuth";
import { makeEffectAuthRequest } from "../auth/http";
import { isLegacyTokenAuthorized } from "../http";
import { shouldRejectUntrustedRequestOrigin } from "../trustedOrigins";
import { ComputerService } from "./Services/ComputerService";
import { makeComputerFrameRouteLayer } from "./computerFrameRoute";
import { authorizeDesktopComputerStop } from "./desktopComputerAuthorization";

export const desktopComputerRoutes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/api/desktop/computer/emergency-stop",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const config = yield* ServerConfig;
      if (
        !authorizeDesktopComputerStop({
          mode: config.mode,
          token: config.authToken,
          authorization: request.headers.authorization,
          remoteAddress: request.remoteAddress,
        })
      ) {
        return HttpServerResponse.empty({ status: 403 });
      }
      const computer = yield* ComputerService;
      // Never acknowledge revocation before the manager's independent input latch engages.
      yield* Effect.promise(() => computer.manager.emergencyStopInput());
      return HttpServerResponse.jsonUnsafe({ accepted: true }, { status: 202 });
    }),
  ),
  makeComputerFrameRouteLayer({
    authorizeUpgrade: (request) =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const url = HttpServerRequest.toURL(request);
        if (
          !url ||
          shouldRejectUntrustedRequestOrigin({
            rawOrigin: request.headers.origin,
            requestOrigin: url.origin,
            config,
          })
        )
          return false;
        if (isLegacyTokenAuthorized({ config, url, remoteAddress: request.remoteAddress }))
          return true;
        const auth = yield* ServerAuth;
        const session = yield* auth.authenticateWebSocketUpgrade(makeEffectAuthRequest(request));
        return session.role === "owner";
      }).pipe(Effect.catch(() => Effect.succeed(false))),
  }),
);
