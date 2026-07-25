// FILE: WorkPreparationRepository.ts
// Purpose: Durable queue and normalized-document persistence contract for DJL Work.

import type {
  ChatAttachment,
  DocumentArtifact,
  OrchestrationEvent,
  ProjectId,
  ThreadId,
  WorkPreparationJobStatus,
} from "@synara/contracts";
import { Option, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export type WorkPreparationRepositoryError = PersistenceSqlError | PersistenceDecodeError;
export type WorkTurnStartPayload = Extract<
  OrchestrationEvent,
  { type: "thread.turn-start-requested" }
>["payload"];

export interface WorkPreparationJobRecord {
  readonly id: string;
  readonly sourceEventId: string;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly messageId: string;
  readonly request: WorkTurnStartPayload;
  readonly messageText: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly status: WorkPreparationJobStatus;
  readonly preparedPrompt: string | null;
  readonly error: string | null;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly dispatchedAt: string | null;
}

export interface EnqueueWorkPreparationInput {
  readonly id: string;
  readonly sourceEventId: string;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly messageId: string;
  readonly request: WorkTurnStartPayload;
  readonly messageText: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly now: string;
}

export interface WorkPreparationRepositoryShape {
  readonly enqueue: (
    input: EnqueueWorkPreparationInput,
  ) => Effect.Effect<WorkPreparationJobRecord, WorkPreparationRepositoryError>;
  readonly recover: () => Effect.Effect<
    ReadonlyArray<WorkPreparationJobRecord>,
    WorkPreparationRepositoryError
  >;
  readonly claim: (
    id: string,
    now: string,
  ) => Effect.Effect<Option.Option<WorkPreparationJobRecord>, WorkPreparationRepositoryError>;
  readonly complete: (
    id: string,
    preparedPrompt: string,
    artifacts: ReadonlyArray<DocumentArtifact>,
    now: string,
  ) => Effect.Effect<void, WorkPreparationRepositoryError>;
  readonly fail: (
    id: string,
    error: string,
    now: string,
  ) => Effect.Effect<void, WorkPreparationRepositoryError>;
  readonly deferForInput: (
    id: string,
    error: string,
    now: string,
  ) => Effect.Effect<void, WorkPreparationRepositoryError>;
  readonly resumeNeedsInput: (
    now: string,
  ) => Effect.Effect<ReadonlyArray<WorkPreparationJobRecord>, WorkPreparationRepositoryError>;
  readonly markDispatched: (
    id: string,
    now: string,
  ) => Effect.Effect<void, WorkPreparationRepositoryError>;
  readonly get: (
    id: string,
  ) => Effect.Effect<Option.Option<WorkPreparationJobRecord>, WorkPreparationRepositoryError>;
  readonly listArtifacts: (
    id: string,
  ) => Effect.Effect<ReadonlyArray<DocumentArtifact>, WorkPreparationRepositoryError>;
  readonly listRecentArtifactsForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<DocumentArtifact>, WorkPreparationRepositoryError>;
}

export class WorkPreparationRepository extends ServiceMap.Service<
  WorkPreparationRepository,
  WorkPreparationRepositoryShape
>()("synara/persistence/Services/WorkPreparationRepository") {}
