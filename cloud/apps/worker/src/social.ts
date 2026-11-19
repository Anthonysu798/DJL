import type { PgBoss } from "pg-boss";
import type { PublishingWorker } from "../../api/src/social/publishing/PublishingWorker.ts";
export async function registerSocialJobs(boss: PgBoss, worker: PublishingWorker): Promise<void> {
  await boss.createQueue("social.publish");
  await boss.createQueue("social.sweep");
  await boss.schedule("social.sweep", "* * * * *", undefined, { tz: "UTC" });
  await boss.work<{ taskId: string }>("social.publish", { batchSize: 1 }, async ([job]) => {
    if (job) await worker.execute(job.data.taskId);
  });
  const sweep = async () => {
    for (const taskId of await worker.due())
      await boss.send("social.publish", { taskId }, { singletonKey: taskId });
  };
  await boss.work("social.sweep", { batchSize: 1 }, sweep);
  await sweep();
}
