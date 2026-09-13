import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { PlanId } from "@djl/domain";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import type { PrincipalResolver } from "../auth/guard.ts";
import { requirePrincipal, requireRole } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError, errorResponse } from "../http/errors.ts";
import { json, readJson } from "../http/json.ts";
import type { BillingService } from "./BillingService.ts";

export interface BillingRouteDeps {
  readonly db: DjlDatabase;
  readonly billing: BillingService;
  readonly principals: PrincipalResolver;
}

function handle<R>(
  effect: Effect.Effect<
    import("effect/unstable/http").HttpServerResponse.HttpServerResponse,
    ApiError,
    R
  >,
) {
  return Effect.gen(function* () {
    const ctx = yield* RequestContext;
    return yield* effect.pipe(
      Effect.catchIf(
        (e): e is ApiError => e instanceof ApiError,
        (e) => Effect.succeed(errorResponse(e.status, e.code, e.message, ctx.traceId)),
      ),
    );
  });
}

const BILLING_ROLES = ["owner", "billing"] as const;

const attempt = (fn: () => Promise<{ url: string }>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => {
      if (e instanceof ApiError) return e;
      console.error(
        JSON.stringify({
          level: "error",
          msg: "billing checkout failed",
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      return new ApiError(502, "billing_error", "Billing provider error.");
    },
  });

export function makeBillingRoutes(deps: BillingRouteDeps) {
  const orgName = (orgId: string) =>
    Effect.promise(
      async () =>
        (await deps.db.query.organization.findFirst({ where: eq(schema.organization.id, orgId) }))
          ?.name ?? "DJL Cloud",
    );

  const checkout = HttpRouter.add(
    "POST",
    "/v1/billing/checkout",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        requireRole(p, BILLING_ROLES);
        const body = (yield* readJson) as Partial<{
          kind: "subscription" | "topup";
          planId: PlanId;
          interval: "month" | "year";
          usd: number;
        }>;
        const name = yield* orgName(p.orgId);
        const attempt = (fn: () => Promise<{ url: string }>) =>
          Effect.tryPromise({
            try: fn,
            catch: (e) => {
              if (e instanceof ApiError) return e;
              console.error(
                JSON.stringify({
                  level: "error",
                  msg: "billing checkout failed",
                  error: e instanceof Error ? e.message : String(e),
                }),
              );
              return new ApiError(502, "billing_error", "Billing provider error.");
            },
          });
        if (body.kind === "topup") {
          const r = yield* attempt(() =>
            deps.billing.topupCheckout({
              orgId: p.orgId,
              userId: p.userId,
              email: p.email,
              orgName: name,
              usd: Number(body.usd),
            }),
          );
          return json(r);
        }
        if (body.kind === "subscription" && body.planId) {
          const r = yield* attempt(() =>
            deps.billing.subscribeCheckout({
              orgId: p.orgId,
              userId: p.userId,
              email: p.email,
              orgName: name,
              planId: body.planId!,
              interval: body.interval === "year" ? "year" : "month",
            }),
          );
          return json(r);
        }
        return yield* Effect.fail(
          new ApiError(400, "bad_request", "kind must be subscription or topup."),
        );
      }),
    ),
  );

  const portal = HttpRouter.add(
    "POST",
    "/v1/billing/portal",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        requireRole(p, BILLING_ROLES);
        const name = yield* orgName(p.orgId);
        const r = yield* Effect.tryPromise({
          try: () => deps.billing.portal(p.orgId, p.email, name),
          catch: () => new ApiError(502, "billing_error", "Billing provider error."),
        });
        return json(r);
      }),
    ),
  );

  const subscription = HttpRouter.add(
    "GET",
    "/v1/billing/subscription",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const sub = yield* Effect.promise(() =>
          deps.db.query.subscriptions.findFirst({
            where: eq(schema.subscriptions.orgId, p.orgId),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
          }),
        );
        const invoices = yield* Effect.promise(() =>
          deps.db.query.invoices.findMany({
            where: eq(schema.invoices.orgId, p.orgId),
            orderBy: (t, { desc }) => [desc(t.createdAt)],
            limit: 24,
          }),
        );
        return json({ subscription: sub ?? null, invoices });
      }),
    ),
  );

  const webhook = HttpRouter.add(
    "POST",
    "/v1/webhooks/stripe",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const ctx = yield* RequestContext;
      const signature = request.headers["stripe-signature"] ?? "";
      const payload = yield* request.text.pipe(Effect.catch(() => Effect.succeed("")));
      const outcome = yield* Effect.tryPromise({
        try: () => deps.billing.handleWebhook(payload, signature),
        catch: (e) =>
          e instanceof ApiError
            ? e
            : new ApiError(500, "webhook_failed", "Webhook processing failed."),
      }).pipe(
        Effect.catchIf(
          (e): e is ApiError => e instanceof ApiError,
          (e) => Effect.succeed(e),
        ),
      );
      if (outcome instanceof ApiError)
        return errorResponse(outcome.status, outcome.code, outcome.message, ctx.traceId);
      return json({ received: true, outcome });
    }),
  );

  return Layer.mergeAll(checkout, portal, subscription, webhook);
}
