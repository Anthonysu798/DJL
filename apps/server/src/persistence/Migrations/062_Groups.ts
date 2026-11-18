// FILE: 062_Groups.ts
// Purpose: Multi agents groups, their members, the group conversation log and reply records.
// Layer: Persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS groups (
      group_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      folder_is_auto INTEGER NOT NULL DEFAULT 1,
      hop_limit INTEGER NOT NULL DEFAULT 6,
      skip_all_warning INTEGER NOT NULL DEFAULT 0,
      pending_handoffs_json TEXT NOT NULL DEFAULT '[]',
      resume_requested INTEGER NOT NULL DEFAULT 0,
      last_speakers_json TEXT NOT NULL DEFAULT '[]',
      last_round_all INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS group_members (
      member_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      handle TEXT NOT NULL,
      role TEXT,
      model TEXT,
      position INTEGER NOT NULL,
      native_session_id TEXT,
      read_seq INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS group_log (
      group_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (group_id, seq)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS group_replies (
      reply_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok', 'empty', 'failed')),
      error TEXT,
      files_json TEXT NOT NULL DEFAULT '[]',
      commands_json TEXT NOT NULL DEFAULT '[]'
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_group_replies_group ON group_replies(group_id)`;
});
