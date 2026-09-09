// FILE: 060_ServerCommands.ts
// Purpose: Audit trail and approval queue for agent commands run on registered servers.
// Layer: Persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS server_commands (
      command_id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      server_name TEXT NOT NULL,
      thread_id TEXT,
      command TEXT NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      output TEXT,
      reason TEXT,
      requested_at INTEGER NOT NULL,
      finished_at INTEGER
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_server_commands_server_requested
    ON server_commands(server_id, requested_at DESC)
  `;
});
