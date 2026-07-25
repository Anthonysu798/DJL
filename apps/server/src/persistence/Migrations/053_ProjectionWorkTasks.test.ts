import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.effect("adds and backfills backend-authoritative Work task state", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 52 });

    yield* sql`
      INSERT INTO projection_projects (
        project_id, kind, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
      ) VALUES (
        'work-project', 'studio', 'Work', '/tmp/work', '[]',
        '2026-07-13T10:00:00.000Z', '2026-07-13T10:00:00.000Z', NULL
      )
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode,
        interaction_mode, env_mode, latest_turn_id, created_at, updated_at, deleted_at
      ) VALUES
        ('planning-task', 'work-project', 'Planning', '{"provider":"opencode","model":"test"}',
         'full-access', 'default', 'local', NULL,
         '2026-07-13T10:00:00.000Z', '2026-07-13T10:00:00.000Z', NULL),
        ('working-task', 'work-project', 'Working', '{"provider":"opencode","model":"test"}',
         'full-access', 'default', 'local', 'turn-working',
         '2026-07-13T10:00:00.000Z', '2026-07-13T10:01:00.000Z', NULL),
        ('failed-task', 'work-project', 'Failed', '{"provider":"opencode","model":"test"}',
         'full-access', 'default', 'local', 'turn-failed',
         '2026-07-13T10:00:00.000Z', '2026-07-13T10:02:00.000Z', NULL),
        ('complete-task', 'work-project', 'Complete', '{"provider":"opencode","model":"test"}',
         'full-access', 'default', 'local', 'turn-complete',
         '2026-07-13T10:00:00.000Z', '2026-07-13T10:03:00.000Z', NULL)
    `;
    yield* sql`
      INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES
        ('working-task', 'running', 'opencode', 'full-access', 'turn-working', NULL,
         '2026-07-13T10:01:00.000Z'),
        ('failed-task', 'error', 'opencode', 'full-access', NULL, 'Provider failed',
         '2026-07-13T10:02:00.000Z')
    `;
    yield* sql`
      INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state,
        requested_at, started_at, completed_at, checkpoint_files_json
      ) VALUES (
        'complete-task', 'turn-complete', NULL, 'assistant-complete', 'completed',
        '2026-07-13T10:01:00.000Z', '2026-07-13T10:01:10.000Z',
        '2026-07-13T10:03:00.000Z', '[]'
      )
    `;

    yield* runMigrations();

    const rows = yield* sql<{ readonly threadId: string; readonly task: string | null }>`
      SELECT thread_id AS "threadId", work_task_json AS task
      FROM projection_threads
      ORDER BY thread_id
    `;
    const statuses = Object.fromEntries(
      rows.map((row) => [row.threadId, row.task === null ? null : JSON.parse(row.task).status]),
    );
    assert.deepStrictEqual(statuses, {
      "complete-task": "complete",
      "failed-task": "failed",
      "planning-task": "planning",
      "working-task": "working",
    });
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
