import type { PgBoss } from "pg-boss";
import type { SocialReportService } from "../../api/src/social/reports/SocialReportService.ts";

/** The schedule/report tables remain authoritative after process death or missed queue notifications. */
export async function registerSocialReportJobs(
  boss: PgBoss,
  reports: Pick<SocialReportService, "due" | "execute">,
) {
  await boss.createQueue("social.report");
  await boss.createQueue("social.report-sweep");
  await boss.schedule("social.report-sweep", "*/5 * * * *", undefined, { tz: "UTC" });
  await boss.work<{ scheduleId: string }>("social.report", { batchSize: 1 }, async ([job]) => {
    if (job) await reports.execute(job.data.scheduleId);
  });
  const sweep = async () => {
    for (const scheduleId of await reports.due())
      await boss.send(
        "social.report",
        { scheduleId },
        { singletonKey: scheduleId, retryLimit: 3, retryDelay: 60, expireInSeconds: 1800 },
      );
  };
  await boss.work("social.report-sweep", { batchSize: 1 }, sweep);
  await sweep();
}
