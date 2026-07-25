import { Schema } from "effect";

import { CommandId, IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const WorkTaskPhase = Schema.Literals(["planning", "working", "review", "complete"]);
export type WorkTaskPhase = typeof WorkTaskPhase.Type;

export const WorkTaskCondition = Schema.Literals(["active", "needs_input", "failed", "cancelled"]);
export type WorkTaskCondition = typeof WorkTaskCondition.Type;

export const WorkTaskStatus = Schema.Literals([
  "planning",
  "working",
  "needs_input",
  "needs_review",
  "complete",
  "failed",
  "cancelled",
]);
export type WorkTaskStatus = typeof WorkTaskStatus.Type;

export const WorkTaskAction = Schema.Literals([
  "start_work",
  "request_input",
  "resolve_input",
  "submit_review",
  "complete",
  "request_changes",
  "fail",
  "cancel",
  "retry",
  "reopen",
]);
export type WorkTaskAction = typeof WorkTaskAction.Type;

export const WorkTaskProgress = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(
  Schema.isLessThanOrEqualTo(100),
);
export type WorkTaskProgress = typeof WorkTaskProgress.Type;

/**
 * Backend-authoritative lifecycle state for the nontechnical Work surface.
 * A task is one-to-one with an orchestration thread. `resumePhase` preserves
 * the last useful phase while the task is blocked, failed, or cancelled.
 */
export const WorkTask = Schema.Struct({
  threadId: ThreadId,
  phase: WorkTaskPhase,
  condition: WorkTaskCondition,
  status: WorkTaskStatus,
  resumePhase: WorkTaskPhase,
  progress: WorkTaskProgress,
  statusReason: Schema.NullOr(TrimmedNonEmptyString),
  lastTransitionCommandId: Schema.NullOr(CommandId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type WorkTask = typeof WorkTask.Type;
