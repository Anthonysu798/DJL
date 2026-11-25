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
import { makeMiddleware, routeLabel, routedPath } from "./middleware.ts";

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

describe("route labels for metrics and error reports", () => {
  it.each([
    ["/v1/public/shares/Zm9vYmFyLXNlY3JldC10b2tlbl9hYmNERUYxMjM0NTY3ODk", "/v1/public/shares/:id"],
    ["/v1/auth/reset-password/aB3xYz9QwErTy", "/v1/auth/reset-password/:id"],
    ["/v1/files/0b8f6f0e-6c1d-4c7e-9d4b-0d5c1f2a3b4c/url", "/v1/files/:id/url"],
    [`/v1/sync/attachments/${"a".repeat(64)}/complete`, "/v1/sync/attachments/:id/complete"],
    ["/admin/v1/settings/admin.ip_allowlist", "/admin/v1/settings/:id"],
    ["/v1/commerce/webhooks/stripe-test", "/v1/commerce/webhooks/stripe-test"],
    ["/v1/oauth2/callback", "/v1/oauth2/callback"],
  ])("labels %s as %s", (path, label) => {
    expect(routeLabel(path)).toBe(label);
  });

  it("never exports a share token to metrics or the error reporter", async () => {
    const token = "s3cr3tShareTokenValue_0123456789abcdefABCDEF";
    const shared = HttpServerRequest.fromWeb(
      new Request(`http://127.0.0.1/v1/public/shares/${token}`),
    );
    await Effect.runPromise(
      Effect.provideService(
        makeMiddleware(env, "local")(Effect.die(new Error("Synthetic handler defect"))),
        HttpServerRequest.HttpServerRequest,
        shared,
      ),
    );
    expect(JSON.stringify([add.mock.calls, captureError.mock.calls])).not.toContain(token);
    expect(add.mock.calls[0]![1]).toMatchObject({ route: "/v1/public/shares/:id" });
    expect(captureError.mock.calls[0]![1]).toMatchObject({ path: "/v1/public/shares/:id" });
  });
});

describe("admin API boundary", () => {
  const adminOrigin = new URL(env.adminPublicUrl).origin;
  const send = (path: string, init: RequestInit) =>
    Effect.runPromise(
      Effect.provideService(
        makeMiddleware(env, "local")(Effect.succeed(HttpServerResponse.empty({ status: 200 }))),
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request(`http://127.0.0.1${path}`, init)),
      ),
    );

  it("grants credentialed CORS on /admin/* to the admin origin only", async () => {
    for (const origin of [env.webPublicUrl, "https://files.slcor.test"]) {
      const preflight = await send("/admin/v1/admins", { method: "OPTIONS", headers: { origin } });
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
      expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
    }
    const own = await send("/admin/v1/admins", {
      method: "OPTIONS",
      headers: { origin: adminOrigin },
    });
    expect(own.headers["access-control-allow-origin"]).toBe(adminOrigin);
    // The web origin keeps its CORS grant on the user API.
    const web = await send("/v1/me", { method: "OPTIONS", headers: { origin: env.webPublicUrl } });
    expect(web.headers["access-control-allow-origin"]).toBe(env.webPublicUrl);
  });

  it("refuses a cookie-only admin mutation from any other origin before the handler runs", async () => {
    const cookie = "djl_admin=synthetic-admin-cookie";
    for (const origin of [undefined, env.webPublicUrl, "https://files.slcor.test"]) {
      const forged = await send("/admin/v1/admins", {
        method: "POST",
        headers: { cookie, "content-type": "text/plain", ...(origin ? { origin } : {}) },
        body: "{}",
      });
      expect(forged.status).toBe(403);
    }
    const own = await send("/admin/v1/admins", {
      method: "POST",
      headers: { cookie, origin: adminOrigin },
    });
    expect(own.status).toBe(200);
    const bearer = await send("/admin/v1/admins", {
      method: "POST",
      headers: { cookie, authorization: "Bearer synthetic-token" },
    });
    expect(bearer.status).toBe(200);
  });

  // The router matches all of these to the /admin/v1/admins handler.
  const spellings = [
    "/ADMIN/v1/admins",
    "/Admin/V1/Admins",
    "//admin/v1/admins",
    "/admin//v1/admins",
    "/admin/v1/admins/",
    "/%61dmin/v1/admins",
    "/admin/%76%31/admins",
    "/admin/v1/admins;x=1",
    "/admin/v1/admins?x=1",
  ];

  it.each(spellings)("reads %s the way the router does", (spelling) => {
    expect(routedPath(spelling)).toBe("/admin/v1/admins");
    expect(routedPath(`http://127.0.0.1:8787${spelling}`)).toBe("/admin/v1/admins");
  });

  it.each(spellings)("refuses a forged cookie POST spelled %s", async (spelling) => {
    const forged = await send(spelling, {
      method: "POST",
      headers: { cookie: "djl_admin=synthetic-admin-cookie", origin: env.webPublicUrl },
    });
    expect(forged.status).toBe(403);
    expect(forged.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("applies the user-session CSRF check to any spelling of a /v1 path", async () => {
    for (const path of ["/V1/devices", "//v1/devices", "/%761/devices"]) {
      const forged = await send(path, {
        method: "POST",
        headers: { cookie: "djl.session_token=synthetic", origin: "https://evil.test" },
      });
      expect(forged.status).toBe(403);
    }
  });
});
