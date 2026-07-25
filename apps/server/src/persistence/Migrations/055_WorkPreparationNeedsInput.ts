import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly sql: string | null }>`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'work_preparation_jobs'
  `;
  const definition = rows[0]?.sql ?? "";
  if (definition.includes("'needs_input'")) return;

  yield* sql`DROP INDEX IF EXISTS idx_work_preparation_jobs_recovery`;
  yield* sql`DROP INDEX IF EXISTS idx_work_preparation_jobs_thread`;
  yield* sql`ALTER TABLE work_preparation_jobs RENAME TO work_preparation_jobs_legacy`;
  yield* sql`
    CREATE TABLE work_preparation_jobs (
      job_id TEXT PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      message_text TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'needs_input', 'completed', 'failed')),
      prepared_prompt TEXT,
      error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      dispatched_at TEXT
    )
  `;
  yield* sql`
    INSERT INTO work_preparation_jobs (
      job_id, source_event_id, thread_id, project_id, message_id, request_json,
      message_text, attachments_json, status, prepared_prompt, error, attempt_count,
      created_at, updated_at, completed_at, dispatched_at
    )
    SELECT
      job_id, source_event_id, thread_id, project_id, message_id, request_json,
      message_text, attachments_json, status, prepared_prompt, error, attempt_count,
      created_at, updated_at, completed_at, dispatched_at
    FROM work_preparation_jobs_legacy
  `;
  yield* sql`DROP TABLE work_preparation_jobs_legacy`;
  yield* sql`
    CREATE INDEX idx_work_preparation_jobs_recovery
      ON work_preparation_jobs(status, dispatched_at, created_at)
  `;
  yield* sql`
    CREATE INDEX idx_work_preparation_jobs_thread
      ON work_preparation_jobs(thread_id, created_at DESC)
  `;
});
