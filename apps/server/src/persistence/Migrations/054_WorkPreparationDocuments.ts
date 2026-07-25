import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS work_preparation_jobs (
      job_id TEXT PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      message_text TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
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
    CREATE INDEX IF NOT EXISTS idx_work_preparation_jobs_recovery
      ON work_preparation_jobs(status, dispatched_at, created_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_work_preparation_jobs_thread
      ON work_preparation_jobs(thread_id, created_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS document_artifacts (
      artifact_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      detected_media_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      extraction_method TEXT NOT NULL CHECK (extraction_method IN ('native', 'ocr', 'hybrid')),
      blocks_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      schema_version INTEGER NOT NULL,
      engine_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(thread_id, attachment_id, content_hash)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_document_artifacts_job
      ON document_artifacts(job_id, created_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_document_artifacts_thread
      ON document_artifacts(thread_id, created_at DESC)
  `;
});
