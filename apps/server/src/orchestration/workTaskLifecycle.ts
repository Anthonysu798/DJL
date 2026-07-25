import type {
  CommandId,
  IsoDateTime,
  ThreadId,
  WorkTask,
  WorkTaskAction,
  WorkTaskPhase,
  WorkTaskProgress,
  WorkTaskStatus,
} from "@synara/contracts";

export interface WorkTaskTransition {
  readonly action: WorkTaskAction;
  readonly commandId: string;
  readonly occurredAt: IsoDateTime;
  readonly reason?: string;
  readonly progress?: number;
}

function statusFor(phase: WorkTaskPhase, condition: WorkTask["condition"]): WorkTaskStatus {
  if (condition === "needs_input") return "needs_input";
  if (condition === "failed") return "failed";
  if (condition === "cancelled") return "cancelled";
  if (phase === "review") return "needs_review";
  return phase;
}

function boundedProgress(progress: number): WorkTaskProgress {
  return Math.max(0, Math.min(100, Math.round(progress))) as WorkTaskProgress;
}

export function createWorkTask(
  threadId: string,
  createdAt: IsoDateTime,
  commandId: string | null,
): WorkTask {
  return {
    threadId: threadId as ThreadId,
    phase: "planning",
    condition: "active",
    status: "planning",
    resumePhase: "planning",
    progress: 0 as WorkTaskProgress,
    statusReason: null,
    lastTransitionCommandId: commandId as CommandId | null,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
  };
}

function assertTransition(task: WorkTask, action: WorkTaskAction): void {
  if (action === "complete" && task.status !== "needs_review") {
    throw new Error("Work task must be ready for review before it can be completed");
  }
  if (action === "resolve_input" && task.condition !== "needs_input") {
    throw new Error("Work task is not waiting for input");
  }
  if (action === "retry" && task.condition !== "failed" && task.condition !== "cancelled") {
    throw new Error("Only a failed or cancelled Work task can be retried");
  }
  if (action === "reopen" && task.phase !== "complete") {
    throw new Error("Only a completed Work task can be reopened");
  }
}

export function transitionWorkTask(task: WorkTask, transition: WorkTaskTransition): WorkTask {
  if (task.lastTransitionCommandId === transition.commandId) return task;

  assertTransition(task, transition.action);

  let phase = task.phase;
  let condition = task.condition;
  let resumePhase = task.resumePhase;
  let progress = task.progress;
  let completedAt = task.completedAt;

  switch (transition.action) {
    case "start_work":
      phase = "working";
      resumePhase = "working";
      condition = "active";
      progress = boundedProgress(transition.progress ?? Math.max(task.progress, 10));
      completedAt = null;
      break;
    case "request_input":
      resumePhase = phase;
      condition = "needs_input";
      break;
    case "resolve_input":
      phase = resumePhase;
      condition = "active";
      break;
    case "submit_review":
      phase = "review";
      resumePhase = "review";
      condition = "active";
      progress = boundedProgress(transition.progress ?? Math.max(task.progress, 90));
      completedAt = null;
      break;
    case "complete":
      phase = "complete";
      resumePhase = "complete";
      condition = "active";
      progress = 100 as WorkTaskProgress;
      completedAt = transition.occurredAt;
      break;
    case "request_changes":
    case "reopen":
      phase = "planning";
      resumePhase = "planning";
      condition = "active";
      progress = 0 as WorkTaskProgress;
      completedAt = null;
      break;
    case "fail":
      resumePhase = phase;
      condition = "failed";
      break;
    case "cancel":
      resumePhase = phase;
      condition = "cancelled";
      break;
    case "retry":
      phase = resumePhase;
      condition = "active";
      completedAt = null;
      break;
  }

  return {
    ...task,
    phase,
    condition,
    status: statusFor(phase, condition),
    resumePhase,
    progress,
    statusReason: transition.reason?.trim() || null,
    lastTransitionCommandId: transition.commandId as CommandId,
    updatedAt: transition.occurredAt,
    completedAt,
  };
}
