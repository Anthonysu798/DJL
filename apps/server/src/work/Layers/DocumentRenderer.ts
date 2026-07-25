// Live native document renderer: signed component lifecycle plus restart-safe render jobs.

import { createPublicKey } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import type { DocumentRenderEvent, DocumentRendererStatus } from "@synara/contracts";
import { Effect, Layer, PubSub, Stream } from "effect";

import { ServerConfig } from "../../config";
import { DocumentRenderManager } from "../documentRenderer";
import {
  DocumentRendererSidecarManager,
  type SignedDocumentRendererReleaseManifest,
} from "../documentRendererSidecar";
import {
  DocumentRenderer,
  DocumentRendererServiceError,
  type DocumentRendererShape,
} from "../Services/DocumentRenderer";

const MAX_MANIFEST_BYTES = 256 * 1024;

function serviceError(operation: string, cause: unknown): DocumentRendererServiceError {
  return new DocumentRendererServiceError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const events = yield* PubSub.unbounded<DocumentRenderEvent>();
  // The explicit override exists only for local development and the isolated Electron gate.
  const configuredOverride = process.env.DJL_DOCUMENT_RENDERER_BINARY_PATH?.trim() ?? "";
  const overridePath = configuredOverride ? path.resolve(configuredOverride) : null;
  const manifestUrl = process.env.DJL_DOCUMENT_RENDERER_MANIFEST_URL?.trim() ?? "";
  const publicKeyPem = process.env.DJL_DOCUMENT_RENDERER_MANIFEST_PUBLIC_KEY_PEM?.trim() ?? "";
  const installAvailable = manifestUrl.startsWith("https://") && publicKeyPem.length > 0;
  const declaredDownloadSize = Number(process.env.DJL_DOCUMENT_RENDERER_DOWNLOAD_SIZE_BYTES ?? "");
  let installing = false;
  let sidecar: DocumentRendererSidecarManager | null = null;
  if (publicKeyPem) {
    try {
      sidecar = new DocumentRendererSidecarManager({
        componentRoot: path.join(config.stateDir, "document-renderer", "component"),
        manifestPublicKey: createPublicKey(publicKeyPem),
      });
    } catch {
      sidecar = null;
    }
  }

  const overrideRenderer = async () => {
    if (!overridePath)
      throw new Error("Install the local document viewer to preview Office files.");
    const resolved = await realpath(overridePath).catch(() => null);
    const info = resolved ? await lstat(resolved).catch(() => null) : null;
    if (!resolved || !info?.isFile() || info.isSymbolicLink()) {
      throw new Error("The configured local document viewer executable is unavailable.");
    }
    return {
      binaryPath: resolved,
      version: process.env.DJL_DOCUMENT_RENDERER_VERSION?.trim() || "libreoffice-local",
    };
  };

  const renderer = async () => (overridePath ? overrideRenderer() : sidecar!.renderer());
  const renderManager = new DocumentRenderManager({
    stateRoot: path.join(config.stateDir, "document-renderer", "renders"),
    renderer,
    onEvent: async (event) => {
      await Effect.runPromise(PubSub.publish(events, event));
    },
  });

  const unavailable: DocumentRendererStatus = {
    state: "unavailable",
    installAvailable: false,
    version: null,
    rendererVersion: null,
    detail: "This DJL build has no trusted document-viewer release configured.",
  };

  const status: DocumentRendererShape["status"] = Effect.tryPromise(async () => {
    if (installing) {
      return {
        state: "installing" as const,
        installAvailable,
        version: null,
        rendererVersion: null,
        ...(Number.isSafeInteger(declaredDownloadSize) && declaredDownloadSize > 0
          ? { downloadSizeBytes: declaredDownloadSize }
          : {}),
        detail: "Installing the local document viewer…",
      };
    }
    if (overridePath) {
      try {
        const local = await overrideRenderer();
        return {
          state: "ready" as const,
          installAvailable: false,
          version: local.version,
          rendererVersion: local.version,
          detail: "Using an explicitly configured local viewer for development.",
        };
      } catch (cause) {
        return {
          state: "unhealthy" as const,
          installAvailable: false,
          version: null,
          rendererVersion: null,
          detail: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }
    if (!sidecar) return unavailable;
    const current = await sidecar.status();
    if (current.state === "not_installed") {
      return {
        state: "not_installed" as const,
        installAvailable,
        version: null,
        rendererVersion: null,
        ...(Number.isSafeInteger(declaredDownloadSize) && declaredDownloadSize > 0
          ? { downloadSizeBytes: declaredDownloadSize }
          : {}),
        detail: installAvailable
          ? "Install the local document viewer to preview Office files."
          : "No trusted document-viewer download is configured.",
      };
    }
    return {
      state: current.state,
      installAvailable,
      version: current.version,
      rendererVersion: current.rendererVersion,
      detail: current.detail ?? null,
    };
  }).pipe(Effect.orElseSucceed(() => unavailable));

  const loadManifest = Effect.tryPromise({
    try: async () => {
      if (!installAvailable) throw new Error("No trusted document-viewer release is configured.");
      const response = await fetch(manifestUrl, {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Manifest request returned HTTP ${response.status}.`);
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) {
        throw new Error("The document-viewer release manifest is too large.");
      }
      return JSON.parse(text) as SignedDocumentRendererReleaseManifest;
    },
    catch: (cause) => serviceError("loadManifest", cause),
  });

  const installOrRepair = (operation: "install" | "repair") =>
    Effect.gen(function* () {
      if (!sidecar || overridePath) {
        return yield* serviceError(
          operation,
          new Error("Document viewer installation is unavailable."),
        );
      }
      const manifest = yield* loadManifest;
      installing = true;
      const installed = yield* Effect.tryPromise({
        try: () => sidecar![operation](manifest),
        catch: (cause) => serviceError(operation, cause),
      }).pipe(Effect.ensuring(Effect.sync(() => (installing = false))));
      return {
        state: installed.state,
        installAvailable,
        version: installed.state === "not_installed" ? null : installed.version,
        rendererVersion: installed.state === "not_installed" ? null : installed.rendererVersion,
        detail: installed.state === "unhealthy" ? (installed.detail ?? null) : null,
      } satisfies DocumentRendererStatus;
    });

  const tryManager = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => serviceError(operation, cause) });

  return {
    status,
    install: installOrRepair("install"),
    repair: installOrRepair("repair"),
    uninstall: sidecar ? tryManager("uninstall", () => sidecar!.uninstall()) : Effect.void,
    requestRender: (input) =>
      tryManager("requestRender", () =>
        renderManager.requestRender({
          threadId: input.threadId as never,
          projectId: input.projectId as never,
          filePath: input.filePath,
        }),
      ),
    getRender: (input) =>
      tryManager("getRender", () =>
        renderManager.getRender({
          threadId: input.threadId as never,
          renderId: input.renderId,
        }),
      ),
    cancelRender: (input) =>
      tryManager("cancelRender", () =>
        renderManager.cancelRender({
          threadId: input.threadId as never,
          renderId: input.renderId,
        }),
      ),
    events: Stream.fromPubSub(events),
  } satisfies DocumentRendererShape;
});

export const DocumentRendererLive = Layer.effect(DocumentRenderer, make);
