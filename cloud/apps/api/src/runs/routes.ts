import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { CloudRunEventsQuery } from "@synara/contracts/cloud";

import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { decodeQuery, idParam } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { RunService } from "./RunService.ts";

export interface RunRouteDeps {
  readonly runs: RunService;
  readonly principals: PrincipalResolver;
}

const FAIL = { status: 500, code: "run_error", message: "Run request failed." };

/** An async generator of SSE text as a byte stream; cancelling it aborts `controller`. */
function sseBody(lines: AsyncGenerator<string>, controller: AbortController) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(stream) {
      const { value, done } = await lines.next();
      if (done) stream.close();
      else stream.enqueue(encoder.encode(value));
    },
    async cancel() {
      controller.abort();
      await lines.return(undefined);
    },
  });
}

export function makeRunRoutes(deps: RunRouteDeps) {
  const principal = requirePrincipal(deps.principals);
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/v1/runs/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.runs.get(p, id), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/runs/:id/events",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const request = yield* HttpServerRequest.HttpServerRequest;
          const query = yield* decodeQuery(CloudRunEventsQuery);
          const lastEventId = Number(request.headers["last-event-id"]);
          const after =
            query.after ?? (Number.isInteger(lastEventId) && lastEventId > 0 ? lastEventId : 0);
          if (!request.headers["accept"]?.includes("text/event-stream"))
            return json(yield* attempt(() => deps.runs.events(p, id, after), FAIL));
          const controller = new AbortController();
          const lines = yield* attempt(
            () => deps.runs.stream(p, id, after, controller.signal),
            FAIL,
          );
          return HttpServerResponse.stream(
            Stream.fromReadableStream({
              evaluate: () => sseBody(lines, controller),
              onError: (error) => error,
            }),
            {
              status: 200,
              contentType: "text/event-stream; charset=utf-8",
              headers: {
                "cache-control": "no-store",
                connection: "keep-alive",
                "x-accel-buffering": "no",
              },
            },
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/runs/:id/cancel",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.runs.cancel(p, id), FAIL));
        }),
      ),
    ),
  );
}
