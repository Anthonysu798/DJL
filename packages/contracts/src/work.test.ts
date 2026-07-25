import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ClientOrchestrationCommand, OrchestrationEvent } from "./orchestration";
import { WorkTask, WorkTaskAction, WorkTaskStatus } from "./work";

const decodeWorkTask = Schema.decodeUnknownEffect(WorkTask);
const decodeWorkTaskAction = Schema.decodeUnknownEffect(WorkTaskAction);
const decodeWorkTaskStatus = Schema.decodeUnknownEffect(WorkTaskStatus);
const decodeClientCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent);

it.effect("decodes a backend-authoritative Work task", () =>
  Effect.gen(function* () {
    const task = yield* decodeWorkTask({
      threadId: "thread-1",
      phase: "working",
      condition: "needs_input",
      status: "needs_input",
      resumePhase: "working",
      progress: 42,
      statusReason: "Choose an OCR provider",
      lastTransitionCommandId: "provider:event-7",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:02:00.000Z",
      completedAt: null,
    });

    assert.equal(task.phase, "working");
    assert.equal(task.condition, "needs_input");
    assert.equal(task.status, "needs_input");
    assert.equal(task.resumePhase, "working");
  }),
);

it.effect("accepts every public Work status and lifecycle action", () =>
  Effect.gen(function* () {
    const statuses = [
      "planning",
      "working",
      "needs_input",
      "needs_review",
      "complete",
      "failed",
      "cancelled",
    ] as const;
    const actions = [
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
    ] as const;

    for (const status of statuses) {
      assert.equal(yield* decodeWorkTaskStatus(status), status);
    }
    for (const action of actions) {
      assert.equal(yield* decodeWorkTaskAction(action), action);
    }
  }),
);

it.effect("decodes Work lifecycle commands and events through orchestration", () =>
  Effect.gen(function* () {
    const command = yield* decodeClientCommand({
      type: "thread.work-task.transition",
      commandId: "client:complete-1",
      threadId: "thread-1",
      action: "complete",
      reason: "Approved by the user",
      createdAt: "2026-07-13T10:03:00.000Z",
    });
    assert.equal(command.type, "thread.work-task.transition");

    const task = yield* decodeWorkTask({
      threadId: "thread-1",
      phase: "complete",
      condition: "active",
      status: "complete",
      resumePhase: "complete",
      progress: 100,
      statusReason: "Approved by the user",
      lastTransitionCommandId: "client:complete-1",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:03:00.000Z",
      completedAt: "2026-07-13T10:03:00.000Z",
    });
    const event = yield* decodeEvent({
      sequence: 3,
      eventId: "event-3",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      occurredAt: "2026-07-13T10:03:00.000Z",
      commandId: "client:complete-1",
      causationEventId: null,
      correlationId: "client:complete-1",
      metadata: {},
      type: "thread.work-task-transitioned",
      payload: { threadId: "thread-1", task, action: "complete" },
    });
    assert.equal(event.type, "thread.work-task-transitioned");
  }),
);
