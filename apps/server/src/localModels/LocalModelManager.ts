import { spawn, type SpawnOptions } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { totalmem } from "node:os";

import type {
  LocalHardwareProfile,
  LocalInstalledModel,
  LocalModelCapabilityProfile,
  LocalModelHardwareProfile,
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

import {
  curatedModelDisplayName,
  curatedToolSupport,
  inferChampionUseCase,
  isChampionRecommendationForUseCase,
  LOCAL_MODEL_RUNTIME_STORAGE_RESERVE_BYTES,
  LOCAL_MODEL_RECOMMENDATIONS,
  localModelFallbackChain,
  localModelOperatingSystemSupported,
  localModelRecommendationFitsHardware,
  nextSmallerRecommendation,
  recommendLocalModel,
  recommendLocalModelsByUseCase,
  toolCallSupportForParameterSize,
} from "./catalog";
import { collectHardwareProfile, detectHardwareProfile } from "./hardwareProfile";
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
import { resolveLmStudioContext } from "./lmStudioContext";

const OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
const LM_STUDIO_ENDPOINT = "http://127.0.0.1:1234";
const REQUEST_TIMEOUT_MS = 2_500;
const DEFAULT_CANARY_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_CANARY_USABILITY_THRESHOLD_MS = 30_000;
const DEFAULT_HARDWARE_PROFILE_TTL_MS = 15_000;
// First launch can include Windows Defender scanning and GPU discovery. Keep
// polling the localhost API so slow cold starts do not invite repeated retries.
const START_TIMEOUT_MS = 90_000;
const MAX_RETAINED_INSTALL_JOBS = 32;
// LM Studio briefly reports `failed` while retrying some interrupted downloads itself.
const LM_STUDIO_FAILED_STATUS_CONFIRMATIONS = 3;
// A warm-up generation long enough to time reliably but short enough that setup does not stall.
const WARM_UP_TOKENS = 48;
// `num_predict` is a ceiling, not a target, so the prompt has to be one the model will not answer
// in a word or two. Counting runs to the cap on every model without needing a creative answer.
const WARM_UP_PROMPT = "Count from 1 to 60, separated by spaces.";
// Timing a handful of tokens measures call overhead rather than throughput. Measured against a
// real M1 Max: a 2-token reply reads as 9 tok/s where the true rate is above 90.
const MINIMUM_TIMEABLE_TOKENS = 16;
// Loading a cold model into memory dominates this call, so it needs far longer than an API probe.
const WARM_UP_TIMEOUT_MS = 180_000;
// Below this a local model feels like waiting; above it, it feels like typing.
const COMFORTABLE_TOKENS_PER_SECOND = 15;
// Below this the model is not worth using for real work on this machine.
const UNUSABLE_TOKENS_PER_SECOND = 5;
const MAX_RETAINED_SETUP_JOBS = 8;
const GIB = 1024 ** 3;

const MANAGED_OLLAMA_DEVICE_OVERRIDE_KEYS = new Set([
  "CUDA_VISIBLE_DEVICES",
  "GGML_VK_VISIBLE_DEVICES",
  "GPU_DEVICE_ORDINAL",
  "HIP_VISIBLE_DEVICES",
  "OLLAMA_GPU_OVERHEAD",
  "OLLAMA_LLM_LIBRARY",
  "OLLAMA_VULKAN",
  "ROCR_VISIBLE_DEVICES",
  "VK_ADD_DRIVER_FILES",
  "VK_ADD_IMPLICIT_LAYER_PATH",
  "VK_ADD_LAYER_PATH",
  "VK_DRIVER_FILES",
  "VK_ICD_FILENAMES",
  "VK_IMPLICIT_LAYER_PATH",
  "VK_INSTANCE_LAYERS",
  "VK_LAYER_PATH",
  "VK_LOADER_DRIVERS_DISABLE",
  "VK_LOADER_DRIVERS_SELECT",
  "VK_LOADER_LAYERS_ALLOW",
  "VK_LOADER_LAYERS_DISABLE",
  "VK_LOADER_LAYERS_ENABLE",
]);

function managedOllamaBaseEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => !MANAGED_OLLAMA_DEVICE_OVERRIDE_KEYS.has(key.toUpperCase()),
    ),
  );
}

interface RuntimeProbe {
  readonly status: LocalModelRuntimeStatus;
  readonly models: ReadonlyArray<LocalInstalledModel> | null;
}

interface LmStudioRuntimeModel {
  readonly modelId: string;
  readonly name: string;
  readonly managed: boolean;
  readonly maxContextWindowTokens: number | null;
  readonly loadedInstanceId: string | null;
  readonly loadedInstanceIds: ReadonlyArray<string>;
  readonly loadedContextWindowTokens: number | null;
  readonly requiredLoadContextWindowTokens: number | null;
}

export interface LocalModelInferenceCanaryInput {
  readonly runtime: LocalModelRuntime;
  readonly modelId: string;
  readonly signal: AbortSignal;
}

export interface LocalModelCapabilityProbeInput {
  readonly runtime: LocalModelRuntime;
  readonly modelId: string;
}

export interface LocalModelCapabilityProbeResult {
  readonly tier: LocalModelCapabilityProfile["tier"];
  readonly result: LocalModelCapabilityProfile["result"];
  readonly failureReason: string | null;
}

