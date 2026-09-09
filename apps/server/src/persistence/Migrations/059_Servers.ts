// FILE: 059_Servers.ts
// Purpose: Registry of user SSH hosts for the Servers settings section.
// Layer: Persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS servers (
      server_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      auth_json TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      permission_tier TEXT NOT NULL CHECK (permission_tier IN ('read-only', 'approve-each', 'full')),
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL CHECK (source IN ('manual', 'ssh-config')),
      ssh_config_alias TEXT,
      last_test_json TEXT,
      last_stats_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_servers_name ON servers(name)`;
});
