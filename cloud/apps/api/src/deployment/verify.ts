import { createDatabase } from "@djl/db";
import { blobStoreFromEnv } from "../sync/BlobStore.ts";
import { Redis } from "ioredis";
import { PgBoss } from "pg-boss";
import postgres from "postgres";
import { AGENT_RUN_JOB, AGENT_RUN_QUEUE_OPTIONS } from "../runs/RunExecutor.ts";

const { db: _db, sql, close } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
redis.on("error", () => undefined);
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const denied = async (query: PromiseLike<unknown>) => {
  try {
    await query;
  } catch (error) {
    return (error as { code?: string }).code === "42501";
  }
  return false;
};
let stage = "postgres";
try {
  const [role] =
    await sql`select current_user as name, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user`;
  assert(["djl_api", "djl_worker"].includes(role!.name), "Unexpected runtime database role");
  assert(
    !role!.rolsuper && !role!.rolcreatedb && !role!.rolcreaterole,
    "Runtime role is overprivileged",
  );
  const [grants] =
    await sql`select has_table_privilege(current_user, 'audit_events', 'INSERT') as insert_ok, has_table_privilege(current_user, 'audit_events', 'UPDATE') as update_ok, has_table_privilege(current_user, 'credit_ledger', 'DELETE') as delete_ok`;
  assert(
    grants!.insert_ok && !grants!.update_ok && !grants!.delete_ok,
    "Append-only grants are invalid",
  );
  assert(await denied(sql`delete from audit_events where false`), "Audit deletion was allowed");
  assert(
    await denied(sql`create table public.djl_forbidden_probe (id integer)`),
    "Runtime DDL was allowed",
  );
  const badUrl = new URL(process.env.DATABASE_URL!);
  badUrl.password = "invalid-password-test-only";
  const bad = postgres(badUrl.toString(), { max: 1, connect_timeout: 5 });
  let rejected = false;
  try {
    await bad`select 1`;
  } catch (error) {
    rejected = (error as { code?: string }).code === "28P01";
  } finally {
    await bad.end({ timeout: 1 });
  }
  assert(rejected, "Postgres accepted an invalid password");
  stage = "redis";
  await redis.connect();
  assert((await redis.ping()) === "PONG", "Redis did not authenticate");

  stage = "storage";
  const blobs = blobStoreFromEnv(process.env, { mockExternals: false });
  const key = `verification/${crypto.randomUUID()}`;
  const bytes = new TextEncoder().encode("DJL VPS storage verification");
  try {
    await blobs.write(key, bytes, "text/plain");
    assert((await blobs.head(key))?.sizeBytes === bytes.length, "S3 object size mismatch");
    assert(
      Buffer.from((await blobs.read(key)) ?? []).equals(Buffer.from(bytes)),
      "S3 read mismatch",
    );
    const signed = new URL((await blobs.presignDownload(key)).url);
    const internal = new URL(process.env.STORAGE_S3_ENDPOINT!);
    const publicHost = signed.host;
    assert(
      signed.origin === process.env.STORAGE_S3_PUBLIC_ENDPOINT,
      "Client URL exposes the private endpoint",
    );
    signed.protocol = internal.protocol;
    signed.host = internal.host;
    const response = await fetch(signed, { headers: { Host: publicHost } });
    assert(
      response.ok && (await response.text()) === new TextDecoder().decode(bytes),
      "Public-host S3 signature failed",
    );
    if (process.env.VERIFY_PUBLIC_STORAGE === "true") {
      const upload = await blobs.presignUpload(key, "text/plain", bytes.length);
      const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
      assert(put.ok, "Public HTTPS upload failed");
      const download = await fetch((await blobs.presignDownload(key)).url);
      assert(
        download.ok && (await download.text()) === new TextDecoder().decode(bytes),
        "Public HTTPS download failed",
      );
      const preflight = await fetch(upload.url, {
        method: "OPTIONS",
        headers: {
          Origin: process.env.WEB_PUBLIC_URL!,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      assert(
        preflight.ok &&
          preflight.headers.get("access-control-allow-origin") === process.env.WEB_PUBLIC_URL,
        "Browser storage CORS failed",
      );
    }
  } finally {
    await blobs.remove(key);
  }

  stage = "pg-boss";
  const worker = role!.name === "djl_worker";
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: "pgboss",
    createSchema: false,
    ...(worker ? {} : { migrate: false, supervise: false }),
  });
  boss.on("error", () => undefined);
  try {
    await boss.start();
    if (worker) await boss.createQueue(AGENT_RUN_JOB, AGENT_RUN_QUEUE_OPTIONS);
    assert(Boolean(await boss.getQueue(AGENT_RUN_JOB)), "Agent queue is missing");
  } finally {
    await boss.stop();
  }
  console.log(
    JSON.stringify({
      databaseRole: role!.name,
      databaseAuth: "passed",
      appendOnly: "passed",
      redis: "passed",
      storage: "passed",
      queue: "passed",
    }),
  );
} catch (error) {
  // Provider errors can include URLs or SQL parameters; keep those out of logs.
  console.error(
    error instanceof Error && !("code" in error)
      ? error.message
      : JSON.stringify({ stage, failed: true, code: (error as { code?: string }).code ?? null }),
  );
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await close();
}
