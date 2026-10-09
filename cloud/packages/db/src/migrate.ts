/**
 * Applies pending SQL migrations from ./drizzle. Used by CI, local dev, and the
 * deploy pipeline. Fails closed: any error exits non-zero.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(sql), {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
  console.log("migrations applied");
} finally {
  await sql.end();
}
