/**
 * OpenAI-compatible gateway routes plus catalog and usage views.
 */
import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { hashIp } from "../audit/AuditLog.ts";
import type { PrincipalResolver } from "../auth/guard.ts";
import { requirePrincipal } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import type { GatewayService, RequestFacts } from "./GatewayService.ts";

export interface GatewayRouteDeps {
  readonly gateway: GatewayService;
  readonly principals: PrincipalResolver;
  readonly ipSalt: string;
}

const GATEWAY_FAILURE = {
  status: 502,
  code: "gateway_error",
  message: "The gateway could not complete the request.",
};
const MAX_BODY_BYTES = 6 * 1024 * 1024; // vision payloads

const readBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const length = Number(request.headers["content-length"] ?? "0");
  if (length > MAX_BODY_BYTES)
    return yield* Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
  const text = yield* request.text.pipe(
    Effect.mapError(() => new ApiError(400, "bad_body", "Could not read body.")),
  );
  if (text.length > MAX_BODY_BYTES)
    return yield* Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return yield* Effect.fail(new ApiError(400, "bad_json", "Body is not valid JSON."));
  }
});

export function makeGatewayRoutes(deps: GatewayRouteDeps) {
  const facts = Effect.gen(function* () {
    const principal = yield* requirePrincipal(deps.principals);
    const ctx = yield* RequestContext;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const ipHash = yield* Effect.promise(() => hashIp(ctx.ip, deps.ipSalt));
    const deviceId = request.headers["x-device-id"] ?? null;
    return { principal, traceId: ctx.traceId, ipHash, deviceId } satisfies RequestFacts;
  });

  const models = HttpRouter.add(
    "GET",
    "/v1/models",
    handle(
      Effect.gen(function* () {
        yield* requirePrincipal(deps.principals);
        const list = yield* Effect.promise(() => deps.gateway.listModels());
        return json({
          object: "list",
          models: list,
          data: list.map((m) => ({ id: m.id, object: "model", owned_by: m.provider })),
        });
      }),
    ),
  );

  const chat = HttpRouter.add(
    "POST",
    "/v1/chat/completions",
    handle(
      Effect.gen(function* () {
        const f = yield* facts;
        const body = yield* readBody;
        if (
          typeof body.model !== "string" ||
          !Array.isArray(body.messages) ||
          body.messages.length === 0
        ) {
          return yield* Effect.fail(
            new ApiError(400, "bad_request", "model and messages are required."),
          );
        }
        if (body.stream === false) {
          return yield* Effect.fail(
            new ApiError(400, "bad_request", "DJL Cloud chat is streaming only. Set stream: true."),
          );
        }
        const { stream, requestId } = yield* attempt(
          () => deps.gateway.chatStream(f, body as never),
          GATEWAY_FAILURE,
        );
        const sseHeaders = {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
          "x-request-id": requestId,
          "x-trace-id": f.traceId,
        };
        const { "content-type": contentType, ...headers } = sseHeaders;
        return HttpServerResponse.stream(
          Stream.fromReadableStream({ evaluate: () => stream, onError: (error) => error }),
          { status: 200, contentType, headers },
        );
      }),
    ),
  );

  const images = HttpRouter.add(
    "POST",
    "/v1/images/generations",
    handle(
      Effect.gen(function* () {
        const f = yield* facts;
        const body = yield* readBody;
        if (typeof body.model !== "string" || typeof body.prompt !== "string") {
          return yield* Effect.fail(
            new ApiError(400, "bad_request", "model and prompt are required."),
          );
        }
        const result = yield* attempt(
          () => deps.gateway.generateImage(f, body as never),
          GATEWAY_FAILURE,
        );
        return json(result);
      }),
    ),
  );

  const embeddings = HttpRouter.add(
    "POST",
    "/v1/embeddings",
    handle(
      Effect.gen(function* () {
        const f = yield* facts;
        const body = yield* readBody;
        if (typeof body.model !== "string" || body.input === undefined) {
          return yield* Effect.fail(
            new ApiError(400, "bad_request", "model and input are required."),
          );
        }
        const result = yield* attempt(() => deps.gateway.embed(f, body as never), GATEWAY_FAILURE);
        return json(result);
      }),
    ),
  );

  const usage = HttpRouter.add(
    "GET",
    "/v1/usage",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const [recent, byModel] = yield* Effect.promise(() =>
          Promise.all([deps.gateway.usage(p.orgId), deps.gateway.usageByModel(p.orgId)]),
        );
        return json({
          recent: recent.map((r) => ({
            id: r.id,
            model: r.modelId,
            endpoint: r.endpoint,
            status: r.status,
            settled: r.settledMicro,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            images: r.images,
            latencyMs: r.latencyMs,
            createdAt: r.createdAt,
          })),
          byModel,
        });
      }),
    ),
  );

  return Layer.mergeAll(models, chat, images, embeddings, usage);
}
