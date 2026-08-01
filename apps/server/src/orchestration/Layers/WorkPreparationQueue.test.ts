import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { EventId, MessageId, ProjectId, ThreadId } from "@synara/contracts";
import { Effect, Layer, Option, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig, type ServerConfigShape } from "../../config.ts";
import { WorkPreparationRepository } from "../../persistence/Services/WorkPreparationRepository.ts";
import type { WorkPreparationJobRecord } from "../../persistence/Services/WorkPreparationRepository.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { WorkPreparationQueue } from "../Services/WorkPreparationQueue.ts";
import { WorkPreparationQueueLive } from "./WorkPreparationQueue.ts";
import { documentIntelligenceBlocker } from "./WorkPreparationQueue.ts";
import { DocumentIntelligence } from "../../work/Services/DocumentIntelligence.ts";
import { ProjectMemory } from "../../memory/Services/ProjectMemory.ts";
import { DocumentOcrRequiredError } from "../../work/documentExtraction.ts";
import { preservePreparationFailure } from "./WorkPreparationQueue.ts";
import { projectMemorySearchQuery, workContextCharacterBudget } from "./WorkPreparationQueue.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("WorkPreparationQueue", () => {
  it("allocates explicit memory only after prompt, output, history, and tools are reserved", () => {
    expect(
      workContextCharacterBudget({
        contextWindowTokens: 8_192,
        outputTokens: 2_048,
        systemPromptChars: 4_000,
        currentThreadHistoryChars: 8_000,
        toolSchemaChars: 6_000,
        attachmentChars: 2_000,
      }),
    ).toBe(4_576);
    expect(
      workContextCharacterBudget({
        contextWindowTokens: 4_096,
        outputTokens: 2_048,
        systemPromptChars: 8_000,
        currentThreadHistoryChars: 8_000,
        toolSchemaChars: 8_000,
        attachmentChars: 8_000,
      }),
    ).toBe(0);
  });

  it("enables project memory only for the explicit /memory command", () => {
    expect(projectMemorySearchQuery("What did we decide?")).toBeNull();
    expect(projectMemorySearchQuery("remember today was nice")).toBeNull();
    expect(projectMemorySearchQuery("/memory launch date")).toBe("launch date");
    expect(projectMemorySearchQuery("  /memory   发布日期  ")).toBe("发布日期");
  });

  it("preserves typed OCR failures across the promise boundary", async () => {
    const original = new DocumentOcrRequiredError("scan.png");
    const failure = await Effect.runPromise(
      Effect.tryPromise({
        try: () => Promise.reject(original),
        catch: preservePreparationFailure,
      }).pipe(Effect.flip),
    );

    expect(failure).toBe(original);
  });

  it("reports only document-intelligence choices that the server can actually provide", () => {
    expect(
      documentIntelligenceBlocker({
        state: "unavailable",
        installAvailable: false,
        version: null,
        engineVersion: null,
        detail: "No signed release configured",
      }),
    ).toEqual({
      localInstallAvailable: false,
      cloudOcrAvailable: false,
      cloudOcrRequiresConsent: false,
      visionModelAlternative: true,
      reason:
        "Switch to a vision-capable model, or configure a signed local document-intelligence release.",
    });
  });

  it("normalizes files on its own worker and publishes a prepared turn", async () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "djl-preparation-queue-"));
    tempDirs.push(baseDir);
    const attachmentsDir = path.join(baseDir, "attachments");
    mkdirSync(attachmentsDir, { recursive: true });
    writeFileSync(path.join(attachmentsDir, "attachment-1.txt"), "hello office work");

    let record: WorkPreparationJobRecord | null = null;
    const artifacts: unknown[] = [];
    const commands: unknown[] = [];
    let memoryRetrievals = 0;
    const repositoryLayer = Layer.succeed(WorkPreparationRepository, {
      enqueue: (input) =>
        Effect.sync(() => {
          record ??= {
            id: input.id,
            sourceEventId: input.sourceEventId,
            threadId: input.threadId,
            projectId: input.projectId,
            messageId: input.messageId,
            request: input.request,
            messageText: input.messageText,
            attachments: input.attachments,
            status: "queued",
            preparedPrompt: null,
            error: null,
            attemptCount: 0,
            createdAt: input.now,
            updatedAt: input.now,
            completedAt: null,
            dispatchedAt: null,
          };
          return record;
        }),
      recover: () => Effect.succeed([]),
      claim: (_id, now) =>
        Effect.sync(() => {
          if (!record || record.status !== "queued") return Option.none();
          record = {
            ...record,
            status: "processing",
            attemptCount: record.attemptCount + 1,
            updatedAt: now,
          };
          return Option.some(record);
        }),
      complete: (_id, preparedPrompt, nextArtifacts, now) =>
        Effect.sync(() => {
          artifacts.push(...nextArtifacts);
          if (!record) throw new Error("missing record");
          record = {
            ...record,
            status: "completed",
            preparedPrompt,
            updatedAt: now,
            completedAt: now,
          };
        }),
      fail: (_id, error, now) =>
        Effect.sync(() => {
          if (record) record = { ...record, status: "failed", error, updatedAt: now };
        }),
      deferForInput: (_id, error, now) =>
        Effect.sync(() => {
          if (record) record = { ...record, status: "needs_input", error, updatedAt: now };
        }),
      resumeNeedsInput: () => Effect.succeed([]),
      markDispatched: () => Effect.void,
      get: () => Effect.sync(() => (record ? Option.some(record) : Option.none())),
      listArtifacts: () => Effect.succeed([]),
      listRecentArtifactsForThread: () => Effect.succeed([]),
    });
    const configLayer = Layer.succeed(ServerConfig, {
      attachmentsDir,
    } as ServerConfigShape);
    const engineLayer = Layer.succeed(OrchestrationEngineService, {
      dispatch: (command: unknown) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
      readEvents: () => Stream.empty,
      streamDomainEventsFrom: () => Stream.empty,
      getReadModel: () =>
        Effect.succeed({
          projects: [
            {
              id: ProjectId.makeUnsafe("project-1"),
              title: "DJL Work",
            },
          ],
          threads: [
            {
              id: ThreadId.makeUnsafe("thread-1"),
              worktreePath: null,
            },
          ],
        } as never),
      repairState: () => Effect.die("unused"),
      refreshCommandReadModel: () => Effect.die("unused"),
      streamDomainEvents: Stream.empty,
    } as never);
    const layer = WorkPreparationQueueLive.pipe(
      Layer.provideMerge(repositoryLayer),
      Layer.provideMerge(configLayer),
      Layer.provideMerge(engineLayer),
      Layer.provideMerge(
        Layer.succeed(DocumentIntelligence, {
          status: Effect.succeed({
            state: "not_installed" as const,
            installAvailable: false,
            version: null,
            engineVersion: null,
            detail: null,
          }),
          install: Effect.die("unused"),
          repair: Effect.die("unused"),
          uninstall: Effect.void,
          recognize: () => Effect.die("unused"),
        }),
      ),
      Layer.provideMerge(
        Layer.succeed(ProjectMemory, {
          start: Effect.void,
          ensureProject: () => Effect.succeed("/tmp/memory"),
          recordTurn: () => Effect.die("unused"),
          retrieve: () =>
            Effect.sync(() => {
              memoryRetrievals += 1;
              return {
                brief: "Source [[Project]]\nThe preferred reporting currency is CAD.",
                citations: [{ path: "Project", title: "Project", score: 1 }],
              };
            }),
          retrieveExact: () => Effect.succeed({ brief: "", citations: [] }),
          list: () => Effect.succeed([]),
          save: () => Effect.die("unused"),
          rename: () => Effect.die("unused"),
          delete: () => Effect.die("unused"),
          reindexProject: () => Effect.void,
          vaultRoot: "/tmp/memory",
          projectRoot: () => "/tmp/memory/Studio/Projects/project-1",
        }),
      ),
    );

    const prepared = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* WorkPreparationQueue;
          yield* queue.enqueue({
            event: {
              eventId: EventId.makeUnsafe("event-1"),
              aggregateKind: "thread",
              aggregateId: ThreadId.makeUnsafe("thread-1"),
              sequence: 1,
              type: "thread.turn-start-requested",
              commandId: null,
              correlationId: null,
              causationEventId: null,
              metadata: {},
              payload: {
                threadId: ThreadId.makeUnsafe("thread-1"),
                messageId: MessageId.makeUnsafe("message-1"),
                assistantDeliveryMode: "streaming",
                dispatchMode: "queue",
                runtimeMode: "full-access",
                interactionMode: "default",
                createdAt: "2026-07-13T10:00:00.000Z",
              },
              occurredAt: "2026-07-13T10:00:00.000Z",
            } as never,
            projectId: ProjectId.makeUnsafe("project-1"),
            message: {
              id: MessageId.makeUnsafe("message-1"),
              text: "Summarize this file",
              attachments: [
                {
                  type: "file",
                  id: "attachment-1" as never,
                  name: "notes.txt",
                  mimeType: "text/plain",
                  sizeBytes: 17,
                },
              ],
            },
          });
          yield* queue.drain;
          return yield* Effect.race(
            Stream.runHead(queue.streamCompleted),
            Effect.sleep("50 millis").pipe(Effect.as(Option.none())),
          );
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(prepared).toEqual(
      Option.some(
        expect.objectContaining({
          job: expect.objectContaining({
            status: "completed",
            preparedPrompt: expect.stringContaining("[Source: notes.txt, paragraph 1]"),
          }),
        }),
      ),
    );
    expect(Option.getOrThrow(prepared).job.preparedPrompt).not.toContain(
      "preferred reporting currency is CAD",
    );
    expect(memoryRetrievals).toBe(0);
    expect(artifacts).toHaveLength(1);
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "thread.activity.append",
          activity: expect.objectContaining({ kind: "work.preparation.completed" }),
        }),
      ]),
    );
  });
});
