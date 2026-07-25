import { CommandId, EventId, ThreadId, type OrchestrationEvent } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { isThreadDetailEvent, isThreadDetailEventForThread } from "./orchestrationThreadEvents";

const THREAD_ID = ThreadId.makeUnsafe("thread-work-detail-test");

const WORK_TRANSITION_EVENT = {
  sequence: 2,
  eventId: EventId.makeUnsafe("event-work-detail-test"),
  aggregateKind: "thread",
  aggregateId: THREAD_ID,
  occurredAt: "2026-07-13T12:00:00.000Z",
  commandId: CommandId.makeUnsafe("work:event-work-detail-test:submit_review"),
  causationEventId: null,
  correlationId: null,
  metadata: {},
  type: "thread.work-task-transitioned",
  payload: {
    threadId: THREAD_ID,
    action: "submit_review",
    task: {
      threadId: THREAD_ID,
      phase: "review",
      condition: "active",
      status: "needs_review",
      resumePhase: "review",
      progress: 90,
      statusReason: null,
      lastTransitionCommandId: CommandId.makeUnsafe("work:event-work-detail-test:submit_review"),
      createdAt: "2026-07-13T11:59:00.000Z",
      updatedAt: "2026-07-13T12:00:00.000Z",
      completedAt: null,
    },
  },
} satisfies Extract<OrchestrationEvent, { type: "thread.work-task-transitioned" }>;

describe("orchestration thread detail events", () => {
  it("classifies Work task transitions as thread detail events", () => {
    expect(isThreadDetailEvent(WORK_TRANSITION_EVENT)).toBe(true);
    expect(isThreadDetailEventForThread(WORK_TRANSITION_EVENT, THREAD_ID)).toBe(true);
    expect(
      isThreadDetailEventForThread(
        WORK_TRANSITION_EVENT,
        ThreadId.makeUnsafe("thread-work-detail-other"),
      ),
    ).toBe(false);
  });
});
