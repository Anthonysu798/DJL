// FILE: WorkPreparationRepository.ts
// Purpose: SQLite implementation of DJL Work's restart-safe preparation queue.

import {
  ChatAttachment,
  DocumentArtifact,
  ProjectId,
  ThreadId,
  WorkPreparationJobStatus,
} from "@synara/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  WorkPreparationRepository,
  type WorkPreparationJobRecord,
  type WorkPreparationRepositoryShape,
  type WorkTurnStartPayload,
} from "../Services/WorkPreparationRepository.ts";

const JobRow = Schema.Struct({
  id: Schema.String,
  sourceEventId: Schema.String,
  threadId: ThreadId,
  projectId: ProjectId,
  messageId: Schema.String,
  request: Schema.fromJsonString(Schema.Json),
  messageText: Schema.String,
  attachments: Schema.fromJsonString(Schema.Array(ChatAttachment)),
  status: WorkPreparationJobStatus,
  preparedPrompt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  attemptCount: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  dispatchedAt: Schema.NullOr(Schema.String),
});
type JobRow = typeof JobRow.Type;

const ArtifactRow = Schema.Struct({
  id: DocumentArtifact.fields.id,
  threadId: DocumentArtifact.fields.threadId,
  projectId: DocumentArtifact.fields.projectId,
  attachmentId: DocumentArtifact.fields.attachmentId,
  originalName: DocumentArtifact.fields.originalName,
  contentHash: DocumentArtifact.fields.contentHash,
  detectedMediaType: DocumentArtifact.fields.detectedMediaType,
  sizeBytes: DocumentArtifact.fields.sizeBytes,
  extractionMethod: DocumentArtifact.fields.extractionMethod,
  blocks: Schema.fromJsonString(DocumentArtifact.fields.blocks),
  warnings: Schema.fromJsonString(DocumentArtifact.fields.warnings),
  schemaVersion: DocumentArtifact.fields.schemaVersion,
  engineVersion: DocumentArtifact.fields.engineVersion,
  createdAt: DocumentArtifact.fields.createdAt,
});
type ArtifactRow = typeof ArtifactRow.Type;
type SqlRow = Record<string, unknown>;

const decodeJobRow = Schema.decodeUnknownEffect(JobRow);
const decodeArtifactRow = Schema.decodeUnknownEffect(ArtifactRow);

function jobFromRow(row: JobRow): WorkPreparationJobRecord {
  return { ...row, request: row.request as WorkTurnStartPayload };
}

function sqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selectById = (id: string) =>
    sql<SqlRow>`
      SELECT
        job_id AS id,
        source_event_id AS "sourceEventId",
        thread_id AS "threadId",
        project_id AS "projectId",
        message_id AS "messageId",
        request_json AS request,
        message_text AS "messageText",
        attachments_json AS attachments,
        status,
        prepared_prompt AS "preparedPrompt",
        error,
        attempt_count AS "attemptCount",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        completed_at AS "completedAt",
        dispatched_at AS "dispatchedAt"
      FROM work_preparation_jobs
      WHERE job_id = ${id}
      LIMIT 1
    `.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeJobRow(row))),
      Effect.map((rows) =>
        rows[0] === undefined ? Option.none() : Option.some(jobFromRow(rows[0])),
      ),
      Effect.mapError(
        sqlOrDecodeError(
          "WorkPreparationRepository.selectById",
          "WorkPreparationRepository.decodeJob",
        ),
      ),
    );

  const enqueue: WorkPreparationRepositoryShape["enqueue"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO work_preparation_jobs (
              job_id, source_event_id, thread_id, project_id, message_id,
              request_json, message_text, attachments_json, status, created_at, updated_at
            ) VALUES (
              ${input.id}, ${input.sourceEventId}, ${input.threadId}, ${input.projectId},
              ${input.messageId}, ${JSON.stringify(input.request)}, ${input.messageText},
              ${JSON.stringify(input.attachments)}, 'queued', ${input.now}, ${input.now}
            )
            ON CONFLICT(source_event_id) DO NOTHING
          `;
          const rows = yield* sql<{ readonly id: string }>`
            SELECT job_id AS id
            FROM work_preparation_jobs
            WHERE source_event_id = ${input.sourceEventId}
            LIMIT 1
          `;
          const id = rows[0]?.id;
          if (!id) return yield* Effect.die("Queued Work preparation job was not persisted");
          const job = yield* selectById(id);
          if (Option.isNone(job))
            return yield* Effect.die("Queued Work preparation job disappeared");
          return job.value;
        }),
      )
      .pipe(
        Effect.mapError(
          sqlOrDecodeError(
            "WorkPreparationRepository.enqueue",
            "WorkPreparationRepository.enqueue.decode",
          ),
        ),
      );

  const recover: WorkPreparationRepositoryShape["recover"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const now = new Date().toISOString();
          yield* sql`
            UPDATE work_preparation_jobs
            SET status = 'queued', updated_at = ${now}
            WHERE status = 'processing'
          `;
          const rows = yield* sql<SqlRow>`
            SELECT
              job_id AS id, source_event_id AS "sourceEventId", thread_id AS "threadId",
              project_id AS "projectId", message_id AS "messageId", request_json AS request,
              message_text AS "messageText", attachments_json AS attachments, status,
              prepared_prompt AS "preparedPrompt", error, attempt_count AS "attemptCount",
              created_at AS "createdAt", updated_at AS "updatedAt",
              completed_at AS "completedAt", dispatched_at AS "dispatchedAt"
            FROM work_preparation_jobs
            WHERE status = 'queued'
               OR (status = 'completed' AND dispatched_at IS NULL)
            ORDER BY created_at, job_id
          `;
          return yield* Effect.forEach(rows, (row) => decodeJobRow(row));
        }),
      )
      .pipe(
        Effect.map((rows) => rows.map(jobFromRow)),
        Effect.mapError(
          sqlOrDecodeError(
            "WorkPreparationRepository.recover",
            "WorkPreparationRepository.recover.decode",
          ),
        ),
      );

  const claim: WorkPreparationRepositoryShape["claim"] = (id, now) =>
    sql<SqlRow>`
      UPDATE work_preparation_jobs
      SET status = 'processing', attempt_count = attempt_count + 1,
          error = NULL, updated_at = ${now}
      WHERE job_id = ${id} AND status = 'queued'
      RETURNING
        job_id AS id, source_event_id AS "sourceEventId", thread_id AS "threadId",
        project_id AS "projectId", message_id AS "messageId", request_json AS request,
        message_text AS "messageText", attachments_json AS attachments, status,
        prepared_prompt AS "preparedPrompt", error, attempt_count AS "attemptCount",
        created_at AS "createdAt", updated_at AS "updatedAt",
        completed_at AS "completedAt", dispatched_at AS "dispatchedAt"
    `.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeJobRow(row))),
      Effect.map((rows) =>
        rows[0] === undefined ? Option.none() : Option.some(jobFromRow(rows[0])),
      ),
      Effect.mapError(
        sqlOrDecodeError(
          "WorkPreparationRepository.claim",
          "WorkPreparationRepository.claim.decode",
        ),
      ),
    );

  const complete: WorkPreparationRepositoryShape["complete"] = (
    id,
    preparedPrompt,
    artifacts,
    now,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          for (const artifact of artifacts) {
            yield* sql`
              INSERT INTO document_artifacts (
                artifact_id, job_id, thread_id, project_id, attachment_id, original_name,
                content_hash, detected_media_type, size_bytes, extraction_method,
                blocks_json, warnings_json, schema_version, engine_version, created_at
              ) VALUES (
                ${artifact.id}, ${id}, ${artifact.threadId}, ${artifact.projectId},
                ${artifact.attachmentId}, ${artifact.originalName}, ${artifact.contentHash},
                ${artifact.detectedMediaType}, ${artifact.sizeBytes}, ${artifact.extractionMethod},
                ${JSON.stringify(artifact.blocks)}, ${JSON.stringify(artifact.warnings)},
                ${artifact.schemaVersion}, ${artifact.engineVersion}, ${artifact.createdAt}
              )
              ON CONFLICT(thread_id, attachment_id, content_hash) DO NOTHING
            `;
          }
          yield* sql`
            UPDATE work_preparation_jobs
            SET status = 'completed', prepared_prompt = ${preparedPrompt}, error = NULL,
                updated_at = ${now}, completed_at = ${now}
            WHERE job_id = ${id} AND status = 'processing'
          `;
        }),
      )
      .pipe(Effect.mapError(toPersistenceSqlError("WorkPreparationRepository.complete")));

  const fail: WorkPreparationRepositoryShape["fail"] = (id, error, now) =>
    sql`
      UPDATE work_preparation_jobs
      SET status = 'failed', error = ${error.slice(0, 8_000)}, updated_at = ${now}
      WHERE job_id = ${id}
    `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("WorkPreparationRepository.fail")));

  const deferForInput: WorkPreparationRepositoryShape["deferForInput"] = (id, error, now) =>
    sql`
      UPDATE work_preparation_jobs
      SET status = 'needs_input', error = ${error.slice(0, 8_000)}, updated_at = ${now}
      WHERE job_id = ${id} AND status = 'processing'
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("WorkPreparationRepository.deferForInput")),
    );

  const resumeNeedsInput: WorkPreparationRepositoryShape["resumeNeedsInput"] = (now) =>
    sql<SqlRow>`
      UPDATE work_preparation_jobs
      SET status = 'queued', error = NULL, updated_at = ${now}
      WHERE status = 'needs_input'
      RETURNING
        job_id AS id, source_event_id AS "sourceEventId", thread_id AS "threadId",
        project_id AS "projectId", message_id AS "messageId", request_json AS request,
        message_text AS "messageText", attachments_json AS attachments, status,
        prepared_prompt AS "preparedPrompt", error, attempt_count AS "attemptCount",
        created_at AS "createdAt", updated_at AS "updatedAt",
        completed_at AS "completedAt", dispatched_at AS "dispatchedAt"
    `.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeJobRow(row))),
      Effect.map((rows) => rows.map(jobFromRow)),
      Effect.mapError(
        sqlOrDecodeError(
          "WorkPreparationRepository.resumeNeedsInput",
          "WorkPreparationRepository.resumeNeedsInput.decode",
        ),
      ),
    );

  const markDispatched: WorkPreparationRepositoryShape["markDispatched"] = (id, now) =>
    sql`
      UPDATE work_preparation_jobs
      SET dispatched_at = COALESCE(dispatched_at, ${now}), updated_at = ${now}
      WHERE job_id = ${id} AND status = 'completed'
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("WorkPreparationRepository.markDispatched")),
    );

  const listArtifacts: WorkPreparationRepositoryShape["listArtifacts"] = (id) =>
    sql<SqlRow>`
      SELECT
        artifact_id AS id, thread_id AS "threadId", project_id AS "projectId",
        attachment_id AS "attachmentId", original_name AS "originalName",
        content_hash AS "contentHash", detected_media_type AS "detectedMediaType",
        size_bytes AS "sizeBytes", extraction_method AS "extractionMethod",
        blocks_json AS blocks, warnings_json AS warnings, schema_version AS "schemaVersion",
        engine_version AS "engineVersion", created_at AS "createdAt"
      FROM document_artifacts
      WHERE job_id = ${id}
      ORDER BY created_at, artifact_id
    `.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeArtifactRow(row))),
      Effect.mapError(
        sqlOrDecodeError(
          "WorkPreparationRepository.listArtifacts",
          "WorkPreparationRepository.listArtifacts.decode",
        ),
      ),
    );

  const listRecentArtifactsForThread: WorkPreparationRepositoryShape["listRecentArtifactsForThread"] =
    (threadId) =>
      sql<SqlRow>`
        SELECT
          artifact_id AS id, thread_id AS "threadId", project_id AS "projectId",
          attachment_id AS "attachmentId", original_name AS "originalName",
          content_hash AS "contentHash", detected_media_type AS "detectedMediaType",
          size_bytes AS "sizeBytes", extraction_method AS "extractionMethod",
          blocks_json AS blocks, warnings_json AS warnings, schema_version AS "schemaVersion",
          engine_version AS "engineVersion", created_at AS "createdAt"
        FROM document_artifacts
        WHERE thread_id = ${threadId}
        ORDER BY created_at DESC, artifact_id DESC
        LIMIT 20
      `.pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeArtifactRow(row))),
        Effect.mapError(
          sqlOrDecodeError(
            "WorkPreparationRepository.listRecentArtifactsForThread",
            "WorkPreparationRepository.listRecentArtifactsForThread.decode",
          ),
        ),
      );

  return {
    enqueue,
    recover,
    claim,
    complete,
    fail,
    deferForInput,
    resumeNeedsInput,
    markDispatched,
    get: selectById,
    listArtifacts,
    listRecentArtifactsForThread,
  } satisfies WorkPreparationRepositoryShape;
});

export const WorkPreparationRepositoryLive = Layer.effect(WorkPreparationRepository, make);
