// FILE: 066_GroupMemberGuest.ts
// Purpose: Multi agents visiting agents: marks a group member that a guest's own computer
//          answers for.
// Layer: Persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (yield* columnExists(sql, "group_members", "guest_id")) return;
  yield* sql.unsafe("ALTER TABLE group_members ADD COLUMN guest_id TEXT");
});
