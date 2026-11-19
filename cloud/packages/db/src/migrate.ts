/**
 * Applies pending SQL migrations from ./drizzle. Used by CI, local dev, and the
 * deploy pipeline. Fails closed: any error exits non-zero.
 */
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { applyCloudMigrations } from "./applyMigrations.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });
try {
  await applyCloudMigrations(sql, fileURLToPath(new URL("../drizzle", import.meta.url)));
  console.log("migrations applied");
} finally {
  await sql.end();
}
