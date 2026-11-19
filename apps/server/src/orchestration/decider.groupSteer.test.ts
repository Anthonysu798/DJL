import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-11-18T10:00:00.000Z";

async function runningThread(
  kind: "group" | "project",
  modelSelection: ModelSelection,
): Promise<{ readModel: OrchestrationReadModel; threadId: ThreadId }> {
  const projectId = ProjectId.makeUnsafe(`${kind}-project`);
  const threadId = ThreadId.makeUnsafe(`${kind}-thread`);
  const base = {
    occurredAt: now,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  } as const;
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      ...base,
      sequence: 1,
      eventId: EventId.makeUnsafe(`${kind}-event-project`),
      aggregateKind: "project",
      aggregateId: projectId,
      type: "project.created",
      commandId: CommandId.makeUnsafe(`${kind}-command-project`),
      payload: {
        projectId,
        kind,
        title: "Launch",
        workspaceRoot: `/tmp/djl-${kind}`,
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  const withThread = await Effect.runPromise(
    projectEvent(withProject, {
      ...base,
      sequence: 2,
      eventId: EventId.makeUnsafe(`${kind}-event-thread`),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.created",
      commandId: CommandId.makeUnsafe(`${kind}-command-thread`),
      payload: {
        threadId,
        projectId,
        title: "Launch",
        modelSelection,
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        handoff: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  const readModel = {
    ...withThread,
    // eslint-disable-next-line oxc/no-map-spread -- Keep caller-owned records immutable.
    threads: withThread.threads.map((thread) => ({
      ...thread,
      session: {
        threadId,
        status: "running" as const,
        providerName: modelSelection.provider,
        runtimeMode: "approval-required" as const,
        activeTurnId: TurnId.makeUnsafe("turn-1"),
        lastError: null,
        updatedAt: now,
      },
    })),
  };
  return { readModel, threadId };
}

async function steerTypes(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
  modelSelection: ModelSelection,
) {
  const result = await Effect.runPromise(
    decideOrchestrationCommand({
      readModel,
      command: {
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("command-steer"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("message-steer"),
          role: "user",
          text: "@Codex quick question",
          attachments: [],
        },
        modelSelection,
        dispatchMode: "steer",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: "2026-11-18T10:01:00.000Z",
      },
    }),
  );
  const events = (Array.isArray(result) ? result : [result]) as ReadonlyArray<
    Omit<OrchestrationEvent, "sequence">
  >;
  return events.map((event) => event.type);
}

describe("group steer decider", () => {
  it("a steer on a running group thread is not queued and does not interrupt", async () => {
    const selection: ModelSelection = { provider: "group", model: "group" };
    const { readModel, threadId } = await runningThread("group", selection);
    expect(await steerTypes(readModel, threadId, selection)).toEqual([
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
  });

  it("a steer on a running Qwen thread still queues and interrupts", async () => {
    const selection = { provider: "qwen", model: "qwen3-coder-plus" } as ModelSelection;
    const { readModel, threadId } = await runningThread("project", selection);
    expect(await steerTypes(readModel, threadId, selection)).toEqual([
      "thread.message-sent",
      "thread.turn-queued",
      "thread.turn-interrupt-requested",
    ]);
  });
});
