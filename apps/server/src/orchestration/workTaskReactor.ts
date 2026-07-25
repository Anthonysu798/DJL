import {
  CommandId,
  isToolLifecycleItemType,
  type ProviderRuntimeEvent,
  type WorkTaskAction,
} from "@synara/contracts";

export interface DerivedWorkTaskTransition {
  readonly action: WorkTaskAction;
  readonly reason?: string;
  readonly progress?: number;
}

export function workTaskProviderCommandId(
  event: ProviderRuntimeEvent,
  action: WorkTaskAction,
): CommandId {
  return CommandId.makeUnsafe(`work:${event.eventId}:${action}`);
}

export function deriveWorkTaskTransition(
  event: ProviderRuntimeEvent,
): DerivedWorkTaskTransition | null {
  switch (event.type) {
    case "item.started":
      if (!isToolLifecycleItemType(event.payload.itemType)) return null;
      return {
        action: "start_work",
        reason: event.payload.title ?? "Using a work tool",
      };
    case "tool.progress":
      return {
        action: "start_work",
        reason: event.payload.summary ?? event.payload.toolName ?? "Using a work tool",
      };
    case "request.opened":
      return {
        action: "request_input",
        reason: event.payload.detail ?? "Approval required",
      };
    case "user-input.requested":
      return { action: "request_input", reason: "Your input is required" };
    case "request.resolved":
    case "user-input.resolved":
      return { action: "resolve_input" };
    case "turn.completed":
      if (event.payload.state === "completed") {
        return { action: "submit_review", reason: "Work is ready for review", progress: 90 };
      }
      if (event.payload.state === "failed") {
        return {
          action: "fail",
          reason: event.payload.errorMessage ?? event.payload.stopReason ?? "The task failed",
        };
      }
      return {
        action: "cancel",
        reason: event.payload.stopReason ?? "The task was interrupted",
      };
    case "turn.aborted":
      return { action: "cancel", reason: event.payload.reason };
    case "runtime.error":
      return { action: "fail", reason: event.payload.message };
    case "session.state.changed":
      return event.payload.state === "error"
        ? { action: "fail", reason: event.payload.reason ?? "Provider session error" }
        : null;
    default:
      return null;
  }
}
