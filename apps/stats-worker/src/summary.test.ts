import { describe, expect, it } from "vitest";

import { buildSummary, fillDays, summaryWindowStart, toCountMap } from "./summary";

const NOW = new Date("2026-09-02T15:04:05.000Z");

describe("toCountMap", () => {
  it("maps rows to an object and labels null keys as unknown", () => {
    expect(
      toCountMap([
        { key: "CN", count: 4 },
        { key: null, count: 1 },
      ]),
    ).toEqual({ CN: 4, unknown: 1 });
  });
});

describe("summaryWindowStart", () => {
  it("starts the 30-day window at midnight UTC 29 days ago", () => {
    expect(summaryWindowStart(NOW)).toBe("2026-08-04T00:00:00.000Z");
  });
});

describe("fillDays", () => {
  it("zero-fills every day of the window in ascending order", () => {
    const days = fillDays([{ day: "2026-09-01", count: 3 }], NOW);
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: "2026-08-04", count: 0 });
    expect(days.at(-2)).toEqual({ day: "2026-09-01", count: 3 });
    expect(days.at(-1)).toEqual({ day: "2026-09-02", count: 0 });
  });
});

describe("buildSummary", () => {
  it("assembles installs and downloads sections", () => {
    const summary = buildSummary(
      {
        installsTotal: 2,
        installsByCountry: [{ key: "CN", count: 2 }],
        installsByPlatform: [{ key: "darwin", count: 2 }],
        installsByVersion: [{ key: "0.5.6", count: 2 }],
        installsByDay: [{ day: "2026-09-02", count: 2 }],
        downloadsTotal: 5,
        downloadsBySource: [
          { key: "github", count: 3 },
          { key: "oss", count: 2 },
        ],
        downloadsByCountry: [{ key: null, count: 5 }],
        downloadsByPlatform: [{ key: "mac", count: 5 }],
        downloadsByDay: [],
      },
      NOW,
    );
    expect(summary.installs.total).toBe(2);
    expect(summary.installs.byVersion).toEqual({ "0.5.6": 2 });
    expect(summary.installs.byDay.at(-1)).toEqual({ day: "2026-09-02", count: 2 });
    expect(summary.downloads.bySource).toEqual({ github: 3, oss: 2 });
    expect(summary.downloads.byCountry).toEqual({ unknown: 5 });
    expect(summary.downloads.byDay.every((row) => row.count === 0)).toBe(true);
  });
});
