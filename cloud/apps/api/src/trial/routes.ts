import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import type { PrincipalResolver } from "../auth/guard.ts";
import { requirePrincipal } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { attempt, handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import type { TrialService } from "./TrialService.ts";

export interface TrialRouteDeps {
  readonly db: DjlDatabase;
  readonly trial: TrialService;
  readonly principals: PrincipalResolver;
}

export function makeTrialRoutes(deps: TrialRouteDeps) {
  const status = HttpRouter.add(
    "GET",
    "/v1/trial",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const row = yield* Effect.promise(() => deps.trial.status(p.personalOrgId));
        return json({
          trial: row
            ? {
                status: row.status,
                grantedAt: row.grantedAt,
                expiresAt: row.expiresAt,
                reasons: row.reasons,
              }
            : null,
        });
      }),
    ),
  );

  const claim = HttpRouter.add(
    "POST",
    "/v1/trial/claim",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const ctx = yield* RequestContext;
        const body = (yield* readJson) as Partial<{ deviceFingerprint: string }>;
        const user = yield* Effect.promise(() =>
          deps.db.query.user.findFirst({ where: eq(schema.user.id, p.userId) }),
        );
        const row = yield* attempt(
          () =>
            deps.trial.claim({
              orgId: p.personalOrgId,
              userId: p.userId,
              phoneNumber: user?.phoneNumber ?? null,
              phoneVerified: Boolean(user?.phoneNumberVerified),
              deviceFingerprint: body.deviceFingerprint ?? null,
              ip: ctx.ip,
              suspended: p.banned,
            }),
          { status: 500, code: "trial_failed", message: "Could not evaluate the trial." },
        );
        return json({ trial: { status: row.status, reasons: row.reasons } }, 201);
      }),
    ),
  );

  return Layer.mergeAll(status, claim);
}
