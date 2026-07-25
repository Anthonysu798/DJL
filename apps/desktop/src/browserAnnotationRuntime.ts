import * as Crypto from "node:crypto";

import type { WebContents } from "electron";
import {
  BrowserAnnotationCaptureMetadata as BrowserAnnotationCaptureMetadataSchema,
  BrowserAnnotationEvent,
  type BrowserAnnotationCaptureMetadata,
  type BrowserAnnotationCommandInput,
  type BrowserAnnotationEvent as BrowserAnnotationEventType,
  type BrowserAnnotationCaptureInput,
  type ThreadId,
} from "@synara/contracts";
import { Schema } from "effect";
import { annotationBootstrapSource } from "@synara/shared/browserAnnotationBootstrap";

export { annotationBootstrapSource } from "@synara/shared/browserAnnotationBootstrap";

const ANNOTATION_WORLD_NAME = "synara-browser-annotations";
const ANNOTATION_GLOBAL = "__synaraBrowserAnnotations";

export async function withAtomicAnnotationCleanup<T>(
  prepare: () => Promise<void>,
  action: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    await prepare();
    outcome = { ok: true, value: await action() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await cleanup();
  } catch (cleanupError) {
    if (outcome.ok) throw cleanupError;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export function previewExistingTextNodes(
  nodes: Array<{ nodeValue: string | null }>,
  nextText: string,
): () => void {
  const previous = nodes.map((node) => node.nodeValue);
  if (nodes.length > 0) {
    nodes[0]!.nodeValue = nextText;
    for (const node of nodes.slice(1)) node.nodeValue = "";
  }
  return () => nodes.forEach((node, index) => (node.nodeValue = previous[index] ?? null));
}

export function clampDragArea(
  start: { x: number; y: number },
  end: { x: number; y: number },
  viewport: { width: number; height: number },
) {
  const sx = Math.max(0, Math.min(viewport.width, start.x));
  const sy = Math.max(0, Math.min(viewport.height, start.y));
  const ex = Math.max(0, Math.min(viewport.width, end.x));
  const ey = Math.max(0, Math.min(viewport.height, end.y));
  return {
    x: Math.min(sx, ex),
    y: Math.min(sy, ey),
    width: Math.abs(ex - sx),
    height: Math.abs(ey - sy),
  };
}

export function decodeBrowserAnnotationBindingPayload(
  threadId: ThreadId,
  tabId: string,
  payload: string,
): BrowserAnnotationEventType {
  const parsed = JSON.parse(payload) as unknown;
  const candidate =
    typeof parsed === "object" && parsed !== null
      ? { ...(parsed as Record<string, unknown>), threadId, tabId }
      : parsed;
  return Schema.decodeUnknownSync(BrowserAnnotationEvent)(candidate);
}

interface RuntimeEvaluateResult {
  result?: { value?: unknown; description?: string };
  exceptionDetails?: unknown;
}

export class BrowserAnnotationRuntime {
  private readonly bindingName = `__synara_annotation_${Crypto.randomBytes(16).toString("hex")}`;
  private contextId: number | null = null;
  private mainFrameId: string | null = null;
  private scriptIdentifier: string | null = null;
  private bindingAdded = false;
  private listenerAttached = false;
  private desiredEnabled = false;
  private operationQueue: Promise<void> = Promise.resolve();
  private initialized = false;
  private disposeRequested = false;
  private disposed = false;
  private ownsDebuggerAttachment = false;
  private disposePromise: Promise<void> | null = null;
  private readonly handleDebuggerMessage: (
    event: Electron.Event,
    method: string,
    params?: unknown,
  ) => void;

  constructor(
    private readonly webContents: WebContents,
    private readonly threadId: ThreadId,
    private readonly tabId: string,
    private readonly emit: (event: BrowserAnnotationEventType) => void,
    private readonly canDetachOwnedDebugger: () => boolean = () => true,
    private readonly restoreFailureMessage = "browser.restoreCommentingAfterPageChange",
  ) {
    this.handleDebuggerMessage = (_event, method, params) => {
      if (method === "Runtime.executionContextCreated") {
        const context = (
          params as
            | {
                context?: { id?: unknown; name?: unknown; auxData?: { frameId?: unknown } };
              }
            | undefined
        )?.context;
        if (
          context?.name === ANNOTATION_WORLD_NAME &&
          typeof context.id === "number" &&
          this.mainFrameId !== null &&
          context.auxData?.frameId === this.mainFrameId
        ) {
          const contextId = context.id;
          this.contextId = contextId;
          if (this.desiredEnabled) {
            void this.runExclusive(async () => {
              if (!this.desiredEnabled || this.disposeRequested || this.contextId !== contextId)
                return;
              await this.enableReplacementContext(contextId);
            }).catch(() => {
              if (!this.desiredEnabled || this.disposeRequested || this.contextId !== contextId)
                return;
              this.emit({
                type: "runtime-error",
                threadId: this.threadId,
                tabId: this.tabId,
                message: this.restoreFailureMessage,
              });
            });
          }
        }
        return;
      }
      if (method === "Runtime.executionContextDestroyed") {
        const id = (params as { executionContextId?: unknown } | undefined)?.executionContextId;
        if (id === this.contextId) {
          this.contextId = null;
          this.emit({ type: "cancelled", threadId: this.threadId, tabId: this.tabId });
        }
        return;
      }
      if (method === "Runtime.executionContextsCleared") {
        if (this.contextId !== null) {
          this.contextId = null;
          this.emit({ type: "cancelled", threadId: this.threadId, tabId: this.tabId });
        }
        return;
      }
      if (method !== "Runtime.bindingCalled") return;
      const binding = params as { name?: unknown; payload?: unknown; executionContextId?: unknown };
      if (
        binding.name !== this.bindingName ||
        typeof binding.payload !== "string" ||
        this.contextId === null ||
        binding.executionContextId !== this.contextId
      )
        return;
      try {
        this.emit(
          decodeBrowserAnnotationBindingPayload(this.threadId, this.tabId, binding.payload),
        );
      } catch {
        // Website-controlled metadata is untrusted. Invalid or oversized payloads are dropped.
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.disposed) return;
    const debuggerApi = this.webContents.debugger;
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach("1.3");
      this.ownsDebuggerAttachment = true;
    }
    debuggerApi.on("message", this.handleDebuggerMessage);
    this.listenerAttached = true;
    await debuggerApi.sendCommand("Page.enable");
    await debuggerApi.sendCommand("Runtime.enable");
    await debuggerApi.sendCommand("Runtime.addBinding", {
      name: this.bindingName,
      executionContextName: ANNOTATION_WORLD_NAME,
    });
    this.bindingAdded = true;
    const script = (await debuggerApi.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
      source: annotationBootstrapSource(this.bindingName),
      worldName: ANNOTATION_WORLD_NAME,
      includeCommandLineAPI: false,
    })) as { identifier?: string };
    this.scriptIdentifier = script.identifier ?? null;
    await this.createCurrentDocumentWorld();
    this.initialized = true;
  }

  private async createCurrentDocumentWorld(): Promise<void> {
    const tree = (await this.webContents.debugger.sendCommand("Page.getFrameTree")) as {
      frameTree?: { frame?: { id?: string } };
    };
    const frameId = tree.frameTree?.frame?.id;
    if (!frameId) throw new Error("Browser page has no main frame");
    this.mainFrameId = frameId;
    const world = (await this.webContents.debugger.sendCommand("Page.createIsolatedWorld", {
      frameId,
      worldName: ANNOTATION_WORLD_NAME,
      grantUniveralAccess: false,
    })) as { executionContextId?: number };
    this.contextId = world.executionContextId ?? null;
    await this.evaluate(annotationBootstrapSource(this.bindingName));
  }

  private async evaluate(expression: string): Promise<unknown> {
    if (this.contextId === null) await this.createCurrentDocumentWorld();
    const response = (await this.webContents.debugger.sendCommand("Runtime.evaluate", {
      expression,
      contextId: this.contextId,
      returnByValue: true,
      awaitPromise: true,
    })) as RuntimeEvaluateResult;
    if (response.exceptionDetails) {
      throw new Error(response.result?.description ?? "Browser annotation command failed");
    }
    return response.result?.value;
  }

  async command(command: BrowserAnnotationCommandInput["command"]): Promise<void> {
    if (this.disposeRequested) throw new Error("Browser annotation runtime is disposing.");
    if (command.type === "enable") this.desiredEnabled = true;
    if (command.type === "disable") this.desiredEnabled = false;
    await this.runExclusive(async () => {
      await this.initialize();
      await this.evaluate(
        `globalThis[${JSON.stringify(ANNOTATION_GLOBAL)}]?.command(${JSON.stringify(command)})`,
      );
    });
  }

  async capture(
    input: BrowserAnnotationCaptureInput,
    capture: () => Promise<Buffer>,
  ): Promise<{ pngBytes: Buffer; metadata: BrowserAnnotationCaptureMetadata }> {
    if (this.disposeRequested) throw new Error("Browser annotation runtime is disposing.");
    return this.runExclusive(async () => {
      await this.initialize();
      let metadata: BrowserAnnotationCaptureMetadata | null = null;
      const pngBytes = await withAtomicAnnotationCleanup(
        async () => {
          const value = await this.evaluate(
            `globalThis[${JSON.stringify(ANNOTATION_GLOBAL)}]?.prepareCapture(${JSON.stringify(input)})`,
          );
          metadata = Schema.decodeUnknownSync(BrowserAnnotationCaptureMetadataSchema)(value);
        },
        capture,
        () =>
          this.evaluate(`globalThis[${JSON.stringify(ANNOTATION_GLOBAL)}]?.cleanupCapture()`).then(
            () => undefined,
          ),
      );
      if (!metadata) throw new Error("Browser annotation capture metadata is missing.");
      return { pngBytes, metadata };
    });
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposeRequested = true;
    this.desiredEnabled = false;
    this.disposePromise = this.runExclusive(async () => {
      this.disposed = true;
      await this.disposeInternal();
    });
    return this.disposePromise;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.catch(() => undefined).then(operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async enableReplacementContext(contextId: number): Promise<void> {
    const response = (await this.webContents.debugger.sendCommand("Runtime.evaluate", {
      expression: `${annotationBootstrapSource(this.bindingName)}; globalThis[${JSON.stringify(ANNOTATION_GLOBAL)}]?.command({ type: 'enable' })`,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    })) as RuntimeEvaluateResult;
    if (response.exceptionDetails) {
      throw new Error(response.result?.description ?? "Browser annotation enable failed");
    }
  }

  private async disposeInternal(): Promise<void> {
    const debuggerApi = this.webContents.debugger;
    if (!this.webContents.isDestroyed()) {
      if (this.contextId !== null) {
        await debuggerApi
          .sendCommand("Runtime.evaluate", {
            expression: `globalThis[${JSON.stringify(ANNOTATION_GLOBAL)}]?.dispose()`,
            contextId: this.contextId,
            returnByValue: true,
            awaitPromise: true,
          })
          .catch(() => undefined);
      }
      if (this.scriptIdentifier) {
        await debuggerApi
          .sendCommand("Page.removeScriptToEvaluateOnNewDocument", {
            identifier: this.scriptIdentifier,
          })
          .catch(() => undefined);
      }
      if (this.bindingAdded) {
        await debuggerApi
          .sendCommand("Runtime.removeBinding", { name: this.bindingName })
          .catch(() => undefined);
      }
    }
    if (this.listenerAttached) {
      debuggerApi.removeListener("message", this.handleDebuggerMessage);
      this.listenerAttached = false;
    }
    this.contextId = null;
    this.mainFrameId = null;
    this.scriptIdentifier = null;
    this.bindingAdded = false;
    if (
      this.ownsDebuggerAttachment &&
      !this.webContents.isDestroyed() &&
      debuggerApi.isAttached() &&
      this.canDetachOwnedDebugger()
    ) {
      try {
        debuggerApi.detach();
      } catch {
        // Another CDP consumer may have raced with disposal; preserve runtime teardown.
      }
    }
    this.ownsDebuggerAttachment = false;
  }
}
