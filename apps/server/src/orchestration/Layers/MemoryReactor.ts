// FILE: MemoryReactor.ts
// Purpose: Persists source-backed Work turn memory after successful review transitions.

import {
  CommandId,
  EventId,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type ThreadId,
} from "@synara/contracts";
import { makeDrainableWorker } from "@synara/shared/DrainableWorker";
import { Cause, Effect, Layer, Option, Stream } from "effect";

import { ProjectMemory } from "../../memory/Services/ProjectMemory.ts";
import { resolveProjectMemoryScope } from "../../memory/projectMemoryScope.ts";
import { MemoryReactor, type MemoryReactorShape } from "../Services/MemoryReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

type MemoryTriggerEvent = Extract<OrchestrationEvent, { type: "thread.work-task-transitioned" }>;

function stableEventToken(value: string): string {
  return Buffer.from(value).toString("base64url").slice(0, 96);
}

export function recordInputFromCompletedWorkThread(
  project: OrchestrationProjectShell,
  thread: OrchestrationThread,
) {
  const latestTurn = thread.latestTurn;
  if (!thread.workTask || !latestTurn || latestTurn.state !== "completed") return null;
  const turnMessages = thread.messages.filter((message) => message.turnId === latestTurn.turnId);
  const userMessage =
    turnMessages.find((message) => message.role === "user") ??
    thread.messages.toReversed().find((message) => message.role === "user");
  const assistantMessage = turnMessages
    .toReversed()
    .find((message) => message.role === "assistant" && !message.streaming);
  if (!userMessage || !assistantMessage || !assistantMessage.text.trim()) return null;
  const memoryScope = resolveProjectMemoryScope({
    containerProjectId: project.id,
    containerTitle: project.title,
    workspaceRoot: thread.worktreePath,
  });
  return {
    projectId: memoryScope.projectId,
    projectTitle: memoryScope.title,
    projectCreatedAt: project.createdAt,
    threadId: thread.id,
    threadTitle: thread.title,
    turnId: latestTurn.turnId,
    userText: userMessage.text,
    assistantText: assistantMessage.text,
    completedAt: latestTurn.completedAt ?? assistantMessage.updatedAt,
  } as const;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const projectMemory = yield* ProjectMemory;

  const recordThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    sourceEventId: string,
    appendActivity: boolean,
  ) {
    const threadOption = yield* projectionSnapshotQuery.getThreadDetailById(threadId);
    if (Option.isNone(threadOption)) return;
    const thread = threadOption.value;
    const projectOption = yield* projectionSnapshotQuery.getProjectShellById(thread.projectId);
    if (Option.isNone(projectOption) || projectOption.value.kind !== "studio") return;
    const input = recordInputFromCompletedWorkThread(projectOption.value, thread);
    if (!input) return;
    const result = yield* projectMemory.recordTurn(input);
    if (!appendActivity) return;
    const createdAt = new Date().toISOString();
    const commandToken = stableEventToken(`${sourceEventId}:${input.turnId}`);
    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: CommandId.makeUnsafe(`memory:${commandToken}`),
      threadId: thread.id,
      activity: {
        id: EventId.makeUnsafe(`memory-${commandToken}`),
        tone: result.conflictPath ? "approval" : "info",
        kind: result.conflictPath ? "work.memory.conflict" : "work.memory.updated",
        summary: result.conflictPath ? "Project memory needs review" : "Project memory updated",
        payload: {
          source: `[[Tasks/${String(thread.id)}]]`,
          conflict: result.conflictPath !== null,
        },
        turnId: input.turnId,
        createdAt,
      },
      createdAt,
    });
  });

  const processEvent = (event: MemoryTriggerEvent) =>
    recordThread(event.payload.threadId, event.eventId, true);

  const processEventSafely = (event: MemoryTriggerEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("project memory reactor failed to persist a completed Work turn", {
          threadId: event.payload.threadId,
          eventId: event.eventId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const recoverCompletedTurns = Effect.gen(function* () {
    const snapshot = yield* projectionSnapshotQuery.getSnapshot();
    const studioProjectIds = new Set(
      snapshot.projects.filter((project) => project.kind === "studio").map((project) => project.id),
    );
    const candidates = snapshot.threads.filter(
      (thread) =>
        studioProjectIds.has(thread.projectId) &&
        thread.latestTurn?.state === "completed" &&
        (thread.workTask?.status === "needs_review" || thread.workTask?.status === "complete"),
    );
    yield* Effect.forEach(
      candidates,
      (thread) =>
        recordThread(thread.id, `recovery:${thread.latestTurn?.turnId ?? thread.id}`, false),
      { concurrency: 2, discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("project memory recovery failed", { cause: Cause.pretty(cause) }),
    ),
  );

  const start: MemoryReactorShape["start"] = Effect.gen(function* () {
    // Subscribe before starting the potentially expensive vault reindex so a
    // turn settling during startup is queued. The memory worker naturally waits
    // on ProjectMemory's lock while the background reindex is in progress.
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.work-task-transitioned" &&
        (event.payload.action === "submit_review" || event.payload.action === "complete")
          ? worker.enqueue(event)
          : Effect.void,
      ),
    );
    yield* Effect.forkScoped(
      projectMemory.start.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project memory watcher failed to start", {
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.andThen(recoverCompletedTurns),
      ),
    );
  });

  return { start, drain: worker.drain } satisfies MemoryReactorShape;
});

export const MemoryReactorLive = Layer.effect(MemoryReactor, make);
