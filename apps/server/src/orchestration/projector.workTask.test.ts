import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { transitionWorkTask } from "./workTaskLifecycle.ts";

const occurredAt = "2026-07-13T10:00:00.000Z";
const projectId = ProjectId.makeUnsafe("work-project-1");
const threadId = ThreadId.makeUnsafe("work-thread-1");

function event(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  aggregateKind: OrchestrationEvent["aggregateKind"];
  aggregateId: string;
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.makeUnsafe(input.aggregateId)
        : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt,
    commandId: CommandId.makeUnsafe(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

async function createWorkTaskModel() {
  const project = await Effect.runPromise(
    projectEvent(
      createEmptyReadModel(occurredAt),
      event({
        sequence: 1,
        type: "project.created",
        aggregateKind: "project",
        aggregateId: projectId,
        payload: {
          projectId,
          kind: "studio",
          title: "Work",
          workspaceRoot: "/tmp/djl-work",
          defaultModelSelection: null,
          scripts: [],
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      }),
    ),
  );
  return Effect.runPromise(
    projectEvent(
      project,
      event({
        sequence: 2,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: threadId,
        payload: {
          threadId,
          projectId,
          title: "Prepare report",
          modelSelection: { provider: "opencode", model: "openai/gpt-5" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      }),
    ),
  );
}

describe("Work task projector", () => {
  it("initializes Studio-compatible threads as planning Work tasks", async () => {
    const model = await createWorkTaskModel();
    expect(model.threads[0]?.workTask).toMatchObject({
      threadId,
      phase: "planning",
      condition: "active",
      status: "planning",
      progress: 0,
    });
  });

  it("projects lifecycle transitions from their full event state", async () => {
    const model = await createWorkTaskModel();
    const current = model.threads[0]?.workTask;
    expect(current).toBeTruthy();
    if (!current) return;
    const working = transitionWorkTask(current, {
      action: "start_work",
      commandId: "provider:item-1",
      occurredAt: "2026-07-13T10:01:00.000Z",
      progress: 40,
    });
    const next = await Effect.runPromise(
      projectEvent(
        model,
        event({
          sequence: 3,
          type: "thread.work-task-transitioned",
          aggregateKind: "thread",
          aggregateId: threadId,
          payload: { threadId, task: working, action: "start_work" },
        }),
      ),
    );
    expect(next.threads[0]?.workTask).toEqual(working);
  });
});
