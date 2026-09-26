import type { Microcredits } from "./units.ts";

/**
 * Usage windows: a rolling 5-hour window and a 7-day week, both capped in
 * microcredits per plan. Credits still pay; windows only limit how fast.
 *
 * Settled spend is kept in 5-minute UTC buckets; in-flight holds count too.
 * A reset sets a floor: spend before it no longer counts toward either
 * window. Redeeming a banked reset also moves the week anchor so a new
 * 7-day week starts at that moment. All math is UTC milliseconds, so there
 * is no daylight-saving edge.
 */
export type WindowKind = "five_hour" | "week";

export interface WindowCaps {
  readonly fiveHour: Microcredits;
  readonly week: Microcredits;
}

export interface SpendBucket {
  readonly start: Date;
  readonly amount: Microcredits;
}

export interface WindowBounds {
  readonly fiveHourStart: Date;
  readonly weekStart: Date;
  /** When the current week ends; a floor never moves it. */
  readonly weekEnd: Date;
}

export interface WindowUsage {
  readonly kind: WindowKind;
  readonly limit: Microcredits;
  readonly used: Microcredits;
  readonly remaining: Microcredits;
  /** When spend next rolls off (5-hour) or the week ends; null when nothing is used. */
  readonly resetsAt: Date | null;
}

export interface WindowsUsage {
  readonly fiveHour: WindowUsage;
  readonly week: WindowUsage;
}

export const BUCKET_MS = 5 * 60_000;
export const FIVE_HOURS_MS = 5 * 3_600_000;
export const WEEK_MS = 7 * 86_400_000;
export const BANK_LIFETIME_MS = 90 * 86_400_000;
/** 1970-01-01 was a Thursday; the first Monday is 4 days later. */
const FIRST_MONDAY_MS = 4 * 86_400_000;

const later = (a: Date, b: Date | null): Date => (b && b > a ? b : a);

/** The later of the user's own floor and the global "reset everyone" floor. */
export function effectiveFloor(userFloor: Date | null, globalFloor: Date | null): Date | null {
  if (!userFloor) return globalFloor;
  return later(userFloor, globalFloor);
}

/**
 * The bucket settled spend goes into: the 5-minute UTC slot, or the current
 * week start (which includes any floor) when the week began or a reset
 * happened inside that slot, so the spend counts in the current windows.
 */
export function bucketStartFor(now: Date, weekStart: Date): Date {
  const aligned = new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS);
  return later(aligned, weekStart);
}

export function windowBounds(input: {
  readonly now: Date;
  readonly weekAnchorAt: Date;
  readonly floor: Date | null;
}): WindowBounds {
  const { now, weekAnchorAt, floor } = input;
  const anchor = weekAnchorAt.getTime();
  const weeks = Math.floor((now.getTime() - anchor) / WEEK_MS);
  const periodStart = anchor + weeks * WEEK_MS;
  return {
    fiveHourStart: later(new Date(now.getTime() - FIVE_HOURS_MS), floor),
    weekStart: later(new Date(periodStart), floor),
    weekEnd: new Date(periodStart + WEEK_MS),
  };
}

function usage(
  kind: WindowKind,
  limit: Microcredits,
  used: Microcredits,
  resetsAt: Date | null,
): WindowUsage {
  const remaining = limit > used ? limit - used : 0n;
  return { kind, limit, used, remaining, resetsAt: used > 0n ? resetsAt : null };
}

/**
 * Measure both windows. `recent` holds the buckets at or after the 5-hour
 * start (older ones are ignored); `weekSpent` is the bucket total since the
 * week start; `held` is the sum of open holds.
 */
export function measureWindows(input: {
  readonly now: Date;
  readonly bounds: WindowBounds;
  readonly caps: WindowCaps;
  readonly recent: readonly SpendBucket[];
  readonly weekSpent: Microcredits;
  readonly held: Microcredits;
}): WindowsUsage {
  const { now, bounds, caps, held } = input;
  // Held spend settles now, so it rolls off last.
  const spends = [
    ...input.recent
      .filter((b) => b.start >= bounds.fiveHourStart)
      .toSorted((a, b) => a.start.getTime() - b.start.getTime()),
    ...(held > 0n ? [{ start: now, amount: held }] : []),
  ];
  const fiveHourUsed = spends.reduce((sum, b) => sum + b.amount, 0n);
  // Not exhausted: the oldest spend rolls off next. Exhausted: the first
  // moment enough has rolled off to leave room again.
  const mustDrop = fiveHourUsed >= caps.fiveHour ? fiveHourUsed - caps.fiveHour + 1n : 1n;
  let dropped = 0n;
  let fiveHourResetsAt: Date | null = null;
  for (const spend of spends) {
    dropped += spend.amount;
    if (dropped >= mustDrop) {
      fiveHourResetsAt = new Date(spend.start.getTime() + FIVE_HOURS_MS);
      break;
    }
  }
  return {
    fiveHour: usage("five_hour", caps.fiveHour, fiveHourUsed, fiveHourResetsAt),
    week: usage("week", caps.week, input.weekSpent + held, bounds.weekEnd),
  };
}

/** How much more may be spent right now. */
export function windowRoom(windows: WindowsUsage): Microcredits {
  const { fiveHour, week } = windows;
  return fiveHour.remaining < week.remaining ? fiveHour.remaining : week.remaining;
}

/** The exhausted window that frees up last, or null when both have room. */
export function blockingWindow(windows: WindowsUsage): WindowUsage | null {
  const exhausted = [windows.fiveHour, windows.week].filter((w) => w.remaining === 0n);
  return (
    exhausted.toSorted((a, b) => (b.resetsAt?.getTime() ?? 0) - (a.resetsAt?.getTime() ?? 0))[0] ??
    null
  );
}

export function bankExpiresAt(grantedAt: Date): Date {
  return new Date(grantedAt.getTime() + BANK_LIFETIME_MS);
}

/** Monday 00:00 UTC of the week containing `now`; keys the weekly free allowance. */
export function freeWeekStart(now: Date): Date {
  const weeks = Math.floor((now.getTime() - FIRST_MONDAY_MS) / WEEK_MS);
  return new Date(FIRST_MONDAY_MS + weeks * WEEK_MS);
}
