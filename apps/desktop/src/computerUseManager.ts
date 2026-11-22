import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import {
  decodeComputerUseRequest,
  type ComputerActivityScope,
  decodeComputerUseResponse,
  decodeComputerActivitySummaryCommand,
  type ComputerUseActionType,
  type ComputerUseError,
  type ComputerUseHistoryEvent,
  type ComputerUseHistorySettings,
  type ComputerUseHistoryState,
  type ComputerUseRequest,
  type ComputerUseResponse,
  type ComputerUseSession,
  type ComputerUseStatus,
  type ComputerUseTarget,
} from "@djl/contracts";
import { computerUsePauseDeadline } from "./computerUsePauseDeadline";
import { ComputerUseHistory } from "./computerUseHistory";
import { ComputerActivityRecorder } from "./computerActivityRecorder";
import { ComputerActivitySummaries } from "./computerActivitySummaries";
import { ComputerActivityStream } from "./computerActivityStream";
import type { Readable } from "node:stream";

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_HTTP_BYTES = 128 * 1024;
const MAX_PENDING = 100;
const CLEAR_RECOVERY_REQUIRED =
  "History clear recovery is required. Recording and history processing are stopped.";

export type ComputerUseManagerEvent =
  | { type: "recording-changed" }
  | { type: "thread-stopped"; threadId: string }
  | { type: "show-thread"; threadId: string }
  | { type: "history"; threadId: string; event: ComputerUseHistoryEvent }
  | {
      type: "activity";
      phase: "before" | "after";
      threadId: string;
      sessionId: string;
      target: ComputerUseTarget;
      actionType: ComputerUseActionType;
      acknowledgement?: "dispatched" | "rejected" | "cancelled";
      effect?: "unverified" | "observed-change" | "observed-no-change";
    }
  | { type: "stopped"; threadId: string; sessionId: string; target: ComputerUseTarget };

export interface ComputerUseManagerOptions {
  helperPath: string;
  controlEngine?: "legacy" | "cua";
  historyDirectory: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  terminationTimeoutMs?: number;
  spawnHelper?: (path: string) => ChildProcessWithoutNullStreams;
  /** Internal deterministic clock seam; never exposed through computer-use requests. */
  pauseClock?: {
    now: () => number;
    setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  };
}

type RetiringHelper = {
  child: ChildProcessWithoutNullStreams;
  timer: ReturnType<typeof setTimeout>;
  completion: Promise<void>;
  resolve: () => void;
  graceElapsed: boolean;
};

type Pending = {
  threadId: string;
  request: ComputerUseRequest;
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: ComputerUseResponse) => void;
};
const failure = (
  method: ComputerUseRequest["method"],
  code: ComputerUseError["code"],
  message: string,
): ComputerUseResponse => ({ method, error: { code, message } });
const sameTarget = (a: ComputerUseTarget, b: ComputerUseTarget): boolean =>
  a.bundleId === b.bundleId && a.pid === b.pid && a.windowId === b.windowId;
