import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index.ts";

export type DjlDatabase = ReturnType<typeof createDatabase>["db"];

/**
 * Keep each process's pool small so the API and worker can share Postgres.
 */
export function createDatabase(databaseUrl: string, options: { readonly max?: number } = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 8,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
