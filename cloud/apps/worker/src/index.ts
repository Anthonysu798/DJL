/**
 * Worker entry: pg-boss on the same Postgres, cron schedules for the ledger,
 * trials, purge, stats, and usage window jobs. Stripe webhooks are processed inline by the
 * API; the worker only owns time-based work.
 */
import { FakeBlobStore, createS3BlobStore } from "@djl/api/blobs";
import { LedgerService } from "@djl/api/credits";
import { createDatabase } from "@djl/db";
import { PgBoss } from "pg-boss";

import { JOBS } from "./jobs.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const { db, close } = createDatabase(databaseUrl, { max: 4 });
const ledger = new LedgerService(db);
const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const blobs =
  process.env.DJL_MOCK_EXTERNALS === "true"
    ? new FakeBlobStore()
    : createS3BlobStore({
        endpoint: requireEnv("STORAGE_S3_ENDPOINT"),
        region: process.env.STORAGE_S3_REGION ?? "us-east-1",
        bucket: process.env.STORAGE_BUCKET ?? "djl-sync",
        accessKeyId: requireEnv("STORAGE_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("STORAGE_SECRET_ACCESS_KEY"),
      });
const deps = { db, ledger, blobs };

const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss", max: 4 });
boss.on("error", (error) =>
  console.error(JSON.stringify({ level: "error", msg: "pg-boss", error: String(error) })),
);
await boss.start();

const SCHEDULES: Record<keyof typeof JOBS, string> = {
  "ledger.release-stale": "*/5 * * * *",
  "ledger.expire-trials": "17 * * * *",
  "ledger.refold": "43 * * * *",
  "users.purge-deleted": "15 3 * * *",
  "chat.purge-deleted": "35 3 * * *",
  "stats.daily": "5 0 * * *",
  "usage.grantPlanResets": "7 * * * *",
  "usage.bulkGrant": "* * * * *",
  "usage.expireBanks": "30 2 * * *",
  "usage.pruneBuckets": "45 3 * * *",
  "usage.grantFreeAllowance": "11 * * * *",
};

for (const [name, handler] of Object.entries(JOBS) as [
  keyof typeof JOBS,
  (typeof JOBS)[keyof typeof JOBS],
][]) {
  await boss.createQueue(name);
  await boss.schedule(name, SCHEDULES[name], undefined, { tz: "UTC" });
  await boss.work(name, { batchSize: 1 }, async () => {
    const started = Date.now();
    const result = await handler(deps);
    console.log(JSON.stringify({ level: "info", job: name, ms: Date.now() - started, result }));
  });
}

console.log(JSON.stringify({ level: "info", msg: "worker started", jobs: Object.keys(JOBS) }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void boss
      .stop({ graceful: true, timeout: 10_000 })
      .then(close)
      .then(() => process.exit(0));
  });
}
