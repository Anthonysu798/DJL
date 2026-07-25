// FILE: WorkPreparationQueue.ts
// Purpose: Restart-safe document preparation worker, independent of provider turn serialization.

import { createHash } from "node:crypto";

import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  type DocumentIntelligenceStatus,
  type OrchestrationThreadActivity,
} from "@synara/contracts";
import { makeDrainableWorker } from "@synara/shared/DrainableWorker";
import { Cause, Effect, Layer, Option, Queue, Stream } from "effect";

import { resolveAttachmentPathById } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  WorkPreparationRepository,
  type WorkPreparationJobRecord,
} from "../../persistence/Services/WorkPreparationRepository.ts";
import {
  buildTrustedWorkPrompt,
  DocumentOcrRequiredError,
  normalizeDocument,
} from "../../work/documentExtraction.ts";
import {
  DocumentIntelligence,
  DocumentIntelligenceError,
} from "../../work/Services/DocumentIntelligence.ts";
import { resolveWorkModelDocumentRouting } from "../../work/modelDocumentRouting.ts";
import { ProjectMemory } from "../../memory/Services/ProjectMemory.ts";
import { resolveProjectMemoryScope } from "../../memory/projectMemoryScope.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  WorkPreparationQueue,
  type WorkPreparationAttachment,
  type WorkPreparationQueueShape,
} from "../Services/WorkPreparationQueue.ts";