export interface LocalModelManagerOptions {
  readonly stateDir: string;
  readonly managedOpenCodeRootDir?: string;
  readonly fetch?: LocalModelFetch;
  readonly totalMemoryBytes?: number;
  readonly hardwareProfile?: LocalHardwareProfile;
  readonly availableMemoryBytes?: number;
  readonly cpuLogicalCores?: number;
  readonly freeDiskBytes?: number | null;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly osVersion?: string;
  readonly hardwareProfileTtlMs?: number;
  readonly canaryRequestTimeoutMs?: number;
  readonly canaryUsabilityThresholdMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly onSnapshot?: (snapshot: LocalModelsSnapshot) => void | Promise<void>;
  readonly hardwareProfileProvider?: () => Promise<LocalModelHardwareProfile>;
  readonly runInferenceCanary?: (input: LocalModelInferenceCanaryInput) => Promise<void>;
  readonly runCapabilityProbe?: (
    input: LocalModelCapabilityProbeInput,
  ) => Promise<LocalModelCapabilityProbeResult>;
  readonly installOllama?: (options: OllamaInstallOptions) => Promise<OllamaInstallResult>;
  readonly installLmStudio?: (options: LmStudioInstallOptions) => Promise<LmStudioInstallResult>;
  readonly spawnRuntime?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => Pick<ReturnType<typeof spawn>, "once" | "unref">;
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

function assertSupportedSetupPlatform(
  profile: LocalModelHardwareProfile,
  operation: "startSetup" | "retrySetup" | "installRuntime",
  runtime: LocalModelRuntime,
): void {
  if (profile.platform === "win32" && !localModelOperatingSystemSupported(profile)) {
    throw new LocalModelManagerError(
      operation,
      `Local AI requires Windows 10 22H2 or later. This PC is running Windows ${profile.osVersion ?? "an unknown version"}.`,
    );
  }
  if (profile.platform === "darwin" && !localModelOperatingSystemSupported(profile)) {
    throw new LocalModelManagerError(
      operation,
      `Local AI requires macOS 14 or later. This Mac is running macOS ${profile.osVersion ?? "an unknown version"}.`,
    );
  }
  if (profile.platform !== "darwin") return;
  if (runtime === "lmstudio" && profile.cpuArchitecture === "x64") {
    throw new LocalModelManagerError(
      operation,
      "LM Studio local setup requires Apple Silicon. Choose Ollama for an Intel Mac.",
    );
  }
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
    : 0;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasNonEmptyText(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!Array.isArray(value)) return false;
  return value.some((part) => {
    const item = record(part);
    return hasNonEmptyText(item?.text) || hasNonEmptyText(item?.content);
  });
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

// Reports the measured speed plainly so a slow machine is told it is slow, rather than left to
// wonder why the model feels broken.
function readyMessage(tokensPerSecond: number | null): string {
  if (tokensPerSecond === null) return "Local AI is ready to use in chat.";
  if (tokensPerSecond < UNUSABLE_TOKENS_PER_SECOND) {
    return `Local AI is ready, but at about ${tokensPerSecond} tokens per second it is too slow to use comfortably on this computer. Try a smaller option.`;
  }
  if (tokensPerSecond < COMFORTABLE_TOKENS_PER_SECOND) {
    return `Local AI is ready at about ${tokensPerSecond} tokens per second, which is slower than ideal. A smaller option would feel faster.`;
  }
  return `Local AI is ready to use in chat at about ${tokensPerSecond} tokens per second.`;
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
  readonly #hardwareProfileOverride: LocalHardwareProfile | undefined;
  #hardwareSummaryPromise: Promise<LocalHardwareProfile> | null = null;
  readonly #hardwareProfileProvider: () => Promise<LocalModelHardwareProfile>;
  readonly #runInferenceCanary: (input: LocalModelInferenceCanaryInput) => Promise<void>;
  readonly #runCapabilityProbe: (
    input: LocalModelCapabilityProbeInput,
  ) => Promise<LocalModelCapabilityProbeResult>;
  readonly #platform: NodeJS.Platform;
  readonly #arch: NodeJS.Architecture;
  readonly #processArch: NodeJS.Architecture;
  readonly #env: NodeJS.ProcessEnv;
  readonly #hardwareProfileTtlMs: number;
  readonly #canaryRequestTimeoutMs: number;
  readonly #canaryUsabilityThresholdMs: number;
  readonly #now: () => Date;
  readonly #onSnapshot: ((snapshot: LocalModelsSnapshot) => void | Promise<void>) | undefined;
  readonly #jobs = new Map<string, LocalModelInstallJob>();
  readonly #runtimeInstallJobs = new Map<LocalModelRuntime, LocalModelRuntimeInstallJob>();
  readonly #setupJobs = new Map<string, LocalModelSetupJob>();
  readonly #setupControllers = new Map<string, AbortController>();
  readonly #jobControllers = new Map<string, AbortController>();
  readonly #knownModels = new Map<LocalModelRuntime, ReadonlyArray<LocalInstalledModel>>();
  readonly #availableModels = new Map<LocalModelRuntime, ReadonlyArray<LocalInstalledModel>>();
  // Measured tokens per second keyed by `${runtime}:${modelId}`; runtimes cannot report this.
  // Persisted alongside the setup jobs so a restart does not throw the numbers away.
  readonly #measuredSpeeds = new Map<string, number>();
  readonly #capabilityProfiles = new Map<
    string,
    { readonly digest: string; readonly profile: LocalModelCapabilityProfile }
  >();
  // Models already attempted this run, so one that cannot be timed is not retried every tick.
  readonly #attemptedSpeedKeys = new Set<string>();
  #residentMeasurement: Promise<void> | null = null;
  readonly #configPath: string;
  readonly #stateDir: string;
  readonly #installOllama: (options: OllamaInstallOptions) => Promise<OllamaInstallResult>;
  readonly #installLmStudio: (options: LmStudioInstallOptions) => Promise<LmStudioInstallResult>;
  readonly #spawnRuntime: NonNullable<LocalModelManagerOptions["spawnRuntime"]>;
  readonly #runtimeInstalls = new Map<LocalModelRuntime, Promise<LocalModelsSnapshot>>();
  readonly #runtimeStarts = new Map<LocalModelRuntime, Promise<LocalModelsSnapshot>>();
  readonly #lmStudioRuntimeModels = new Map<string, LmStudioRuntimeModel>();
  readonly #lmStudioContextLoads = new Map<string, Promise<void>>();
  readonly #setupStatePath: string;
  #setupStateWrite = Promise.resolve();
  #initializePromise: Promise<void> | null = null;
  #managedOllamaCommand: string | null = null;
  #managedLmStudioCommand: string | null = null;
  #lastSynchronizedInventoryFingerprint: string | null = null;
  #configWrite = Promise.resolve();
  #hardwareProfilePromise: Promise<LocalModelHardwareProfile> | null = null;
  #hardwareProfileResolved = false;
  #hardwareProfileCollectedAtMs = 0;

  constructor(options: LocalModelManagerOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#totalMemoryBytes = options.totalMemoryBytes ?? totalmem();
    this.#hardwareProfileOverride = options.hardwareProfile;
    this.#platform = options.platform ?? process.platform;
    this.#env = options.env ?? process.env;
    const configuredProcessArch = this.#env.DJL_PROCESS_ARCH;
    this.#processArch =
      options.arch ??
      (configuredProcessArch === "arm64" || configuredProcessArch === "x64"
        ? configuredProcessArch
        : process.arch);
    const configuredHostArch = this.#env.DJL_HOST_ARCH;
    this.#arch =
      options.arch ??
      (configuredHostArch === "arm64" || configuredHostArch === "x64"
        ? configuredHostArch
        : process.arch);
    this.#hardwareProfileTtlMs = Math.max(
      0,
      finiteNonNegative(options.hardwareProfileTtlMs ?? DEFAULT_HARDWARE_PROFILE_TTL_MS),
    );
    this.#canaryRequestTimeoutMs = Math.max(
      1,
      finiteNonNegative(options.canaryRequestTimeoutMs ?? DEFAULT_CANARY_REQUEST_TIMEOUT_MS),
    );
    this.#canaryUsabilityThresholdMs = Math.max(
      1,
      finiteNonNegative(
        options.canaryUsabilityThresholdMs ?? DEFAULT_CANARY_USABILITY_THRESHOLD_MS,
      ),
    );
    this.#now = options.now ?? (() => new Date());
    this.#onSnapshot = options.onSnapshot;
    this.#stateDir = options.stateDir;
    this.#installOllama = options.installOllama ?? installOllamaRuntime;
    this.#installLmStudio = options.installLmStudio ?? installLmStudioRuntime;
    this.#spawnRuntime = options.spawnRuntime ?? spawn;
    this.#hardwareProfileProvider =
      options.hardwareProfileProvider ??
      (() =>
        collectHardwareProfile({
          stateDir: options.stateDir,
          platform: this.#platform,
          architecture: this.#arch,
          processArchitecture: this.#processArch,
          runningUnderTranslation: this.#env.DJL_RUNNING_UNDER_TRANSLATION === "1",
          ...(options.osVersion === undefined ? {} : { osVersion: options.osVersion }),
          ...(options.totalMemoryBytes === undefined
            ? {}
            : { totalMemoryBytes: options.totalMemoryBytes, gpus: [] }),
          ...(options.availableMemoryBytes !== undefined
            ? { availableMemoryBytes: options.availableMemoryBytes }
            : options.totalMemoryBytes === undefined
              ? {}
              : { availableMemoryBytes: options.totalMemoryBytes }),
          ...(options.cpuLogicalCores === undefined
            ? {}
            : { cpuLogicalCores: options.cpuLogicalCores }),
          ...(options.freeDiskBytes === undefined ? {} : { freeDiskBytes: options.freeDiskBytes }),
          // A total-memory override is retained for deterministic legacy callers and tests.
          // Real desktop collection has no override and performs Windows GPU discovery.
        }));
    this.#runInferenceCanary =
      options.runInferenceCanary ?? ((input) => this.#runDefaultInferenceCanary(input));
    this.#runCapabilityProbe =
      options.runCapabilityProbe ?? ((input) => this.#runDefaultCapabilityProbe(input));
    this.#configPath = join(
      options.managedOpenCodeRootDir ?? join(options.stateDir, "opencode"),
      "config",
      "opencode",
      "opencode.json",
    );
    this.#setupStatePath = join(this.#stateDir, "local-models", "setup-state.json");
  }

  // Hardware does not change while the app runs, and the probes shell out, so detect once.
  async #getHardwareSummary(): Promise<LocalHardwareProfile> {
    if (this.#hardwareProfileOverride) return this.#hardwareProfileOverride;
    this.#hardwareSummaryPromise ??= detectHardwareProfile({
      platform: this.#platform,
      arch: this.#arch,
      totalMemoryBytes: this.#totalMemoryBytes,
    });
    return this.#hardwareSummaryPromise;
  }

  async getSnapshot(
    options: { readonly synchronizeConfig?: boolean } = {},
  ): Promise<LocalModelsSnapshot> {
    await this.#ensureInitialized();
    const probes = await Promise.all([this.#probeOllama(), this.#probeLmStudio()]);
    for (const probe of probes) {
      if (probe.models !== null) {
        this.#knownModels.set(probe.status.runtime, probe.models);
        this.#availableModels.set(probe.status.runtime, probe.models);
      } else {
        this.#availableModels.delete(probe.status.runtime);
      }
    }
    if (options.synchronizeConfig !== false) {
      await this.#synchronizeOpenCodeConfig();
    }
    const installedModels = [...this.#knownModels.values()]
      .flat()
      .map((model) => this.#modelWithCapabilityProfile(model));
    const [hardware, hardwareProfile] = await Promise.all([
      this.#getHardwareSummary(),
      this.#getHardwareProfile(),
    ]);
    const recommendedModelIdsByUseCase = recommendLocalModelsByUseCase(hardwareProfile);
    return {
      totalMemoryBytes: hardwareProfile.totalMemoryBytes,
      hardware,
      freeDiskBytes: hardwareProfile.freeDiskBytes,
      hardwareProfile,
      recommendedModelId: recommendedModelIdsByUseCase.general,
      recommendedModelIdsByUseCase,
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
    if (
      snapshot.runtimes.some(({ runtime, state }) => runtime === "ollama" && state === "running")
    ) {
      // Detached: a warm-up must never delay the caller, and a failure must never break the loop.
      void this.#measureResidentModel();
    }
    return snapshot;
  }

  // Whether a locally-served model is known to be unable to drive tool calls. Only ever returns
  // false on positive evidence; unknown and hosted models stay null so nothing is withheld on a
  // guess. Callers use this to avoid handing tools to a model that will only mangle them.
  async toolSupportForModel(modelSlug: string): Promise<boolean | null> {
    const runtime: LocalModelRuntime | null = modelSlug.startsWith("ollama/")
      ? "ollama"
      : modelSlug.startsWith("lmstudio/")
        ? "lmstudio"
        : null;
    if (!runtime) return null;
    const modelId = modelSlug.slice(runtime.length + 1);
    const snapshot = await this.getSnapshot({ synchronizeConfig: false });
    const model = snapshot.installedModels.find(
      (candidate) => candidate.runtime === runtime && candidate.modelId === modelId,
    );
    if (!model) return null;
    const digest = this.#capabilityDigest(model);
    if (model.supportsToolCalls === false) {
      this.#capabilityProfiles.set(modelSlug, {
        digest,
        profile: {
          tier: "chat-only",
          runtimeDigest: digest,
          probedAt: this.#now().toISOString(),
          result: "failed",
          failureReason: "The model is known to be unable to produce valid tool calls.",
        },
      });
      await this.#persistSetupState();
      return false;
    }
    const cached = this.#capabilityProfiles.get(modelSlug);
    if (cached?.digest === digest) {
      return cached.profile.result === "passed" && cached.profile.tier !== "chat-only";
    }
    let result: LocalModelCapabilityProbeResult;
    try {
      result = await this.#runCapabilityProbe({ runtime, modelId });
    } catch {
      // An unavailable runtime is not evidence that the model lacks tools. Retry on next use.
      return null;
    }
    if (result.result === "unknown") return null;
    this.#capabilityProfiles.set(modelSlug, {
      digest,
      profile: {
        ...result,
        runtimeDigest: digest,
        probedAt: this.#now().toISOString(),
      },
    });
    await this.#persistSetupState();
    await this.#emitLatestSnapshot();
    return result.result === "passed" && result.tier !== "chat-only";
  }

  async rerunCapabilityCheck(input: LocalModelCapabilityProbeInput): Promise<LocalModelsSnapshot> {
    const modelSlug = `${input.runtime}/${input.modelId}`;
    this.#capabilityProfiles.delete(modelSlug);
    await this.toolSupportForModel(modelSlug);
    const snapshot = await this.getSnapshot({ synchronizeConfig: false });
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
    const modelId = modelSlug.slice(runtime.length + 1);
    const snapshot = await this.getSnapshot({ synchronizeConfig: false });
    const status = snapshot.runtimes.find((candidate) => candidate.runtime === runtime);
    if (!status) return;
    if (status.state === "stopped") {
      await this.startRuntime(runtime);
    } else if (status.state !== "running") {
      throw new LocalModelManagerError(
        "ensureRuntimeForModel",
        status.detail ?? `${status.name} is not ready. Open Local Models settings to repair it.`,
      );
    }
    if (runtime === "lmstudio") {
      if (!this.#lmStudioRuntimeModels.has(modelId)) {
        throw new LocalModelManagerError(
          "ensureRuntimeForModel",
          `LM Studio cannot serve requested model '${modelId}'. Refresh models, install or load it in LM Studio, or choose another model.`,
        );
      }
      await this.#ensureLmStudioModelContext(modelId);
    }
  }

  async #ensureLmStudioModelContext(modelId: string): Promise<void> {
    const existing = this.#lmStudioContextLoads.get(modelId);
    if (existing) return existing;
    const operation = this.#runLmStudioModelContextLoad(modelId);
    this.#lmStudioContextLoads.set(modelId, operation);
    try {
      await operation;
    } finally {
      if (this.#lmStudioContextLoads.get(modelId) === operation) {
        this.#lmStudioContextLoads.delete(modelId);
      }
    }
  }

  async #runLmStudioModelContextLoad(modelId: string): Promise<void> {
    const model = this.#lmStudioRuntimeModels.get(modelId);
    if (!model) {
      throw new LocalModelManagerError(
        "ensureRuntimeForModel",
        `LM Studio cannot serve requested model '${modelId}'. Refresh models, install or load it in LM Studio, or choose another model.`,
      );
    }
    const requiredContext = model?.requiredLoadContextWindowTokens ?? null;
    const exactInstanceLoaded = model.loadedInstanceId === model.modelId;
    if (!model.managed) {
      if (!exactInstanceLoaded) {
        const resolved =
          model.loadedInstanceIds.length > 0
            ? `; LM Studio currently exposes '${model.loadedInstanceIds.join("', '")}' instead`
            : "";
        throw new LocalModelManagerError(
          "ensureRuntimeForModel",
          `LM Studio model '${model.modelId}' is available but not loaded with that API identifier${resolved}. Load it in LM Studio, refresh models, or choose another model.`,
        );
      }
      return;
    }
    if (exactInstanceLoaded && requiredContext === null) return;
    try {
      for (const loadedInstanceId of model.loadedInstanceIds) {
        const unload = await this.#request(`${LM_STUDIO_ENDPOINT}/api/v1/models/unload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instance_id: loadedInstanceId }),
        });
        if (!unload.ok) throw new Error(`LM Studio unload returned HTTP ${unload.status}.`);
      }
      const load = await this.#request(
        `${LM_STUDIO_ENDPOINT}/api/v1/models/load`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model.modelId,
            ...(requiredContext !== null ? { context_length: requiredContext } : {}),
            echo_load_config: true,
          }),
        },
        WARM_UP_TIMEOUT_MS,
      );
      if (!load.ok) throw new Error(`LM Studio load returned HTTP ${load.status}.`);
      const body = record(await responseJson(load));
      const appliedContext = finitePositive(record(body?.load_config)?.context_length);
      const loadedInstanceId = typeof body?.instance_id === "string" ? body.instance_id.trim() : "";
      if (
        body?.status !== "loaded" ||
        loadedInstanceId !== model.modelId ||
        (requiredContext !== null && (appliedContext === null || appliedContext < requiredContext))
      ) {
        if (loadedInstanceId !== model.modelId) {
          throw new Error(
            `LM Studio loaded '${loadedInstanceId || "an unknown instance"}' instead of requested model '${model.modelId}'.`,
          );
        }
        throw new Error(
          `LM Studio loaded ${model.name} with an ${appliedContext ?? "unknown"}-token context; DJL tools require at least ${requiredContext}.`,
        );
      }
      const probe = await this.#probeLmStudio();
      if (probe.models === null) {
        throw new Error(`LM Studio stopped responding after loading '${model.modelId}'.`);
      }
      this.#knownModels.set("lmstudio", probe.models);
      this.#availableModels.set("lmstudio", probe.models);
      if (this.#lmStudioRuntimeModels.get(model.modelId)?.loadedInstanceId !== model.modelId) {
        throw new Error(
          `LM Studio did not expose requested model '${model.modelId}' after loading it.`,
        );
      }
      await this.#synchronizeOpenCodeConfig();
    } catch (cause) {
      if (cause instanceof LocalModelManagerError) throw cause;
      throw new LocalModelManagerError(
        "ensureRuntimeForModel",
        cause instanceof Error ? cause.message : "LM Studio could not prepare the selected model.",
        cause,
      );
    }
  }

  // Brings an already-installed Ollama up at launch. A stopped runtime reports no inventory, so
  // without this the user's installed models are missing from the model picker until they find the
  // start button in settings — which is exactly the step a non-technical user will not find.
  //
  // Only Ollama: it is the runtime DJL installs and manages, it serves on loopback, and it costs
  // nothing until a model is actually loaded. LM Studio is a user-owned GUI app and is left alone.
  // Never installs anything, and never rejects — launch must not depend on this succeeding.
  async startInstalledRuntimes(): Promise<void> {
    try {
      const snapshot = await this.getSnapshot({ synchronizeConfig: false });
      const status = snapshot.runtimes.find(({ runtime }) => runtime === "ollama");
      if (status?.state !== "stopped") return;
      await this.startRuntime("ollama");
    } catch {
      // Leaves the runtime stopped and the manual start button in settings as the fallback.
    }
  }

  async startSetup(input: LocalModelSetupInput): Promise<LocalModelSetupJob> {
    await this.#ensureInitialized();
    const runtime = input.runtime ?? "ollama";
    const useCase =
      input.useCase ??
      (input.recommendationId ? inferChampionUseCase(input.recommendationId) : null) ??
      "general";
    const active = this.#activeSetupJob();
    if (active) {
      if (active.runtime === runtime && (active.useCase ?? "general") === useCase) return active;
      throw new LocalModelManagerError(
        "startSetup",
        "Another local AI is already being prepared. Let it finish or cancel it first.",
      );
    }
    const hardwareProfile = await this.#getHardwareProfile(true);
    assertSupportedSetupPlatform(hardwareProfile, "startSetup", runtime);
    const racedActive = this.#activeSetupJob();
    if (racedActive) {
      if (racedActive.runtime === runtime && (racedActive.useCase ?? "general") === useCase) {
        return racedActive;
      }
      throw new LocalModelManagerError(
        "startSetup",
        "Another local AI is already being prepared. Let it finish or cancel it first.",
      );
    }
    const recommendation = input.recommendationId
      ? LOCAL_MODEL_RECOMMENDATIONS.find(({ id }) => id === input.recommendationId)
      : (recommendLocalModel(hardwareProfile, useCase) ??
        // Let the setup job surface an actionable disk-space message when hardware
        // capacity is otherwise sufficient, instead of failing before a job exists.
        recommendLocalModel({ ...hardwareProfile, freeDiskBytes: null }, useCase));
    if (!recommendation) {
      throw new LocalModelManagerError("startSetup", "No recommended local model is available.");
    }
    if (
      input.recommendationId &&
      (!isChampionRecommendationForUseCase(recommendation.id, useCase) ||
        !localModelRecommendationFitsHardware(recommendation, {
          ...hardwareProfile,
          freeDiskBytes: null,
        }))
    ) {
      throw new LocalModelManagerError(
        "startSetup",
        "That local model is not a safe champion for the selected category on this computer.",
      );
    }
    const source = recommendation.sources.find((candidate) => candidate.runtime === runtime);
    if (!source) {
      throw new LocalModelManagerError(
        "startSetup",
        `${recommendation.name} is not available for ${runtimeMetadata(runtime).name}.`,
      );
    }
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
      useCase,
      recommendationId: recommendation.id,
      modelId: source.modelId,
      state: "detecting",
      downloadedBytes: 0,
      totalBytes: finiteNonNegative(source.estimatedDownloadBytes),
      message: "Checking this computer…",
      tokensPerSecond: null,
      suggestedFallbackId: null,
      startedAt: this.#now().toISOString(),
      finishedAt: null,
    };
    this.#setupJobs.set(job.id, job);
    await this.#persistSetupState();
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
    const useCase = job.useCase ?? "general";
    const active = this.#activeSetupJob(jobId);
    if (active) {
      if (active.runtime === job.runtime && (active.useCase ?? "general") === useCase)
        return active;
      throw new LocalModelManagerError(
        "retrySetup",
        "Another local AI is already being prepared. Let it finish or cancel it first.",
      );
    }
    const hardwareProfile = await this.#getHardwareProfile(true);
    assertSupportedSetupPlatform(hardwareProfile, "retrySetup", job.runtime);
    const recommendation =
      recommendLocalModel(hardwareProfile, useCase) ??
      recommendLocalModel({ ...hardwareProfile, freeDiskBytes: null }, useCase);
    if (!recommendation) {
      throw new LocalModelManagerError(
        "retrySetup",
        "No recommended local model is available for this computer right now.",
      );
    }
    const source = recommendation.sources.find(({ runtime }) => runtime === job.runtime);
    if (!source) {
      throw new LocalModelManagerError(
        "retrySetup",
        `${recommendation.name} is not available for ${runtimeMetadata(job.runtime).name}.`,
      );
    }
    const latestJob = this.#setupJobs.get(jobId);
    if (!latestJob) {
      throw new LocalModelManagerError("retrySetup", "The setup job was not found.");
    }
    if (latestJob.state !== "failed" && latestJob.state !== "cancelled") return latestJob;
    const racedActive = this.#activeSetupJob();
    if (racedActive) {
      if (racedActive.id === jobId) return racedActive;
      if (racedActive.runtime === job.runtime && (racedActive.useCase ?? "general") === useCase) {
        return racedActive;
      }
      throw new LocalModelManagerError(
        "retrySetup",
        "Another local AI is already being prepared. Let it finish or cancel it first.",
      );
    }
    const retried = this.#updateSetupJob(jobId, {
      recommendationId: recommendation.id,
      modelId: source.modelId,
      state: "detecting",
      downloadedBytes: 0,
      totalBytes: finiteNonNegative(source.estimatedDownloadBytes),
      message: "Checking this computer…",
      tokensPerSecond: null,
      suggestedFallbackId: null,
      finishedAt: null,
    });
    await this.#persistSetupState();
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
    await this.#persistSetupState();
    await this.#emitLatestSnapshot();
    return cancelled;
  }

  async #runSetup(jobId: string, signal: AbortSignal): Promise<void> {
    try {
      let snapshot = await this.getSnapshot();
      const initial = this.#setupJobs.get(jobId);
      if (!initial || signal.aborted) return;
      const fallbacks = localModelFallbackChain(
        initial.recommendationId,
        initial.useCase ?? "general",
      );
      if (fallbacks.length === 0) throw new Error("Local AI setup is no longer available.");

      for (let candidateIndex = 0; candidateIndex < fallbacks.length; candidateIndex += 1) {
        const recommendation = fallbacks[candidateIndex];
        if (!recommendation) continue;
        const source = recommendation.sources.find(({ runtime }) => runtime === initial.runtime);
        if (!source) continue;
        const runtimeStatus = snapshot.runtimes.find(({ runtime }) => runtime === initial.runtime);
        if (!runtimeStatus) throw new Error("Local AI setup is no longer available.");

        this.#updateSetupJob(jobId, {
          recommendationId: recommendation.id,
          modelId: source.modelId,
          state: "detecting",
          downloadedBytes: 0,
          totalBytes: finiteNonNegative(source.estimatedDownloadBytes),
          message:
            candidateIndex === 0
              ? "Checking this computer…"
              : "Choosing a more compatible local AI…",
        });
        await this.#persistSetupState();
        await this.#emitLatestSnapshot();

        const alreadyInstalled = snapshot.installedModels.some(
          ({ runtime, modelId }) => runtime === initial.runtime && modelId === source.modelId,
        );
        if (!alreadyInstalled) {
          const runtimeBytes =
            runtimeStatus.state === "not_installed"
              ? Math.max(
                  runtimeStatus.estimatedDownloadBytes,
                  LOCAL_MODEL_RUNTIME_STORAGE_RESERVE_BYTES,
                )
              : 0;
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
            message: "Preparing local AI…",
          });
          await this.#persistSetupState();
          await this.#emitLatestSnapshot();
          snapshot = await this.installRuntime(initial.runtime);
        } else if (runtimeStatus.state === "stopped") {
          this.#updateSetupJob(jobId, {
            state: "starting_runtime",
            message: "Starting local AI…",
          });
          await this.#persistSetupState();
          await this.#emitLatestSnapshot();
          snapshot = await this.startRuntime(initial.runtime);
        } else if (runtimeStatus.state !== "running") {
          throw new Error("Local AI could not be started.");
        }
        if (signal.aborted) return;

        const installedAfterStart = snapshot.installedModels.some(
          ({ runtime, modelId }) => runtime === initial.runtime && modelId === source.modelId,
        );
        let downloadedByThisSetup = false;
        if (!alreadyInstalled && !installedAfterStart) {
          this.#updateSetupJob(jobId, {
            state: "downloading_model",
            downloadedBytes: 0,
            totalBytes: finiteNonNegative(source.estimatedDownloadBytes),
            message: "Downloading local AI…",
          });
          await this.#persistSetupState();
          await this.#emitLatestSnapshot();
          const existingInstall = [...this.#jobs.values()].find(
            (job) =>
              job.runtime === initial.runtime &&
              job.modelId === source.modelId &&
              (job.state === "queued" || job.state === "downloading"),
          );
          const installInput: LocalModelInstallInput =
            source.runtime === "lmstudio"
              ? {
                  runtime: "lmstudio",
                  modelId: source.modelId,
                  ...("quantization" in source && source.quantization
                    ? { quantization: source.quantization }
                    : {}),
                }
              : { runtime: "ollama", modelId: source.modelId };
          const installJob = await this.installModel(installInput);
          downloadedByThisSetup = existingInstall === undefined;
          while (!signal.aborted) {
            const currentInstall = this.#jobs.get(installJob.id);
            if (!currentInstall) throw new Error("Local AI download did not complete.");
            this.#updateSetupJob(jobId, {
              downloadedBytes: currentInstall.downloadedBytes,
              totalBytes:
                currentInstall.totalBytes ?? finiteNonNegative(source.estimatedDownloadBytes),
              message: "Downloading local AI…",
            });
            if (currentInstall.state === "completed") break;
            if (currentInstall.state === "failed" || currentInstall.state === "cancelled") {
              throw new Error("Local AI download did not complete.");
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        if (signal.aborted) return;

        this.#updateSetupJob(jobId, {
          state: "synchronizing",
          message: "Verifying local AI…",
        });
        await this.#persistSetupState();
        await this.#emitLatestSnapshot();
        snapshot = await this.getSnapshot();
        if (
          !snapshot.installedModels.some(
            ({ runtime, modelId }) => runtime === initial.runtime && modelId === source.modelId,
          )
        ) {
          throw new Error("Local AI is not available after download.");
        }

        this.#updateSetupJob(jobId, {
          state: "verifying",
          message: "Checking that local AI works well here…",
        });
        await this.#persistSetupState();
        await this.#emitLatestSnapshot();

        try {
          await this.#runInferenceCanary({
            runtime: initial.runtime,
            modelId: source.modelId,
            signal,
          });
        } catch {
          if (signal.aborted) return;
          if (candidateIndex + 1 < fallbacks.length) {
            if (downloadedByThisSetup) {
              await this.#bestEffortRemoveSetupModel(initial.runtime, source.modelId);
            }
            // A failed model load can stop the local runtime. Probe again so the
            // next, smaller candidate can restart it instead of inheriting stale state.
            snapshot = await this.getSnapshot();
            continue;
          }
          throw new Error("Local AI could not complete its readiness check.");
        }

        let tokensPerSecond: number | null = null;
        if (initial.runtime === "ollama") {
          tokensPerSecond = await this.#measureTokensPerSecond(source.modelId, signal);
          if (tokensPerSecond !== null) {
            this.#measuredSpeeds.set(`${initial.runtime}:${source.modelId}`, tokensPerSecond);
          }
        }
        if (signal.aborted) return;
        const suggestedFallbackId =
          tokensPerSecond !== null && tokensPerSecond < COMFORTABLE_TOKENS_PER_SECOND
            ? (fallbacks[candidateIndex + 1]?.id ??
              nextSmallerRecommendation(recommendation.id)?.id ??
              null)
            : null;
        this.#updateSetupJob(jobId, {
          state: "ready",
          downloadedBytes: finiteNonNegative(source.estimatedDownloadBytes),
          totalBytes: finiteNonNegative(source.estimatedDownloadBytes),
          message: readyMessage(tokensPerSecond),
          tokensPerSecond,
          suggestedFallbackId,
          finishedAt: this.#now().toISOString(),
        });
        await this.#persistSetupState();
        await this.#emitLatestSnapshot();
        return;
      }
      throw new Error("No compatible local AI option is available.");
    } catch (cause) {
      if (signal.aborted) return;
      const detail = cause instanceof Error ? cause.message : String(cause);
      this.#updateSetupJob(jobId, {
        state: "failed",
        message: detail.startsWith("Not enough free disk space")
          ? detail
          : "Local AI setup could not be completed. Retry setup.",
        finishedAt: this.#now().toISOString(),
      });
      await this.#persistSetupState();
      await this.#emitLatestSnapshot();
    } finally {
      this.#setupControllers.delete(jobId);
    }
  }

  // Models installed before DJL, or added through the custom model field, never went through a
  // setup run, so nothing ever timed them. `/api/ps` lists what Ollama already holds in memory:
  // timing one of those costs a single short generation, where loading a cold model to benchmark
  // it would evict whatever the user is actually working with. One model per refresh, so a slow
  // machine never stacks warm-ups, and a model that cannot be timed is not retried every tick.
  async #measureResidentModel(): Promise<void> {
    if (this.#residentMeasurement) return;
    // A setup run does its own timed generation. Two at once would understate both, which is the
    // false "slower than ideal" alarm this measurement exists to avoid.
    const setupRunning = [...this.#setupJobs.values()].some(
      (job) => !["ready", "failed", "cancelled"].includes(job.state),
    );
    if (setupRunning) return;
    this.#residentMeasurement = (async () => {
      try {
        const response = await this.#request(`${OLLAMA_ENDPOINT}/api/ps`);
        if (!response.ok) return;
        const body = record(await responseJson(response));
        const resident = Array.isArray(body?.models) ? body.models : [];
        const modelId = resident
          .map((value) => {
            const model = record(value);
            return typeof model?.name === "string" ? model.name : "";
          })
          .find(
            (name) =>
              name &&
              !this.#measuredSpeeds.has(`ollama:${name}`) &&
              !this.#attemptedSpeedKeys.has(`ollama:${name}`),
          );
        if (!modelId) return;
        this.#attemptedSpeedKeys.add(`ollama:${modelId}`);
        const tokensPerSecond = await this.#measureTokensPerSecond(modelId);
        if (tokensPerSecond === null) return;
        this.#measuredSpeeds.set(`ollama:${modelId}`, tokensPerSecond);
        await this.#persistSetupState();
        await this.#emitLatestSnapshot();
      } catch {
        // The refresh loop must survive a runtime that disappears mid-measurement.
      } finally {
        this.#residentMeasurement = null;
      }
    })();
    await this.#residentMeasurement;
  }

  // Runs one short generation and times it. This turns "should be fast enough" into a number, and
  // leaves the model resident so the user's first real message has no cold-start delay.
  async #measureTokensPerSecond(modelId: string, signal?: AbortSignal): Promise<number | null> {
    try {
      const response = await this.#request(
        `${OLLAMA_ENDPOINT}/api/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelId,
            prompt: WARM_UP_PROMPT,
            stream: false,
            options: { num_predict: WARM_UP_TOKENS },
          }),
          ...(signal ? { signal } : {}),
        },
        WARM_UP_TIMEOUT_MS,
      );
      if (!response.ok) return null;
      const body = record(await responseJson(response));
      const tokens = finiteNonNegative(body?.eval_count);
      const nanoseconds = finiteNonNegative(body?.eval_duration);
      // Too short a sample is worse than no measurement: it understates a fast machine badly
      // enough to warn the user about a model that is actually running well.
      if (tokens < MINIMUM_TIMEABLE_TOKENS || nanoseconds <= 0) return null;
      return Math.round(tokens / (nanoseconds / 1e9));
    } catch {
      // A model that cannot be timed still works; the speed label is simply unavailable.
      return null;
    }
  }

  async #bestEffortRemoveSetupModel(runtime: LocalModelRuntime, modelId: string): Promise<void> {
    // LM Studio does not currently expose a deletion operation that DJL can use safely.
    if (runtime !== "ollama") return;
    try {
      let snapshot = await this.getSnapshot({ synchronizeConfig: false });
      let status = snapshot.runtimes.find((candidate) => candidate.runtime === runtime);
      if (status?.state === "stopped") {
        snapshot = await this.startRuntime(runtime);
        status = snapshot.runtimes.find((candidate) => candidate.runtime === runtime);
      }
      if (status?.state !== "running") return;
      const response = await this.#request(`${OLLAMA_ENDPOINT}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
      if (response.ok) this.#knownModels.delete(runtime);
    } catch {
      // Cleanup is best-effort; fallback setup must continue even when deletion fails.
    }
  }

  async installRuntime(runtime: LocalModelRuntime): Promise<LocalModelsSnapshot> {
    await this.#ensureInitialized();
    const hardwareProfile = await this.#getHardwareProfile();
    assertSupportedSetupPlatform(hardwareProfile, "installRuntime", runtime);
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
      // Only the model directory is DJL's to decide, because DJL owns that storage. How the model
      // runs — the context window above all — is left entirely to Ollama's own defaults. DJL is a
      // UI over the opencode harness, not a tuner of the runtime: pinning OLLAMA_CONTEXT_LENGTH
      // here capped the window at 8192 where Ollama would have given 32768, which measurably
      // degraded local models.
      const env = managedOllama
        ? {
            ...managedOllamaBaseEnvironment(this.#env),
            OLLAMA_MODELS: join(this.#stateDir, "local-models", "ollama", "models"),
            // Keep implicit graphics overlays out of the private inference process. Older
            // Vulkan loaders may ignore this, which is harmless.
            VK_LOADER_LAYERS_DISABLE: "~implicit~",
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
      const spawnOptions: SpawnOptions = {
        // A detached Windows console process creates a new visible console.
        // With ignored stdio, unref is sufficient for it to outlive DJL.
        detached: this.#platform !== "win32",
        env,
        stdio: "ignore",
        windowsHide: true,
      };
      if (runtime === "lmstudio") {
        await new Promise<void>((resolve, reject) => {
          const child = this.#spawnRuntime(command, ["daemon", "up", "--json"], {
            ...spawnOptions,
            detached: false,
          });
          child.once("error", reject);
          child.once("exit", (code, signal) => {
            if (code === 0) {
              resolve();
            } else if (code !== null) {
              reject(new Error(`LM Studio command exited with code ${code}.`));
            } else {
              reject(new Error(`LM Studio command exited after signal ${signal ?? "unknown"}.`));
            }
          });
        });
      }
      const commands = runtime === "ollama" ? [["serve"]] : [["server", "start", "--port", "1234"]];
      for (const args of commands) {
        const child = this.#spawnRuntime(command, args, {
          ...spawnOptions,
        });
        child.once("error", (error) => {
          spawnState.error = error;
        });
        child.once("exit", (code, signal) => {
          if (code !== null && code !== 0) {
            spawnState.error = new Error(
              `${runtimeMetadata(runtime).name} command exited with code ${code}.`,
            );
          } else if (signal) {
            spawnState.error = new Error(
              `${runtimeMetadata(runtime).name} command exited after signal ${signal}.`,
            );
          }
        });
        child.unref();
      }
    } catch (cause) {
      throw new LocalModelManagerError(
        "startRuntime",
        `Failed to start ${runtimeMetadata(runtime).name}${
          cause instanceof Error ? `: ${cause.message}` : "."
        }`,
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
        const details = record(model?.details);
        return [
          {
            runtime: "ollama",
            modelId,
            name: curatedModelDisplayName("ollama", modelId) ?? modelId,
            sizeBytes: finiteNonNegative(model?.size),
            contextWindowTokens: null,
            // Curated tiers carry a measured verdict; anything else falls back to parameter size.
            supportsToolCalls:
              curatedToolSupport("ollama", modelId) ??
              toolCallSupportForParameterSize(details?.parameter_size),
            tokensPerSecond: this.#measuredSpeeds.get(`ollama:${modelId}`) ?? null,
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
    } catch {
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
          this.#lmStudioRuntimeModels.clear();
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
      const installationKind = await this.#runtimeInstallationKind("lmstudio");
      const managed = installationKind === "managed";
      const runtimeModels: LmStudioRuntimeModel[] = [];
      const models = rawModels.flatMap((value): LocalInstalledModel[] => {
        const model = record(value);
        const modelId = typeof model?.key === "string" ? model.key : "";
        if (!model || !modelId || model.type === "embedding") return [];
        const maxContextWindowTokens = finitePositive(model.max_context_length);
        const loadedInstances = Array.isArray(model.loaded_instances) ? model.loaded_instances : [];
        const loadedInstanceRecords = loadedInstances.flatMap((instance) => {
          const parsed = record(instance);
          return parsed ? [parsed] : [];
        });
        const loadedInstanceIds = loadedInstanceRecords.flatMap((instance) =>
          typeof instance.id === "string" && instance.id.trim().length > 0
            ? [instance.id.trim()]
            : [],
        );
        const exactInstance = loadedInstanceRecords.find((instance) => instance.id === modelId);
        const loadedContextWindowTokens = finitePositive(
          record(exactInstance?.config)?.context_length,
        );
        const reportedToolSupport = record(model.capabilities)?.trained_for_tool_use;
        const intrinsicToolSupport =
          curatedToolSupport("lmstudio", modelId) ??
          (typeof reportedToolSupport === "boolean"
            ? reportedToolSupport
            : toolCallSupportForParameterSize(model.params_string));
        const context = resolveLmStudioContext({
          managed,
          supportsToolCalls: intrinsicToolSupport,
          maxContextWindowTokens,
          loadedContextWindowTokens,
        });
        const name =
          curatedModelDisplayName("lmstudio", modelId) ??
          (typeof model.display_name === "string" ? model.display_name : modelId);
        runtimeModels.push({
          modelId,
          name,
          managed,
          maxContextWindowTokens,
          loadedInstanceId: typeof exactInstance?.id === "string" ? exactInstance.id : null,
          loadedInstanceIds,
          loadedContextWindowTokens,
          requiredLoadContextWindowTokens: context.requiredLoadContextWindowTokens,
        });
        return [
          {
            runtime: "lmstudio",
            modelId,
            name,
            sizeBytes: finiteNonNegative(model.size_bytes),
            contextWindowTokens: context.effectiveContextWindowTokens,
            maxContextWindowTokens,
            loadedContextWindowTokens,
            toolContextWindowReady: intrinsicToolSupport === true ? context.toolsUsable : null,
            supportsToolCalls:
              intrinsicToolSupport === true ? context.toolsUsable : intrinsicToolSupport,
            tokensPerSecond: null,
          },
        ];
      });
      this.#lmStudioRuntimeModels.clear();
      for (const model of runtimeModels) this.#lmStudioRuntimeModels.set(model.modelId, model);
      return {
        status: {
          runtime: "lmstudio",
          ...metadata,
          state: "running",
          version: null,
          installationKind,
          detail: null,
          capabilities: runtimeCapabilities("lmstudio", "running"),
        },
        models,
      };
    } catch {
      this.#lmStudioRuntimeModels.clear();
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
      let consecutiveFailedStatuses = 0;
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
          message:
            state === "paused"
              ? "Paused in LM Studio."
              : state === "failed"
                ? "LM Studio reported an error; waiting for its automatic retry…"
                : "Downloading in LM Studio…",
        });
        await this.#emitLatestSnapshot();
        if (state === "failed") {
          consecutiveFailedStatuses += 1;
          if (consecutiveFailedStatuses >= LM_STUDIO_FAILED_STATUS_CONFIRMATIONS) {
            throw new Error("LM Studio could not download this model.");
          }
          continue;
        }
        consecutiveFailedStatuses = 0;
        if (state === "completed" || state === "already_downloaded") {
          this.#updateJob(jobId, {
            state: "completed",
            message: "Installed and ready in DJL.",
            finishedAt: this.#now().toISOString(),
          });
          await this.#emitLatestSnapshot();
          return;
        }
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

  #activeSetupJob(excludeJobId?: string): LocalModelSetupJob | undefined {
    return [...this.#setupJobs.values()].find(
      (job) => job.id !== excludeJobId && !["ready", "failed", "cancelled"].includes(job.state),
    );
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
              typeof job.startedAt !== "string" ||
              (job.useCase !== undefined &&
                !["general", "document", "reasoning", "coding"].includes(String(job.useCase)))
            ) {
              continue;
            }
            this.#setupJobs.set(job.id, job as unknown as LocalModelSetupJob);
          }
          // A speed entry the app cannot trust is dropped on its own; the model is simply
          // measured again rather than blocking startup.
          for (const [key, value] of Object.entries(record(root?.speeds) ?? {})) {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
              this.#measuredSpeeds.set(key, value);
            }
          }
          for (const [modelSlug, value] of Object.entries(record(root?.capabilityProfiles) ?? {})) {
            const entry = record(value);
            const profile = record(entry?.profile);
            if (
              typeof entry?.digest === "string" &&
              (profile?.tier === "chat-only" ||
                profile?.tier === "assisted" ||
                profile?.tier === "agentic") &&
              (profile.result === "passed" ||
                profile.result === "failed" ||
                profile.result === "unknown") &&
              typeof profile.runtimeDigest === "string" &&
              typeof profile.probedAt === "string" &&
              (profile.failureReason === null || typeof profile.failureReason === "string")
            ) {
              this.#capabilityProfiles.set(modelSlug, {
                digest: entry.digest,
                profile: profile as unknown as LocalModelCapabilityProfile,
              });
            }
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
        const resumableJobs = [...this.#setupJobs.values()]
          .filter((job) => !["ready", "failed", "cancelled"].includes(job.state))
          .toSorted(
            (left, right) =>
              right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id),
          );
        const jobToResume = resumableJobs[0];
        for (const staleJob of resumableJobs.slice(1)) {
          this.#updateSetupJob(staleJob.id, {
            state: "cancelled",
            message: "A newer local AI setup was resumed instead.",
            finishedAt: this.#now().toISOString(),
          });
        }
        if (resumableJobs.length > 1) await this.#persistSetupState();
        if (jobToResume) {
          this.#updateSetupJob(jobToResume.id, {
            state: "detecting",
            message: "Resuming local AI setup…",
            finishedAt: null,
          });
          const controller = new AbortController();
          this.#setupControllers.set(jobToResume.id, controller);
          queueMicrotask(() => void this.#runSetup(jobToResume.id, controller.signal));
        }
      })();
    }
    await this.#initializePromise;
  }

  async #persistSetupState(): Promise<void> {
    const payload = `${JSON.stringify(
      {
        version: 2,
        jobs: [...this.#setupJobs.values()],
        speeds: Object.fromEntries(this.#measuredSpeeds),
        capabilityProfiles: Object.fromEntries(this.#capabilityProfiles),
      },
      null,
      2,
    )}\n`;
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

  async #getHardwareProfile(refresh = false): Promise<LocalModelHardwareProfile> {
    const stale =
      this.#hardwareProfileResolved &&
      Date.now() - this.#hardwareProfileCollectedAtMs >= this.#hardwareProfileTtlMs;
    if (refresh || stale) {
      this.#hardwareProfilePromise = null;
      this.#hardwareProfileResolved = false;
    }
    if (!this.#hardwareProfilePromise) {
      const pending = this.#hardwareProfileProvider();
      this.#hardwareProfilePromise = pending;
      pending.then(
        () => {
          if (this.#hardwareProfilePromise !== pending) return;
          this.#hardwareProfileResolved = true;
          this.#hardwareProfileCollectedAtMs = Date.now();
        },
        () => {
          if (this.#hardwareProfilePromise !== pending) return;
          this.#hardwareProfilePromise = null;
          this.#hardwareProfileResolved = false;
        },
      );
    }
    return await this.#hardwareProfilePromise;
  }

  async #runDefaultInferenceCanary(input: LocalModelInferenceCanaryInput): Promise<void> {
    const controller = new AbortController();
    const startedAtMs = performance.now();
    const timeout = setTimeout(() => controller.abort(), this.#canaryRequestTimeoutMs);
    try {
      const response = await this.#fetch(
        `${runtimeMetadata(input.runtime).endpoint}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: input.modelId,
            messages: [{ role: "user", content: "Reply with READY." }],
            max_tokens: 32,
            stream: false,
          }),
          signal: AbortSignal.any([controller.signal, input.signal]),
        },
      );
      if (!response.ok) throw new Error("Local inference readiness request failed.");
      const payload = record(await responseJson(response));
      if (performance.now() - startedAtMs > this.#canaryUsabilityThresholdMs) {
        throw new Error("Local inference is too slow for automatic setup.");
      }
      const firstChoice = Array.isArray(payload?.choices) ? record(payload.choices[0]) : null;
      const message = record(firstChoice?.message);
      if (
        !hasNonEmptyText(message?.content) &&
        !hasNonEmptyText(message?.reasoning_content) &&
        !hasNonEmptyText(firstChoice?.text)
      ) {
        throw new Error("Local inference returned an empty response.");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  #capabilityDigest(model: LocalInstalledModel): string {
    return [
      model.runtime,
      model.modelId,
      model.sizeBytes,
      model.contextWindowTokens ?? "unknown",
      model.loadedContextWindowTokens ?? "unknown",
    ].join(":");
  }

  #modelWithCapabilityProfile(model: LocalInstalledModel): LocalInstalledModel {
    const cached = this.#capabilityProfiles.get(`${model.runtime}/${model.modelId}`);
    return cached?.digest === this.#capabilityDigest(model)
      ? { ...model, capabilityProfile: cached.profile }
      : model;
  }

  async #runDefaultCapabilityProbe(
    input: LocalModelCapabilityProbeInput,
  ): Promise<LocalModelCapabilityProbeResult> {
    const endpoint = `${runtimeMetadata(input.runtime).endpoint}/v1/chat/completions`;
    const request = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#canaryRequestTimeoutMs);
      try {
        const response = await this.#fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: input.modelId, stream: false, max_tokens: 96, ...body }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Capability probe returned HTTP ${response.status}.`);
        return record(await responseJson(response)) ?? {};
      } finally {
        clearTimeout(timeout);
      }
    };
    const messageFrom = (payload: Record<string, unknown>): Record<string, unknown> | null => {
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      return record(record(choices[0])?.message);
    };
    const toolCallsFrom = (
      message: Record<string, unknown> | null,
    ): ReadonlyArray<Record<string, unknown>> =>
      Array.isArray(message?.tool_calls)
        ? message.tool_calls.flatMap((value) => {
            const parsed = record(value);
            return parsed ? [parsed] : [];
          })
        : [];
    const tool = {
      type: "function",
      function: {
        name: "djl_capability_probe",
        description: "Return a deterministic probe token.",
        parameters: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
          additionalProperties: false,
        },
      },
    };

    const plain = messageFrom(
      await request({ messages: [{ role: "user", content: "Reply with READY." }] }),
    );
    if (!hasNonEmptyText(plain?.content) && !hasNonEmptyText(plain?.reasoning_content)) {
      return {
        tier: "chat-only",
        result: "failed",
        failureReason: "The model did not complete the plain-chat capability probe.",
      };
    }

    const firstToolMessage = messageFrom(
      await request({
        messages: [
          {
            role: "user",
            content:
              "Call djl_capability_probe exactly once with token FIRST. Do not answer in prose.",
          },
        ],
        tools: [tool],
        tool_choice: "required",
      }),
    );
    const firstToolCall = toolCallsFrom(firstToolMessage)[0];
    const firstToolFunction = record(firstToolCall?.function);
    if (!firstToolCall || firstToolFunction?.name !== "djl_capability_probe") {
      return {
        tier: "chat-only",
        result: "failed",
        failureReason: "The model did not produce a valid synthetic tool call.",
      };
    }

    const synthesis = messageFrom(
      await request({
        messages: [
          {
            role: "user",
            content: "Use the tool result and reply with the exact word SYNTHESIZED.",
          },
          {
            role: "assistant",
            content: null,
            tool_calls: [firstToolCall],
          },
          {
            role: "tool",
            tool_call_id: firstToolCall.id,
            content: '{"token":"SYNTHESIZED"}',
          },
        ],
        tools: [tool],
      }),
    );
    if (!hasNonEmptyText(synthesis?.content)) {
      return {
        tier: "chat-only",
        result: "failed",
        failureReason: "The model called a tool but could not synthesize its result.",
      };
    }

    const secondToolMessage = messageFrom(
      await request({
        messages: [
          {
            role: "user",
            content:
              "Call djl_capability_probe exactly once with token SECOND. Do not answer in prose.",
          },
        ],
        tools: [tool],
        tool_choice: "required",
      }),
    );
    const secondToolCall = toolCallsFrom(secondToolMessage)[0];
    return secondToolCall && record(secondToolCall.function)?.name === "djl_capability_probe"
      ? { tier: "agentic", result: "passed", failureReason: null }
      : { tier: "assisted", result: "passed", failureReason: null };
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

  async #request(
    url: string,
    init?: RequestInit,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
      if (!(await this.#hasExternalLmStudioInstallation())) return null;
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

  async #hasExternalLmStudioInstallation(): Promise<boolean> {
    const homeDir = this.#env.HOME ?? this.#env.USERPROFILE ?? "";
    const candidates: string[] = [];
    try {
      const marker = JSON.parse(
        await readFile(
          join(homeDir, ".lmstudio", ".internal", "app-install-location.json"),
          "utf8",
        ),
      ) as unknown;
      const markerRecord = record(marker);
      if (typeof markerRecord?.path === "string") candidates.push(markerRecord.path);
    } catch {
      // Older installations may not have written the location marker.
    }
    if (this.#platform === "darwin") {
      candidates.push(
        "/Applications/LM Studio.app/Contents/MacOS/LM Studio",
        join(homeDir, "Applications", "LM Studio.app", "Contents", "MacOS", "LM Studio"),
      );
    } else if (this.#platform === "win32") {
      candidates.push(join(this.#env.LOCALAPPDATA ?? "", "Programs", "LM Studio", "LM Studio.exe"));
    }
    for (const candidate of candidates.filter(Boolean)) {
      try {
        await access(candidate, this.#platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
        return true;
      } catch {
        // Try the next known installation location.
      }
    }
    return false;
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
    const models = [...this.#availableModels.values()].flat();
    this.#configWrite = this.#configWrite
      .catch(() => undefined)
      .then(async () => {
        const inventoryFingerprint = models
          .map(({ runtime, modelId, contextWindowTokens, supportsToolCalls }) =>
            [runtime, modelId, contextWindowTokens ?? "", supportsToolCalls ?? ""].join(":"),
          )
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
          new Set(["ollama", "lmstudio"]),
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
