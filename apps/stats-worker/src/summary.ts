// FILE: summary.ts
// Purpose: Turns grouped D1 rows into the JSON shape served by GET /v1/stats.

export const SUMMARY_DAY_WINDOW = 30;

export interface CountRow {
  readonly key: string | null;
  readonly count: number;
}

export interface DayRow {
  readonly day: string;
  readonly count: number;
}

export interface SummaryRows {
  readonly installsTotal: number;
  readonly installsByCountry: readonly CountRow[];
  readonly installsByPlatform: readonly CountRow[];
  readonly installsByVersion: readonly CountRow[];
  readonly installsByDay: readonly DayRow[];
  readonly downloadsTotal: number;
  readonly downloadsBySource: readonly CountRow[];
  readonly downloadsByCountry: readonly CountRow[];
  readonly downloadsByPlatform: readonly CountRow[];
  readonly downloadsByDay: readonly DayRow[];
}

export interface StatsSummary {
  readonly installs: {
    readonly total: number;
    readonly byCountry: Record<string, number>;
    readonly byPlatform: Record<string, number>;
    readonly byVersion: Record<string, number>;
    readonly byDay: readonly DayRow[];
  };
  readonly downloads: {
    readonly total: number;
    readonly bySource: Record<string, number>;
    readonly byCountry: Record<string, number>;
    readonly byPlatform: Record<string, number>;
    readonly byDay: readonly DayRow[];
  };
}

export function toCountMap(rows: readonly CountRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.key ?? "unknown"] = row.count;
  }
  return map;
}

function utcDayStart(now: Date, daysAgo: number): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return day;
}

export function summaryWindowStart(now: Date): string {
  return utcDayStart(now, SUMMARY_DAY_WINDOW - 1).toISOString();
}

export function fillDays(rows: readonly DayRow[], now: Date): DayRow[] {
  const counts = new Map(rows.map((row) => [row.day, row.count]));
  const days: DayRow[] = [];
  for (let daysAgo = SUMMARY_DAY_WINDOW - 1; daysAgo >= 0; daysAgo -= 1) {
    const day = utcDayStart(now, daysAgo).toISOString().slice(0, 10);
    days.push({ day, count: counts.get(day) ?? 0 });
  }
  return days;
}

export function buildSummary(rows: SummaryRows, now: Date): StatsSummary {
  return {
    installs: {
      total: rows.installsTotal,
      byCountry: toCountMap(rows.installsByCountry),
      byPlatform: toCountMap(rows.installsByPlatform),
      byVersion: toCountMap(rows.installsByVersion),
      byDay: fillDays(rows.installsByDay, now),
    },
    downloads: {
      total: rows.downloadsTotal,
      bySource: toCountMap(rows.downloadsBySource),
      byCountry: toCountMap(rows.downloadsByCountry),
      byPlatform: toCountMap(rows.downloadsByPlatform),
      byDay: fillDays(rows.downloadsByDay, now),
    },
  };
}
