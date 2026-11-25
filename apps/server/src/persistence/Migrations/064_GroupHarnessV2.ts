// FILE: 064_GroupHarnessV2.ts
// Purpose: Multi agents v2: the group brief, default recipient and automatic reviewer; muted
//          members, the brief revision each member has seen and its context usage; and whether a
//          reply came from a propose-only round or passed; reactions on messages; missions.
// Layer: Persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

const COLUMNS: ReadonlyArray<readonly [table: string, column: string, definition: string]> = [
  ["groups", "brief", "TEXT NOT NULL DEFAULT ''"],
  ["groups", "setup_rev", "INTEGER NOT NULL DEFAULT 0"],
  ["groups", "default_recipient", "TEXT NOT NULL DEFAULT 'last'"],
  ["groups", "reviewer_member_id", "TEXT"],
  ["group_members", "muted", "INTEGER NOT NULL DEFAULT 0"],
  ["group_members", "setup_rev_seen", "INTEGER NOT NULL DEFAULT 0"],
  ["group_members", "context_json", "TEXT"],
  ["group_replies", "propose_only", "INTEGER NOT NULL DEFAULT 0"],
  ["group_replies", "passed", "INTEGER NOT NULL DEFAULT 0"],
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const [table, column, definition] of COLUMNS) {
    if (yield* columnExists(sql, table, column)) continue;
    yield* sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  // A member has one status reaction per message (slot "status"); the user one per kind.
  yield* sql`
    CREATE TABLE IF NOT EXISTS group_reactions (
      group_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      slot TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, target_id, actor, slot)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS group_missions (
      mission_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      mission_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_group_missions_group ON group_missions(group_id)`;
});
