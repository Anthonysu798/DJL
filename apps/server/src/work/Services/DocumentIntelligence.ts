// FILE: DocumentIntelligence.ts
// Purpose: Server-owned local OCR lifecycle and recognition contract.

import type { DocumentIntelligenceStatus } from "@synara/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { OcrRecognitionResult } from "../ocrSidecar.ts";

export class DocumentIntelligenceError extends Schema.TaggedErrorClass<DocumentIntelligenceError>()(
  "DocumentIntelligenceError",
  {
    operation: Schema.String,
    code: Schema.Literals([
      "unavailable",
      "not_installed",
      "invalid_manifest",
      "invalid_signature",
      "unsupported_platform",
      "download_failed",
      "hash_mismatch",
      "unhealthy",
      "invalid_output",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DocumentIntelligenceShape {
  readonly status: Effect.Effect<DocumentIntelligenceStatus>;
  readonly install: Effect.Effect<DocumentIntelligenceStatus, DocumentIntelligenceError>;
  readonly repair: Effect.Effect<DocumentIntelligenceStatus, DocumentIntelligenceError>;
  readonly uninstall: Effect.Effect<void, DocumentIntelligenceError>;
  readonly recognize: (
    filePath: string,
  ) => Effect.Effect<OcrRecognitionResult, DocumentIntelligenceError>;
}

export class DocumentIntelligence extends ServiceMap.Service<
  DocumentIntelligence,
  DocumentIntelligenceShape
>()("djl/work/Services/DocumentIntelligence") {}
