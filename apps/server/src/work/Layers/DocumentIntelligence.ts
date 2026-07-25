// FILE: DocumentIntelligence.ts
// Purpose: Local-only document intelligence service backed by the signed OCR sidecar.

import { createPublicKey } from "node:crypto";
import path from "node:path";

import type { DocumentIntelligenceStatus } from "@synara/contracts";
import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import {
  DocumentIntelligence,
  DocumentIntelligenceError,
  type DocumentIntelligenceShape,
} from "../Services/DocumentIntelligence.ts";
import {
  OcrSidecarError,
  OcrSidecarManager,
  type SignedOcrReleaseManifest,
} from "../ocrSidecar.ts";

const MAX_MANIFEST_BYTES = 256 * 1024;

function mapError(operation: string, cause: unknown): DocumentIntelligenceError {
  if (cause instanceof DocumentIntelligenceError) return cause;
  const code = cause instanceof OcrSidecarError ? cause.code : "unhealthy";
  return new DocumentIntelligenceError({
    operation,
    code,
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function publicStatus(
  status:
    | { readonly state: "not_installed" }
    | {
        readonly state: "ready" | "unhealthy";
        readonly version: string;
        readonly engineVersion: string;
        readonly detail?: string;
      },
  installAvailable: boolean,
): DocumentIntelligenceStatus {
  return status.state === "not_installed"
    ? {
        state: "not_installed",
        installAvailable,
        version: null,
        engineVersion: null,
        detail: null,
      }
    : {
        state: status.state,
        installAvailable,
        version: status.version,
        engineVersion: status.engineVersion,
        detail: status.detail ?? null,
      };
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const manifestUrl = process.env.DJL_OCR_MANIFEST_URL?.trim() ?? "";
  const publicKeyPem = process.env.DJL_OCR_MANIFEST_PUBLIC_KEY_PEM?.trim() ?? "";
  const installAvailable = manifestUrl.startsWith("https://") && publicKeyPem.length > 0;
  let manager: OcrSidecarManager | null = null;
  if (publicKeyPem.length > 0) {
    try {
      manager = new OcrSidecarManager({
        componentRoot: path.join(config.stateDir, "document-intelligence"),
        manifestPublicKey: createPublicKey(publicKeyPem),
      });
    } catch {
      manager = null;
    }
  }

  const unavailableStatus: DocumentIntelligenceStatus = {
    state: "unavailable",
    installAvailable: false,
    version: null,
    engineVersion: null,
    detail: "This DJL build has no trusted document-intelligence release configured.",
  };

  const loadManifest = Effect.tryPromise({
    try: async () => {
      if (!installAvailable) {
        throw new DocumentIntelligenceError({
          operation: "loadManifest",
          code: "unavailable",
          detail: unavailableStatus.detail ?? "Document intelligence is unavailable.",
        });
      }
      const response = await fetch(manifestUrl, {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Manifest request returned HTTP ${response.status}.`);
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) {
        throw new Error("The OCR release manifest is too large.");
      }
      return JSON.parse(text) as SignedOcrReleaseManifest;
    },
    catch: (cause) => mapError("loadManifest", cause),
  });

  const status: DocumentIntelligenceShape["status"] = manager
    ? Effect.tryPromise(() => manager!.status()).pipe(
        Effect.map((value) => publicStatus(value, installAvailable)),
        Effect.orElseSucceed(() => unavailableStatus),
      )
    : Effect.succeed(unavailableStatus);

  const installOrRepair = (operation: "install" | "repair") =>
    Effect.gen(function* () {
      if (!manager) {
        return yield* mapError(
          operation,
          new OcrSidecarError(
            unavailableStatus.detail ?? "Document intelligence is unavailable.",
            "not_installed",
          ),
        );
      }
      const manifest = yield* loadManifest;
      const result = yield* Effect.tryPromise({
        try: () => manager![operation](manifest),
        catch: (cause) => mapError(operation, cause),
      });
      return publicStatus(result, installAvailable);
    });

  const uninstall: DocumentIntelligenceShape["uninstall"] = manager
    ? Effect.tryPromise({
        try: () => manager!.uninstall(),
        catch: (cause) => mapError("uninstall", cause),
      })
    : Effect.void;

  const recognize: DocumentIntelligenceShape["recognize"] = (filePath) =>
    manager
      ? Effect.tryPromise({
          try: () => manager!.recognize(filePath),
          catch: (cause) => mapError("recognize", cause),
        })
      : Effect.fail(
          new DocumentIntelligenceError({
            operation: "recognize",
            code: "not_installed",
            detail: "Install DJL document intelligence to extract text from this scan.",
          }),
        );

  return {
    status,
    install: installOrRepair("install"),
    repair: installOrRepair("repair"),
    uninstall,
    recognize,
  } satisfies DocumentIntelligenceShape;
});

export const DocumentIntelligenceLive = Layer.effect(DocumentIntelligence, make);
