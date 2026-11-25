// FILE: 065_GroupGuests.ts
// Purpose: Multi agents guests: the people an owner invited into a group, kept on the group row.
// Layer: Persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (yield* columnExists(sql, "groups", "guests_json")) return;
  yield* sql.unsafe("ALTER TABLE groups ADD COLUMN guests_json TEXT NOT NULL DEFAULT '[]'");
});
