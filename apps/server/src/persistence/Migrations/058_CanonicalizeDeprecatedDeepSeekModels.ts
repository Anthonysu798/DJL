// FILE: 058_CanonicalizeDeprecatedDeepSeekModels.ts
// Purpose: Moves persisted official DeepSeek aliases onto supported V4 Flash.
// Layer: Persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { normalizePersistedModelSelection } from "../modelSelectionCompatibility.ts";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedJson(json: string | null): {
  readonly changed: boolean;
  readonly value: string | null;
} {
  if (json === null) return { changed: false, value: json };
  const value = normalizePersistedModelSelection(JSON.parse(json) as unknown);
  const serialized = JSON.stringify(value);
  return {
    changed: serialized !== json,
    value: serialized !== json ? serialized : json,
  };
}

function normalizedEventPayload(json: string): {
  readonly changed: boolean;
  readonly value: string;
} {
  const payload = JSON.parse(json) as unknown;
  if (!isRecord(payload)) return { changed: false, value: json };

  let next: JsonObject | undefined;
  for (const field of ["defaultModelSelection", "modelSelection"] as const) {
    if (payload[field] === undefined || payload[field] === null) continue;
    const value = normalizePersistedModelSelection(payload[field]);
    if (JSON.stringify(value) !== JSON.stringify(payload[field])) {
      next ??= { ...payload };
      next[field] = value;
    }
  }
  return next === undefined
    ? { changed: false, value: json }
    : { changed: true, value: JSON.stringify(next) };
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* sql<{ readonly projectId: string; readonly selection: string | null }>`
    SELECT project_id AS "projectId", default_model_selection_json AS "selection"
    FROM projection_projects
    WHERE default_model_selection_json IS NOT NULL
  `;
  for (const project of projects) {
    const normalized = normalizedJson(project.selection);
    if (!normalized.changed) continue;
    yield* sql`
      UPDATE projection_projects
      SET default_model_selection_json = ${normalized.value}
      WHERE project_id = ${project.projectId}
    `;
  }

  const threads = yield* sql<{ readonly threadId: string; readonly selection: string }>`
    SELECT thread_id AS "threadId", model_selection_json AS "selection"
    FROM projection_threads
  `;
  for (const thread of threads) {
    const normalized = normalizedJson(thread.selection);
    if (!normalized.changed) continue;
    yield* sql`
      UPDATE projection_threads
      SET model_selection_json = ${normalized.value}
      WHERE thread_id = ${thread.threadId}
    `;
  }

  const events = yield* sql<{ readonly sequence: number; readonly payload: string }>`
    SELECT sequence, payload_json AS "payload"
    FROM orchestration_events
  `;
  for (const event of events) {
    const normalized = normalizedEventPayload(event.payload);
    if (!normalized.changed) continue;
    yield* sql`
      UPDATE orchestration_events
      SET payload_json = ${normalized.value}
      WHERE sequence = ${event.sequence}
    `;
  }
});
