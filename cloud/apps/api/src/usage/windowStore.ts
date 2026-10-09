/**
 * Usage window state in Postgres. Every function runs inside a caller's
 * transaction. The ledger calls `holdWindows` and `settleHold` from its own
 * reserve and settle transactions, so credits and windows never disagree.
 *
 * Lock order is fixed: credit_balances (taken by the ledger) and then
 * usage_windows. Paths that change only windows (redeem, admin reset) take
 * just the usage_windows row.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  blockingWindow,
  bucketStartFor,
  effectiveFloor,
  measureWindows,
  windowBounds,
  windowRoom,
  type Microcredits,
  type WindowCaps,
  type WindowUsage,
  type WindowsUsage,
} from "@djl/domain";

export type Tx = Parameters<Parameters<DjlDatabase["transaction"]>[0]>[0];

/** Settings key "reset everyone" writes: spend before it counts for nobody. */
export const GLOBAL_FLOOR_KEY = "usage.global_floor_at";
/** Holds older than this are swept, matching the stale reservation release. */
export const HOLD_TTL_MS = 10 * 60_000;

export class UsageWindowExhaustedError extends Error {
  readonly _tag = "UsageWindowExhaustedError";
  constructor(readonly window: WindowUsage) {
    super("usage_window_exhausted");
  }
}

export interface WindowState {
  readonly weekAnchorAt: Date;
  /** The later of the user's floor and the global floor. */
  readonly floor: Date | null;
}

const { usageBuckets, usageHolds, usageWindows } = schema;

async function globalFloor(tx: Tx): Promise<Date | null> {
  const row = await tx.query.settings.findFirst({
    where: eq(schema.settings.key, GLOBAL_FLOOR_KEY),
  });
  return typeof row?.value === "string" ? new Date(row.value) : null;
}

/** The user's window row, created on first use. `lock` takes it FOR UPDATE. */
export async function windowState(tx: Tx, userId: string, lock: boolean): Promise<WindowState> {
  await tx.insert(usageWindows).values({ userId }).onConflictDoNothing();
  const query = tx.select().from(usageWindows).where(eq(usageWindows.userId, userId));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new Error("usage_windows row missing after upsert");
  return {
    weekAnchorAt: row.weekAnchorAt,
    floor: effectiveFloor(row.floorAt, await globalFloor(tx)),
  };
}

export async function measure(
  tx: Tx,
  userId: string,
  state: WindowState,
  caps: WindowCaps,
  now: Date,
): Promise<WindowsUsage> {
  const bounds = windowBounds({ now, weekAnchorAt: state.weekAnchorAt, floor: state.floor });
  const recent = await tx
    .select({ start: usageBuckets.bucketStart, amount: usageBuckets.spentMicro })
    .from(usageBuckets)
    .where(
      and(eq(usageBuckets.userId, userId), gte(usageBuckets.bucketStart, bounds.fiveHourStart)),
    );
  const [week] = await tx
    .select({ total: sql<string>`coalesce(sum(${usageBuckets.spentMicro}), 0)::text` })
    .from(usageBuckets)
    .where(and(eq(usageBuckets.userId, userId), gte(usageBuckets.bucketStart, bounds.weekStart)));
  const [held] = await tx
    .select({ total: sql<string>`coalesce(sum(${usageHolds.amountMicro}), 0)::text` })
    .from(usageHolds)
    .where(eq(usageHolds.userId, userId));
  return measureWindows({
    now,
    bounds,
    caps,
    recent,
    weekSpent: BigInt(week?.total ?? "0"),
    held: BigInt(held?.total ?? "0"),
  });
}

/**
 * Hold room in both windows for a reservation and return the amount held.
 * With `partial`, a request may start with less room than its estimate (a
 * stream is then cut at the hold); otherwise the whole estimate must fit.
 */
export async function holdWindows(
  tx: Tx,
  input: {
    readonly reservationId: string;
    readonly userId: string;
    readonly caps: WindowCaps;
    readonly amount: Microcredits;
    readonly partial: boolean;
    readonly now: Date;
  },
): Promise<Microcredits> {
  const state = await windowState(tx, input.userId, true);
  const usage = await measure(tx, input.userId, state, input.caps, input.now);
  const room = windowRoom(usage);
  if (room === 0n || (!input.partial && room < input.amount)) {
    const tightest = usage.fiveHour.remaining <= usage.week.remaining ? usage.fiveHour : usage.week;
    throw new UsageWindowExhaustedError(blockingWindow(usage) ?? tightest);
  }
  const held = room < input.amount ? room : input.amount;
  await tx.insert(usageHolds).values({
    id: input.reservationId,
    userId: input.userId,
    amountMicro: held,
    expiresAt: new Date(input.now.getTime() + HOLD_TTL_MS),
  });
  return held;
}

/**
 * Replace a reservation's hold with its actual cost in the current bucket.
 * The window records at most what it held (a cut stream can overshoot by one
 * chunk), so concurrent requests never push a window past its cap; the
 * ledger still charges the full actual cost.
 */
export async function settleHold(
  tx: Tx,
  reservationId: string,
  actual: Microcredits,
  now: Date,
): Promise<void> {
  const hold = await tx.query.usageHolds.findFirst({ where: eq(usageHolds.id, reservationId) });
  if (!hold) return;
  const state = await windowState(tx, hold.userId, true);
  await tx.delete(usageHolds).where(eq(usageHolds.id, reservationId));
  const spent = actual < hold.amountMicro ? actual : hold.amountMicro;
  if (spent <= 0n) return;
  const { weekStart } = windowBounds({ now, weekAnchorAt: state.weekAnchorAt, floor: state.floor });
  await tx
    .insert(usageBuckets)
    .values({ userId: hold.userId, bucketStart: bucketStartFor(now, weekStart), spentMicro: spent })
    .onConflictDoUpdate({
      target: [usageBuckets.userId, usageBuckets.bucketStart],
      set: { spentMicro: sql`${usageBuckets.spentMicro} + ${spent}` },
    });
}

/** Zero both windows from `now`; a redeemed bank also starts a new week. */
export async function resetWindows(
  tx: Tx,
  userId: string,
  now: Date,
  options: { readonly newWeek: boolean },
): Promise<void> {
  await windowState(tx, userId, true);
  await tx
    .update(usageWindows)
    .set(options.newWeek ? { floorAt: now, weekAnchorAt: now } : { floorAt: now })
    .where(eq(usageWindows.userId, userId));
}
