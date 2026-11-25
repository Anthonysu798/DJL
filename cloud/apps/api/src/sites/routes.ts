import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import {
  CloudCreateSiteDeployInput,
  CloudCreateSiteInput,
  CloudCreateSiteReportInput,
} from "@djl/contracts/cloud";

import { hashIp } from "../audit/AuditLog.ts";
import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { decodeBody, decodeQuery, idParam } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { SiteService } from "./SiteService.ts";

export interface SiteRouteDeps {
  readonly sites: SiteService;
  readonly principals: PrincipalResolver;
  readonly ipSalt: string;
}

const FAIL = { status: 500, code: "site_error", message: "Site request failed." };
const NameQuery = Schema.Struct({ name: Schema.String.check(Schema.isMaxLength(64)) });

export function makeSiteRoutes(deps: SiteRouteDeps) {
  const principal = requirePrincipal(deps.principals);
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/v1/sites",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          return json(yield* attempt(() => deps.sites.list(p), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/sites/name-available",
      handle(
        Effect.gen(function* () {
          yield* principal;
          const { name } = yield* decodeQuery(NameQuery);
          return json(yield* attempt(() => deps.sites.nameAvailability(name), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/sites",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const input = yield* decodeBody(CloudCreateSiteInput);
          return json({ site: yield* attempt(() => deps.sites.create(p, input), FAIL) }, 201);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/sites/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json({ site: yield* attempt(() => deps.sites.get(p, id), FAIL) });
        }),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/v1/sites/:id",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json({ site: yield* attempt(() => deps.sites.remove(p, id), FAIL) });
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/sites/:id/deploys",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const input = yield* decodeBody(CloudCreateSiteDeployInput);
          return json(yield* attempt(() => deps.sites.createDeploy(p, id, input), FAIL), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/sites/:id/deploys/:deployId/complete",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const deployId = yield* idParam("deployId");
          return json({
            site: yield* attempt(() => deps.sites.completeDeploy(p, id, deployId), FAIL),
          });
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/v1/public/sites/reports",
      handle(
        Effect.gen(function* () {
          const input = yield* decodeBody(CloudCreateSiteReportInput);
          const ctx = yield* RequestContext;
          const ipHash = yield* Effect.promise(() => hashIp(ctx.ip, deps.ipSalt));
          yield* attempt(() => deps.sites.report(ipHash, input), FAIL);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
  );
}
