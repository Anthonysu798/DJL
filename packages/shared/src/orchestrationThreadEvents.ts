import type { OrchestrationEvent, ThreadId } from "@synara/contracts";

const THREAD_DETAIL_EVENT_TYPES = [
  "thread.message-sent",
  "thread.proposed-plan-upserted",
  "thread.activity-appended",
  "thread.turn-diff-completed",
  "thread.reverted",
  "thread.conversation-rolled-back",
  "thread.session-set",
  "thread.meta-updated",
  "thread.pinned-message-added",
  "thread.pinned-message-removed",
  "thread.pinned-message-done-set",
  "thread.pinned-message-label-set",
  "thread.marker-added",
  "thread.marker-removed",
  "thread.marker-done-set",
  "thread.marker-label-set",
  "thread.archived",
  "thread.unarchived",
  "thread.work-task-transitioned",
] as const satisfies ReadonlyArray<OrchestrationEvent["type"]>;

const THREAD_DETAIL_EVENT_TYPE_SET = new Set<OrchestrationEvent["type"]>(THREAD_DETAIL_EVENT_TYPES);

export type ThreadDetailEvent = Extract<
  OrchestrationEvent,
  { type: (typeof THREAD_DETAIL_EVENT_TYPES)[number] }
>;

export function isThreadDetailEvent(event: OrchestrationEvent): event is ThreadDetailEvent {
  return THREAD_DETAIL_EVENT_TYPE_SET.has(event.type);
}

export function isThreadDetailEventForThread(
  event: OrchestrationEvent,
  threadId: ThreadId,
): event is ThreadDetailEvent {
  return (
    event.aggregateKind === "thread" && event.aggregateId === threadId && isThreadDetailEvent(event)
  );
}
