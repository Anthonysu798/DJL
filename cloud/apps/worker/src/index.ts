/**
 * Worker entry: pg-boss on the same Postgres, cron schedules for the ledger,
 * trials, purge, stats, and usage window jobs, and the background agent
 * (task runs). Stripe webhooks are processed inline by the API.
 */
import { createAgentRuntime } from "@djl/api/agent";
import { blobStoreFromEnv } from "@djl/api/blobs";
import { LedgerService } from "@djl/api/credits";
import { CommerceAlertsService, commerceAlertsEnabled } from "@djl/api/commerce-alerts";
import {
  CommerceAlertDeliveryService,
  commerceAlertEmailConfig,
  commerceAlertEmailSender,
} from "@djl/api/commerce-alert-email";
import { createDatabase } from "@djl/db";
import { MockOutbox, createResendSender } from "@djl/notify";
import { Redis } from "ioredis";
import { PgBoss } from "pg-boss";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";

import { registerAgentJobs } from "./agent.ts";
import { COMMERCE_IMAGE_CLEANUP, JOBS } from "./jobs.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const { db, close } = createDatabase(databaseUrl, { max: 4 });
const ledger = new LedgerService(db);
const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const mockExternals = process.env.DJL_MOCK_EXTERNALS === "true";
const blobs = blobStoreFromEnv(process.env, { mockExternals });
const deps = { db, ledger, blobs };

const boss = new PgBoss({
  connectionString: databaseUrl,
  schema: "pgboss",
  max: 4,
  createSchema: process.env.PG_BOSS_CREATE_SCHEMA !== "false",
});
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
  [COMMERCE_IMAGE_CLEANUP.name]: COMMERCE_IMAGE_CLEANUP.schedule,
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

// Independent, database-only monitoring. Disabled by default and never requires provider credentials.
const commerceAlerts = new CommerceAlertsService(db, {
  enabled: commerceAlertsEnabled(
    process.env.DJL_COMMERCE_ALERTS_ENABLED,
    process.env.DJL_ENV ?? "local",
  ),
  environment: process.env.DJL_ENV ?? "local",
});
try {
  await boss.createQueue("commerce.alerts.scan");
  await boss.schedule("commerce.alerts.scan", "*/5 * * * *", undefined, { tz: "UTC" });
  await boss.work("commerce.alerts.scan", { batchSize: 1 }, async () => {
    try {
      const result = await commerceAlerts.scan();
      console.log(JSON.stringify({ level: "info", job: "commerce.alerts.scan", result }));
    } catch {
      console.error(
        JSON.stringify({
          level: "error",
          job: "commerce.alerts.scan",
          code: "commerce_alert_scan_failed",
        }),
      );
      throw new Error("commerce_alert_scan_failed");
    }
  });
} catch {
  // Missing monitoring must remain visible as never-scanned/stale, not stop unrelated AI jobs.
  console.error(
    JSON.stringify({
      level: "error",
      job: "commerce.alerts.scan",
      code: "commerce_alert_registration_failed",
    }),
  );
}

// Separate from scanning and AI notifications. Default off; uses only its dedicated commerce key.
const commerceEmailSender = commerceAlertEmailSender(process.env);
const commerceEmail = new CommerceAlertDeliveryService(db, {
  ...commerceAlertEmailConfig(process.env),
  ...(commerceEmailSender ? { sender: commerceEmailSender } : {}),
});
try {
  await boss.createQueue("commerce.alerts.email");
  await boss.schedule("commerce.alerts.email", "*/5 * * * *", undefined, { tz: "UTC" });
  await boss.work("commerce.alerts.email", { batchSize: 1 }, async () => {
    try {
      const result = await commerceEmail.dispatch();
      console.log(JSON.stringify({ level: "info", job: "commerce.alerts.email", result }));
    } catch {
      console.error(
        JSON.stringify({
          level: "error",
          job: "commerce.alerts.email",
          code: "commerce_alert_email_unavailable",
        }),
      );
      throw new Error("commerce_alert_email_unavailable");
    }
  });
} catch {
  console.error(
    JSON.stringify({
      level: "error",
      job: "commerce.alerts.email",
      code: "commerce_alert_email_registration_failed",
    }),
  );
}

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63799", {
  maxRetriesPerRequest: 2,
});
const agent = createAgentRuntime({
  db,
  redis,
  blobs,
  email: mockExternals
    ? new MockOutbox(true)
    : createResendSender({
        apiKey: requireEnv("RESEND_API_KEY"),
        from: process.env.EMAIL_FROM ?? "DJL Cloud <no-reply@slcor.com>",
        replyTo: process.env.EMAIL_REPLY_TO ?? "support@slcor.com",
      }),
  mockExternals,
  webPublicUrl: process.env.WEB_PUBLIC_URL ?? "http://localhost:3000",
  env: process.env,
});
await registerAgentJobs(boss, {
  db,
  ledger,
  agent,
  concurrency: Number(process.env.AGENT_CONCURRENCY ?? 4),
});

console.log(JSON.stringify({ level: "info", msg: "worker started", jobs: Object.keys(JOBS) }));

const heartbeat = async () => {
  try {
    await db.execute(sql`select 1`);
    await redis.ping();
    writeFileSync("/tmp/djl-worker-ready", String(Date.now()));
  } catch {
    console.error(JSON.stringify({ level: "error", msg: "worker readiness check failed" }));
  }
};
await heartbeat();
const heartbeatTimer = setInterval(() => {
  void heartbeat();
}, 30_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(heartbeatTimer);
    void boss
      .stop({ graceful: true, timeout: 10_000 })
      .then(() => redis.disconnect())
      .then(close)
      .then(() => process.exit(0));
  });
}
