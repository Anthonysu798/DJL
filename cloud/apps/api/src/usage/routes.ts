/**
 * Signed-in usage routes: both windows, live banked resets, and redeeming one.
 */
import {
  CloudRedeemBankInput,
  type CloudRedeemBankResponse,
  type CloudResetBank,
  type CloudResetBanksResponse,
  type CloudUsageWindow,
  type CloudUsageWindowsResponse,
} from "@synara/contracts/cloud";
import type { WindowUsage } from "@djl/domain";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";

import type { PrincipalResolver } from "../auth/guard.ts";
import { requirePrincipal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import type { ResetBank, UsageService, UsageWindowsView } from "./UsageService.ts";

export interface UsageRouteDeps {
  readonly usage: UsageService;
  readonly principals: PrincipalResolver;
}

const FAIL = { status: 500, code: "usage_error", message: "Could not read usage." };

const windowWire = (w: WindowUsage): CloudUsageWindow => ({
  kind: w.kind,
  limit: w.limit.toString(),
  used: w.used.toString(),
  remaining: w.remaining.toString(),
  resetsAt: w.resetsAt?.toISOString() ?? null,
});

const windowsWire = (view: UsageWindowsView): CloudUsageWindowsResponse => ({
  planId: view.planId,
  windows: { fiveHour: windowWire(view.windows.fiveHour), week: windowWire(view.windows.week) },
  banks: {
    count: view.banks.count,
    nextExpiresAt: view.banks.nextExpiresAt?.toISOString() ?? null,
  },
});

const bankWire = (bank: ResetBank): CloudResetBank => ({
  id: bank.id,
  source: bank.source,
  grantedAt: bank.grantedAt.toISOString(),
  expiresAt: bank.expiresAt.toISOString(),
});

const decodeRedeem = Schema.decodeUnknownEffect(CloudRedeemBankInput);

export function makeUsageRoutes(deps: UsageRouteDeps) {
  const windows = HttpRouter.add(
    "GET",
    "/v1/usage/windows",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const view = yield* attempt(() => deps.usage.windows(p.userId, p.orgId), FAIL);
        return json(windowsWire(view));
      }),
    ),
  );

  const banks = HttpRouter.add(
    "GET",
    "/v1/usage/banks",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const rows = yield* attempt(() => deps.usage.banks(p.userId), FAIL);
        const body: CloudResetBanksResponse = { banks: rows.map(bankWire) };
        return json(body);
      }),
    ),
  );

  const redeem = HttpRouter.add(
    "POST",
    "/v1/usage/resets/redeem",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const input = yield* decodeRedeem(yield* readJson).pipe(
          Effect.mapError(
            () => new ApiError(400, "bad_request", "idempotencyKey must be 1 to 128 characters."),
          ),
        );
        const result = yield* attempt(
          () => deps.usage.redeem(p.userId, p.orgId, input.idempotencyKey),
          { status: 500, code: "redeem_failed", message: "Could not redeem the reset." },
        );
        const body: CloudRedeemBankResponse = {
          redeemedBankId: result.redeemedBankId,
          usage: windowsWire(result.usage),
        };
        return json(body);
      }),
    ),
  );

  return Layer.mergeAll(windows, banks, redeem);
}
