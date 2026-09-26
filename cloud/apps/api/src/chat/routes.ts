import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  CloudConversationListQuery,
  CloudConversationSearchQuery,
  CloudCreateConversationInput,
  CloudRegenerateInput,
  CloudSendMessageInput,
  CloudUpdateConversationInput,
} from "@synara/contracts/cloud";

import { hashIp } from "../audit/AuditLog.ts";
import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import type { RequestFacts } from "../gateway/GatewayService.ts";
import { RequestContext } from "../http/context.ts";
import { decodeBody, decodeQuery, idParam } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { ChatService } from "./ChatService.ts";

export interface ChatRouteDeps {
  readonly chat: ChatService;
  readonly principals: PrincipalResolver;
  readonly ipSalt: string;
}

const FAIL = { status: 500, code: "chat_error", message: "Chat request failed." };

export function makeChatRoutes(deps: ChatRouteDeps) {
  const principal = requirePrincipal(deps.principals);
  const facts = Effect.gen(function* () {
    const p = yield* principal;
    const ctx = yield* RequestContext;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const ipHash = yield* Effect.promise(() => hashIp(ctx.ip, deps.ipSalt));
    const deviceId = request.headers["x-device-id"] ?? null;
    return { principal: p, traceId: ctx.traceId, ipHash, deviceId } satisfies RequestFacts;
  });
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/v1/conversations",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const query = yield* decodeQuery(CloudConversationListQuery);
          return json(yield* attempt(() => deps.chat.list(p, query), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/conversations",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const input = yield* decodeBody(CloudCreateConversationInput);
          return json(yield* attempt(() => deps.chat.create(p, input), FAIL), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/conversations/search",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const query = yield* decodeQuery(CloudConversationSearchQuery);
          return json(yield* attempt(() => deps.chat.search(p, query), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/conversations/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.chat.get(p, id), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "PATCH",
      "/v1/conversations/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const input = yield* decodeBody(CloudUpdateConversationInput);
          return json(yield* attempt(() => deps.chat.update(p, id, input), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/v1/conversations/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          yield* attempt(() => deps.chat.remove(p, id), FAIL);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/conversations/:id/messages",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.chat.branch(p, id), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/conversations/:id/messages",
      handle(
        Effect.gen(function* () {
          const f = yield* facts;
          const id = yield* idParam("id");
          const input = yield* decodeBody(CloudSendMessageInput);
          return json(yield* attempt(() => deps.chat.send(f, id, input), FAIL), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/conversations/:id/messages/:messageId/regenerate",
      handle(
        Effect.gen(function* () {
          const f = yield* facts;
          const id = yield* idParam("id");
          const messageId = yield* idParam("messageId");
          const input = yield* decodeBody(CloudRegenerateInput);
          return json(
            yield* attempt(() => deps.chat.regenerate(f, id, messageId, input), FAIL),
            201,
          );
        }),
      ),
    ),
  );
}
