import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("058_CanonicalizeDeprecatedDeepSeekModels", (it) => {
  it.effect("rewrites retired DeepSeek aliases across saved projections and event payloads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-07-24T18:00:00.000Z";

      yield* runMigrations({ toMigrationInclusive: 57 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'deepseek-project', 'project', 'DeepSeek Project', '/tmp/deepseek-project',
          ${JSON.stringify({
            provider: "opencode",
            model: "deepseek/deepseek-chat",
            options: { agent: "build" },
          })},
          '[]', ${now}, ${now}, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, env_mode, created_at, updated_at, deleted_at
        ) VALUES (
          'deepseek-thread', 'deepseek-project', 'DeepSeek Thread',
          ${JSON.stringify({
            provider: "opencode",
            model: "deepseek/deepseek-reasoner",
            options: { variant: "fast" },
          })},
          'full-access', 'default', 'local', ${now}, ${now}, NULL
        )
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, command_id, causation_event_id, correlation_id, actor_kind,
          payload_json, metadata_json
        ) VALUES
          (
            'deepseek-project-event', 'project', 'deepseek-project', 0, 'project.created',
            ${now}, 'deepseek-project-command', NULL, NULL, 'server',
            ${JSON.stringify({
              defaultModelSelection: {
                provider: "opencode",
                model: "deepseek/deepseek-chat",
              },
            })}, '{}'
          ),
          (
            'deepseek-thread-event', 'thread', 'deepseek-thread', 0, 'thread.created',
            ${now}, 'deepseek-thread-command', NULL, NULL, 'server',
            ${JSON.stringify({
              modelSelection: {
                provider: "opencode",
                model: "deepseek/deepseek-reasoner",
              },
            })}, '{}'
          )
      `;

      yield* runMigrations();

      const project = yield* sql<{ readonly selection: string }>`
        SELECT default_model_selection_json AS "selection"
        FROM projection_projects
        WHERE project_id = 'deepseek-project'
      `;
      const thread = yield* sql<{ readonly selection: string }>`
        SELECT model_selection_json AS "selection"
        FROM projection_threads
        WHERE thread_id = 'deepseek-thread'
      `;
      const events = yield* sql<{ readonly payload: string }>`
        SELECT payload_json AS "payload"
        FROM orchestration_events
        ORDER BY sequence ASC
      `;

      assert.deepStrictEqual(JSON.parse(project[0]!.selection), {
        provider: "opencode",
        model: "deepseek/deepseek-v4-flash",
        options: { agent: "build" },
      });
      assert.deepStrictEqual(JSON.parse(thread[0]!.selection), {
        provider: "opencode",
        model: "deepseek/deepseek-v4-flash",
        options: { variant: "fast" },
      });
      assert.deepStrictEqual(
        JSON.parse(events[0]!.payload).defaultModelSelection.model,
        "deepseek/deepseek-v4-flash",
      );
      assert.deepStrictEqual(
        JSON.parse(events[1]!.payload).modelSelection.model,
        "deepseek/deepseek-v4-flash",
      );
    }),
  );
});
