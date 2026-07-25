import { CommandId, EventId, ProjectId, ProviderItemId, ThreadId } from "@synara/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";

const TestLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "work-projection-test-" })),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("Work task durable projection", (it) => {
  it.effect("persists initial and transitioned Work task state", () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore;
      const pipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = "2026-07-13T10:00:00.000Z";
      const projectId = ProjectId.makeUnsafe("work-project-1");
      const threadId = ThreadId.makeUnsafe("work-thread-1");

      yield* store.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("event-project-1"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("command-project-1"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          projectId,
          kind: "studio",
          title: "Work",
          workspaceRoot: "/tmp/work",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* store.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("event-thread-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: CommandId.makeUnsafe("command-thread-1"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Prepare report",
          modelSelection: { provider: "opencode", model: "test" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* store.append({
        type: "thread.work-task-transitioned",
        eventId: EventId.makeUnsafe("event-work-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-07-13T10:01:00.000Z",
        commandId: CommandId.makeUnsafe("provider:item-1"),
        causationEventId: null,
        correlationId: null,
        metadata: { providerItemId: ProviderItemId.makeUnsafe("item-1") },
        payload: {
          threadId,
          action: "start_work",
          task: {
            threadId,
            phase: "working",
            condition: "active",
            status: "working",
            resumePhase: "working",
            progress: 35,
            statusReason: "Editing the workbook",
            lastTransitionCommandId: CommandId.makeUnsafe("provider:item-1"),
            createdAt,
            updatedAt: "2026-07-13T10:01:00.000Z",
            completedAt: null,
          },
        },
      });

      yield* pipeline.bootstrap;
      const rows = yield* sql<{ readonly task: string | null }>`
        SELECT work_task_json AS task FROM projection_threads WHERE thread_id = ${threadId}
      `;
      assert.equal(rows.length, 1);
      assert.equal(JSON.parse(rows[0]?.task ?? "null")?.status, "working");
      assert.equal(JSON.parse(rows[0]?.task ?? "null")?.progress, 35);
    }),
  );
});
