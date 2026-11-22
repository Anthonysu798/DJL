import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { CloudCreateContentReportInput } from "@synara/contracts/cloud";

import { hashIp } from "../audit/AuditLog.ts";
import { optionalPrincipal, type PrincipalResolver } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { decodeBody } from "../http/decode.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { ContentReportService } from "./ContentReportService.ts";

export interface ContentReportRouteDeps {
  readonly contentReports: ContentReportService;
  readonly principals: PrincipalResolver;
  readonly ipSalt: string;
}

const FAIL = { status: 500, code: "report_error", message: "Report request failed." };

export function makeContentReportRoutes(deps: ContentReportRouteDeps) {
  const principal = optionalPrincipal(deps.principals);
  return Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/v1/reports",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const input = yield* decodeBody(CloudCreateContentReportInput);
          const ctx = yield* RequestContext;
          const ipHash = p ? null : yield* Effect.promise(() => hashIp(ctx.ip, deps.ipSalt));
          const result = yield* attempt(() => deps.contentReports.create(p, ipHash, input), FAIL);
          return json(result.body, result.status);
        }),
      ),
    ),
  );
}
