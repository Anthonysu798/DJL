import { Cause, Effect, Exit } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureError, add } = vi.hoisted(() => ({ captureError: vi.fn(), add: vi.fn() }));
vi.mock("../observability.ts", () => ({
  captureError,
  currentTraceId: () => null,
  httpRequests: { add },
}));

import { loadApiEnv } from "../config/env.ts";
import { ApiError } from "./errors.ts";
import { handle } from "./handle.ts";
import { makeMiddleware } from "./middleware.ts";

const env = loadApiEnv({ DJL_ENV: "test" });
const request = HttpServerRequest.fromWeb(
  new Request("http://127.0.0.1/v1/commerce/catalog", {
    headers: { "x-trace-id": "middleware-regression", origin: env.webPublicUrl },
  }),
);
function run<E>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E>) {
  return Effect.provideService(
    makeMiddleware(env, "local")(app),
    HttpServerRequest.HttpServerRequest,
    request,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("request cancellation and error reporting", () => {
  it("preserves a pure interruption without logging a server failure or counting a 500", async () => {
    const cause = Cause.interrupt(123);
    const exit = await Effect.runPromiseExit(run(Effect.failCause(cause)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) throw new Error("Expected request interruption");
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect([...Cause.interruptors(exit.cause)]).toEqual([123]);
    expect(console.error).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "still reports a real defect (mixed with interruption: %s)",
    async (mixed) => {
      const defect = Cause.die(new Error("Synthetic handler defect"));
      const cause = mixed
        ? Cause.fromReasons([...defect.reasons, ...Cause.interrupt(123).reasons])
        : defect;
      const response = await Effect.runPromise(run(Effect.failCause(cause)));

      expect(response.status).toBe(500);
      expect(response.headers["x-trace-id"]).toBe("middleware-regression");
      expect(response.headers["access-control-allow-origin"]).toBe(env.webPublicUrl);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(await HttpServerResponse.toWeb(response).json()).toEqual({
        error: {
          code: "internal",
          message: "Something went wrong.",
          traceId: "middleware-regression",
        },
      });
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(captureError).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledExactlyOnceWith(1, {
        route: "/v1/commerce/catalog",
        method: "GET",
        status: 500,
      });
    },
  );

  it("keeps handled business refusals and security headers without reporting a defect", async () => {
    const app = handle(Effect.fail(new ApiError(403, "forbidden", "Not allowed.")));
    const response = await Effect.runPromise(
      Effect.provideService(
        makeMiddleware(env, "local")(app),
        HttpServerRequest.HttpServerRequest,
        request,
      ),
    );

    expect(response.status).toBe(403);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(console.error).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledExactlyOnceWith(1, {
      route: "/v1/commerce/catalog",
      method: "GET",
      status: 403,
    });
  });
});
