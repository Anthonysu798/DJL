import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Older builds could leave a pending placeholder behind when provider
  // validation failed before a concrete turn id was allocated. The terminal
  // session is authoritative, so these rows must not keep the UI spinning.
  yield* sql`
    DELETE FROM projection_turns
    WHERE turn_id IS NULL
      AND state = 'pending'
      AND EXISTS (
        SELECT 1
        FROM projection_thread_sessions
        WHERE projection_thread_sessions.thread_id = projection_turns.thread_id
          AND projection_thread_sessions.active_turn_id IS NULL
          AND projection_thread_sessions.status IN ('error', 'interrupted', 'stopped')
      )
  `;
});
