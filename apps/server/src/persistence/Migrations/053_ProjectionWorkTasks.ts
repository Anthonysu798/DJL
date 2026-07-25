import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('projection_threads')
    WHERE name = 'work_task_json'
  `;
  if (columns.length === 0) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN work_task_json TEXT`;
  }

  // Preserve legacy Studio history while making the new Work lifecycle
  // backend-authoritative from the first launch after upgrade.
  yield* sql`
    UPDATE projection_threads AS thread
    SET work_task_json = json_object(
      'threadId', thread.thread_id,
      'phase', CASE
        WHEN EXISTS (
          SELECT 1 FROM projection_thread_sessions session
          WHERE session.thread_id = thread.thread_id
            AND session.status IN ('running', 'starting')
        ) THEN 'working'
        WHEN EXISTS (
          SELECT 1 FROM projection_thread_sessions session
          WHERE session.thread_id = thread.thread_id AND session.status = 'error'
        ) THEN COALESCE((
          SELECT CASE WHEN turn.state = 'error' THEN 'working' ELSE 'planning' END
          FROM projection_turns turn
          WHERE turn.thread_id = thread.thread_id AND turn.turn_id = thread.latest_turn_id
        ), 'planning')
        WHEN EXISTS (
          SELECT 1 FROM projection_turns turn
          WHERE turn.thread_id = thread.thread_id
            AND turn.turn_id = thread.latest_turn_id
            AND turn.state = 'completed'
        ) THEN 'complete'
        ELSE 'planning'
      END,
      'condition', CASE
        WHEN EXISTS (
          SELECT 1 FROM projection_thread_sessions session
          WHERE session.thread_id = thread.thread_id AND session.status = 'error'
        ) THEN 'failed'
        ELSE 'active'
      END,
      'status', CASE
        WHEN EXISTS (
          SELECT 1 FROM projection_thread_sessions session
          WHERE session.thread_id = thread.thread_id
            AND session.status IN ('running', 'starting')
        ) THEN 'working'
        WHEN EXISTS (
          SELECT 1 FROM projection_thread_sessions session
          WHERE session.thread_id = thread.thread_id AND session.status = 'error'
        ) THEN 'failed'
        WHEN EXISTS (
          SELECT 1 FROM projection_turns turn
          WHERE turn.thread_id = thread.thread_id
            AND turn.turn_id = thread.latest_turn_id
            AND turn.state = 'completed'
        ) THEN 'complete'
        ELSE 'planning'
      END,
      'resumePhase', CASE
        WHEN EXISTS (
          SELECT 1 FROM projection_thread_sessions session
          WHERE session.thread_id = thread.thread_id
            AND session.status IN ('running', 'starting')
        ) THEN 'working'
        WHEN EXISTS (
          SELECT 1 FROM projection_turns turn
          WHERE turn.thread_id = thread.thread_id
            AND turn.turn_id = thread.latest_turn_id
            AND turn.state = 'completed'
        ) THEN 'complete'
        ELSE 'planning'
      END,
      'progress', CASE
        WHEN EXISTS (
          SELECT 1 FROM projection_thread_sessions session
          WHERE session.thread_id = thread.thread_id
            AND session.status IN ('running', 'starting')
        ) THEN 10
        WHEN EXISTS (
          SELECT 1 FROM projection_turns turn
          WHERE turn.thread_id = thread.thread_id
            AND turn.turn_id = thread.latest_turn_id
            AND turn.state = 'completed'
        ) THEN 100
        ELSE 0
      END,
      'statusReason', (
        SELECT session.last_error FROM projection_thread_sessions session
        WHERE session.thread_id = thread.thread_id AND session.status = 'error'
        LIMIT 1
      ),
      'lastTransitionCommandId', NULL,
      'createdAt', thread.created_at,
      'updatedAt', thread.updated_at,
      'completedAt', CASE
        WHEN EXISTS (
          SELECT 1 FROM projection_turns turn
          WHERE turn.thread_id = thread.thread_id
            AND turn.turn_id = thread.latest_turn_id
            AND turn.state = 'completed'
        ) THEN (
          SELECT turn.completed_at FROM projection_turns turn
          WHERE turn.thread_id = thread.thread_id AND turn.turn_id = thread.latest_turn_id
          LIMIT 1
        )
        ELSE NULL
      END
    )
    WHERE thread.work_task_json IS NULL
      AND EXISTS (
        SELECT 1 FROM projection_projects project
        WHERE project.project_id = thread.project_id
          AND project.kind = 'studio'
          AND project.deleted_at IS NULL
      )
  `;
});
