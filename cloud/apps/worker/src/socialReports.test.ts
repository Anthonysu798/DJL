import { describe, expect, it, vi } from "vitest";
import type { PgBoss } from "pg-boss";
import { registerSocialReportJobs } from "./socialReports.ts";
function fixture(ids: string[] = []) {
  const handlers = new Map<string, (jobs: unknown[]) => Promise<void>>();
  const boss = {
    createQueue: vi.fn(async () => {}),
    schedule: vi.fn(async () => {}),
    send: vi.fn(async (_name: string, _data?: unknown, _options?: unknown) => "job"),
    work: vi.fn(
      async (name: string, _options: unknown, handler: (jobs: unknown[]) => Promise<void>) => {
        handlers.set(name, handler);
      },
    ),
  };
  const reports = { due: vi.fn(async () => ids), execute: vi.fn(async () => 1) };
  return { boss, reports, handlers };
}
describe("durable social recap queue", () => {
  it("creates no report jobs when all preferences are disabled", async () => {
    const f = fixture();
    await registerSocialReportJobs(f.boss as unknown as PgBoss, f.reports);
    expect(f.boss.send).not.toHaveBeenCalled();
    expect(f.reports.execute).not.toHaveBeenCalled();
    expect(f.boss.schedule).toHaveBeenCalledWith("social.report-sweep", "*/5 * * * *", undefined, {
      tz: "UTC",
    });
  });
  it("repairs missed notifications from persisted due schedules and retries only report collection", async () => {
    const f = fixture(["schedule-a"]);
    await registerSocialReportJobs(f.boss as unknown as PgBoss, f.reports);
    expect(f.boss.send).toHaveBeenCalledWith(
      "social.report",
      { scheduleId: "schedule-a" },
      expect.objectContaining({ singletonKey: "schedule-a", retryLimit: 3 }),
    );
    await f.handlers.get("social.report")!([{ data: { scheduleId: "schedule-a" } }]);
    expect(f.reports.execute).toHaveBeenCalledWith("schedule-a");
    await f.handlers.get("social.report-sweep")!([]);
    expect(f.reports.due).toHaveBeenCalledTimes(2);
    expect(f.boss.send.mock.calls.every(([name]) => name === "social.report")).toBe(true);
  });
});