function stableToken(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function preservePreparationFailure(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error("Document preparation failed with a non-Error rejection.", { cause });
}

function jobIdForSourceEvent(eventId: string): string {
  return `work-prep-${stableToken(eventId)}`;
}

function serverCommandId(jobId: string, suffix: string): CommandId {
  return CommandId.makeUnsafe(`server:${jobId}:${suffix}`);
}

export function documentIntelligenceBlocker(status: DocumentIntelligenceStatus) {
  const localInstallAvailable = status.installAvailable;
  return {
    localInstallAvailable,
    // Cloud OCR stays false until an adapter, secret, and explicit consent policy are all
    // configured server-side. The browser cannot claim or enable this capability.
    cloudOcrAvailable: false,
    cloudOcrRequiresConsent: false,
    visionModelAlternative: true,
    reason: localInstallAvailable
      ? "Install the signed local document reader, or switch to a vision-capable model."
      : "Switch to a vision-capable model, or configure a signed local document-intelligence release.",
  } as const;
}

const make = Effect.gen(function* () {
  const repository = yield* WorkPreparationRepository;
  const config = yield* ServerConfig;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const documentIntelligence = yield* DocumentIntelligence;
  const projectMemory = yield* ProjectMemory;
  // There is one provider-command consumer. A queue preserves prepared jobs
  // published during startup before that consumer has finished subscribing;
  // a PubSub could lose that handoff and leave Work permanently cancelled.
  const completed = yield* Queue.unbounded<{ readonly job: WorkPreparationJobRecord }>();

  const appendPreparationActivity = (input: {
    readonly jobId: string;
    readonly threadId: string;
    readonly kind: string;
    readonly summary: string;
    readonly tone: "info" | "error";
    readonly payload: OrchestrationThreadActivity["payload"];
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId(input.jobId, `activity:${input.kind}`),
      threadId: input.threadId as never,
      activity: {
        id: EventId.makeUnsafe(`work-preparation-${stableToken(`${input.jobId}:${input.kind}`)}`),
        tone: input.tone,
        kind: input.kind,
        summary: input.summary,
        payload: input.payload,
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const publishCompleted = (job: WorkPreparationJobRecord) =>
    Queue.offer(completed, { job }).pipe(Effect.asVoid);

  const processJob = (jobId: string) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const claimed = yield* repository.claim(jobId, now);
      if (Option.isNone(claimed)) {
        const existing = yield* repository.get(jobId);
        if (
          Option.isSome(existing) &&
          existing.value.status === "completed" &&
          existing.value.dispatchedAt === null
        ) {
          yield* publishCompleted(existing.value);
        }
        return;
      }
      const job = claimed.value;
      yield* appendPreparationActivity({
        jobId,
        threadId: job.threadId,
        kind: "work.preparation.started",
        summary:
          job.attachments.length > 0 ? "Preparing attached documents" : "Preparing task context",
        tone: "info",
        payload: { attachmentCount: job.attachments.length, attempt: job.attemptCount },
        createdAt: now,
      });

      const documentAttachments = job.attachments.filter(
        (attachment): attachment is WorkPreparationAttachment =>
          attachment.type === "file" || attachment.type === "image",
      );
      const modelRouting = resolveWorkModelDocumentRouting(
        job.request.modelSelection ?? {
          provider: "opencode",
          model: DEFAULT_MODEL_BY_PROVIDER.opencode,
        },
      );
      const documentIntelligenceStatus = yield* documentIntelligence.status;
      const ocr =
        documentIntelligenceStatus.state === "ready"
          ? (filePath: string) => Effect.runPromise(documentIntelligence.recognize(filePath))
          : undefined;
      const artifacts = yield* Effect.forEach(
        documentAttachments,
        (attachment) =>
          Effect.gen(function* () {
            const filePath = resolveAttachmentPathById({
              attachmentsDir: config.attachmentsDir,
              attachmentId: attachment.id,
            });
            if (!filePath) {
              return yield* Effect.fail(
                new Error(`Immutable attachment '${attachment.name}' is unavailable.`),
              );
            }
            return yield* Effect.tryPromise({
              try: () =>
                normalizeDocument({
                  filePath,
                  attachment,
                  jobId,
                  threadId: job.threadId,
                  projectId: job.projectId,
                  createdAt: now,
                  requireOcr: modelRouting.requireOcrForImages,
                  ...(ocr ? { ocr } : {}),
                }),
              catch: preservePreparationFailure,
            });
          }),
        { concurrency: 2 },
      );
      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((candidate) => candidate.id === job.threadId);
      const project = readModel.projects.find((candidate) => candidate.id === job.projectId);
      const memoryScope = resolveProjectMemoryScope({
        containerProjectId: job.projectId,
        containerTitle: project?.title ?? "DJL Work",
        workspaceRoot: thread?.worktreePath,
      });
      const memory = yield* projectMemory
        .retrieve({
          projectId: memoryScope.projectId,
          threadId: job.threadId,
          query: job.messageText,
          maxChars: 12_000,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Project memory retrieval failed; continuing without memory", {
              jobId,
              projectId: job.projectId,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as({ brief: "", citations: [] })),
          ),
        );
      const preparedPrompt = buildTrustedWorkPrompt({
        userPrompt: job.messageText,
        artifacts,
        ...(memory.brief ? { memoryBrief: memory.brief } : {}),
      });
      const completedAt = new Date().toISOString();
      yield* repository.complete(jobId, preparedPrompt, artifacts, completedAt);
      const updated = yield* repository.get(jobId);
      if (Option.isNone(updated)) {
        return yield* Effect.fail(new Error(`Prepared Work job '${jobId}' disappeared.`));
      }
      yield* orchestrationEngine
        .dispatch({
          type: "thread.work-task.transition",
          commandId: serverCommandId(jobId, "work-task:resolve-input"),
          threadId: job.threadId,
          action: "resolve_input",
          reason: "Document intelligence is ready. Resuming the task.",
          createdAt: completedAt,
        })
        .pipe(Effect.ignore);
      yield* appendPreparationActivity({
        jobId,
        threadId: job.threadId,
        kind: "work.preparation.completed",
        summary: artifacts.length > 0 ? "Documents are ready" : "Task context is ready",
        tone: "info",
        payload: {
          artifactCount: artifacts.length,
          warningCount: artifacts.reduce((total, artifact) => total + artifact.warnings.length, 0),
          memoryCitationCount: memory.citations.length,
        },
        createdAt: completedAt,
      });
      yield* publishCompleted(updated.value);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          if (Cause.hasInterruptsOnly(cause)) return yield* Effect.failCause(cause);
          const squashed = Cause.squash(cause);
          const detail = Cause.pretty(cause).slice(0, 8_000);
          const failedAt = new Date().toISOString();
          if (
            squashed instanceof DocumentOcrRequiredError ||
            squashed instanceof DocumentIntelligenceError
          ) {
            yield* repository.deferForInput(jobId, detail, failedAt).pipe(Effect.ignore);
            const waitingJob = yield* repository.get(jobId).pipe(
              Effect.map(Option.getOrUndefined),
              Effect.catch(() => Effect.succeed(undefined)),
            );
            if (waitingJob) {
              const currentDocumentIntelligenceStatus = yield* documentIntelligence.status;
              const blocker = documentIntelligenceBlocker(currentDocumentIntelligenceStatus);
              yield* appendPreparationActivity({
                jobId,
                threadId: waitingJob.threadId,
                kind: "work.preparation.needs_document_intelligence",
                summary: "Document intelligence is required",
                tone: "info",
                payload: {
                  ...blocker,
                  detail: squashed.message,
                },
                createdAt: failedAt,
              }).pipe(Effect.ignore);
              yield* orchestrationEngine
                .dispatch({
                  type: "thread.work-task.transition",
                  commandId: serverCommandId(jobId, "work-task:request-input"),
                  threadId: waitingJob.threadId,
                  action: "request_input",
                  reason: blocker.reason,
                  createdAt: failedAt,
                })
                .pipe(Effect.ignore);
            }
            return;
          }
          yield* repository.fail(jobId, detail, failedAt).pipe(Effect.ignore);
          const failedJob = yield* repository.get(jobId).pipe(
            Effect.map(Option.getOrUndefined),
            Effect.catch(() => Effect.succeed(undefined)),
          );
          if (failedJob) {
            yield* appendPreparationActivity({
              jobId,
              threadId: failedJob.threadId,
              kind: "work.preparation.failed",
              summary: "Document preparation failed",
              tone: "error",
              payload: { detail },
              createdAt: failedAt,
            }).pipe(Effect.ignore);
            yield* orchestrationEngine
              .dispatch({
                type: "thread.work-task.transition",
                commandId: serverCommandId(jobId, "work-task:fail"),
                threadId: failedJob.threadId,
                action: "fail",
                reason: "Document preparation failed. Retry the task or remove the affected file.",
                createdAt: failedAt,
              })
              .pipe(Effect.ignore);
          }
          yield* Effect.logWarning("Work preparation job failed", { jobId, cause: detail });
        }),
      ),
    );

  const worker = yield* makeDrainableWorker(processJob);

  const enqueue: WorkPreparationQueueShape["enqueue"] = (input) =>
    Effect.gen(function* () {
      const job = yield* repository.enqueue({
        id: jobIdForSourceEvent(input.event.eventId),
        sourceEventId: input.event.eventId,
        threadId: input.event.payload.threadId,
        projectId: input.projectId,
        messageId: input.message.id,
        request: input.event.payload,
        messageText: input.message.text,
        attachments: input.message.attachments ?? [],
        now: input.event.occurredAt,
      });
      if (job.status === "queued") {
        yield* worker.enqueue(job.id);
      } else if (job.status === "completed" && job.dispatchedAt === null) {
        yield* publishCompleted(job);
      }
    });

  const start: WorkPreparationQueueShape["start"] = repository
    .recover()
    .pipe(
      Effect.flatMap((jobs) =>
        Effect.forEach(
          jobs,
          (job) => (job.status === "completed" ? publishCompleted(job) : worker.enqueue(job.id)),
          { concurrency: 1, discard: true },
        ),
      ),
    );

  const resumeNeedsInput: WorkPreparationQueueShape["resumeNeedsInput"] = Effect.suspend(() =>
    repository.resumeNeedsInput(new Date().toISOString()),
  ).pipe(
    Effect.flatMap((jobs) =>
      Effect.forEach(jobs, (job) => worker.enqueue(job.id), {
        concurrency: 1,
        discard: true,
      }),
    ),
  );

  return {
    start,
    enqueue,
    resumeNeedsInput,
    markDispatched: repository.markDispatched,
    streamCompleted: Stream.fromQueue(completed),
    drain: worker.drain,
  } satisfies WorkPreparationQueueShape;
});

export const WorkPreparationQueueLive = Layer.effect(WorkPreparationQueue, make);
