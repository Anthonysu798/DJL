import { DocumentArtifactId, EventId, MessageId, ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";
import { Effect, Layer, Option } from "effect";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { WorkPreparationRepository } from "../Services/WorkPreparationRepository.ts";
import { WorkPreparationRepositoryLive } from "./WorkPreparationRepository.ts";

const databaseLayer = NodeSqliteClient.layerMemory();
const repositoryLayer = WorkPreparationRepositoryLive.pipe(Layer.provide(databaseLayer));
const testLayer = Layer.mergeAll(databaseLayer, repositoryLayer);

describe("WorkPreparationRepository", () => {
  it("deduplicates event replay and recovers processing/completed jobs", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const repository = yield* WorkPreparationRepository;
        const request = {
          threadId: ThreadId.makeUnsafe("thread-1"),
          messageId: MessageId.makeUnsafe("message-1"),
          assistantDeliveryMode: "streaming" as const,
          dispatchMode: "queue" as const,
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          createdAt: "2026-07-13T10:00:00.000Z",
        };
        const base = {
          sourceEventId: EventId.makeUnsafe("event-1"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          messageId: "message-1",
          request,
          messageText: "Summarize this",
          attachments: [],
          now: "2026-07-13T10:00:00.000Z",
        };
        const first = yield* repository.enqueue({ ...base, id: "job-1" });
        const replay = yield* repository.enqueue({ ...base, id: "job-replayed" });
        expect(first.id).toBe("job-1");
        expect(replay.id).toBe("job-1");

        const claimed = yield* repository.claim("job-1", "2026-07-13T10:01:00.000Z");
        expect(Option.getOrThrow(claimed).attemptCount).toBe(1);
        const recovered = yield* repository.recover();
        expect(recovered).toEqual([expect.objectContaining({ id: "job-1", status: "queued" })]);

        yield* repository.claim("job-1", "2026-07-13T10:02:00.000Z");
        yield* repository.deferForInput(
          "job-1",
          "OCR installation is required",
          "2026-07-13T10:02:10.000Z",
        );
        expect(yield* repository.recover()).toEqual([]);
        expect(yield* repository.resumeNeedsInput("2026-07-13T10:02:20.000Z")).toEqual([
          expect.objectContaining({ id: "job-1", status: "queued" }),
        ]);
        yield* repository.claim("job-1", "2026-07-13T10:02:30.000Z");
        yield* repository.complete(
          "job-1",
          "<djl_work_task>prepared</djl_work_task>",
          [
            {
              id: DocumentArtifactId.makeUnsafe("artifact-1"),
              threadId: ThreadId.makeUnsafe("thread-1"),
              projectId: ProjectId.makeUnsafe("project-1"),
              attachmentId: "attachment-1" as never,
              originalName: "notes.txt",
              contentHash: "a".repeat(64),
              detectedMediaType: "text/plain",
              sizeBytes: 10,
              extractionMethod: "native",
              blocks: [],
              warnings: [],
              schemaVersion: 1,
              engineVersion: "test-1",
              createdAt: "2026-07-13T10:02:00.000Z",
            },
          ],
          "2026-07-13T10:02:00.000Z",
        );
        expect(yield* repository.listArtifacts("job-1")).toHaveLength(1);
        expect(yield* repository.listRecentArtifactsForThread(request.threadId)).toEqual([
          expect.objectContaining({
            id: "artifact-1",
            originalName: "notes.txt",
          }),
        ]);
        expect(
          yield* repository.listRecentArtifactsForThread(ThreadId.makeUnsafe("thread-2")),
        ).toEqual([]);
        expect((yield* repository.recover()).map((job) => job.id)).toEqual(["job-1"]);

        yield* repository.markDispatched("job-1", "2026-07-13T10:03:00.000Z");
        expect(yield* repository.recover()).toEqual([]);
      }).pipe(Effect.provide(testLayer)),
    );
  });
});
