/** Global commerce limits and incident clocks require a fresh database per SQL suite, not just unique users. */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDatabase } from "@djl/db";
import { testDatabase } from "./db.ts";

export async function isolatedCommerceTestDatabase(): Promise<ReturnType<typeof createDatabase>> {
  if (process.env.DJL_ENV && !["local", "test"].includes(process.env.DJL_ENV))
    throw new Error("Isolated commerce SQL suites require a local or test environment.");
  if (process.env.COMMERCE_TEST_PGLITE === "true") return testDatabase();
  let base: URL;
  try {
    base = new URL(process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl");
  } catch {
    throw new Error("Invalid isolated commerce test database configuration.");
  }
  if (
    !["postgres:", "postgresql:"].includes(base.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw new Error("Isolated commerce SQL suites require loopback PostgreSQL.");
  const name = `djl_commerce_suite_${randomUUID().replaceAll("-", "")}`;
  const owned = () => /^djl_commerce_suite_[0-9a-f]{32}$/.test(name);
  if (!owned()) throw new Error("Invalid isolated commerce database name.");
  const admin = postgres(base.href, { max: 1, prepare: false, connect_timeout: 10 });
  let created = false,
    connection: ReturnType<typeof createDatabase> | undefined;
  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      try {
        await connection?.close();
        if (created) {
          if (!owned()) throw new Error("Refusing to drop an unowned commerce test database.");
          await admin.unsafe(`DROP DATABASE "${name}"`);
          created = false;
        }
      } finally {
        await admin.end({ timeout: 5 });
      }
    })());
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const target = new URL(base.href);
    target.pathname = `/${name}`;
    connection = createDatabase(target.href, { max: 4 });
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    });
    return { ...connection, close };
  } catch (error) {
    await close();
    throw error;
  }
}
