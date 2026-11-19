import { afterEach, describe, expect, it, vi } from "vitest";
import { computerHistoryClearScope } from "./computerHistoryClearScope";

const cutoff = new Date("2026-10-29T18:24:56.789Z");
afterEach(() => vi.unstubAllEnvs());

describe("computer history deletion boundaries", () => {
  it.each([
    ["10m", "2026-10-29T18:14:56.789Z"],
    ["1h", "2026-10-29T17:24:56.789Z"],
  ] as const)("uses the frozen cutoff for %s", (range, since) => {
    expect(computerHistoryClearScope({ range, cutoff, bundleId: " com.djl.fixture " })).toEqual({
      method: "activity.clear",
      since,
      until: "2026-10-29T18:24:56.789Z",
      bundleId: "com.djl.fixture",
    });
  });
  it("keeps all-time app deletion bounded to its exact bundle identity", () => {
    expect(
      computerHistoryClearScope({ range: "all", cutoff, bundleId: " com.DJL.OldApp " }),
    ).toEqual({ method: "activity.clear", bundleId: "com.DJL.OldApp" });
    expect(computerHistoryClearScope({ range: "all", cutoff, bundleId: "  " })).toEqual({
      method: "activity.clear",
    });
  });
  it.each([
    ["2026-03-08T16:00:00.000Z", "2026-03-08T05:00:00.000Z"],
    ["2026-11-01T17:00:00.000Z", "2026-11-01T04:00:00.000Z"],
  ])("starts today at calendar midnight across DST: %s", (until, since) => {
    vi.stubEnv("TZ", "America/New_York");
    expect(computerHistoryClearScope({ range: "today", cutoff: new Date(until) })).toEqual({
      method: "activity.clear",
      since,
      until,
    });
  });
  it("converts valid custom local input to exact UTC bounds", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(
      computerHistoryClearScope({
        range: "custom",
        cutoff,
        since: "2026-10-29T10:00",
        until: "2026-10-29T11:30",
      }),
    ).toEqual({
      method: "activity.clear",
      since: "2026-10-29T14:00:00.000Z",
      until: "2026-10-29T15:30:00.000Z",
    });
  });
  it.each([
    ["", "2026-10-29T11:30"],
    ["2026-02-30T10:00", "2026-03-02T11:30"],
    ["2026-10-29T11:30", "2026-10-29T10:00"],
    ["2026-10-29T10:00", "2026-10-29T10:00"],
    ["2026-03-08T02:30", "2026-03-08T04:00"],
  ])("rejects missing, normalized or empty/reversed custom ranges: %s", (since, until) => {
    vi.stubEnv("TZ", "America/New_York");
    expect(computerHistoryClearScope({ range: "custom", cutoff, since, until })).toBeNull();
  });
  it("rejects an overlong bundle and invalid cutoff instead of broadening deletion", () => {
    expect(
      computerHistoryClearScope({ range: "all", cutoff, bundleId: "a".repeat(257) }),
    ).toBeNull();
    expect(computerHistoryClearScope({ range: "10m", cutoff: new Date(NaN) })).toBeNull();
  });
});
