import { spawn, type SpawnOptions } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  LocalInstalledModel,
  LocalModelInstallInput,
  LocalModelInstallJob,
  LocalModelRemoveInput,
  LocalModelRuntime,
  LocalModelRuntimeInstallJob,
  LocalModelRuntimeInstallationKind,
  LocalModelRuntimeStatus,
  LocalModelSetupInput,
  LocalModelSetupJob,
  LocalModelsSnapshot,
} from "@synara/contracts";

import { isCuratedLocalModel, LOCAL_MODEL_RECOMMENDATIONS, recommendLocalModel } from "./catalog";
import { buildOpenCodeLocalProviderConfig } from "./openCodeConfig";
import {
  installOllamaRuntime,
  type LocalModelFetch,
  type OllamaInstallOptions,
  type OllamaInstallResult,
} from "./OllamaInstaller";
import {
  installLmStudioRuntime,
  type LmStudioInstallOptions,
  type LmStudioInstallResult,
} from "./LmStudioInstaller";

const OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
const LM_STUDIO_ENDPOINT = "http://127.0.0.1:1234";
const REQUEST_TIMEOUT_MS = 2_500;
// First launch can include Windows Defender scanning and GPU discovery. Keep
// polling the localhost API so slow cold starts do not invite repeated retries.
const START_TIMEOUT_MS = 90_000;
const MAX_RETAINED_INSTALL_JOBS = 32;
const MAX_RETAINED_SETUP_JOBS = 8;
const GIB = 1024 ** 3;

interface RuntimeProbe {
  readonly status: LocalModelRuntimeStatus;
  readonly models: ReadonlyArray<LocalInstalledModel> | null;
}

export interface LocalModelManagerOptions {
  readonly stateDir: string;
  readonly managedOpenCodeRootDir?: string;
  readonly fetch?: LocalModelFetch;
  readonly totalMemoryBytes?: number;
  readonly freeDiskBytes?: number | null;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly onSnapshot?: (snapshot: LocalModelsSnapshot) => void | Promise<void>;
  readonly installOllama?: (options: OllamaInstallOptions) => Promise<OllamaInstallResult>;
  readonly installLmStudio?: (options: LmStudioInstallOptions) => Promise<LmStudioInstallResult>;
  readonly spawnRuntime?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => { once: (event: "error", listener: (error: Error) => void) => unknown; unref: () => void };
}

