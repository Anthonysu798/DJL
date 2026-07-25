import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.effect("removes legacy pending turns whose provider session is already terminal", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 56 });

    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, branch, worktree_path, latest_turn_id,
        created_at, updated_at, deleted_at, runtime_mode, interaction_mode,
        model_selection_json, handoff_json, env_mode
      ) VALUES (
        'thread-terminal-pending', 'project-test', 'Test', 'main', NULL, NULL,
        '2026-07-22T12:00:00.000Z', '2026-07-22T12:00:00.000Z', NULL,
        'full-access', 'default', '{"provider":"opencode","model":"deepseek/deepseek-chat"}',
        NULL, 'inherit'
      )
    `;
    yield* sql`
      INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_session_id, provider_thread_id,
        active_turn_id, last_error, updated_at, runtime_mode
      ) VALUES (
        'thread-terminal-pending', 'error', 'opencode', NULL, NULL, NULL,
        'Provider validation failed', '2026-07-22T12:00:01.000Z', 'full-access'
      )
    `;
    yield* sql`
      INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state,
        requested_at, started_at, completed_at, checkpoint_turn_count,
        checkpoint_ref, checkpoint_status, checkpoint_files_json
      ) VALUES (
        'thread-terminal-pending', NULL, 'message-test', NULL, 'pending',
        '2026-07-22T12:00:00.000Z', NULL, NULL, NULL, NULL, NULL, '[]'
      )
    `;

    yield* runMigrations();

    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM projection_turns
      WHERE thread_id = 'thread-terminal-pending'
    `;
    assert.deepStrictEqual(rows, [{ count: 0 }]);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
