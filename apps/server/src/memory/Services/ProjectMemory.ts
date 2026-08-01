import type {
  MemoryContextReference,
  ProjectId,
  ProjectMemoryItem,
  ThreadId,
  TurnId,
} from "@synara/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class ProjectMemoryError extends Schema.TaggedErrorClass<ProjectMemoryError>()(
  "ProjectMemoryError",
  {
    operation: Schema.String,
    code: Schema.Literals(["invalid_path", "io", "index", "conflict", "too_large"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ProjectMemoryCitation {
  readonly path: string;
  readonly title: string;
  readonly score: number;
}

export interface ProjectMemoryRetrieval {
  readonly brief: string;
  readonly citations: ReadonlyArray<ProjectMemoryCitation>;
}

export interface EnsureProjectMemoryInput {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly createdAt: string;
}

export interface RecordProjectTurnInput {
  readonly projectId: ProjectId;
  readonly projectTitle: string;
  readonly projectCreatedAt: string;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly turnId: TurnId | null;
  readonly userText: string;
  readonly assistantText: string;
  readonly completedAt: string;
}

export interface RetrieveProjectMemoryInput {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly query: string;
  readonly maxChars?: number;
}

export interface RetrieveExactProjectMemoryInput {
  readonly projectId: ProjectId;
  readonly references: ReadonlyArray<MemoryContextReference>;
  readonly maxChars?: number;
}

export interface SaveProjectMemoryInput {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly content: string;
}

export interface RenameProjectMemoryInput {
  readonly projectId: ProjectId;
  readonly path: string;
  readonly title: string;
}

export interface DeleteProjectMemoryInput {
  readonly projectId: ProjectId;
  readonly path: string;
}

export interface ProjectMemoryShape {
  readonly start: Effect.Effect<void, ProjectMemoryError>;
  readonly ensureProject: (
    input: EnsureProjectMemoryInput,
  ) => Effect.Effect<string, ProjectMemoryError>;
  readonly recordTurn: (
    input: RecordProjectTurnInput,
  ) => Effect.Effect<
    { readonly path: string; readonly conflictPath: string | null },
    ProjectMemoryError
  >;
  readonly retrieve: (
    input: RetrieveProjectMemoryInput,
  ) => Effect.Effect<ProjectMemoryRetrieval, ProjectMemoryError>;
  readonly retrieveExact: (
    input: RetrieveExactProjectMemoryInput,
  ) => Effect.Effect<ProjectMemoryRetrieval, ProjectMemoryError>;
  readonly list: (
    projectId: ProjectId,
    options?: { readonly includeTaskHistory?: boolean },
  ) => Effect.Effect<ReadonlyArray<ProjectMemoryItem>, ProjectMemoryError>;
  readonly save: (
    input: SaveProjectMemoryInput,
  ) => Effect.Effect<ProjectMemoryItem, ProjectMemoryError>;
  readonly rename: (
    input: RenameProjectMemoryInput,
  ) => Effect.Effect<ProjectMemoryItem, ProjectMemoryError>;
  readonly delete: (input: DeleteProjectMemoryInput) => Effect.Effect<void, ProjectMemoryError>;
  readonly reindexProject: (projectId: ProjectId) => Effect.Effect<void, ProjectMemoryError>;
  readonly vaultRoot: string;
  readonly projectRoot: (projectId: ProjectId) => string;
}

export class ProjectMemory extends ServiceMap.Service<ProjectMemory, ProjectMemoryShape>()(
  "djl/memory/Services/ProjectMemory",
) {}
