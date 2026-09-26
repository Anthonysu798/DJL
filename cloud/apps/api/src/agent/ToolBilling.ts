/**
 * Charges agent tools (web search, page reads, sandbox time, image edit
 * surcharge) at the admin-editable `tool_prices`, through the same ledger
 * reserve → settle path as model calls, so credits and usage windows apply
 * to tools exactly as they do to tokens. A tool that fails is refunded.
 */
import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { Microcredits } from "@djl/domain";

import type { LedgerService } from "../credits/LedgerService.ts";
import type { RequestFacts } from "../gateway/GatewayService.ts";
import { ApiError } from "../http/errors.ts";
import { planForOrg } from "../usage/plans.ts";

export type ToolPriceKey = "exa_search" | "exa_contents" | "sandbox_second" | "image_edit";

/** Credits or a usage window ran out; the run moves to `blocked_on_usage`. */
export class UsageBlockedError extends Error {
  readonly _tag = "UsageBlockedError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const EXHAUSTED_CODES = new Set(["insufficient_credits", "usage_window_exhausted"]);

/** Error codes that mean out of credits or over a usage window. */
export const isUsageExhausted = (code: string) => EXHAUSTED_CODES.has(code);

/** Any error that means "out of credits or over a usage window", as a UsageBlockedError. */
export function asUsageBlocked(error: unknown): UsageBlockedError | null {
  if (error instanceof UsageBlockedError) return error;
  const tag = (error as { _tag?: unknown } | null)?._tag;
  if (tag === "InsufficientCreditsError")
    return new UsageBlockedError("insufficient_credits", "Out of credits.");
  if (tag === "UsageWindowExhaustedError")
    return new UsageBlockedError("usage_window_exhausted", "A usage limit was reached.");
  if (error instanceof ApiError && EXHAUSTED_CODES.has(error.code))
    return new UsageBlockedError(error.code, error.message);
  return null;
}

export class ToolBilling {
  constructor(
    private readonly db: DjlDatabase,
    private readonly ledger: Pick<LedgerService, "reserve" | "settle" | "release">,
  ) {}

  async price(tool: ToolPriceKey): Promise<Microcredits> {
    const row = await this.db.query.toolPrices.findFirst({
      columns: { microPerUnit: true },
      where: eq(schema.toolPrices.tool, tool),
    });
    return row?.microPerUnit ?? 0n;
  }

  /**
   * Reserves `maxUnits` of `tool` (holding room in the user's usage windows
   * like a model call), runs `work`, and settles the units it reports (never
   * more than reserved). Throws UsageBlockedError when the
   * reservation is refused; a failing `work` is released and rethrown.
   */
  async charge<T>(
    facts: RequestFacts,
    tool: ToolPriceKey,
    maxUnits: number,
    work: () => Promise<{ readonly value: T; readonly units: number }>,
  ): Promise<{ readonly value: T; readonly cost: Microcredits }> {
    const price = await this.price(tool);
    if (price === 0n) return { value: (await work()).value, cost: 0n };
    const orgId = facts.principal.orgId;
    const reservationId = crypto.randomUUID();
    const key = `tool:${reservationId}`;
    const plan = await planForOrg(this.db, orgId, new Date());
    try {
      await this.ledger.reserve({
        orgId,
        reservationId,
        estimate: price * BigInt(maxUnits),
        idempotencyKey: key,
        actor: `user:${facts.principal.userId}`,
        window: { userId: facts.principal.userId, caps: plan.windowCaps, partial: false },
      });
    } catch (error) {
      throw asUsageBlocked(error) ?? error;
    }
    let result: { readonly value: T; readonly units: number };
    try {
      result = await work();
    } catch (error) {
      await this.ledger
        .release({ orgId, reservationId, idempotencyKey: key, actor: "system:agent" })
        .catch(() => undefined);
      throw error;
    }
    const cost = price * BigInt(Math.min(Math.max(result.units, 0), maxUnits));
    await this.ledger.settle({
      orgId,
      reservationId,
      actual: cost,
      idempotencyKey: key,
      actor: "system:agent",
    });
    return { value: result.value, cost };
  }
}
