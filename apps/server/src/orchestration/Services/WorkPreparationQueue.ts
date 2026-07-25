// FILE: WorkPreparationQueue.ts
// Purpose: Separate persisted preparation worker contract for DJL Work turns.

import type {
  ChatAttachment,
  OrchestrationEvent,
  OrchestrationMessage,
  ProjectId,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type {
  WorkPreparationJobRecord,
  WorkPreparationRepositoryError,
} from "../../persistence/Services/WorkPreparationRepository.ts";

export interface EnqueueWorkTurnPreparationInput {
  readonly event: Extract<OrchestrationEvent, { type: "thread.turn-start-requested" }>;
  readonly projectId: ProjectId;
  readonly message: Pick<OrchestrationMessage, "id" | "text" | "attachments">;
}

export interface PreparedWorkTurn {
  readonly job: WorkPreparationJobRecord;
}

export interface WorkPreparationQueueShape {
  readonly start: Effect.Effect<void, WorkPreparationRepositoryError>;
  readonly enqueue: (
    input: EnqueueWorkTurnPreparationInput,
  ) => Effect.Effect<void, WorkPreparationRepositoryError>;
  readonly markDispatched: (
    id: string,
    now: string,
  ) => Effect.Effect<void, WorkPreparationRepositoryError>;
  readonly resumeNeedsInput: Effect.Effect<void, WorkPreparationRepositoryError>;
  readonly streamCompleted: Stream.Stream<PreparedWorkTurn>;
  readonly drain: Effect.Effect<void>;
}

export class WorkPreparationQueue extends ServiceMap.Service<
  WorkPreparationQueue,
  WorkPreparationQueueShape
>()("synara/orchestration/Services/WorkPreparationQueue") {}

export type WorkPreparationAttachment = Extract<ChatAttachment, { type: "file" | "image" }>;
