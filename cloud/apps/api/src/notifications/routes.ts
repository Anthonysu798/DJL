import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { CloudNotificationsQuery, CloudReadNotificationsInput } from "@synara/contracts/cloud";
import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { decodeBody, decodeQuery } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { NotificationService } from "./NotificationService.ts";

export interface NotificationRouteDeps {
  readonly notifications: NotificationService;
  readonly principals: PrincipalResolver;
}
const FAIL = { status: 500, code: "notification_error", message: "Couldn't load notifications." };

export function makeNotificationRoutes(deps: NotificationRouteDeps) {
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/v1/notifications",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const query = yield* decodeQuery(CloudNotificationsQuery);
          return json(yield* attempt(() => deps.notifications.list(p, query.cursor), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/notifications/read",
      handle(
        Effect.gen(function* () {
          const p = yield* requirePrincipal(deps.principals);
          const body = yield* decodeBody(CloudReadNotificationsInput);
          return json(yield* attempt(() => deps.notifications.markRead(p, body.ids), FAIL));
        }),
      ),
    ),
  );
}
