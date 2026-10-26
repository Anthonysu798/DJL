/** Separate control gateway so an existing admin session can recover a stopped main API. */
import http from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { createDatabase } from "@djl/db";
import { Effect, Layer, Scope } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { Redis } from "ioredis";
import { AdminAuth, ADMIN_LOCKOUT } from "../admin/AdminAuth.ts";
import { loadApiEnv, type ApiEnv } from "../config/env.ts";
import { makeMiddleware } from "../http/middleware.ts";
import { createRedisLockouts } from "../security/throttle.ts";
import { ControllerClient, type HostController } from "./ControllerClient.ts";
import { ServerOperations } from "./ServerOperations.ts";
import { TrafficMonitor } from "./TrafficMonitor.ts";
import { makeServerRoutes, makeOperationsSessionRoutes } from "./routes.ts";

export async function startOperationsGateway(
  options: { env?: ApiEnv; port?: number; host?: string; controller?: HostController } = {},
) {
  const env = options.env ?? loadApiEnv();
  const database = createDatabase(env.databaseUrl, { max: 4 });
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  const auth = new AdminAuth(database.db, {
    appSecret: env.betterAuthSecret,
    ipSalt: env.ipHashSalt,
    mfaRequired: true,
    lockouts: createRedisLockouts(redis, { prefix: "admin:lockout", ...ADMIN_LOCKOUT }),
  });
  const traffic = new TrafficMonitor(redis);
  const operations = new ServerOperations(
    database.db,
    options.controller ??
      new ControllerClient(process.env.SERVER_CONTROL_URL, process.env.SERVER_CONTROL_TOKEN),
    auth,
    traffic,
    env.env === "local" || env.env === "test"
      ? null
      : (process.env.SERVER_CONTROL_ADMINS ?? "").split(",").filter(Boolean),
  );
  const ready = HttpRouter.add(
    "GET",
    "/ready",
    Effect.tryPromise(async () => {
      await database.sql.unsafe("select 1");
      await redis.ping();
      return HttpServerResponse.jsonUnsafe({ ready: true });
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ ready: false }, { status: 503 })),
      ),
    ),
  );
  const routes = Layer.mergeAll(
    makeServerRoutes(auth, operations),
    makeOperationsSessionRoutes(auth, env.env !== "local" && env.env !== "test"),
    ready,
  );
  let reconciling = false;
  const reconcileTimer = setInterval(() => {
    if (reconciling) return;
    reconciling = true;
    void operations
      .reconcile()
      .catch(() => undefined)
      .finally(() => {
        reconciling = false;
      });
  }, 10_000);
  reconcileTimer.unref();
  const scope = Scope.makeUnsafe();
  const address = await Effect.runPromise(
    Scope.provide(
      Effect.gen(function* () {
        const server = yield* NodeHttpServer.make(() => http.createServer(), {
          host: options.host ?? "0.0.0.0",
          port: options.port ?? 8788,
        });
        const app = yield* HttpRouter.toHttpEffect(routes);
        yield* server.serve(makeMiddleware(env, "vps-control")(app));
        return server.address;
      }),
      scope,
    ),
  );
  return {
    address,
    close: async () => {
      clearInterval(reconcileTimer);
      await Effect.runPromise(Scope.close(scope, { _tag: "Success", value: undefined } as never));
      await traffic.close();
      redis.disconnect();
      await database.close();
    },
  };
}
if (import.meta.main) {
  const gateway = await startOperationsGateway();
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    await gateway.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void stop();
  });
  process.on("SIGINT", () => {
    void stop();
  });
}
