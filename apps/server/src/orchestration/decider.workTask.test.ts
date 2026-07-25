import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-07-13T10:00:00.000Z";
const projectId = ProjectId.makeUnsafe("work-project-1");
const threadId = ThreadId.makeUnsafe("work-thread-1");

async function createWorkReadModel() {
  const project = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: EventId.makeUnsafe("event-project-1"),
      aggregateKind: "project",
      aggregateId: projectId,
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("command-project-1"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        projectId,
        kind: "studio",
        title: "Work",
        workspaceRoot: "/tmp/djl-work",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  return Effect.runPromise(
    projectEvent(project, {
      sequence: 2,
      eventId: EventId.makeUnsafe("event-thread-1"),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("command-thread-1"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        projectId,
        title: "Prepare quarterly report",
        modelSelection: { provider: "opencode", model: "openai/gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        handoff: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

describe("Work task decider", () => {
  it("creates a deterministic lifecycle event for a Work thread", async () => {
    const readModel = await createWorkReadModel();
    const event = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.work-task.transition",
          commandId: CommandId.makeUnsafe("provider:item-7"),
          threadId,
          action: "start_work",
          reason: "Editing the workbook",
          progress: 35,
          createdAt: "2026-07-13T10:01:00.000Z",
        },
      }),
    );

    const events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">> = Array.isArray(event)
      ? (event as ReadonlyArray<Omit<OrchestrationEvent, "sequence">>)
      : [event as Omit<OrchestrationEvent, "sequence">];
    const transition = events.find(
      (candidate) => candidate.type === "thread.work-task-transitioned",
    ) as
      | Omit<Extract<OrchestrationEvent, { type: "thread.work-task-transitioned" }>, "sequence">
      | undefined;
    expect(transition?.type).toBe("thread.work-task-transitioned");
    if (transition?.type !== "thread.work-task-transitioned") return;
    expect(transition.payload.task).toMatchObject({
      threadId,
      phase: "working",
      status: "working",
      progress: 35,
      lastTransitionCommandId: "provider:item-7",
    });
  });

  it("rejects Work transitions on developer project threads", async () => {
    const readModel = await createWorkReadModel();
    const developerModel = {
      ...readModel,
      projects: readModel.projects.map((project) => ({ ...project, kind: "project" as const })),
    };

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          readModel: developerModel,
          command: {
            type: "thread.work-task.transition",
            commandId: CommandId.makeUnsafe("client:complete-1"),
            threadId,
            action: "start_work",
            createdAt: "2026-07-13T10:01:00.000Z",
          },
        }),
      ),
    ).rejects.toThrow("only available for Work tasks");
  });

  it("allows a cancelled Work prompt to be replayed from its interrupted latest turn", async () => {
    const readModel = await createWorkReadModel();
    const messageId = MessageId.makeUnsafe("cancelled-user-message");
    const cancelledAt = "2026-07-13T10:02:00.000Z";
    const cancelledModel = {
      ...readModel,
      threads: readModel.threads.map((thread) => ({
        ...thread,
        messages: [
          {
            id: messageId,
            role: "user" as const,
            text: "sleep 15",
            attachments: [],
            turnId: null,
            streaming: false,
            source: "native" as const,
            createdAt: now,
            updatedAt: cancelledAt,
          },
        ],
        latestTurn: {
          turnId: TurnId.makeUnsafe("cancelled-provider-turn"),
          state: "interrupted" as const,
          requestedAt: now,
          startedAt: now,
          completedAt: cancelledAt,
          assistantMessageId: null,
        },
        session: {
          threadId,
          status: "interrupted" as const,
          providerName: "opencode",
          runtimeMode: "full-access" as const,
          activeTurnId: null,
          lastError: "Aborted",
          updatedAt: cancelledAt,
        },
      })),
    };

    const event = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel: cancelledModel,
        command: {
          type: "thread.message.edit-and-resend",
          commandId: CommandId.makeUnsafe("retry-cancelled-work-task"),
          threadId,
          messageId,
          text: "sleep 15",
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: "2026-07-13T10:03:00.000Z",
        },
      }),
    );

    expect(event).toMatchObject({
      type: "thread.message-edit-resend-requested",
      payload: {
        threadId,
        messageId,
        text: "sleep 15",
        rollbackTurnCount: 0,
        removedTurnIds: [],
      },
    });
  });
});
