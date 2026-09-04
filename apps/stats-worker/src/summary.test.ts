import { describe, expect, it } from "vitest";

import {
  buildPublicSummary,
  buildSummary,
  fillDays,
  summaryWindowStart,
  toCountMap,
} from "./summary";

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
  it("assembles private visits, installs, and downloads sections", () => {
    const summary = buildSummary(
      {
        visitPageViews: 4,
        visitUniqueVisitors: 2,
        visitsByCountry: [
          { key: "CA", count: 3 },
          { key: "US", count: 1 },
        ],
        visitsByPath: [
          { key: "/", count: 2 },
          { key: "/guide", count: 2 },
        ],
        visitsByDay: [{ day: "2026-09-02", count: 4 }],
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
    expect(summary.visits.pageViews).toBe(4);
    expect(summary.visits.uniqueVisitors).toBe(2);
    expect(summary.visits.byCountry).toEqual({ CA: 3, US: 1 });
    expect(summary.visits.byPath).toEqual({ "/": 2, "/guide": 2 });
    expect(summary.visits.byDay.at(-1)).toEqual({ day: "2026-09-02", count: 4 });
    expect(summary.installs.total).toBe(2);
    expect(summary.installs.byVersion).toEqual({ "0.5.6": 2 });
    expect(summary.installs.byDay.at(-1)).toEqual({ day: "2026-09-02", count: 2 });
    expect(summary.downloads.bySource).toEqual({ github: 3, oss: 2 });
    expect(summary.downloads.byCountry).toEqual({ unknown: 5 });
    expect(summary.downloads.byDay.every((row) => row.count === 0)).toBe(true);
  });

  it("publishes only sanitized download aggregates", () => {
    const privateSummary = buildSummary(
      {
        visitPageViews: 4,
        visitUniqueVisitors: 2,
        visitsByCountry: [{ key: "CA", count: 4 }],
        visitsByPath: [{ key: "/private", count: 4 }],
        visitsByDay: [],
        installsTotal: 2,
        installsByCountry: [{ key: "CA", count: 2 }],
        installsByPlatform: [{ key: "darwin", count: 2 }],
        installsByVersion: [{ key: "0.5.10", count: 2 }],
        installsByDay: [],
        downloadsTotal: 5,
        downloadsBySource: [{ key: "github", count: 5 }],
        downloadsByCountry: [{ key: "CA", count: 5 }],
        downloadsByPlatform: [{ key: "mac", count: 5 }],
        downloadsByDay: [{ day: "2026-09-02", count: 5 }],
      },
      NOW,
    );

    expect(buildPublicSummary(privateSummary)).toEqual({
      downloads: {
        total: 5,
        bySource: { github: 5 },
        byPlatform: { mac: 5 },
        byDay: expect.any(Array),
      },
    });
    expect(buildPublicSummary(privateSummary).downloads.byDay.at(-1)).toEqual({
      day: "2026-09-02",
      count: 5,
    });
  });
});
