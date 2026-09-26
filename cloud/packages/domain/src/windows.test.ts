import { describe, expect, it } from "vitest";

import { creditsToMicro } from "./units.ts";
import {
  bankExpiresAt,
  blockingWindow,
  bucketStartFor,
  effectiveFloor,
  freeWeekStart,
  measureWindows,
  windowBounds,
  windowRoom,
  type WindowCaps,
} from "./windows.ts";

const at = (iso: string) => new Date(iso);
const caps: WindowCaps = { fiveHour: creditsToMicro(100), week: creditsToMicro(500) };

describe("usage windows", () => {
  it("aligns buckets to 5 UTC minutes, never before the week start", () => {
    const weekStart = at("2026-09-20T00:00:00.000Z");
    expect(bucketStartFor(at("2026-09-26T12:04:59.999Z"), weekStart)).toEqual(
      at("2026-09-26T12:00:00.000Z"),
    );
    expect(bucketStartFor(at("2026-09-26T12:05:00.000Z"), weekStart)).toEqual(
      at("2026-09-26T12:05:00.000Z"),
    );
    // Spend right after a reset (or a new week) lands at its start, so it still counts.
    const reset = at("2026-09-26T12:03:17.000Z");
    expect(bucketStartFor(at("2026-09-26T12:04:00.000Z"), reset)).toEqual(reset);
    expect(bucketStartFor(at("2026-09-26T12:06:00.000Z"), reset)).toEqual(
      at("2026-09-26T12:05:00.000Z"),
    );
  });

  it("takes the later of the user's floor and the global floor", () => {
    const a = at("2026-09-01T00:00:00Z");
    const b = at("2026-09-02T00:00:00Z");
    expect(effectiveFloor(a, b)).toEqual(b);
    expect(effectiveFloor(b, a)).toEqual(b);
    expect(effectiveFloor(null, a)).toEqual(a);
    expect(effectiveFloor(null, null)).toBeNull();
  });

  it("rolls the week from the anchor in whole 7-day steps", () => {
    const anchor = at("2026-09-01T10:00:00Z");
    const bounds = windowBounds({
      now: at("2026-09-15T09:59:59Z"),
      weekAnchorAt: anchor,
      floor: null,
    });
    expect(bounds.weekStart).toEqual(at("2026-09-08T10:00:00Z"));
    expect(bounds.weekEnd).toEqual(at("2026-09-15T10:00:00Z"));
    const next = windowBounds({
      now: at("2026-09-15T10:00:00Z"),
      weekAnchorAt: anchor,
      floor: null,
    });
    expect(next.weekStart).toEqual(at("2026-09-15T10:00:00Z"));
    expect(next.fiveHourStart).toEqual(at("2026-09-15T05:00:00Z"));
  });

  it("is exact across DST changes because everything is UTC milliseconds", () => {
    // US DST started 2026-03-08, EU 2026-03-29: neither shifts a UTC window.
    const now = at("2026-03-08T09:30:00Z");
    const bounds = windowBounds({ now, weekAnchorAt: at("2026-03-02T09:30:00Z"), floor: null });
    expect(now.getTime() - bounds.fiveHourStart.getTime()).toBe(5 * 3_600_000);
    expect(bounds.weekEnd.getTime() - bounds.weekStart.getTime()).toBe(7 * 86_400_000);
    expect(bounds.weekStart).toEqual(at("2026-03-02T09:30:00Z"));
  });

  it("never starts either window before the floor", () => {
    const floor = at("2026-09-10T08:00:00Z");
    const bounds = windowBounds({
      now: at("2026-09-10T09:00:00Z"),
      weekAnchorAt: at("2026-09-08T00:00:00Z"),
      floor,
    });
    expect(bounds.fiveHourStart).toEqual(floor);
    expect(bounds.weekStart).toEqual(floor);
    // The floor does not move the end of the week; only a redeem moves the anchor.
    expect(bounds.weekEnd).toEqual(at("2026-09-15T00:00:00Z"));
  });

  it("counts buckets from the 5-hour start inclusive, plus holds", () => {
    const now = at("2026-09-26T12:00:00Z");
    const bounds = windowBounds({ now, weekAnchorAt: at("2026-09-24T00:00:00Z"), floor: null });
    const usage = measureWindows({
      now,
      bounds,
      caps,
      recent: [
        { start: at("2026-09-26T06:55:00Z"), amount: creditsToMicro(99) }, // too old
        { start: at("2026-09-26T07:00:00Z"), amount: creditsToMicro(10) }, // exactly 5h ago
        { start: at("2026-09-26T11:55:00Z"), amount: creditsToMicro(20) },
      ],
      weekSpent: creditsToMicro(130),
      held: creditsToMicro(5),
    });
    expect(usage.fiveHour.used).toBe(creditsToMicro(35));
    expect(usage.fiveHour.remaining).toBe(creditsToMicro(65));
    expect(usage.fiveHour.resetsAt).toEqual(at("2026-09-26T12:00:00Z"));
    expect(usage.week.used).toBe(creditsToMicro(135));
    expect(usage.week.resetsAt).toEqual(at("2026-10-01T00:00:00Z"));
    expect(windowRoom(usage)).toBe(creditsToMicro(65));
    expect(blockingWindow(usage)).toBeNull();
  });

  it("reports when an exhausted 5-hour window frees up again", () => {
    const now = at("2026-09-26T12:00:00Z");
    const bounds = windowBounds({ now, weekAnchorAt: at("2026-09-24T00:00:00Z"), floor: null });
    const usage = measureWindows({
      now,
      bounds,
      caps,
      recent: [
        { start: at("2026-09-26T08:00:00Z"), amount: creditsToMicro(30) },
        { start: at("2026-09-26T09:00:00Z"), amount: creditsToMicro(50) },
        { start: at("2026-09-26T10:00:00Z"), amount: creditsToMicro(30) },
      ],
      weekSpent: creditsToMicro(110),
      held: 0n,
    });
    expect(usage.fiveHour.remaining).toBe(0n);
    // Dropping the 08:00 bucket leaves 80 of 100: room again at 13:00.
    expect(usage.fiveHour.resetsAt).toEqual(at("2026-09-26T13:00:00Z"));
    expect(blockingWindow(usage)?.kind).toBe("five_hour");
    expect(windowRoom(usage)).toBe(0n);
  });

  it("an exhausted week blocks until the week ends, even with 5-hour room", () => {
    const now = at("2026-09-26T12:00:00Z");
    const bounds = windowBounds({ now, weekAnchorAt: at("2026-09-24T00:00:00Z"), floor: null });
    const usage = measureWindows({
      now,
      bounds,
      caps,
      recent: [],
      weekSpent: creditsToMicro(500),
      held: 0n,
    });
    expect(usage.fiveHour.remaining).toBe(creditsToMicro(100));
    expect(blockingWindow(usage)).toMatchObject({
      kind: "week",
      resetsAt: at("2026-10-01T00:00:00Z"),
    });
  });

  it("reports nothing to reset when nothing is spent", () => {
    const now = at("2026-09-26T12:00:00Z");
    const bounds = windowBounds({ now, weekAnchorAt: now, floor: now });
    const usage = measureWindows({ now, bounds, caps, recent: [], weekSpent: 0n, held: 0n });
    expect(usage.fiveHour).toMatchObject({ used: 0n, remaining: caps.fiveHour, resetsAt: null });
    expect(usage.week).toMatchObject({ used: 0n, remaining: caps.week, resetsAt: null });
  });

  it("banks expire 90 days after the grant", () => {
    expect(bankExpiresAt(at("2026-09-26T12:00:00Z"))).toEqual(at("2026-12-25T12:00:00Z"));
  });

  it("free allowance weeks start Monday 00:00 UTC", () => {
    expect(freeWeekStart(at("2026-09-26T12:00:00Z"))).toEqual(at("2026-09-21T00:00:00Z"));
    expect(freeWeekStart(at("2026-09-21T00:00:00Z"))).toEqual(at("2026-09-21T00:00:00Z"));
    expect(freeWeekStart(at("2026-09-20T23:59:59Z"))).toEqual(at("2026-09-14T00:00:00Z"));
  });
});
