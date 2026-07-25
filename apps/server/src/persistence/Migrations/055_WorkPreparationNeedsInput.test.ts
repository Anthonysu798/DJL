import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.effect("persists preparation jobs that are durably waiting for OCR input", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();
    yield* sql`
      INSERT INTO work_preparation_jobs (
        job_id, source_event_id, thread_id, project_id, message_id,
        request_json, message_text, attachments_json, status, created_at, updated_at
      ) VALUES (
        'job-ocr', 'event-ocr', 'thread-ocr', 'project-ocr', 'message-ocr',
        '{}', 'Read this scan', '[]', 'needs_input',
        '2026-07-13T10:00:00.000Z', '2026-07-13T10:00:00.000Z'
      )
    `;
    const rows = yield* sql<{ readonly status: string }>`
      SELECT status FROM work_preparation_jobs WHERE job_id = 'job-ocr'
    `;
    assert.deepStrictEqual(rows, [{ status: "needs_input" }]);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