const validThread = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// This core is Electron-free so process, authorization and cancellation behavior
// can be exercised without granting accessibility permissions or taking actions.
export class ComputerUseManager {
  private readonly history: ComputerUseHistory;
  private readonly activity: ComputerActivityRecorder;
  private readonly summaries: ComputerActivitySummaries;
  private readonly observation: ComputerActivityStream;
  private observationRevision = 0;
  private observationQueue: Promise<void> = Promise.resolve();
  private observationAttempted = false;
  private observationSuspended = false;
  private historyApplyFailed = false;
  private activityClear: { scope: ComputerActivityScope; persisted: boolean } | undefined;
  private historyControlActive = false;
  private recordingRefreshPending = false;
  private stopCancelledPause = false;
  private pauseResumeError: "resume-failed" | undefined;
  private pauseRevision = 0;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pauseClock;
  private readonly activityReaders = new Set<string>();
  private readonly sessions = new Map<string, ComputerUseSession>();
  private readonly epochs = new Map<string, number>();
  private readonly blockedThreads = new Set<string>();
  private globalStopVersion = 0;
  private readonly resumedVersions = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  private readonly retiredIds = new Set<string>();
  private readonly earlyStoppedIds = new Set<string>();
  private readonly listeners = new Set<(event: ComputerUseManagerEvent) => void>();
  private readonly token = randomBytes(32).toString("hex");
  private helper: ChildProcessWithoutNullStreams | undefined;
  private retiringHelper: RetiringHelper | undefined;
  private readonly exitedHelpers = new WeakSet<ChildProcessWithoutNullStreams>();
  private readonly protectedHelpers = new WeakSet<ChildProcessWithoutNullStreams>();
  private readonly inputRequests = new WeakMap<ChildProcessWithoutNullStreams, Set<string>>();
  private buffer = Buffer.alloc(0);
  private queue: Promise<void> = Promise.resolve();
  private queuedCount = 0;
  private readonly activeThreads = new Map<string, number>();
  private server: Server | undefined;
  private endpoint: Promise<{ url: string; token: string }> | undefined;
  private disposed = false;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: ComputerUseManagerOptions) {
    this.platform = options.platform ?? process.platform;
    this.pauseClock = options.pauseClock ?? { now: Date.now, setTimeout, clearTimeout };
    this.history = new ComputerUseHistory(options.historyDirectory);
    const pendingClear = this.history.getPendingActivityClear();
    if (pendingClear !== undefined) this.activityClear = { scope: pendingClear, persisted: true };
    this.activity = new ComputerActivityRecorder({
      directory: join(options.historyDirectory, "activity"),
      settings: this.history.getSettings(),
      onRecorded: () => this.emit({ type: "recording-changed" }),
      capture: async (signal) => {
        if (signal?.aborted || this.disposed) return null;
        const cancel = () => {
          void this.stopOwned("desktop:recorder");
        };
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          const {
            interactionCaptureEnabled: _interaction,
            semanticSummariesEnabled: _semantic,
            ...nativeSettings
          } = this.history.getSettings();
          const response = await this.callHelper("desktop:recorder", {
            method: "activity.capture",
            settings: nativeSettings,
          });
          return !signal?.aborted && response.method === "activity.capture" && "result" in response
            ? response.result
            : null;
        } finally {
          signal?.removeEventListener("abort", cancel);
        }
      },
    });
    this.summaries = new ComputerActivitySummaries({
      directory: join(options.historyDirectory, "activity", "semantic"),
      settings: this.history.getSettings(),
      readEvidence: () => {
        if (this.activityClear || this.disposed) throw new Error(CLEAR_RECOVERY_REQUIRED);
        return this.activity.readEvidence();
      },
      onChanged: () => this.emit({ type: "recording-changed" }),
    });
    if (this.activityClear) {
      this.activity.stop();
      this.summaries.holdActivityClear();
    }
    this.observation = new ComputerActivityStream({
      epoch: () => this.activity.observationEpoch,
      allowed: () => this.observationConsented,
      record: (epoch, record) => this.activity.recordEvent(epoch, record),
      onChanged: () => this.emit({ type: "recording-changed" }),
      onFailure: () => this.suspendObservation(),
    });
  }

  private get observationConsented(): boolean {
    return (
      !this.disposed &&
      !this.historyApplyFailed &&
      !this.activityClear &&
      this.platform === "darwin" &&
      this.activity.interactionCaptureAllowed
    );
  }

  private get observationAllowed(): boolean {
    return this.observationConsented && !this.observationSuspended;
  }

  private suspendObservation(): void {
    this.observationSuspended = true;
    const revision = ++this.observationRevision;
    this.activity.renewObservationEpoch();
    void this.stopOwned("desktop:recorder").then(() => {
      if (revision === this.observationRevision) this.observationAttempted = false;
    });
  }

  private revokeObservation(): void {
    if (this.observationAttempted) void this.stopOwned("desktop:recorder");
  }

  private syncObservation(): void {
    const revision = ++this.observationRevision;
    this.observation.policyChanged();
    this.observationQueue = this.observationQueue.then(async () => {
      if (this.disposed || revision !== this.observationRevision) return;
      const observing = this.observationAllowed;
      if (!observing && !this.observationAttempted) return;
      try {
        if (observing) this.ensureHelper(true);
        if (this.disposed || revision !== this.observationRevision || !this.helper) return;
        const child = this.helper,
          epoch = this.activity.observationEpoch;
        if (observing && !this.observation.hasChannel) {
          this.observation.rejectConfiguration(epoch, "transport-unavailable");
          return;
        }
        this.observationAttempted = true;
        const settings = this.history.getSettings();
        const response = await this.callHelper("desktop:recorder", {
          method: "activity.observe",
          epoch,
          settings: { ...settings, interactionCaptureEnabled: observing },
        });
        if (
          this.disposed ||
          revision !== this.observationRevision ||
          child !== this.helper ||
          epoch !== this.activity.observationEpoch
        )
          return;
        if (
          response.method !== "activity.observe" ||
          "error" in response ||
          response.result.epoch !== epoch ||
          (!observing && response.result.observing)
        ) {
          this.observation.rejectConfiguration(
            epoch,
            "error" in response && response.error.code === "permission-denied"
              ? "permission-denied"
              : "capture-failed",
          );
          this.suspendObservation();
          return;
        }
        this.observationAttempted = observing;
        this.observation.acknowledge(epoch, response.result.observing);
      } catch {
        this.observation.rejectConfiguration(
          this.activity.observationEpoch,
          "transport-unavailable",
        );
        this.suspendObservation();
      }
    });
  }

  onEvent(listener: (event: ComputerUseManagerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<{ url: string; token: string }> {
    if (this.disposed) return Promise.reject(new Error("Computer-use manager disposed"));
    try {
      this.historyControl(() => {
        this.replayActivityClear();
        if (this.historyApplyFailed) throw new Error("History policy requires human recovery");
        this.reconcilePause();
        if (!this.endpoint && this.platform === "darwin") {
          this.activity.start();
          this.syncObservation();
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.endpoint) return this.endpoint;
    this.server = createServer((request, response) => {
      void this.handleHttp(request, response);
    });
    this.server.requestTimeout = 15_000;
    this.server.headersTimeout = 10_000;
    const server = this.server;
    this.endpoint = new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("No localhost address"));
          return;
        }
        resolve({ url: `http://127.0.0.1:${address.port}/computer-use`, token: this.token });
      });
    });
    return this.endpoint;
  }

  async request(
    threadId: string,
    input: unknown,
    context: { origin: "agent" | "renderer" },
  ): Promise<ComputerUseResponse> {
    let request: ComputerUseRequest;
    try {
      request = decodeComputerUseRequest(input);
    } catch {
      return failure("status", "invalid-request", "Invalid computer-use request");
    }
    if (!validThread(threadId))
      return failure(request.method, "invalid-request", "Invalid thread identity");
    if (this.disposed)
      return failure(request.method, "helper-unavailable", "Computer-use manager disposed");
    if (this.options.controlEngine === "cua" && request.method.startsWith("session."))
      return failure(
        request.method,
        "unsupported",
        "Legacy desktop control is disabled while the Cua engine is selected; no action was dispatched.",
      );
    if (request.method === "permissions.request" && context.origin !== "renderer")
      return failure(
        request.method,
        "permission-denied",
        "System permission prompts require a human desktop action",
      );
    if (this.platform !== "darwin") {
      if (request.method === "status" || request.method === "permissions.request") {
        const result: ComputerUseStatus = {
          platform:
            this.platform === "win32" || this.platform === "linux" ? this.platform : "unsupported",
          available: false,
          permissions: { accessibility: "unsupported", screenRecording: "unsupported" },
          capabilities: {
            observation: false,
            screenshots: false,
            backgroundActions: [],
            virtualCursor: false,
            passiveHistory: false,
          },
          message: "Native computer use currently requires macOS 14.4 or newer",
        };
        return request.method === "status"
          ? { method: "status", result }
          : { method: "permissions.request", result };
      }
      if (
        (!request.method.startsWith("history.") &&
          request.method !== "activity.list" &&
          request.method !== "activity.clear" &&
          request.method !== "stop") ||
        request.method === "history.configure" ||
        request.method === "history.pause"
      )
        return failure(
          request.method,
          "unsupported",
          "Native computer use currently requires macOS 14.4 or newer",
        );
    }
    try {
      if (request.method.startsWith("activity."))
        return this.activityRequest(threadId, request, context.origin);
      if (request.method.startsWith("history."))
        return this.historyRequest(threadId, request, context.origin);
      if (request.method === "stop") {
        if (request.sessionId && !this.ownedSession(threadId, request.sessionId))
          return this.unauthorized(request);
        return context.origin === "renderer" && !request.sessionId
          ? await this.stopAll(true)
          : await this.stopOwned(threadId, request.sessionId);
      }
      if (request.method === "session.open" && this.threadBlocked(threadId))
        return failure(
          request.method,
          "cancelled",
          "Computer use stopped until the next user turn",
        );
      if ("sessionId" in request && !this.ownedSession(threadId, request.sessionId))
        return this.unauthorized(request);
      if (
        request.method === "status" ||
        request.method === "apps.list" ||
        request.method === "permissions.request"
      ) {
        const response = await this.callHelper(threadId, request);
        return response;
      }
      if (this.queuedCount >= MAX_PENDING)
        return failure(request.method, "internal", "Computer-use queue is full");
      const epoch = this.epochs.get(threadId) ?? 0;
      this.epochs.set(threadId, epoch);
      this.queuedCount++;
      this.activeThreads.set(threadId, (this.activeThreads.get(threadId) ?? 0) + 1);
      const operation = this.queue.then(async () => {
        this.queuedCount--;
        if (this.disposed || epoch !== (this.epochs.get(threadId) ?? 0))
          return failure(request.method, "cancelled", "Computer-use operation stopped");
        if ("sessionId" in request && !this.ownedSession(threadId, request.sessionId))
          return failure(request.method, "cancelled", "Computer-use session stopped");
        return this.execute(threadId, request);
      });
      const complete = () => {
        const remaining = (this.activeThreads.get(threadId) ?? 1) - 1;
        if (remaining) this.activeThreads.set(threadId, remaining);
        else this.activeThreads.delete(threadId);
      };
      this.queue = operation.then(complete, complete);
      return await operation;
    } catch {
      return failure(request.method, "internal", "Computer-use operation failed");
    }
  }

  stopThread(threadId: string): Promise<ComputerUseResponse> {
    return this.request(threadId, { method: "stop" }, { origin: "agent" });
  }

  // Called only by the trusted host when dispatching a genuine new user turn.
  // This is deliberately absent from ComputerUseRequest and renderer IPC.
  resumeThread(threadId: string, options: { allowActivityHistory?: boolean } = {}): void {
    if (!validThread(threadId) || this.disposed) throw new Error("Invalid computer-use turn start");
    this.blockedThreads.delete(threadId);
    this.resumedVersions.set(threadId, this.globalStopVersion);
    if (options.allowActivityHistory === true) this.activityReaders.add(threadId);
    else this.activityReaders.delete(threadId);
  }

  private threadBlocked(threadId: string): boolean {
    return (
      this.blockedThreads.has(threadId) ||
      (this.resumedVersions.get(threadId) ?? 0) < this.globalStopVersion
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPauseTimer();
    const stopped = this.stopAll();
    this.activity.dispose();
    this.observationRevision++;
    this.observation.detach();
    try {
      this.summaries.dispose();
    } catch {
      // Leases invalidate before persistence; native Stop must still finish.
    }
    this.activityReaders.clear();
    this.failHelper("helper-unavailable", "Computer-use manager disposed");
    this.listeners.clear();
    this.epochs.clear();
    const server = this.server;
    this.server = undefined;
    if (server) {
      await this.endpoint?.catch(() => undefined);
      if (server.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    await stopped;
    await this.queue;
    await this.observationQueue;
    await this.retiringHelper?.completion;
    this.activeThreads.clear();
    this.blockedThreads.clear();
    this.resumedVersions.clear();
  }

  private ownedSession(threadId: string, sessionId: string): ComputerUseSession | undefined {
    const session = this.sessions.get(sessionId);
    return session?.threadId === threadId ? session : undefined;
  }

  private unauthorized(request: ComputerUseRequest): ComputerUseResponse {
    return failure(request.method, "unauthorized-session", "Session is not owned by this thread");
  }

  private historyRequest(
    threadId: string,
    request: ComputerUseRequest,
    origin: "agent" | "renderer",
  ): ComputerUseResponse {
    if (
      origin !== "renderer" &&
      (request.method !== "history.list" || request.source === "passive")
    ) {
      return failure(
        request.method,
        "permission-denied",
        "History controls require a human desktop action",
      );
    }
    if (this.historyControlActive) throw new Error(CLEAR_RECOVERY_REQUIRED);
    switch (request.method) {
      case "history.settings":
        if (this.activityClear) return failure(request.method, "internal", CLEAR_RECOVERY_REQUIRED);
        return { method: request.method, result: this.historyState() };
      case "history.configure": {
        const state = this.historyControl(() => {
          this.replayActivityClear();
          return this.applyHistory(request.settings);
        });
        return { method: request.method, result: state };
      }
      case "history.pause": {
        return this.historyControl(() => {
          this.replayActivityClear();
          const settings = this.history.getSettings();
          if (request.action !== "resume" && request.action !== "indefinite" && !settings.enabled)
            return failure(
              request.method,
              "invalid-request",
              "Recording must be enabled before a timed pause",
            );
          const deadline =
            request.action === "resume" || request.action === "indefinite"
              ? null
              : computerUsePauseDeadline(request.action, this.pauseClock.now());
          const state = this.applyHistory(
            { ...settings, paused: request.action !== "resume" },
            deadline,
          );
          return { method: request.method, result: state };
        });
      }
      case "history.clear":
        return {
          method: request.method,
          result: {
            deletedCount: this.historyControl(() => {
              this.replayActivityClear();
              return this.history.clear(request.source);
            }),
          },
        };
      case "history.list":
        return {
          method: request.method,
          result: this.history.list({
            ...(origin === "agent"
              ? { threadId, source: "agent" as const }
              : request.source
                ? { source: request.source }
                : {}),
            ...(request.cursor ? { cursor: request.cursor } : {}),
            ...(request.limit ? { limit: request.limit } : {}),
          }),
        };
      default:
        return failure(request.method, "invalid-request", "Invalid history operation");
    }
  }

  private historyControl<T>(operation: () => T): T {
    if (this.historyControlActive || this.disposed) throw new Error(CLEAR_RECOVERY_REQUIRED);
    this.historyControlActive = true;
    try {
      return operation();
    } finally {
      this.historyControlActive = false;
      if (this.recordingRefreshPending) {
        this.recordingRefreshPending = false;
        this.emit({ type: "recording-changed" });
      }
    }
  }

  private fenceActivityClear(): void {
    this.cancelPauseTimer();
    this.activity.stop();
    this.observationRevision++;
    this.summaries.holdActivityClear();
    this.revokeObservation();
    this.emit({ type: "recording-changed" });
  }

  private replayActivityClear(): number {
    const pending = this.activityClear;
    if (!pending) return 0;
    this.fenceActivityClear();
    if (this.disposed) throw new Error(CLEAR_RECOVERY_REQUIRED);
    if (!pending.persisted) {
      this.history.beginActivityClear(pending.scope);
      pending.persisted = true;
    }
    if (this.disposed) throw new Error(CLEAR_RECOVERY_REQUIRED);
    let removed = this.activity.clear(pending.scope);
    if (this.disposed) throw new Error(CLEAR_RECOVERY_REQUIRED);
    removed += this.summaries.clear(pending.scope);
    if (this.disposed) throw new Error(CLEAR_RECOVERY_REQUIRED);
    if (this.stopCancelledPause) {
      this.history.configure({ ...this.history.getSettings(), paused: true }, null);
      this.stopCancelledPause = false;
    }
    this.history.finishActivityClear(pending.scope);
    if (this.disposed) throw new Error(CLEAR_RECOVERY_REQUIRED);
    this.activityClear = undefined;
    this.summaries.releaseActivityClear();
    // Deletion has committed. Restoration failure is an independent policy failure,
    // and must not turn this confirmed deletion into an unsuccessful response.
    try {
      const settings = this.history.getSettings();
      this.summaries.configure(this.historyApplyFailed ? { ...settings, paused: true } : settings);
      if (!this.historyApplyFailed && !this.disposed) {
        this.activity.configure(settings);
        this.reconcilePause();
        if (this.platform === "darwin") this.activity.start();
        this.observationSuspended = false;
        this.syncObservation();
      }
    } catch {
      this.historyApplyFailed = true;
      this.cancelPauseTimer();
      this.activity.stop();
      try {
        this.summaries.configure({ ...this.history.getSettings(), paused: true });
      } catch {
        /* runtime settings pause before persistence */
      }
    }
    this.emit({ type: "recording-changed" });
    return removed;
  }

  private historyState(): ComputerUseHistoryState {
    const state = this.history.getState();
    if (this.historyApplyFailed) {
      const { pauseResumeAt: _unarmedDeadline, ...settings } = state;
      return {
        ...settings,
        paused: true,
        ...(this.pauseResumeError ? { pauseResumeError: this.pauseResumeError } : {}),
      };
    }
    return state;
  }

  private cancelPauseTimer(): void {
    this.pauseRevision++;
    if (this.pauseTimer !== undefined) this.pauseClock.clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
  }

  private armPause(): void {
    const state = this.history.getState();
    if (
      this.disposed ||
      this.platform !== "darwin" ||
      this.historyApplyFailed ||
      this.activityClear !== undefined ||
      !state.pauseResumeAt ||
      !state.enabled ||
      !state.paused
    )
      return;
    const revision = this.pauseRevision;
    const deadline = state.pauseResumeAt;
    // A single bounded wake check also notices sleep and forward wall-clock changes.
    const delay = Math.max(1, Math.min(3_600_000, Date.parse(deadline) - this.pauseClock.now()));
    this.pauseTimer = this.pauseClock.setTimeout(() => {
      if (
        this.disposed ||
        this.activityClear ||
        this.historyControlActive ||
        revision !== this.pauseRevision
      )
        return;
      this.pauseTimer = undefined;
      const current = this.history.getState();
      if (current.pauseResumeAt !== deadline || !current.enabled || !current.paused) return;
      if (this.pauseClock.now() < Date.parse(deadline)) {
        this.armPause();
        return;
      }
      try {
        this.historyControl(() =>
          this.applyHistory({ ...this.history.getSettings(), paused: false }, null, true),
        );
      } catch {
        // Fixed truthful status, no raw diagnostic or automatic retry after failure.
        this.pauseResumeError = "resume-failed";
        this.emit({ type: "recording-changed" });
      }
    }, delay);
    this.pauseTimer.unref?.();
  }

  private reconcilePause(): void {
    if (this.platform !== "darwin" || this.activityClear) return;
    const state = this.history.getState();
    if (!state.pauseResumeAt) return;
    if (Date.parse(state.pauseResumeAt) <= this.pauseClock.now()) {
      try {
        this.applyHistory({ ...this.history.getSettings(), paused: false }, null, true);
      } catch (error) {
        this.pauseResumeError = "resume-failed";
        throw error;
      }
    } else {
      this.cancelPauseTimer();
      this.armPause();
    }
  }

  private applyHistory(
    settings: ComputerUseHistorySettings,
    deadline?: string | null,
    automatic = false,
  ): ComputerUseHistoryState {
    this.cancelPauseTimer();
    const previous = this.history.getState();
    const previousSettings = this.history.getSettings();
    this.historyApplyFailed = true;
    this.activity.stop();
    this.revokeObservation();
    try {
      this.summaries.configure({ ...previousSettings, paused: true });
      this.history.configure(settings, deadline);
      // Read settings-only after commit: scheduling/error metadata never goes native.
      if (this.stopCancelledPause) {
        this.history.configure({ ...this.history.getSettings(), paused: true }, null);
        this.stopCancelledPause = false;
      }
      const committed = this.history.getSettings();
      this.activity.configure(committed);
      this.summaries.configure(committed);
      this.activity.start();
      this.historyApplyFailed = false;
      this.pauseResumeError = undefined;
      this.observationSuspended = false;
      this.armPause();
      this.emit({ type: "recording-changed" });
      return this.historyState();
    } catch (error) {
      this.historyApplyFailed = true;
      this.activity.stop();
      try {
        this.summaries.configure({ ...previousSettings, paused: true });
      } catch {
        /* generation invalidates before write */
      }
      try {
        // Automatic failure must remain visibly paused even if the policy apply failed after commit.
        this.history.configure(
          automatic ? { ...previousSettings, paused: true } : previousSettings,
          previous.pauseResumeAt ?? null,
        );
      } catch {
        /* runtime remains fenced, regardless of disk failure */
      }
      throw error;
    } finally {
      this.syncObservation();
    }
  }

  private activityRequest(
    threadId: string,
    request: ComputerUseRequest,
    origin: "agent" | "renderer",
  ): ComputerUseResponse {
    // Capture has a native protocol shape, but no public caller may trigger it
    // or supply a different recording policy. Only the host timer invokes it.
    if (request.method === "activity.capture" || request.method === "activity.observe")
      return failure(
        request.method,
        "permission-denied",
        "Activity capture is owned by the desktop recorder",
      );
    if (request.method === "activity.clear") {
      if (origin !== "renderer")
        return failure(
          request.method,
          "permission-denied",
          "History controls require a human desktop action",
        );
      const { method: _method, ...scope } = request;
      return this.historyControl(() => {
        const previousScope = this.activityClear?.scope;
        const recovered = this.replayActivityClear();
        const sameScope =
          previousScope !== undefined &&
          (["since", "until", "bundleId"] as const).every(
            (field) => previousScope[field] === scope[field],
          );
        if (!sameScope) {
          this.activityClear = { scope: structuredClone(scope), persisted: false };
        }
        const deletedCount = sameScope ? recovered : this.replayActivityClear();
        return { method: request.method, result: { deletedCount } };
      });
    }
    if (request.method !== "activity.list")
      return failure(request.method, "invalid-request", "Invalid activity operation");
    if (origin === "agent" && !this.activityReaders.has(threadId))
      return failure(
        request.method,
        "permission-denied",
        "Select the computer-history skill for this user turn",
      );
    if (this.activityClear || this.historyControlActive)
      return failure(request.method, "internal", CLEAR_RECOVERY_REQUIRED);
    const scope = {
      ...(request.since ? { since: request.since } : {}),
      ...(request.until ? { until: request.until } : {}),
      ...(request.bundleId ? { bundleId: request.bundleId } : {}),
    };
    const semantic = this.summaries.list({
      ...scope,
      ...(request.limit ? { limit: request.limit } : {}),
      ...(request.semanticCursor ? { cursor: request.semanticCursor } : {}),
    });
    const includeSemantic =
      this.history.getSettings().semanticSummariesEnabled === true ||
      semantic.summaries.length > 0 ||
      semantic.status.lastFailure !== undefined;
    return {
      method: request.method,
      result: {
        ...this.activity.list({
          ...scope,
          ...(request.cursor ? { cursor: request.cursor } : {}),
          ...(request.limit ? { limit: request.limit } : {}),
        }),
        ...(includeSemantic
          ? {
              semanticSummaries: semantic.summaries,
              semanticStatus: semantic.status,
              ...(semantic.nextCursor ? { nextSemanticCursor: semantic.nextCursor } : {}),
            }
          : {}),
        ...(this.history.getSettings().interactionCaptureEnabled === true
          ? { interactionStatus: this.observation.status }
          : {}),
      },
    };
  }

  private async execute(
    threadId: string,
    request: ComputerUseRequest,
  ): Promise<ComputerUseResponse> {
    const session =
      "sessionId" in request && request.sessionId
        ? this.sessions.get(request.sessionId)
        : undefined;
    if (request.method === "session.open" && this.sessions.size >= 100)
      return failure(request.method, "internal", "Too many computer-use sessions");
    if (request.method === "session.perform" && session)
      this.emit({
        type: "activity",
        phase: "before",
        threadId,
        sessionId: session.sessionId,
        target: session.target,
        actionType: request.action.type,
      });
    const response = await this.callHelper(threadId, request);
    if (response.method === "session.open" && "result" in response) {
      // receiveFrame publishes identity before resolving the response, so a
      // stopped event later in the same stdout chunk can revoke it synchronously.
      if (!this.ownedSession(threadId, response.result.sessionId))
        return failure(request.method, "cancelled", "Computer-use session stopped");
    } else if (request.method === "session.perform" && session) {
      const outcome =
        response.method === "session.perform" && "result" in response
          ? { acknowledgement: response.result.acknowledgement, effect: response.result.effect }
          : {
              acknowledgement:
                "error" in response && response.error.code === "cancelled"
                  ? ("cancelled" as const)
                  : ("rejected" as const),
              effect: "unverified" as const,
            };
      this.record(threadId, {
        type: "action",
        sessionId: session.sessionId,
        target: session.target,
        actionType: request.action.type,
        ...outcome,
      });
      this.emit({
        type: "activity",
        phase: "after",
        threadId,
        sessionId: session.sessionId,
        target: session.target,
        actionType: request.action.type,
        ...outcome,
      });
    } else if (
      response.method === "session.close" &&
      "result" in response &&
      response.result.closed &&
      session
    ) {
      this.sessions.delete(session.sessionId);
      this.record(threadId, {
        type: "session-closed",
        sessionId: session.sessionId,
        target: session.target,
      });
    }
    return response;
  }

  private async stopAll(blockNewThreads = false): Promise<ComputerUseResponse> {
    if (blockNewThreads) {
      this.globalStopVersion++;
      if (this.history.getState().pauseResumeAt) {
        this.cancelPauseTimer();
        if (this.activityClear || this.historyControlActive) {
          this.stopCancelledPause = true;
          this.activity.stop();
          this.observationRevision++;
          this.revokeObservation();
        } else
          try {
            this.historyControl(() =>
              this.applyHistory({ ...this.history.getSettings(), paused: true }, null),
            );
          } catch {
            // Timer is cancelled and runtime fenced; owner Stop must still complete.
            this.pauseResumeError = "resume-failed";
          }
      }
    }
    const owners = new Set([
      ...this.activeThreads.keys(),
      ...Array.from(this.sessions.values(), (session) => session.threadId),
      ...Array.from(this.pending.values(), (pending) => pending.threadId),
    ]);
    const results = await Promise.all(Array.from(owners, (owner) => this.stopOwned(owner)));
    const error = results.find((result) => "error" in result);
    if (error) return error;
    return {
      method: "stop",
      result: {
        stoppedSessionIds: results.flatMap((result) =>
          result.method === "stop" && "result" in result ? result.result.stoppedSessionIds : [],
        ),
      },
    };
  }

  private async stopOwned(
    threadId: string,
    sessionId?: string,
    notifyHelper = true,
  ): Promise<ComputerUseResponse> {
    if (!sessionId) {
      this.epochs.set(threadId, (this.epochs.get(threadId) ?? 0) + 1);
      this.blockedThreads.add(threadId);
      this.activityReaders.delete(threadId);
    }
    const owned = [...this.sessions.values()].filter(
      (session) => session.threadId === threadId && (!sessionId || session.sessionId === sessionId),
    );
    for (const [id, pending] of this.pending) {
      if (
        pending.threadId === threadId &&
        (!sessionId || ("sessionId" in pending.request && pending.request.sessionId === sessionId))
      ) {
        this.finish(
          id,
          failure(pending.request.method, "cancelled", "Computer-use operation stopped"),
        );
      }
    }
    // Dispatch before any history I/O. An opening session may not have returned
    // its ID yet; native no-session Stop cancels that envelope thread too.
    const stopped =
      this.helper && notifyHelper
        ? this.callHelper(threadId, { method: "stop", ...(sessionId ? { sessionId } : {}) })
        : Promise.resolve<ComputerUseResponse>({
            method: "stop",
            result: { stoppedSessionIds: [] },
          });
    for (const session of owned) {
      try {
        this.revoke(session);
      } catch {
        /* Disk failure cannot delay native Stop. */
      }
    }
    return stopped;
  }

  private record(
    threadId: string,
    fields: Omit<ComputerUseHistoryEvent, "id" | "source" | "at">,
  ): void {
    const event: ComputerUseHistoryEvent = {
      id: randomUUID(),
      source: "agent",
      at: new Date().toISOString(),
      ...fields,
    };
    this.history.append(threadId, event);
    this.emit({ type: "history", threadId, event });
  }

  private revoke(session: ComputerUseSession): void {
    this.sessions.delete(session.sessionId);
    try {
      this.record(session.threadId, {
        type: "stopped",
        sessionId: session.sessionId,
        target: session.target,
      });
    } finally {
      this.emit({
        type: "stopped",
        threadId: session.threadId,
        sessionId: session.sessionId,
        target: session.target,
      });
    }
  }

  private emit(event: ComputerUseManagerEvent): void {
    if (event.type === "recording-changed" && this.historyControlActive) {
      this.recordingRefreshPending = true;
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(event));
      } catch {
        /* UI listeners cannot break Stop. */
      }
    }
  }

  private callHelper(threadId: string, request: ComputerUseRequest): Promise<ComputerUseResponse> {
    // Public entry is closed before disposal callbacks; internal owner Stop still dispatches.
    if (this.disposed && request.method !== "stop")
      return Promise.resolve(
        failure(request.method, "helper-unavailable", "Computer-use manager disposed"),
      );
    if (this.pending.size >= MAX_PENDING && request.method !== "stop")
      return Promise.resolve(failure(request.method, "internal", "Too many computer-use requests"));
    if (this.pending.size >= MAX_PENDING * 2) {
      // Reserve a bounded lane for Stop; process termination is the final
      // cancellation boundary if even that lane has been exhausted.
      this.failHelper("cancelled", "Native computer-use helper stopped");
      return Promise.resolve(
        failure(request.method, "cancelled", "Native computer-use helper stopped"),
      );
    }
    try {
      this.ensureHelper(request.method === "activity.observe");
    } catch {
      return Promise.resolve(
        failure(request.method, "helper-unavailable", "Native computer-use helper unavailable"),
      );
    }
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.finish(id, failure(request.method, "timeout", "Native computer-use helper timed out"));
        this.failHelper("helper-unavailable", "Native computer-use helper did not respond");
      }, this.options.timeoutMs ?? 15_000);
      this.pending.set(id, { threadId, request, timer, resolve });
      try {
        const child = this.helper!;
        if (request.method === "session.perform") {
          const inputs = this.inputRequests.get(child) ?? new Set<string>();
          inputs.add(id);
          this.inputRequests.set(child, inputs);
        }
        child.stdin.write(`${JSON.stringify({ id, threadId, request })}\n`, (error) => {
          if (error) this.failHelper("helper-unavailable", "Native computer-use pipe closed");
        });
      } catch {
        this.failHelper("helper-unavailable", "Native computer-use pipe closed");
      }
    });
  }

  private ensureHelper(skipObservationSync = false): void {
    if (this.retiringHelper) throw new Error("Previous native helper is still stopping");
    if (this.helper) return;
    const child =
      this.options.spawnHelper?.(this.options.helperPath) ??
      (spawn(this.options.helperPath, [], {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        env: { ...process.env, DJL_CUA_ACTIVITY_FD: "3" },
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams);
    this.helper = child;
    this.activity.renewObservationEpoch();
    this.observationSuspended = false;
    this.observationAttempted = false;
    const activityPipe = child.stdio?.[3];
    this.observation.attach(
      activityPipe && "readable" in activityPipe && activityPipe.readable
        ? (activityPipe as Readable)
        : undefined,
    );
    if (!skipObservationSync && this.observationAllowed)
      queueMicrotask(() => this.syncObservation());
    this.buffer = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer | string) => {
      if (this.helper !== child && this.retiringHelper?.child !== child) return;
      this.receive(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), child);
    });
    child.stdout.on("error", () => {
      if (this.helper === child)
        this.failHelper("helper-unavailable", "Native computer-use pipe closed");
    });
    child.stderr.on("error", () => undefined);
    child.stderr.resume(); // Diagnostics may include target content; never persist or forward them.
    child.stdin.on("error", () => {
      if (this.helper === child)
        this.failHelper("helper-unavailable", "Native computer-use pipe closed");
    });
    child.on("error", () => {
      if (this.helper === child)
        this.failHelper("helper-unavailable", "Native computer-use helper unavailable");
    });
    const exited = () => {
      this.exitedHelpers.add(child);
      this.protectedHelpers.delete(child);
      this.inputRequests.delete(child);
      const retiring = this.retiringHelper;
      if (retiring?.child === child) {
        clearTimeout(retiring.timer);
        this.retiringHelper = undefined;
        retiring.resolve();
      }
      if (this.helper === child)
        this.failHelper("helper-unavailable", "Native computer-use helper exited");
    };
    child.once("exit", exited);
    child.once("close", exited);
  }

  private receive(chunk: Buffer, child: ChildProcessWithoutNullStreams): void {
    // Split the incoming chunk before concatenation, so a bad line cannot grow
    // an unbounded buffer even if it is followed by another valid frame.
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      if (this.buffer.length + end - start > MAX_LINE_BYTES) {
        this.buffer = Buffer.alloc(0);
        this.failHelper("helper-unavailable", "Native computer-use frame too large");
        return;
      }
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(start, end)]);
      if (newline === -1) return;
      const line = this.buffer;
      this.buffer = Buffer.alloc(0);
      try {
        this.receiveFrame(JSON.parse(line.toString("utf8")), child);
      } catch {
        if (this.helper === child) {
          this.failHelper("helper-unavailable", "Invalid native computer-use response");
          return;
        }
        // A malformed retired frame cannot certify that keyboard focus is safe.
      }
      if (this.helper !== child && this.retiringHelper?.child !== child) return;
      start = newline + 1;
    }
  }

  private receiveFrame(frame: unknown, child: ChildProcessWithoutNullStreams): void {
    if (!isObject(frame)) throw new Error("Invalid native envelope");
    if (
      Object.keys(frame).length === 1 &&
      isObject(frame.event) &&
      frame.event.type === "input-protection"
    ) {
      const event = frame.event;
      if (
        Object.keys(event).toSorted().join() !== "state,type" ||
        (event.state !== "active" && event.state !== "safe")
      )
        throw new Error("Invalid native keyboard protection event");
      if (event.state === "active") this.protectedHelpers.add(child);
      else this.protectedHelpers.delete(child);
      this.tryForceRetire(child);
      return;
    }
    if (this.helper !== child) {
      // Native replies remain ordered after the active/safe announcements, even
      // after callers have timed out and their public requests were revoked.
      if (
        Object.keys(frame).toSorted().join() === "id,response" &&
        typeof frame.id === "string" &&
        this.inputRequests.get(child)?.has(frame.id)
      ) {
        const response = decodeComputerUseResponse(frame.response);
        if (response.method !== "session.perform")
          throw new Error("Invalid retired input response");
        this.inputRequests.get(child)!.delete(frame.id);
        this.tryForceRetire(child);
      }
      return;
    }
    if (Object.keys(frame).length === 1 && isObject(frame.event)) {
      const event = frame.event;
      if (event.type === "thread-stopped") {
        if (
          Object.keys(event).toSorted().join() !== "threadId,type" ||
          !validThread(event.threadId)
        )
          throw new Error("Invalid native thread event");
        // Only the helper's human floating Stop emits this event. It has
        // already stopped native work; do not echo Stop back to the helper.
        void this.stopOwned(event.threadId, undefined, false);
        this.emit({ type: "thread-stopped", threadId: event.threadId });
        return;
      }
      if (
        Object.keys(event).toSorted().join() !== "sessionId,type" ||
        (event.type !== "stopped" && event.type !== "show-thread") ||
        !validThread(event.sessionId)
      )
        throw new Error("Invalid native event");
      const session = this.sessions.get(event.sessionId);
      if (event.type === "show-thread") {
        if (session) this.emit({ type: "show-thread", threadId: session.threadId });
        return;
      }
      if (session) {
        for (const [id, pending] of this.pending) {
          if ("sessionId" in pending.request && pending.request.sessionId === session.sessionId)
            this.finish(
              id,
              failure(pending.request.method, "cancelled", "Computer-use session stopped"),
            );
        }
        this.revoke(session);
      } else if (
        Array.from(this.pending.values()).some(
          (pending) => pending.request.method === "session.open",
        )
      ) {
        this.earlyStoppedIds.add(event.sessionId);
        if (this.earlyStoppedIds.size > 256)
          this.earlyStoppedIds.delete(this.earlyStoppedIds.values().next().value!);
      }
      return;
    }
    if (Object.keys(frame).toSorted().join() !== "id,response" || typeof frame.id !== "string")
      throw new Error("Invalid native envelope");
    const pending = this.pending.get(frame.id);
    if (!pending) {
      if (this.inputRequests.get(child)?.has(frame.id)) {
        const response = decodeComputerUseResponse(frame.response);
        if (response.method !== "session.perform") throw new Error("Invalid late input response");
        this.inputRequests.get(child)!.delete(frame.id);
        this.tryForceRetire(child);
        return;
      }
      if (this.retiredIds.has(frame.id)) return;
      throw new Error("Unknown native response id");
    }
    const response = decodeComputerUseResponse(frame.response);
    this.validateResponse(pending, response);
    this.inputRequests.get(child)?.delete(frame.id);
    if (
      response.method === "session.open" &&
      "result" in response &&
      this.earlyStoppedIds.delete(response.result.sessionId)
    ) {
      this.record(pending.threadId, {
        type: "stopped",
        sessionId: response.result.sessionId,
        target: response.result.target,
      });
      this.finish(
        frame.id,
        failure(pending.request.method, "cancelled", "Computer-use session stopped"),
      );
      return;
    }
    if (response.method === "session.open" && "result" in response) {
      this.sessions.set(response.result.sessionId, response.result);
      this.record(pending.threadId, {
        type: "session-opened",
        sessionId: response.result.sessionId,
        target: response.result.target,
      });
    }
    this.finish(frame.id, response);
  }

  private validateResponse(pending: Pending, response: ComputerUseResponse): void {
    const { request, threadId } = pending;
    if (request.method !== response.method) throw new Error("Native response method mismatch");
    if ("error" in response) return;
    if (response.method === "session.open") {
      if (
        request.method !== "session.open" ||
        response.result.threadId !== threadId ||
        !sameTarget(request.target, response.result.target) ||
        this.sessions.has(response.result.sessionId)
      )
        throw new Error("Native session identity mismatch");
    }
    const observation =
      response.method === "session.observe"
        ? response.result
        : response.method === "session.perform" && "observation" in response.result
          ? response.result.observation
          : undefined;
    if (observation) {
      if (!("sessionId" in request) || request.sessionId !== observation.sessionId)
        throw new Error("Native observation session mismatch");
      const session = this.ownedSession(threadId, observation.sessionId);
      if (!session || !sameTarget(session.target, observation.target))
        throw new Error("Native observation target mismatch");
    }
    if (
      response.method === "stop" &&
      request.method === "stop" &&
      response.result.stoppedSessionIds.some((id) =>
        request.sessionId
          ? id !== request.sessionId
          : this.sessions.has(id) && this.sessions.get(id)!.threadId !== threadId,
      )
    )
      throw new Error("Native stop scope mismatch");
  }

  private finish(id: string, response: ComputerUseResponse): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    this.retiredIds.add(id);
    if (this.retiredIds.size > 256) this.retiredIds.delete(this.retiredIds.values().next().value!);
    pending.resolve(response);
  }

  private failHelper(code: ComputerUseError["code"], message: string): void {
    const child = this.helper;
    this.helper = undefined;
    this.activity.renewObservationEpoch();
    this.observationRevision++;
    this.observationAttempted = false;
    this.observation.detach();
    if (child && !this.exitedHelpers.has(child)) this.retireHelper(child);
    // Keep a partial frame: the retiring helper must still be able to complete
    // its ordered keyboard-protection handshake on the same private pipe.
    this.earlyStoppedIds.clear();
    for (const threadId of this.epochs.keys())
      this.epochs.set(threadId, this.epochs.get(threadId)! + 1);
    for (const [id, pending] of this.pending)
      this.finish(id, failure(pending.request.method, code, message));
    for (const session of this.sessions.values()) {
      // Storage failures must not prevent killing the process and revoking access.
      try {
        this.revoke(session);
      } catch {
        this.sessions.delete(session.sessionId);
      }
    }
  }

  private retireHelper(child: ChildProcessWithoutNullStreams): void {
    let resolve!: () => void;
    const completion = new Promise<void>((done) => {
      resolve = done;
    });
    const timer = setTimeout(() => {
      if (this.retiringHelper?.child !== child) return;
      this.retiringHelper.graceElapsed = true;
      this.tryForceRetire(child);
    }, this.options.terminationTimeoutMs ?? 1_000);
    timer.unref();
    this.retiringHelper = { child, timer, completion, resolve, graceElapsed: false };
    try {
      child.kill("SIGTERM");
    } catch {
      /* The bounded SIGKILL escalation still runs. */
    }
  }

  private tryForceRetire(child: ChildProcessWithoutNullStreams): void {
    const retiring = this.retiringHelper;
    if (retiring?.child !== child || !retiring.graceElapsed) return;
    // Killing an unknown/retained input scope could remove its routing taps
    // while the background target still owns the user's keyboard focus.
    if (this.protectedHelpers.has(child) || this.inputRequests.get(child)?.size) return;
    retiring.graceElapsed = false;
    try {
      child.kill("SIGKILL");
    } catch {
      /* Keep respawn blocked until an exit/close event proves retirement. */
    } finally {
      retiring.resolve();
    }
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    const authorization = request.headers.authorization;
    const expected = Buffer.from(`Bearer ${this.token}`);
    const actual = Buffer.from(authorization ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      send(401, { error: "Unauthorized" });
      request.resume();
      return;
    }
    if (
      request.method !== "POST" ||
      (request.url !== "/computer-use" &&
        request.url !== "/computer-use/turn-start" &&
        request.url !== "/computer-use/summary-jobs")
    ) {
      send(404, { error: "Not found" });
      request.resume();
      return;
    }
    if (request.headers.origin) {
      send(403, { error: "Browser origins are not accepted" });
      request.resume();
      return;
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_HTTP_BYTES) {
          send(413, { error: "Request too large" });
          request.resume();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.url === "/computer-use/summary-jobs") {
        if (this.disposed) {
          send(503, { error: "Desktop host stopped" });
          return;
        }
        const command = decodeComputerActivitySummaryCommand(body);
        if (this.activityClear || this.historyControlActive) {
          if (command.operation === "claim") send(503, { error: CLEAR_RECOVERY_REQUIRED });
          else
            send(200, {
              operation: command.operation,
              ...(command.operation === "valid" ? { valid: false } : { accepted: false }),
            });
          return;
        }
        switch (command.operation) {
          case "claim":
            send(200, { operation: command.operation, job: this.summaries.claim() });
            return;
          case "valid":
            send(200, {
              operation: command.operation,
              valid: this.summaries.valid(command.leaseId),
            });
            return;
          case "complete":
            send(200, {
              operation: command.operation,
              accepted: this.summaries.complete(command.leaseId, command.content, {
                provider: command.provider,
                model: command.model,
              }),
            });
            return;
          case "fail":
            send(200, {
              operation: command.operation,
              accepted: this.summaries.fail(command.leaseId, command.code),
            });
            return;
        }
      }
      if (request.url === "/computer-use/turn-start") {
        if (
          !isObject(body) ||
          Object.keys(body).some((key) => key !== "threadId" && key !== "allowActivityHistory") ||
          !validThread(body.threadId) ||
          (body.allowActivityHistory !== undefined &&
            typeof body.allowActivityHistory !== "boolean")
        ) {
          send(400, { error: "Invalid turn-start envelope" });
          return;
        }
        this.resumeThread(body.threadId, {
          allowActivityHistory: body.allowActivityHistory === true,
        });
        send(200, { resumed: true });
        return;
      }
      if (
        !isObject(body) ||
        Object.keys(body).toSorted().join() !== "request,threadId" ||
        !validThread(body.threadId)
      ) {
        send(400, { error: "Invalid envelope" });
        return;
      }
      const decoded = decodeComputerUseRequest(body.request);
      const result = await this.request(body.threadId, decoded, { origin: "agent" });
      send(200, result);
    } catch {
      if (!response.headersSent) send(400, { error: "Invalid request" });
    }
  }
}
