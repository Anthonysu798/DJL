import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.effect("creates restart-safe Work preparation and immutable document artifact tables", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();

    const tables = yield* sql<{ readonly name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('work_preparation_jobs', 'document_artifacts')
      ORDER BY name
    `;
    assert.deepStrictEqual(
      tables.map((row) => row.name),
      ["document_artifacts", "work_preparation_jobs"],
    );

    yield* sql`
      INSERT INTO work_preparation_jobs (
        job_id, source_event_id, thread_id, project_id, message_id,
        request_json, message_text, attachments_json, status, created_at, updated_at
      ) VALUES (
        'job-1', 'event-1', 'thread-1', 'project-1', 'message-1',
        '{}', 'Prepare this', '[]', 'queued',
        '2026-07-13T10:00:00.000Z', '2026-07-13T10:00:00.000Z'
      )
    `;
    yield* sql`
      INSERT INTO document_artifacts (
        artifact_id, job_id, thread_id, project_id, attachment_id, original_name,
        content_hash, detected_media_type, size_bytes, extraction_method,
        blocks_json, warnings_json, schema_version, engine_version, created_at
      ) VALUES (
        'artifact-1', 'job-1', 'thread-1', 'project-1', 'attachment-1', 'report.pdf',
        ${"a".repeat(64)}, 'application/pdf', 42, 'native',
        '[]', '[]', 1, 'djl-native-1', '2026-07-13T10:00:01.000Z'
      )
    `;

    const rows = yield* sql<{ readonly status: string; readonly artifactCount: number }>`
      SELECT job.status AS status, COUNT(artifact.artifact_id) AS "artifactCount"
      FROM work_preparation_jobs job
      LEFT JOIN document_artifacts artifact ON artifact.job_id = job.job_id
      GROUP BY job.job_id
    `;
    assert.deepStrictEqual(rows, [{ status: "queued", artifactCount: 1 }]);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