export class LocalModelManagerError extends Error {
  constructor(
    readonly operation: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LocalModelManagerError";
  }
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
    : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Runtime returned invalid JSON (HTTP ${response.status}).`);
  }
}

function runtimeCapabilities(runtime: LocalModelRuntime, state: LocalModelRuntimeStatus["state"]) {
  const running = state === "running";
  return {
    canStart: state === "stopped",
    canInstallModels: running,
    canCancelInstall: running && runtime === "ollama",
    canDeleteModels: running && runtime === "ollama",
  };
}

function runtimeMetadata(runtime: LocalModelRuntime) {
  return runtime === "ollama"
    ? {
        name: "Ollama",
        endpoint: OLLAMA_ENDPOINT,
        installerUrl: "https://ollama.com/download",
        estimatedDownloadBytes: 300 * 1024 ** 2,
      }
    : {
        name: "LM Studio",
        endpoint: LM_STUDIO_ENDPOINT,
        installerUrl: "https://lmstudio.ai/download",
        estimatedDownloadBytes: 500 * 1024 ** 2,
      };
}

export class LocalModelManager {
  readonly #fetch: LocalModelFetch;
  readonly #totalMemoryBytes: number;
  readonly #configuredFreeDiskBytes: number | null | undefined;
  readonly #platform: NodeJS.Platform;
  readonly #arch: NodeJS.Architecture;
  readonly #env: NodeJS.ProcessEnv;
  readonly #now: () => Date;
  readonly #onSnapshot: ((snapshot: LocalModelsSnapshot) => void | Promise<void>) | undefined;
  readonly #jobs = new Map<string, LocalModelInstallJob>();
  readonly #runtimeInstallJobs = new Map<LocalModelRuntime, LocalModelRuntimeInstallJob>();
  readonly #setupJobs = new Map<string, LocalModelSetupJob>();
  readonly #setupControllers = new Map<string, AbortController>();
  readonly #jobControllers = new Map<string, AbortController>();
  readonly #knownModels = new Map<LocalModelRuntime, ReadonlyArray<LocalInstalledModel>>();
  readonly #configPath: string;
  readonly #stateDir: string;
  readonly #installOllama: (options: OllamaInstallOptions) => Promise<OllamaInstallResult>;
  readonly #installLmStudio: (options: LmStudioInstallOptions) => Promise<LmStudioInstallResult>;
  readonly #spawnRuntime: NonNullable<LocalModelManagerOptions["spawnRuntime"]>;
  readonly #runtimeInstalls = new Map<LocalModelRuntime, Promise<LocalModelsSnapshot>>();
  readonly #runtimeStarts = new Map<LocalModelRuntime, Promise<LocalModelsSnapshot>>();
  readonly #setupStatePath: string;
  #setupStateWrite = Promise.resolve();
  #initializePromise: Promise<void> | null = null;
  #managedOllamaCommand: string | null = null;
  #managedLmStudioCommand: string | null = null;
  #lastSynchronizedInventoryFingerprint: string | null = null;
  #configWrite = Promise.resolve();

  constructor(options: LocalModelManagerOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#totalMemoryBytes = options.totalMemoryBytes ?? totalmem();
    this.#configuredFreeDiskBytes = options.freeDiskBytes;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#env = options.env ?? process.env;
    this.#now = options.now ?? (() => new Date());
    this.#onSnapshot = options.onSnapshot;
    this.#stateDir = options.stateDir;
    this.#installOllama = options.installOllama ?? installOllamaRuntime;
    this.#installLmStudio = options.installLmStudio ?? installLmStudioRuntime;
    this.#spawnRuntime = options.spawnRuntime ?? spawn;
    this.#configPath = join(
      options.managedOpenCodeRootDir ?? join(options.stateDir, "opencode"),
      "config",
      "opencode",
      "opencode.json",
    );
    this.#setupStatePath = join(this.#stateDir, "local-models", "setup-state.json");
  }

  async getSnapshot(
    options: { readonly synchronizeConfig?: boolean } = {},
  ): Promise<LocalModelsSnapshot> {
    await this.#ensureInitialized();
    const probes = await Promise.all([this.#probeOllama(), this.#probeLmStudio()]);
    for (const probe of probes) {
      if (probe.models !== null) this.#knownModels.set(probe.status.runtime, probe.models);
    }
    if (options.synchronizeConfig !== false && probes.some(({ models }) => models !== null)) {
      await this.#synchronizeOpenCodeConfig();
    }
    const installedModels = [...this.#knownModels.values()].flat();
    const recommended = recommendLocalModel(this.#totalMemoryBytes);
    return {
      totalMemoryBytes: finiteNonNegative(this.#totalMemoryBytes),
      freeDiskBytes: await this.#getFreeDiskBytes(),
      recommendedModelId: recommended?.id ?? null,
      runtimes: probes.map(({ status }) => status),
      recommendations: [...LOCAL_MODEL_RECOMMENDATIONS],
      installedModels,
      runtimeInstallJobs: [...this.#runtimeInstallJobs.values()],
      installJobs: [...this.#jobs.values()].toSorted((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      ),
      setupJobs: [...this.#setupJobs.values()].toSorted((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      ),
    };
  }

  async refresh(): Promise<LocalModelsSnapshot> {
    const snapshot = await this.getSnapshot();
    await this.#emitSnapshot(snapshot);
    return snapshot;
  }

  async ensureRuntimeForModel(modelSlug: string): Promise<void> {
    const runtime: LocalModelRuntime | null = modelSlug.startsWith("ollama/")
      ? "ollama"
      : modelSlug.startsWith("lmstudio/")
        ? "lmstudio"
        : null;
    if (!runtime) return;
    const snapshot = await this.getSnapshot({ synchronizeConfig: false });
    const status = snapshot.runtimes.find((candidate) => candidate.runtime === runtime);
    if (!status || status.state === "running") return;
    if (status.state === "stopped") {
      await this.startRuntime(runtime);
      return;
    }
    throw new LocalModelManagerError(
      "ensureRuntimeForModel",
      status.detail ?? `${status.name} is not ready. Open Local Models settings to repair it.`,
    );
  }

  async startSetup(input: LocalModelSetupInput): Promise<LocalModelSetupJob> {
    await this.#ensureInitialized();
    const runtime = input.runtime ?? "ollama";
    const recommendation = input.recommendationId
      ? LOCAL_MODEL_RECOMMENDATIONS.find(({ id }) => id === input.recommendationId)
      : recommendLocalModel(this.#totalMemoryBytes);
    if (!recommendation) {
      throw new LocalModelManagerError("startSetup", "No recommended local model is available.");
    }
    const source = recommendation.sources.find((candidate) => candidate.runtime === runtime);
    if (!source) {
      throw new LocalModelManagerError(
        "startSetup",
        `${recommendation.name} is not available for ${runtimeMetadata(runtime).name}.`,
      );
    }
    const active = [...this.#setupJobs.values()].find(
      (job) =>
        job.runtime === runtime &&
        job.modelId === source.modelId &&
        !["ready", "failed", "cancelled"].includes(job.state),
    );
    if (active) return active;
    for (const [jobId, job] of this.#setupJobs) {
      if (this.#setupJobs.size < MAX_RETAINED_SETUP_JOBS) break;
      if (["ready", "failed", "cancelled"].includes(job.state)) this.#setupJobs.delete(jobId);
    }
    if (this.#setupJobs.size >= MAX_RETAINED_SETUP_JOBS) {
      throw new LocalModelManagerError(
        "startSetup",
        "Too many local AI setup jobs are retained. Retry an existing setup instead.",
      );
    }
    const job: LocalModelSetupJob = {
      id: randomUUID(),
      runtime,
      recommendationId: recommendation.id,
      modelId: source.modelId,
      state: "detecting",
      downloadedBytes: 0,
      totalBytes: finiteNonNegative(source.estimatedDownloadBytes),
      message: "Checking this computer…",
      startedAt: this.#now().toISOString(),
      finishedAt: null,
    };
    this.#setupJobs.set(job.id, job);
    await this.#persistSetupJobs();
    const controller = new AbortController();
    this.#setupControllers.set(job.id, controller);
    void this.#runSetup(job.id, controller.signal);
    await this.#emitLatestSnapshot();
    return job;
  }

  async retrySetup(jobId: string): Promise<LocalModelSetupJob> {
    await this.#ensureInitialized();
    const job = this.#setupJobs.get(jobId);
    if (!job) throw new LocalModelManagerError("retrySetup", "The setup job was not found.");
    if (job.state !== "failed" && job.state !== "cancelled") return job;
    const retried = this.#updateSetupJob(jobId, {
      state: "detecting",
      downloadedBytes: 0,
      message: "Checking this computer…",
      finishedAt: null,
    });
    await this.#persistSetupJobs();
    const controller = new AbortController();
    this.#setupControllers.set(jobId, controller);
    void this.#runSetup(jobId, controller.signal);
    await this.#emitLatestSnapshot();
    return retried;
  }

  async cancelSetup(jobId: string): Promise<LocalModelSetupJob> {
    await this.#ensureInitialized();
    const job = this.#setupJobs.get(jobId);
    if (!job) throw new LocalModelManagerError("cancelSetup", "The setup job was not found.");
    if (["ready", "failed", "cancelled"].includes(job.state)) return job;
    this.#setupControllers.get(jobId)?.abort();
    if (job.runtime === "ollama") {
      const modelJob = [...this.#jobs.values()].find(
        (candidate) =>
          candidate.runtime === job.runtime &&
          candidate.modelId === job.modelId &&
          (candidate.state === "queued" || candidate.state === "downloading"),
      );
      if (modelJob) await this.cancelInstall(modelJob.id);
    }
    const cancelled = this.#updateSetupJob(jobId, {
      state: "cancelled",
      message: "Setup cancelled.",
      finishedAt: this.#now().toISOString(),
    });
    await this.#persistSetupJobs();
    await this.#emitLatestSnapshot();
    return cancelled;
  }

  async #runSetup(jobId: string, signal: AbortSignal): Promise<void> {
    try {
      let snapshot = await this.getSnapshot();
      const initial = this.#setupJobs.get(jobId);
      if (!initial || signal.aborted) return;
      const runtimeStatus = snapshot.runtimes.find(({ runtime }) => runtime === initial.runtime);
      const recommendation = LOCAL_MODEL_RECOMMENDATIONS.find(
        ({ id }) => id === initial.recommendationId,
      );
      const source = recommendation?.sources.find(({ runtime }) => runtime === initial.runtime);
      if (!runtimeStatus || !recommendation || !source) {
        throw new Error("The selected local AI setup is no longer available.");
      }

      const alreadyInstalled = snapshot.installedModels.some(
        ({ runtime, modelId }) => runtime === initial.runtime && modelId === initial.modelId,
      );
      if (!alreadyInstalled) {
        const runtimeBytes =
          runtimeStatus.state === "not_installed" ? runtimeStatus.estimatedDownloadBytes : 0;
        const estimatedBytes = finiteNonNegative(source.estimatedDownloadBytes) + runtimeBytes;
        const safetyBytes = Math.max(2 * GIB, Math.ceil(estimatedBytes * 0.1));
        if (
          snapshot.freeDiskBytes !== null &&
          snapshot.freeDiskBytes < estimatedBytes + safetyBytes
        ) {
          throw new Error(
            `Not enough free disk space. Free at least ${Math.ceil((estimatedBytes + safetyBytes - snapshot.freeDiskBytes) / GIB)} GB and retry.`,
          );
        }
      }

      if (runtimeStatus.state === "not_installed") {
        this.#updateSetupJob(jobId, {
          state: "installing_runtime",
          message: `Installing ${runtimeMetadata(initial.runtime).name}…`,
        });
        await this.#persistSetupJobs();
        await this.#emitLatestSnapshot();
        snapshot = await this.installRuntime(initial.runtime);
      } else if (runtimeStatus.state === "stopped") {
        this.#updateSetupJob(jobId, {
          state: "starting_runtime",
          message: `Starting ${runtimeMetadata(initial.runtime).name}…`,
        });
        await this.#persistSetupJobs();
        await this.#emitLatestSnapshot();
        snapshot = await this.startRuntime(initial.runtime);
      } else if (runtimeStatus.state !== "running") {
        throw new Error(runtimeStatus.detail ?? `${runtimeStatus.name} is not ready.`);
      }
      if (signal.aborted) return;

      const installedAfterStart = snapshot.installedModels.some(
        ({ runtime, modelId }) => runtime === initial.runtime && modelId === initial.modelId,
      );
      if (!alreadyInstalled && !installedAfterStart) {
        this.#updateSetupJob(jobId, {
          state: "downloading_model",
          downloadedBytes: 0,
          totalBytes: finiteNonNegative(source.estimatedDownloadBytes),
          message: `Downloading ${recommendation.name}…`,
        });
        await this.#persistSetupJobs();
        await this.#emitLatestSnapshot();
        const installJob = await this.installModel({
          runtime: initial.runtime,
          modelId: initial.modelId,
        } as LocalModelInstallInput);
        while (!signal.aborted) {
          const currentInstall = this.#jobs.get(installJob.id);
          if (!currentInstall) throw new Error("The model download disappeared.");
          this.#updateSetupJob(jobId, {
            downloadedBytes: currentInstall.downloadedBytes,
            totalBytes:
              currentInstall.totalBytes ?? finiteNonNegative(source.estimatedDownloadBytes),
            message: currentInstall.message ?? `Downloading ${recommendation.name}…`,
          });
          if (currentInstall.state === "completed") break;
          if (currentInstall.state === "failed" || currentInstall.state === "cancelled") {
            throw new Error(currentInstall.message ?? "The model download did not complete.");
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      if (signal.aborted) return;

      this.#updateSetupJob(jobId, {
        state: "synchronizing",
        message: "Adding the model to chat…",
      });
      await this.#persistSetupJobs();
      await this.#emitLatestSnapshot();
      snapshot = await this.getSnapshot();
      if (
        !snapshot.installedModels.some(
          ({ runtime, modelId }) => runtime === initial.runtime && modelId === initial.modelId,
        )
      ) {
        throw new Error("The runtime finished downloading, but the model is not available yet.");
      }
      this.#updateSetupJob(jobId, {
        state: "ready",
        downloadedBytes: finiteNonNegative(source.estimatedDownloadBytes),
        totalBytes: finiteNonNegative(source.estimatedDownloadBytes),
        message: `${recommendation.name} is ready to use in chat.`,
        finishedAt: this.#now().toISOString(),
      });
      await this.#persistSetupJobs();
      await this.#emitLatestSnapshot();
    } catch (cause) {
      if (signal.aborted) return;
      this.#updateSetupJob(jobId, {
        state: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
        finishedAt: this.#now().toISOString(),
      });
      await this.#persistSetupJobs();
      await this.#emitLatestSnapshot();
    } finally {
      this.#setupControllers.delete(jobId);
    }
  }

  async installRuntime(runtime: LocalModelRuntime): Promise<LocalModelsSnapshot> {
    const existing = this.#runtimeInstalls.get(runtime);
    if (existing) return existing;

    const operation =
      runtime === "ollama" ? this.#runOllamaRuntimeInstall() : this.#runLmStudioRuntimeInstall();
    this.#runtimeInstalls.set(runtime, operation);
    try {
      return await operation;
    } finally {
      this.#runtimeInstalls.delete(runtime);
    }
  }

  async #runLmStudioRuntimeInstall(): Promise<LocalModelsSnapshot> {
    const startedAt = this.#now().toISOString();
    this.#runtimeInstallJobs.set("lmstudio", {
      runtime: "lmstudio",
      state: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      message: "Checking the official LM Studio local engine…",
      startedAt,
      finishedAt: null,
    });
    await this.#emitLatestSnapshot();
    try {
      const installed = await this.#installLmStudio({
        stateDir: this.#stateDir,
        fetch: this.#fetch,
        platform: this.#platform,
        arch: this.#arch,
        env: this.#env,
        onProgress: async (progress) => {
          const current = this.#runtimeInstallJobs.get("lmstudio");
          if (!current) return;
          this.#runtimeInstallJobs.set("lmstudio", { ...current, ...progress });
          await this.#emitLatestSnapshot();
        },
      });
      this.#managedLmStudioCommand = installed.command;
      const installing = this.#runtimeInstallJobs.get("lmstudio");
      if (installing) {
        this.#runtimeInstallJobs.set("lmstudio", {
          ...installing,
          state: "starting",
          message: "Starting the LM Studio local engine privately…",
        });
      }
      await this.#emitLatestSnapshot();
      await this.startRuntime("lmstudio");
      const starting = this.#runtimeInstallJobs.get("lmstudio");
      if (starting) {
        this.#runtimeInstallJobs.set("lmstudio", {
          ...starting,
          state: "completed",
          message: "The LM Studio local engine is installed and running.",
          finishedAt: this.#now().toISOString(),
        });
      }
      const snapshot = await this.getSnapshot();
      await this.#emitSnapshot(snapshot);
      return snapshot;
    } catch (cause) {
      const current = this.#runtimeInstallJobs.get("lmstudio");
      if (current) {
        this.#runtimeInstallJobs.set("lmstudio", {
          ...current,
          state: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
          finishedAt: this.#now().toISOString(),
        });
      }
      await this.#emitLatestSnapshot();
      throw new LocalModelManagerError(
        "installRuntime",
        cause instanceof Error ? cause.message : "LM Studio engine installation failed.",
        cause,
      );
    }
  }

  async #runOllamaRuntimeInstall(): Promise<LocalModelsSnapshot> {
    const startedAt = this.#now().toISOString();
    this.#runtimeInstallJobs.set("ollama", {
      runtime: "ollama",
      state: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      message: "Checking the latest official Ollama release…",
      startedAt,
      finishedAt: null,
    });
    await this.#emitLatestSnapshot();
    try {
      const installed = await this.#installOllama({
        stateDir: this.#stateDir,
        fetch: this.#fetch,
        platform: this.#platform,
        arch: this.#arch,
        onProgress: async (progress) => {
          const current = this.#runtimeInstallJobs.get("ollama");
          if (!current) return;
          this.#runtimeInstallJobs.set("ollama", { ...current, ...progress });
          await this.#emitLatestSnapshot();
        },
      });
      this.#managedOllamaCommand = installed.command;
      const installing = this.#runtimeInstallJobs.get("ollama");
      if (installing) {
        this.#runtimeInstallJobs.set("ollama", {
          ...installing,
          state: "starting",
          message: "Starting Ollama privately on this computer…",
        });
      }
      await this.#emitLatestSnapshot();
      await this.startRuntime("ollama");
      const starting = this.#runtimeInstallJobs.get("ollama");
      if (starting) {
        this.#runtimeInstallJobs.set("ollama", {
          ...starting,
          state: "completed",
          message: "Ollama is installed and running.",
          finishedAt: this.#now().toISOString(),
        });
      }
      const snapshot = await this.getSnapshot();
      await this.#emitSnapshot(snapshot);
      return snapshot;
    } catch (cause) {
      const current = this.#runtimeInstallJobs.get("ollama");
      if (current) {
        this.#runtimeInstallJobs.set("ollama", {
          ...current,
          state: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
          finishedAt: this.#now().toISOString(),
        });
      }
      await this.#emitLatestSnapshot();
      throw new LocalModelManagerError(
        "installRuntime",
        cause instanceof Error ? cause.message : "Ollama installation failed.",
        cause,
      );
    }
  }

  async startRuntime(runtime: LocalModelRuntime): Promise<LocalModelsSnapshot> {
    const existing = this.#runtimeStarts.get(runtime);
    if (existing) return existing;

    const operation = this.#runRuntimeStart(runtime);
    this.#runtimeStarts.set(runtime, operation);
    try {
      return await operation;
    } finally {
      this.#runtimeStarts.delete(runtime);
    }
  }

  async #runRuntimeStart(runtime: LocalModelRuntime): Promise<LocalModelsSnapshot> {
    const initialProbe =
      runtime === "ollama" ? await this.#probeOllama() : await this.#probeLmStudio();
    if (initialProbe.status.state === "running") {
      if (initialProbe.models !== null) this.#knownModels.set(runtime, initialProbe.models);
      const snapshot = await this.getSnapshot();
      await this.#emitSnapshot(snapshot);
      return snapshot;
    }
    const command = await this.#resolveRuntimeCommand(runtime);
    if (!command) {
      throw new LocalModelManagerError(
        "startRuntime",
        `${runtimeMetadata(runtime).name} is not installed. Download it from the official installer first.`,
      );
    }
    const spawnState: { error: Error | null } = { error: null };
    try {
      const managedOllama =
        runtime === "ollama" && command === (await this.#resolveManagedOllamaCommand());
      const managedLmStudio =
        runtime === "lmstudio" && command === (await this.#resolveManagedLmStudioCommand());
      const env = managedOllama
        ? {
            ...this.#env,
            OLLAMA_CONTEXT_LENGTH: "8192",
            OLLAMA_MODELS: join(this.#stateDir, "local-models", "ollama", "models"),
          }
        : managedLmStudio
          ? {
              ...this.#env,
              HOME: join(this.#stateDir, "local-models", "runtimes", "lmstudio", "current"),
              USERPROFILE: join(this.#stateDir, "local-models", "runtimes", "lmstudio", "current"),
            }
          : this.#env;
      if (managedOllama && env.OLLAMA_MODELS) {
        await mkdir(env.OLLAMA_MODELS, { recursive: true, mode: 0o700 });
      }
      const commands =
        runtime === "ollama"
          ? [["serve"]]
          : managedLmStudio
            ? [
                ["daemon", "up", "--json"],
                ["server", "start", "--port", "1234"],
              ]
            : [["server", "start", "--port", "1234"]];
      for (const args of commands) {
        const child = this.#spawnRuntime(command, args, {
          // A detached Windows console process creates a new visible console.
          // With ignored stdio, unref is sufficient for it to outlive DJL.
          detached: this.#platform !== "win32",
          env,
          stdio: "ignore",
          windowsHide: true,
        });
        child.once("error", (error) => {
          spawnState.error = error;
        });
        child.unref();
      }
    } catch (cause) {
      throw new LocalModelManagerError(
        "startRuntime",
        `Failed to start ${runtimeMetadata(runtime).name}.`,
        cause,
      );
    }

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const spawnError = spawnState.error;
      if (spawnError) {
        throw new LocalModelManagerError(
          "startRuntime",
          `Failed to start ${runtimeMetadata(runtime).name}: ${spawnError.message}`,
          spawnError,
        );
      }
      const probe = runtime === "ollama" ? await this.#probeOllama() : await this.#probeLmStudio();
      if (probe.status.state === "running") {
        if (probe.models !== null) this.#knownModels.set(runtime, probe.models);
        const snapshot = await this.getSnapshot();
        await this.#emitSnapshot(snapshot);
        return snapshot;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    throw new LocalModelManagerError(
      "startRuntime",
      `${runtimeMetadata(runtime).name} did not become ready within ${START_TIMEOUT_MS / 1_000} seconds.`,
    );
  }

  async installModel(input: LocalModelInstallInput): Promise<LocalModelInstallJob> {
    const duplicate = [...this.#jobs.values()].find(
      (job) =>
        job.runtime === input.runtime &&
        job.modelId === input.modelId &&
        (job.state === "queued" || job.state === "downloading"),
    );
    if (duplicate) return duplicate;

    for (const [jobId, job] of this.#jobs) {
      if (this.#jobs.size < MAX_RETAINED_INSTALL_JOBS) break;
      if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") {
        this.#jobs.delete(jobId);
      }
    }
    if (this.#jobs.size >= MAX_RETAINED_INSTALL_JOBS) {
      throw new LocalModelManagerError(
        "installModel",
        "Too many model downloads are already active. Wait for one to finish and retry.",
      );
    }

    const startedAt = this.#now().toISOString();
    const job: LocalModelInstallJob = {
      id: randomUUID(),
      runtime: input.runtime,
      modelId: input.modelId,
      state: "queued",
      downloadedBytes: 0,
      totalBytes: null,
      bytesPerSecond: null,
      message: "Waiting to start…",
      startedAt,
      finishedAt: null,
    };
    this.#jobs.set(job.id, job);
    const controller = new AbortController();
    this.#jobControllers.set(job.id, controller);
    void (input.runtime === "ollama"
      ? this.#runOllamaInstall(job.id, input.modelId, controller.signal)
      : this.#runLmStudioInstall(job.id, input.modelId, input.quantization, controller.signal));
    await this.#emitLatestSnapshot();
    return job;
  }

  async cancelInstall(jobId: string): Promise<LocalModelInstallJob> {
    const job = this.#jobs.get(jobId);
    if (!job) throw new LocalModelManagerError("cancelInstall", "The download job was not found.");
    if (job.runtime !== "ollama") {
      throw new LocalModelManagerError(
        "cancelInstall",
        "LM Studio downloads must be managed in LM Studio.",
      );
    }
    if (job.state !== "queued" && job.state !== "downloading") return job;
    this.#jobControllers.get(jobId)?.abort();
    const cancelled = this.#updateJob(jobId, {
      state: "cancelled",
      message: "Download cancelled.",
      finishedAt: this.#now().toISOString(),
    });
    await this.#emitLatestSnapshot();
    return cancelled;
  }

  async removeModel(input: LocalModelRemoveInput): Promise<LocalModelsSnapshot> {
    if (input.runtime === "lmstudio") {
      throw new LocalModelManagerError("removeModel", "Remove this model from the LM Studio app.");
    }
    const response = await this.#request(`${OLLAMA_ENDPOINT}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.modelId }),
    });
    if (!response.ok) {
      throw new LocalModelManagerError(
        "removeModel",
        `Ollama could not remove the model (HTTP ${response.status}).`,
      );
    }
    const snapshot = await this.getSnapshot();
    await this.#emitSnapshot(snapshot);
    return snapshot;
  }

  async #probeOllama(): Promise<RuntimeProbe> {
    const metadata = runtimeMetadata("ollama");
    try {
      const [versionResponse, tagsResponse] = await Promise.all([
        this.#request(`${OLLAMA_ENDPOINT}/api/version`),
        this.#request(`${OLLAMA_ENDPOINT}/api/tags`),
      ]);
      if (!versionResponse.ok || !tagsResponse.ok) throw new Error("Ollama API is unavailable.");
      const versionJson = record(await responseJson(versionResponse));
      const tagsJson = record(await responseJson(tagsResponse));
      const rawModels = Array.isArray(tagsJson?.models) ? tagsJson.models : [];
      const models = rawModels.flatMap((value): LocalInstalledModel[] => {
        const model = record(value);
        const modelId = typeof model?.name === "string" ? model.name : "";
        if (!modelId) return [];
        return [
          {
            runtime: "ollama",
            modelId,
            name: modelId,
            sizeBytes: finiteNonNegative(model?.size),
            contextWindowTokens: null,
            supportsToolCalls: isCuratedLocalModel("ollama", modelId) ? true : null,
          },
        ];
      });
      return {
        status: {
          runtime: "ollama",
          ...metadata,
          state: "running",
          version: typeof versionJson?.version === "string" ? versionJson.version : null,
          installationKind: await this.#runtimeInstallationKind("ollama"),
          detail: null,
          capabilities: runtimeCapabilities("ollama", "running"),
        },
        models,
      };
    } catch (cause) {
      const command = await this.#resolveRuntimeCommand("ollama");
      const installed = command !== null;
      const state = installed ? "stopped" : "not_installed";
      return {
        status: {
          runtime: "ollama",
          ...metadata,
          state,
          version: null,
          installationKind: command ? this.#installationKindForCommand(command) : null,
          detail: installed ? "Ollama is installed but its local server is stopped." : null,
          capabilities: runtimeCapabilities("ollama", state),
        },
        models: null,
      };
    }
  }

  async #probeLmStudio(): Promise<RuntimeProbe> {
    const metadata = runtimeMetadata("lmstudio");
    try {
      const response = await this.#request(`${LM_STUDIO_ENDPOINT}/api/v1/models`);
      if (response.status === 401 || response.status === 403) {
        return {
          status: {
            runtime: "lmstudio",
            ...metadata,
            state: "error",
            version: null,
            installationKind: await this.#runtimeInstallationKind("lmstudio"),
            detail:
              "LM Studio API authentication is enabled. Disable it for this localhost-only integration.",
            capabilities: runtimeCapabilities("lmstudio", "error"),
          },
          models: null,
        };
      }
      if (response.status === 404) {
        const legacy = await this.#request(`${LM_STUDIO_ENDPOINT}/api/v0/models`);
        if (legacy.ok) {
          return {
            status: {
              runtime: "lmstudio",
              ...metadata,
              state: "update_required",
              version: null,
              installationKind: await this.#runtimeInstallationKind("lmstudio"),
              detail: "Update LM Studio to 0.4.0 or newer to install models from Synara.",
              capabilities: runtimeCapabilities("lmstudio", "update_required"),
            },
            models: this.#parseLegacyLmStudioModels(await responseJson(legacy)),
          };
        }
      }
      if (!response.ok) throw new Error(`LM Studio returned HTTP ${response.status}.`);
      const json = record(await responseJson(response));
      const rawModels = Array.isArray(json?.models) ? json.models : [];
      const models = rawModels.flatMap((value): LocalInstalledModel[] => {
        const model = record(value);
        const modelId = typeof model?.key === "string" ? model.key : "";
        if (!model || !modelId || model.type === "embedding") return [];
        return [
          {
            runtime: "lmstudio",
            modelId,
            name: typeof model.display_name === "string" ? model.display_name : modelId,
            sizeBytes: finiteNonNegative(model.size_bytes),
            contextWindowTokens: null,
            supportsToolCalls: isCuratedLocalModel("lmstudio", modelId) ? true : null,
          },
        ];
      });
      return {
        status: {
          runtime: "lmstudio",
          ...metadata,
          state: "running",
          version: null,
          installationKind: await this.#runtimeInstallationKind("lmstudio"),
          detail: null,
          capabilities: runtimeCapabilities("lmstudio", "running"),
        },
        models,
      };
    } catch {
      const command = await this.#resolveRuntimeCommand("lmstudio");
      const installed = command !== null;
      const state = installed ? "stopped" : "not_installed";
      return {
        status: {
          runtime: "lmstudio",
          ...metadata,
          state,
          version: null,
          installationKind: command ? this.#installationKindForCommand(command) : null,
          detail: installed ? "LM Studio is installed but its local server is stopped." : null,
          capabilities: runtimeCapabilities("lmstudio", state),
        },
        models: null,
      };
    }
  }

  #parseLegacyLmStudioModels(json: unknown): LocalInstalledModel[] {
    const root = record(json);
    const rawModels = Array.isArray(root?.data) ? root.data : [];
    return rawModels.flatMap((value): LocalInstalledModel[] => {
      const model = record(value);
      const id = typeof model?.id === "string" ? model.id : "";
      if (!model || !id || model.type === "embeddings") return [];
      return [
        {
          runtime: "lmstudio",
          modelId: id,
          name: id,
          sizeBytes: 0,
          contextWindowTokens:
            typeof model.max_context_length === "number" && model.max_context_length > 0
              ? Math.floor(model.max_context_length)
              : null,
          supportsToolCalls: Array.isArray(model.capabilities)
            ? model.capabilities.includes("tool_use")
            : null,
        },
      ];
    });
  }

  async #runOllamaInstall(jobId: string, modelId: string, signal: AbortSignal): Promise<void> {
    const startedMs = Date.now();
    try {
      this.#updateJob(jobId, { state: "downloading", message: "Starting Ollama download…" });
      await this.#emitLatestSnapshot();
      const response = await this.#request(`${OLLAMA_ENDPOINT}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, stream: true }),
        signal,
      });
      if (!response.ok || !response.body)
        throw new Error(`Ollama returned HTTP ${response.status}.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let lastEmit = 0;
      while (true) {
        const { value, done } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split("\n");
        buffered = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const progress = record(JSON.parse(line) as unknown);
          if (typeof progress?.error === "string") throw new Error(progress.error);
          const completed = finiteNonNegative(progress?.completed);
          const total = finiteNonNegative(progress?.total);
          this.#updateJob(jobId, {
            state: "downloading",
            downloadedBytes: completed,
            totalBytes: total > 0 ? total : null,
            bytesPerSecond: finiteNonNegative(
              completed / Math.max(1, (Date.now() - startedMs) / 1_000),
            ),
            message: typeof progress?.status === "string" ? progress.status : "Downloading…",
          });
          if (Date.now() - lastEmit >= 200) {
            lastEmit = Date.now();
            await this.#emitLatestSnapshot();
          }
        }
        if (done) break;
      }
      this.#updateJob(jobId, {
        state: "completed",
        message: "Installed and ready in DJL.",
        finishedAt: this.#now().toISOString(),
      });
      await this.#emitLatestSnapshot();
    } catch (cause) {
      if (signal.aborted) return;
      this.#updateJob(jobId, {
        state: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
        finishedAt: this.#now().toISOString(),
      });
      await this.#emitLatestSnapshot();
    } finally {
      this.#jobControllers.delete(jobId);
    }
  }

  async #runLmStudioInstall(
    jobId: string,
    modelId: string,
    quantization: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      this.#updateJob(jobId, { state: "downloading", message: "Starting LM Studio download…" });
      await this.#emitLatestSnapshot();
      const response = await this.#request(`${LM_STUDIO_ENDPOINT}/api/v1/models/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, ...(quantization ? { quantization } : {}) }),
        signal,
      });
      const initial = record(await responseJson(response));
      if (!response.ok) throw new Error(`LM Studio returned HTTP ${response.status}.`);
      const remoteJobId = typeof initial?.job_id === "string" ? initial.job_id : null;
      if (initial?.status === "already_downloaded" || initial?.status === "completed") {
        this.#updateJob(jobId, {
          state: "completed",
          message: "Installed and ready in DJL.",
          finishedAt: this.#now().toISOString(),
        });
        await this.#emitLatestSnapshot();
        return;
      }
      if (!remoteJobId) throw new Error("LM Studio did not return a download job ID.");
      while (!signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const statusResponse = await this.#request(
          `${LM_STUDIO_ENDPOINT}/api/v1/models/download/status/${encodeURIComponent(remoteJobId)}`,
          { signal },
        );
        const status = record(await responseJson(statusResponse));
        if (!statusResponse.ok)
          throw new Error(`LM Studio returned HTTP ${statusResponse.status}.`);
        const state = typeof status?.status === "string" ? status.status : "downloading";
        this.#updateJob(jobId, {
          state: "downloading",
          downloadedBytes: finiteNonNegative(
            status?.downloaded_size_bytes ?? status?.downloaded_bytes,
          ),
          totalBytes: finiteNonNegative(status?.total_size_bytes) || null,
          message: state === "paused" ? "Paused in LM Studio." : "Downloading in LM Studio…",
        });
        await this.#emitLatestSnapshot();
        if (state === "completed" || state === "already_downloaded") {
          this.#updateJob(jobId, {
            state: "completed",
            message: "Installed and ready in DJL.",
            finishedAt: this.#now().toISOString(),
          });
          await this.#emitLatestSnapshot();
          return;
        }
        if (state === "failed") throw new Error("LM Studio could not download this model.");
      }
    } catch (cause) {
      if (!signal.aborted) {
        this.#updateJob(jobId, {
          state: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
          finishedAt: this.#now().toISOString(),
        });
        await this.#emitLatestSnapshot();
      }
    } finally {
      this.#jobControllers.delete(jobId);
    }
  }

  #updateJob(id: string, update: Partial<LocalModelInstallJob>): LocalModelInstallJob {
    const current = this.#jobs.get(id);
    if (!current) throw new LocalModelManagerError("updateJob", "The download job was not found.");
    const next = { ...current, ...update };
    this.#jobs.set(id, next);
    return next;
  }

  #updateSetupJob(id: string, update: Partial<LocalModelSetupJob>): LocalModelSetupJob {
    const current = this.#setupJobs.get(id);
    if (!current)
      throw new LocalModelManagerError("updateSetupJob", "The setup job was not found.");
    const next = { ...current, ...update };
    this.#setupJobs.set(id, next);
    return next;
  }

  async #ensureInitialized(): Promise<void> {
    if (!this.#initializePromise) {
      this.#initializePromise = (async () => {
        try {
          const parsed = JSON.parse(await readFile(this.#setupStatePath, "utf8")) as unknown;
          const root = record(parsed);
          const jobs = Array.isArray(root?.jobs) ? root.jobs : [];
          for (const value of jobs.slice(-MAX_RETAINED_SETUP_JOBS)) {
            const job = record(value);
            if (
              !job ||
              typeof job.id !== "string" ||
              (job.runtime !== "ollama" && job.runtime !== "lmstudio") ||
              typeof job.recommendationId !== "string" ||
              typeof job.modelId !== "string" ||
              typeof job.state !== "string" ||
              typeof job.startedAt !== "string"
            ) {
              continue;
            }
            this.#setupJobs.set(job.id, job as unknown as LocalModelSetupJob);
          }
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new LocalModelManagerError(
              "initialize",
              "The saved local AI setup state is not valid.",
              cause,
            );
          }
        }
        for (const job of this.#setupJobs.values()) {
          if (["ready", "failed", "cancelled"].includes(job.state)) continue;
          this.#updateSetupJob(job.id, {
            state: "detecting",
            message: "Resuming local AI setup…",
            finishedAt: null,
          });
          const controller = new AbortController();
          this.#setupControllers.set(job.id, controller);
          queueMicrotask(() => void this.#runSetup(job.id, controller.signal));
        }
      })();
    }
    await this.#initializePromise;
  }

  async #persistSetupJobs(): Promise<void> {
    const payload = `${JSON.stringify({ version: 1, jobs: [...this.#setupJobs.values()] }, null, 2)}\n`;
    this.#setupStateWrite = this.#setupStateWrite
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#setupStatePath), { recursive: true, mode: 0o700 });
        const temporaryPath = `${this.#setupStatePath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporaryPath, payload, { mode: 0o600 });
        await rename(temporaryPath, this.#setupStatePath);
      });
    await this.#setupStateWrite;
  }

  async #getFreeDiskBytes(): Promise<number | null> {
    if (this.#configuredFreeDiskBytes !== undefined) {
      return this.#configuredFreeDiskBytes === null
        ? null
        : finiteNonNegative(this.#configuredFreeDiskBytes);
    }
    try {
      await mkdir(this.#stateDir, { recursive: true, mode: 0o700 });
      const stats = await statfs(this.#stateDir);
      return finiteNonNegative(Number(stats.bavail) * Number(stats.bsize));
    } catch {
      return null;
    }
  }

  #installationKindForCommand(command: string): LocalModelRuntimeInstallationKind {
    const managedRoot = join(this.#stateDir, "local-models", "runtimes");
    return command.startsWith(managedRoot) ? "managed" : "external";
  }

  async #runtimeInstallationKind(
    runtime: LocalModelRuntime,
  ): Promise<LocalModelRuntimeInstallationKind> {
    const command = await this.#resolveRuntimeCommand(runtime);
    return command ? this.#installationKindForCommand(command) : "service_only";
  }

  async #emitLatestSnapshot(): Promise<void> {
    await this.#emitSnapshot(await this.getSnapshot());
  }

  async #emitSnapshot(snapshot: LocalModelsSnapshot): Promise<void> {
    await this.#onSnapshot?.(snapshot);
  }

  async #request(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const signal = init?.signal
        ? AbortSignal.any([controller.signal, init.signal])
        : controller.signal;
      return await this.#fetch(url, { ...init, signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async #resolveRuntimeCommand(runtime: LocalModelRuntime): Promise<string | null> {
    if (runtime === "ollama") {
      const managed = await this.#resolveManagedOllamaCommand();
      if (managed) return managed;
    } else {
      const managed = await this.#resolveManagedLmStudioCommand();
      if (managed) return managed;
    }
    const command =
      runtime === "ollama"
        ? this.#platform === "win32"
          ? "ollama.exe"
          : "ollama"
        : this.#platform === "win32"
          ? "lms.exe"
          : "lms";
    const pathDirectories = (this.#env.PATH ?? "").split(delimiter).filter(Boolean);
    const candidates = [
      ...pathDirectories.map((directory) => join(directory, command)),
      ...(runtime === "ollama"
        ? this.#platform === "darwin"
          ? [
              "/Applications/Ollama.app/Contents/Resources/ollama",
              "/opt/homebrew/bin/ollama",
              "/usr/local/bin/ollama",
            ]
          : this.#platform === "win32"
            ? [join(this.#env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe")]
            : ["/usr/local/bin/ollama", "/usr/bin/ollama"]
        : this.#platform === "darwin"
          ? [join(this.#env.HOME ?? "", ".lmstudio", "bin", "lms")]
          : this.#platform === "win32"
            ? [join(this.#env.USERPROFILE ?? "", ".lmstudio", "bin", "lms.exe")]
            : [join(this.#env.HOME ?? "", ".lmstudio", "bin", "lms")]),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Try the next known location.
      }
    }
    return null;
  }

  async #resolveManagedOllamaCommand(): Promise<string | null> {
    if (this.#managedOllamaCommand) return this.#managedOllamaCommand;
    const command = join(
      this.#stateDir,
      "local-models",
      "runtimes",
      "ollama",
      "current",
      this.#platform === "win32" ? "ollama.exe" : "ollama",
    );
    try {
      await access(command, this.#platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
      this.#managedOllamaCommand = command;
      return command;
    } catch {
      return null;
    }
  }

  async #resolveManagedLmStudioCommand(): Promise<string | null> {
    if (this.#managedLmStudioCommand) return this.#managedLmStudioCommand;
    const command = join(
      this.#stateDir,
      "local-models",
      "runtimes",
      "lmstudio",
      "current",
      ".lmstudio",
      "bin",
      this.#platform === "win32" ? "lms.exe" : "lms",
    );
    try {
      await access(command, this.#platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
      this.#managedLmStudioCommand = command;
      return command;
    } catch {
      return null;
    }
  }

  async #synchronizeOpenCodeConfig(): Promise<void> {
    const models = [...this.#knownModels.values()].flat();
    this.#configWrite = this.#configWrite
      .catch(() => undefined)
      .then(async () => {
        const inventoryFingerprint = models
          .map(({ runtime, modelId }) => `${runtime}:${modelId}`)
          .toSorted()
          .join("|");
        if (inventoryFingerprint === this.#lastSynchronizedInventoryFingerprint) return;
        let current: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(await readFile(this.#configPath, "utf8")) as unknown;
          const parsedRecord = record(parsed);
          if (!parsedRecord) throw new Error("DJL model configuration must be an object.");
          current = parsedRecord;
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new LocalModelManagerError(
              "synchronizeOpenCodeConfig",
              "DJL's managed model configuration is not valid JSON; local providers were not changed.",
              cause,
            );
          }
        }
        const next = buildOpenCodeLocalProviderConfig(
          current,
          models,
          new Set(this.#knownModels.keys()),
        );
        await mkdir(dirname(this.#configPath), { recursive: true });
        const temporaryPath = `${this.#configPath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        await rename(temporaryPath, this.#configPath);
        this.#lastSynchronizedInventoryFingerprint = inventoryFingerprint;
      });
    await this.#configWrite;
  }
}
