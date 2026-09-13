/**
 * Signed-in account routes: who am I, my organizations, credits, ledger, devices.
 */
import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { formatCredits, totalAvailable } from "@djl/domain";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import type { PrincipalResolver } from "../auth/guard.ts";
import { requirePrincipal } from "../auth/guard.ts";
import type { LedgerService } from "../credits/LedgerService.ts";
import { ApiError } from "../http/errors.ts";
import { handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";

export interface AccountDeps {
  readonly db: DjlDatabase;
  readonly ledger: LedgerService;
  readonly principals: PrincipalResolver;
}

export function makeAccountRoutes(deps: AccountDeps) {
  const me = HttpRouter.add(
    "GET",
    "/v1/me",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const orgs = yield* Effect.promise(() =>
          deps.db
            .select({
              id: schema.organization.id,
              name: schema.organization.name,
              slug: schema.organization.slug,
              role: schema.member.role,
              metadata: schema.organization.metadata,
            })
            .from(schema.member)
            .innerJoin(
              schema.organization,
              eq(schema.organization.id, schema.member.organizationId),
            )
            .where(eq(schema.member.userId, p.userId)),
        );
        return json({
          user: { id: p.userId, email: p.email, emailVerified: p.emailVerified },
          activeOrgId: p.orgId,
          role: p.role,
          organizations: orgs.map((o) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
            role: o.role,
            personal: o.metadata?.includes('"personal"') ?? false,
          })),
        });
      }),
    ),
  );

  const credits = HttpRouter.add(
    "GET",
    "/v1/credits",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const balances = yield* Effect.promise(() => deps.ledger.balances(p.orgId));
        const total = totalAvailable(balances);
        return json({
          orgId: p.orgId,
          balances,
          total,
          display: {
            total: formatCredits(total),
            trial: formatCredits(balances.trial),
            plan: formatCredits(balances.plan),
            topup: formatCredits(balances.topup),
          },
        });
      }),
    ),
  );

  const ledger = HttpRouter.add(
    "GET",
    "/v1/credits/ledger",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = HttpServerRequest.toURL(request);
        const limit = Number(url?.searchParams.get("limit") ?? "50");
        const after = url?.searchParams.get("after") ?? undefined;
        const entries = yield* Effect.promise(() =>
          deps.ledger.history(p.orgId, after ? { limit, after } : { limit }),
        );
        return json({ entries });
      }),
    ),
  );

  const registerDevice = HttpRouter.add(
    "POST",
    "/v1/devices",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const body = (yield* readJson) as Partial<{
          kind: string;
          name: string;
          publicKey: string;
          fingerprint: string;
          appVersion: string;
          platform: string;
        }>;
        if (!body.kind || !["desktop", "web", "ios"].includes(body.kind) || !body.fingerprint) {
          return yield* Effect.fail(
            new ApiError(400, "bad_request", "kind and fingerprint are required."),
          );
        }
        const [device] = yield* Effect.promise(() =>
          deps.db
            .insert(schema.devices)
            .values({
              userId: p.userId,
              kind: body.kind!,
              name: body.name ?? null,
              publicKey: body.publicKey ?? null,
              fingerprint: body.fingerprint!,
              appVersion: body.appVersion ?? null,
              platform: body.platform ?? null,
              lastSeenAt: new Date(),
            })
            .returning({
              id: schema.devices.id,
              kind: schema.devices.kind,
              syncEnabled: schema.devices.syncEnabled,
            }),
        );
        return json({ device }, 201);
      }),
    ),
  );

  const listDevices = HttpRouter.add(
    "GET",
    "/v1/devices",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const rows = yield* Effect.promise(() =>
          deps.db.query.devices.findMany({ where: eq(schema.devices.userId, p.userId) }),
        );
        return json({
          devices: rows.map((d) => ({
            id: d.id,
            kind: d.kind,
            name: d.name,
            trustState: d.trustState,
            syncEnabled: d.syncEnabled,
            lastSeenAt: d.lastSeenAt,
            createdAt: d.createdAt,
          })),
        });
      }),
    ),
  );

  return Layer.mergeAll(me, credits, ledger, registerDevice, listDevices);
}
