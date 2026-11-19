import { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
export function ensureMultiPostSchema(sql: SqlClient) {
  return Effect.gen(function* () {
    yield* sql`CREATE TABLE IF NOT EXISTS multipost_records (kind TEXT NOT NULL,id TEXT NOT NULL,workspace_id TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(kind,id))`;
    yield* sql`CREATE INDEX IF NOT EXISTS multipost_workspace ON multipost_records(workspace_id,kind)`;
    yield* sql`CREATE TABLE IF NOT EXISTS multipost_quota (job_id TEXT PRIMARY KEY,grant_id TEXT NOT NULL,day TEXT NOT NULL)`;
  });
}
