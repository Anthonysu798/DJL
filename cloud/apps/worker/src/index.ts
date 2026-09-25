/**
 * Worker entry: pg-boss on the same Postgres, cron schedules for the ledger,
 * trials, purge, and stats jobs. Stripe webhooks are processed inline by the
 * API; the worker only owns time-based work.
 */
import { LedgerService } from "@djl/api/credits";
import { createDatabase } from "@djl/db";
import { PgBoss } from "pg-boss";

import { JOBS } from "./jobs.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const { db, close } = createDatabase(databaseUrl, { max: 4 });
const ledger = new LedgerService(db);
const deps = { db, ledger };

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
  "stats.daily": "5 0 * * *",
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
