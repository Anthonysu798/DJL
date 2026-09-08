import {
  CommandId,
  ProjectId,
  ThreadId,
  ApprovalRequestId,
  type ProviderRuntimeEvent,
} from "@synara/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery";
import { ProviderRuntimeIngestionLive } from "../../orchestration/Layers/ProviderRuntimeIngestion";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { ProviderRuntimeIngestionService } from "../../orchestration/Services/ProviderRuntimeIngestion";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService";
import { ServerConfig } from "../../config";
import { makeNativeAdapter } from "./adapter";
import type { NativeSink } from "./types";

const threadId = ThreadId.makeUnsafe("native-ingestion");
const projectId = ProjectId.makeUnsafe("native-project");
const unsupported = () =>
  Effect.die(new Error("Unexpected provider operation in ingestion test")) as never;

describe("native adapters through real orchestration ingestion", () => {
  it.each(["claudeAgent", "cursor", "grok", "kimi"] as const)(
    "persists separate %s turns and renders input and approval context",
    async (provider) => {
      const scope = await Effect.runPromise(Scope.make("sequential"));
      let sink!: NativeSink;
      let finish!: () => void;
      const events: ProviderRuntimeEvent[] = [];
      const adapter = await Effect.runPromise(
        makeNativeAdapter(provider, async (_input, value) => {
          sink = value;
          return {
            id: "native-session",
            send: async (turn) => {
              sink.emit({
                type: "content.delta",
                itemId: "assistant-0",
                payload: { streamKind: "assistant_text", delta: turn.input },
              });
              await new Promise<void>((resolve) => {
                finish = resolve;
              });
            },
            close: () => {},
            interrupt: async () => {},
            models: async () => ({ models: [] }),
          };
        }).pipe(Scope.provide(scope)),
      );
      const service: ProviderServiceShape = {
        startSession: (_threadId, input) => adapter.startSession(input),
        sendTurn: adapter.sendTurn,
        steerTurn: unsupported,
        startReview: unsupported,
        forkThread: () => Effect.succeed(null),
        interruptTurn: (input) =>
          adapter.interruptTurn(input.threadId, input.turnId, input.providerThreadId),
        respondToRequest: (input) =>
          adapter.respondToRequest(input.threadId, input.requestId, input.decision),
        respondToUserInput: (input) =>
          adapter.respondToUserInput(input.threadId, input.requestId, input.answers),
        stopSession: (input) => adapter.stopSession(input.threadId),
        listSessions: adapter.listSessions,
        getCapabilities: () => Effect.succeed(adapter.capabilities),
        rollbackConversation: unsupported,
        compactThread: unsupported,
        streamEvents: adapter.streamEvents.pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ),
        ),
      };
      const orchestration = OrchestrationEngineLive.pipe(
        Layer.provide(OrchestrationProjectionPipelineLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationEventStoreLive),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      );
      const runtime = ManagedRuntime.make(
        ProviderRuntimeIngestionLive.pipe(
          Layer.provideMerge(orchestration),
          Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
          Layer.provideMerge(SqlitePersistenceMemory),
          Layer.provideMerge(Layer.succeed(ProviderService, service)),
          Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
          Layer.provideMerge(NodeServices.layer),
        ),
      );
      try {
        const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
        const ingestion = await runtime.runPromise(Effect.service(ProviderRuntimeIngestionService));
        await Effect.runPromise(ingestion.start.pipe(Scope.provide(scope)));
        const createdAt = new Date().toISOString();
        await Effect.runPromise(
          engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("create-project"),
            projectId,
            title: "Native",
            workspaceRoot: "/tmp",
            defaultModelSelection: { provider, model: "native" },
            createdAt,
          }),
        );
        await Effect.runPromise(
          engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe("create-thread"),
            projectId,
            threadId,
            title: "Native",
            modelSelection: { provider, model: "native" },
            interactionMode: "default",
            runtimeMode: "approval-required",
            branch: null,
            worktreePath: null,
            createdAt,
          }),
        );
        const read = async () =>
          (await Effect.runPromise(engine.getReadModel())).threads.find(
            (thread) => thread.id === threadId,
          )!;
        const waitFor = async (
          condition: (thread: Awaited<ReturnType<typeof read>>) => boolean,
        ) => {
          const deadline = Date.now() + 5000;
          for (;;) {
            const thread = await read();
            if (condition(thread)) return thread;
            if (Date.now() > deadline)
              throw new Error("Native ingestion did not reach expected state");
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        await Effect.runPromise(
          adapter.startSession({ threadId, cwd: "/tmp", runtimeMode: "approval-required" }),
        );
        const first = await Effect.runPromise(
          adapter.sendTurn({ threadId, input: "First answer" }),
        );
        const approval = sink.request("command_execution_approval", {
          command: "cat /tmp/review.txt",
          cwd: "/tmp",
        });
        const withApproval = await waitFor((thread) =>
          thread.activities.some((activity) => activity.kind === "approval.requested"),
        );
        const approvalActivity = withApproval.activities.find(
          (activity) => activity.kind === "approval.requested",
        )!;
        expect(approvalActivity.payload).toMatchObject({
          detail: expect.stringContaining("cat /tmp/review.txt"),
        });
        const approvalEvent = events.find((event) => event.type === "request.opened")!;
        await Effect.runPromise(
          adapter.respondToRequest(
            threadId,
            ApprovalRequestId.makeUnsafe(approvalEvent.requestId!),
            "decline",
          ),
        );
        expect(await approval).toBe("decline");
        sink.emit({
          type: "item.completed",
          itemId: "review",
          payload: {
            itemType: "approval_review",
            status: "declined",
            title: "Native review denied",
            detail: "Outside approved scope",
          },
        });
        const reviewed = await waitFor((thread) =>
          thread.activities.some((activity) => activity.kind === "approval.review.completed"),
        );
        expect(
          reviewed.activities.find((activity) => activity.kind === "approval.review.completed")
            ?.payload,
        ).toMatchObject({ detail: "Outside approved scope", status: "declined" });
        const question = sink.request("tool_user_input", {
          questions: [
            {
              question: "Which file?",
              header: "File",
              options: [{ label: "A", description: "File A" }],
              multiSelect: false,
            },
          ],
        });
        const requested = await waitFor((thread) =>
          thread.activities.some((activity) => activity.kind === "user-input.requested"),
        );
        expect(
          requested.activities.find((activity) => activity.kind === "user-input.requested")!
            .payload,
        ).toMatchObject({ questions: [{ id: "Which file?", question: "Which file?" }] });
        const questionEvent = events.find((event) => event.type === "user-input.requested")!;
        await Effect.runPromise(
          adapter.respondToUserInput(
            threadId,
            ApprovalRequestId.makeUnsafe(questionEvent.requestId!),
            { "Which file?": "A" },
          ),
        );
        expect(await question).toEqual({ "Which file?": "A" });
        await waitFor((thread) =>
          thread.activities.some((activity) => activity.kind === "user-input.resolved"),
        );
        finish();
        await waitFor((thread) =>
          thread.messages.some(
            (message) =>
              message.role === "assistant" && message.text === "First answer" && !message.streaming,
          ),
        );
        const second = await Effect.runPromise(
          adapter.sendTurn({ threadId, input: "Second answer" }),
        );
        finish();
        const result = await waitFor(
          (thread) =>
            thread.messages.filter((message) => message.role === "assistant" && !message.streaming)
              .length === 2,
        );
        const messages = result.messages.filter((message) => message.role === "assistant");
        expect(messages.map((message) => message.text)).toEqual(["First answer", "Second answer"]);
        expect(messages.map((message) => message.turnId)).toEqual([first.turnId, second.turnId]);
        expect(new Set(messages.map((message) => message.id)).size).toBe(2);
      } finally {
        await Effect.runPromise(Scope.close(scope, Exit.void));
        await runtime.dispose();
      }
    },
  );
});
