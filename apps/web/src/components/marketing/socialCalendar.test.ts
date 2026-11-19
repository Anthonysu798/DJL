import { describe, expect, it } from "vitest";
import { calendarTimeToIso, calendarWeek, localCalendarTime } from "./socialCalendar";

describe("social schedule timezone conversion", () => {
  it("preserves the instant in a named timezone instead of the browser timezone", () => {
    expect(calendarTimeToIso("2026-10-28T20:00", "America/Toronto")).toBe(
      "2026-10-29T00:00:00.000Z",
    );
    expect(calendarTimeToIso("2026-10-28T20:00", "Asia/Kathmandu")).toBe(
      "2026-10-28T14:15:00.000Z",
    );
    expect(localCalendarTime("2026-10-29T00:00:00Z", "America/Toronto")).toBe("2026-10-28T20:00");
  });
  it("rejects nonexistent, ambiguous and invalid dates", () => {
    expect(() => calendarTimeToIso("2026-03-08T02:30", "America/Toronto")).toThrow(
      "does not exist",
    );
    expect(() => calendarTimeToIso("2026-11-01T01:30", "America/Toronto")).toThrow("occurs twice");
    expect(() => calendarTimeToIso("2026-02-30T12:00", "UTC")).toThrow("valid date");
  });
  it("preserves either known occurrence when an existing fold schedule is unchanged", () => {
    for (const scheduledAt of ["2030-11-03T05:30:00.000Z", "2030-11-03T06:30:00.000Z"]) {
      const known = { scheduledAt, timezone: "America/Toronto" };
      const wall = localCalendarTime(scheduledAt, known.timezone);
      expect(calendarTimeToIso(wall, known.timezone, known)).toBe(scheduledAt);
    }
    const known = { scheduledAt: "2030-11-03T05:30:00.000Z", timezone: "America/Toronto" };
    expect(() => calendarTimeToIso("2030-11-03T01:31", known.timezone, known)).toThrow(
      "occurs twice",
    );
    expect(calendarTimeToIso("2030-11-03T01:30", "UTC", known)).toBe("2030-11-03T01:30:00.000Z");
  });
  it("uses civil Mondays across year boundaries", () => {
    expect(calendarWeek("2026-01-01", 0)).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });
});
