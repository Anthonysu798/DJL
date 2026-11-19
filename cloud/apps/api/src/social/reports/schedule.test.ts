import { describe, expect, it } from "vitest";
import { nextWeeklyInstant, validateReportSchedule } from "./schedule.ts";
const weekly = { enabled: true, timezone: "America/Toronto", weekday: 1, hour: 9, minute: 0 };
describe("weekly recap local calendar", () => {
  it("keeps the requested local time across spring and autumn DST", () => {
    expect(nextWeeklyInstant(new Date("2027-03-07T15:00:00Z"), weekly).toISOString()).toBe(
      "2027-03-08T14:00:00.000Z",
    );
    expect(nextWeeklyInstant(new Date("2027-03-08T14:00:00Z"), weekly).toISOString()).toBe(
      "2027-03-15T13:00:00.000Z",
    );
    expect(nextWeeklyInstant(new Date("2027-11-01T13:00:00Z"), weekly).toISOString()).toBe(
      "2027-11-08T14:00:00.000Z",
    );
  });
  it("uses the first valid minute for a spring gap and first occurrence for a repeated time", () => {
    const sunday = { ...weekly, weekday: 0, hour: 2, minute: 30 };
    expect(nextWeeklyInstant(new Date("2027-03-13T00:00:00Z"), sunday).toISOString()).toBe(
      "2027-03-14T07:00:00.000Z",
    );
    const autumn = { ...weekly, weekday: 0, hour: 1, minute: 30 };
    expect(nextWeeklyInstant(new Date("2027-11-06T00:00:00Z"), autumn).toISOString()).toBe(
      "2027-11-07T05:30:00.000Z",
    );
    expect(nextWeeklyInstant(new Date("2027-11-07T05:30:00Z"), autumn).toISOString()).toBe(
      "2027-11-14T06:30:00.000Z",
    );
  });
  it("supports fractional and far-east UTC offsets without inventing a UTC weekly interval", () => {
    expect(
      nextWeeklyInstant(new Date("2027-01-03T00:00:00Z"), {
        ...weekly,
        timezone: "Asia/Kathmandu",
      }).toISOString(),
    ).toBe("2027-01-04T03:15:00.000Z");
    expect(
      nextWeeklyInstant(new Date("2027-01-03T00:00:00Z"), {
        ...weekly,
        timezone: "Pacific/Kiritimati",
      }).toISOString(),
    ).toBe("2027-01-03T19:00:00.000Z");
  });
  it.each([
    { weekday: -1 },
    { weekday: 7 },
    { hour: 24 },
    { minute: 60 },
    { minute: 0.5 },
    { timezone: "bad/zone" },
  ])("rejects invalid schedules %j", (patch) => {
    expect(() => validateReportSchedule({ ...weekly, ...patch })).toThrow();
  });
});
