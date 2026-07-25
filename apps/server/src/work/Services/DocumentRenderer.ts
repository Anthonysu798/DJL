// Effect service contract for the local native Office/PDF renderer.

import type {
  DocumentRenderEvent,
  DocumentRendererStatus,
  WorkCancelDocumentRenderResult,
  WorkGetDocumentRenderResult,
  WorkRequestDocumentRenderResult,
} from "@synara/contracts";
import { Schema, ServiceMap, type Effect, type Stream } from "effect";

export class DocumentRendererServiceError extends Schema.TaggedErrorClass<DocumentRendererServiceError>()(
  "DocumentRendererServiceError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DocumentRendererShape {
  readonly status: Effect.Effect<DocumentRendererStatus>;
  readonly install: Effect.Effect<DocumentRendererStatus, DocumentRendererServiceError>;
  readonly repair: Effect.Effect<DocumentRendererStatus, DocumentRendererServiceError>;
  readonly uninstall: Effect.Effect<void, DocumentRendererServiceError>;
  readonly requestRender: (input: {
    readonly threadId: string;
    readonly projectId: string;
    readonly filePath: string;
  }) => Effect.Effect<WorkRequestDocumentRenderResult, DocumentRendererServiceError>;
  readonly getRender: (input: {
    readonly threadId: string;
    readonly renderId: string;
  }) => Effect.Effect<WorkGetDocumentRenderResult, DocumentRendererServiceError>;
  readonly cancelRender: (input: {
    readonly threadId: string;
    readonly renderId: string;
  }) => Effect.Effect<WorkCancelDocumentRenderResult, DocumentRendererServiceError>;
  readonly events: Stream.Stream<DocumentRenderEvent>;
}

export class DocumentRenderer extends ServiceMap.Service<DocumentRenderer, DocumentRendererShape>()(
  "djl/work/Services/DocumentRenderer",
) {}
