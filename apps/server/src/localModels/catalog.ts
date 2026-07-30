import type {
  LocalModelHardwareProfile,
  LocalModelRecommendation,
  LocalModelRecommendationsByUseCase,
  LocalModelUseCase,
} from "@synara/contracts";

const GIB = 1024 ** 3;
const estimatedBytes = (gibibytes: number): number => Math.round(gibibytes * GIB);
// Ollama's current Windows installer documentation requires at least 4 GiB for the runtime.
// Keep one cross-platform reserve so first-run recommendations cannot consume that space.
export const LOCAL_MODEL_RUNTIME_STORAGE_RESERVE_BYTES = 4 * GIB;

export const LOCAL_MODEL_RECOMMENDATIONS = [
  {
    id: "qwen3-1.7b",
    supportsToolCalls: false,
    name: "Qwen3 1.7B",
    description: "A fast chat model for low-memory computers with 4 GB or more. Chat only.",
    minimumMemoryBytes: 4 * GIB,
    sources: [
      { runtime: "ollama", modelId: "qwen3:1.7b", estimatedDownloadBytes: estimatedBytes(1.4) },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3-1.7b",
        estimatedDownloadBytes: estimatedBytes(1.4),
        quantization: "Q4_K_M",
      },
    ],
  },
  {
    id: "qwen3.5-2b",
    supportsToolCalls: false,
    name: "Qwen3.5 2B",
    description:
      "A lightweight general-purpose and coding model for systems with 6 GB of memory. Chat only.",
    minimumMemoryBytes: 6 * GIB,
    sources: [
      {
        runtime: "ollama",
        modelId: "qwen3.5:2b-q4_K_M",
        estimatedDownloadBytes: estimatedBytes(2.7),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3.5-2b",
        estimatedDownloadBytes: estimatedBytes(2),
        quantization: "Q4_K_M",
      },
    ],
  },
  {
    id: "granite-4.1-3b",
    supportsToolCalls: true,
    name: "Granite 4.1 3B",
    description: "A compact general, document, and coding model for systems with 8 GB of memory.",
    minimumMemoryBytes: 8 * GIB,
    sources: [
      { runtime: "ollama", modelId: "granite4.1:3b", estimatedDownloadBytes: estimatedBytes(2.1) },
      {
        runtime: "lmstudio",
        modelId: "ibm/granite-4.1-3b",
        estimatedDownloadBytes: estimatedBytes(2.3),
      },
    ],
  },
  {
    id: "qwen2.5-coder-7b",
    supportsToolCalls: true,
    name: "Qwen2.5 Coder 7B",
    description: "A balanced coding model for systems with 12 GB of memory.",
    minimumMemoryBytes: 12 * GIB,
    sources: [
      {
        runtime: "ollama",
        modelId: "qwen2.5-coder:7b",
        estimatedDownloadBytes: estimatedBytes(4.7),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen2.5-coder-7b",
        estimatedDownloadBytes: estimatedBytes(4.7),
        quantization: "Q4_K_M",
      },
    ],
  },
  {
    id: "qwen2.5-coder-14b",
    supportsToolCalls: true,
    name: "Qwen2.5 Coder 14B",
    description: "A capable coding model for systems with 24 GB of memory.",
    minimumMemoryBytes: 24 * GIB,
    sources: [
      {
        runtime: "ollama",
        modelId: "qwen2.5-coder:14b",
        estimatedDownloadBytes: estimatedBytes(9),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen2.5-coder-14b",
        estimatedDownloadBytes: estimatedBytes(9),
        quantization: "Q4_K_M",
      },
    ],
  },
  {
    id: "gpt-oss-20b",
    supportsToolCalls: true,
    name: "GPT-OSS 20B",
    description: "A capable general and reasoning model for systems with 24 GB or more.",
    minimumMemoryBytes: 24 * GIB,
    sources: [
      { runtime: "ollama", modelId: "gpt-oss:20b", estimatedDownloadBytes: 14 * GIB },
      { runtime: "lmstudio", modelId: "openai/gpt-oss-20b", estimatedDownloadBytes: 13 * GIB },
    ],
  },
  {
    id: "qwen3-coder-30b",
    supportsToolCalls: true,
    name: "Qwen3 Coder 30B",
    description: "The strongest curated local coding option, intended for 48 GB systems.",
    minimumMemoryBytes: 48 * GIB,
    sources: [
      { runtime: "ollama", modelId: "qwen3-coder:30b", estimatedDownloadBytes: 19 * GIB },
      { runtime: "lmstudio", modelId: "qwen/qwen3-coder-30b", estimatedDownloadBytes: 19 * GIB },
    ],
  },
] as const satisfies ReadonlyArray<LocalModelRecommendation>;

type LocalModelRecommendationId = (typeof LOCAL_MODEL_RECOMMENDATIONS)[number]["id"];

// One DJL-curated winner per safe device tier. A physical model may honestly win more than
// one category or tier; that reuses one download instead of inventing redundant choices.
export const LOCAL_MODEL_CHAMPION_TIERS = [
  {
    id: "minimal",
    minimumMemoryBytes: 4 * GIB,
    champions: {
      general: "qwen3-1.7b",
      document: "qwen3-1.7b",
      reasoning: "qwen3-1.7b",
      coding: "qwen3-1.7b",
    },
  },
  {
    id: "compact",
    minimumMemoryBytes: 6 * GIB,
    champions: {
      general: "qwen3.5-2b",
      document: "qwen3.5-2b",
      reasoning: "qwen3.5-2b",
      coding: "qwen3.5-2b",
    },
  },
  {
    id: "everyday",
    minimumMemoryBytes: 8 * GIB,
    champions: {
      general: "granite-4.1-3b",
      document: "granite-4.1-3b",
      reasoning: "qwen3.5-2b",
      coding: "granite-4.1-3b",
    },
  },
  {
    id: "balanced",
    minimumMemoryBytes: 12 * GIB,
    champions: {
      general: "granite-4.1-3b",
      document: "granite-4.1-3b",
      reasoning: "qwen3.5-2b",
      coding: "qwen2.5-coder-7b",
    },
  },
  {
    id: "capable",
    minimumMemoryBytes: 24 * GIB,
    champions: {
      general: "gpt-oss-20b",
      document: "granite-4.1-3b",
      reasoning: "gpt-oss-20b",
      coding: "qwen2.5-coder-14b",
    },
  },
  {
    id: "workstation",
    minimumMemoryBytes: 48 * GIB,
    champions: {
      general: "gpt-oss-20b",
      document: "granite-4.1-3b",
      reasoning: "gpt-oss-20b",
      coding: "qwen3-coder-30b",
    },
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly minimumMemoryBytes: number;
  readonly champions: Record<LocalModelUseCase, LocalModelRecommendationId>;
}>;

const RESOURCE_REQUIREMENTS = {
  "qwen3-1.7b": {
    modelPayloadBytes: estimatedBytes(1.4),
    hostOverheadBytes: estimatedBytes(1),
    cpuLogicalCores: 2,
  },
  "qwen3.5-2b": {
    modelPayloadBytes: estimatedBytes(2.7),
    hostOverheadBytes: estimatedBytes(1),
    cpuLogicalCores: 2,
  },
  "granite-4.1-3b": {
    modelPayloadBytes: estimatedBytes(3.2),
    hostOverheadBytes: estimatedBytes(1.2),
    cpuLogicalCores: 4,
  },
  "qwen2.5-coder-7b": {
    modelPayloadBytes: estimatedBytes(6.5),
    hostOverheadBytes: estimatedBytes(1.5),
    cpuLogicalCores: 6,
  },
  "qwen2.5-coder-14b": {
    modelPayloadBytes: estimatedBytes(11.5),
    hostOverheadBytes: estimatedBytes(2),
    cpuLogicalCores: 8,
  },
  "gpt-oss-20b": {
    modelPayloadBytes: estimatedBytes(16.5),
    hostOverheadBytes: estimatedBytes(2.5),
    cpuLogicalCores: 12,
  },
  "qwen3-coder-30b": {
    modelPayloadBytes: estimatedBytes(24),
    hostOverheadBytes: estimatedBytes(3),
    cpuLogicalCores: 16,
  },
} as const;

function gpuMemoryBudget(profile: LocalModelHardwareProfile): number {
  const budgetsByBackend = new Map<string, number>();

  profile.gpus.forEach((gpu, adapterIndex) => {
    // Only a platform probe that positively verified the compute backend may contribute VRAM.
    // This also prevents unified/shared memory from satisfying both the RAM and GPU budgets.
    if (gpu.memoryType !== "dedicated" || gpu.computeCompatible !== true) {
      return;
    }
    if (gpu.availableMemoryBytes === null || gpu.availableMemoryBytes === undefined) {
      return;
    }
    const totalBytes = gpu.dedicatedMemoryBytes ?? 0;
    const availableBytes = Math.min(Math.max(0, gpu.availableMemoryBytes), totalBytes);
    const reserveBytes = Math.max(estimatedBytes(1.5), totalBytes * 0.125);
    const adapterBudgetBytes = Math.max(0, availableBytes - reserveBytes);

    // Only adapters proven to use the same concrete backend can share one model. Legacy,
    // missing, and explicit unknown backends stay isolated per adapter to fail closed.
    const backendGroup = ["cuda", "vulkan", "metal"].includes(gpu.computeBackend ?? "")
      ? gpu.computeBackend!
      : `isolated:${adapterIndex}`;
    budgetsByBackend.set(
      backendGroup,
      Math.min(
        Number.MAX_SAFE_INTEGER,
        (budgetsByBackend.get(backendGroup) ?? 0) + adapterBudgetBytes,
      ),
    );
  });

  return Math.max(0, ...budgetsByBackend.values());
}

function parsedVersion(value: string | undefined, minimumParts: number): number[] | null {
  if (!value || !/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
  const parts = value.split(".").map((part) => Number(part));
  return parts.length >= minimumParts && parts.every(Number.isSafeInteger) ? parts : null;
}

export function localModelOperatingSystemSupported(
  profile: Pick<LocalModelHardwareProfile, "osVersion" | "platform">,
): boolean {
  if (profile.platform === "win32") {
    const version = parsedVersion(profile.osVersion, 3);
    if (!version) return false;
    const [major = 0, minor = 0, build = 0] = version;
    return major > 10 || (major === 10 && (minor > 0 || (minor === 0 && build >= 19_045)));
  }
  if (profile.platform === "darwin") {
    const version = parsedVersion(profile.osVersion, 1);
    return version !== null && (version[0] ?? 0) >= 14;
  }
  return true;
}

function systemHeadroom(profile: LocalModelHardwareProfile): number {
  if (profile.platform !== "win32") {
    return Math.max(2 * GIB, profile.totalMemoryBytes * 0.08);
  }

  // Ramp the Windows floor continuously from 2 GiB at 12 GiB RAM to 3 GiB at 24 GiB.
  // A hard 2-to-3 GiB jump made a slightly larger PC receive a smaller recommendation.
  const floorRamp = Math.min(1, Math.max(0, (profile.totalMemoryBytes - 12 * GIB) / (12 * GIB)));
  return Math.max(2 * GIB + floorRamp * GIB, profile.totalMemoryBytes * 0.1);
}

export function localModelRecommendationFitsHardware(
  recommendation: LocalModelRecommendation,
  profile: LocalModelHardwareProfile,
): boolean {
  const requirements =
    RESOURCE_REQUIREMENTS[recommendation.id as keyof typeof RESOURCE_REQUIREMENTS];
  if (!requirements || !["x64", "arm64"].includes(profile.cpuArchitecture)) {
    return false;
  }

  if (!localModelOperatingSystemSupported(profile)) return false;

  const systemHeadroomBytes = systemHeadroom(profile);
  const availableMemoryBytes = Math.min(profile.availableMemoryBytes, profile.totalMemoryBytes);
  // Available memory already excludes what Windows and running apps currently use. Keep a
  // proportional reserve when the machine is busy so a GPU-resident model is not rejected by
  // subtracting the full system headroom a second time.
  const reservedAvailableMemoryBytes = Math.min(systemHeadroomBytes, availableMemoryBytes * 0.4);
  const ramBudgetBytes = Math.max(0, availableMemoryBytes - reservedAvailableMemoryBytes);
  const gpuBudgetBytes = gpuMemoryBudget(profile);
  const isIntelMacCpuOnly =
    profile.platform === "darwin" && profile.cpuArchitecture === "x64" && gpuBudgetBytes === 0;
  if (
    isIntelMacCpuOnly &&
    requirements.modelPayloadBytes > RESOURCE_REQUIREMENTS["qwen2.5-coder-7b"].modelPayloadBytes
  ) {
    return false;
  }
  const systemPayloadBytes =
    requirements.modelPayloadBytes - Math.min(requirements.modelPayloadBytes, gpuBudgetBytes);
  const hasUnifiedAcceleration =
    profile.platform === "darwin" &&
    (profile.cpuArchitecture === "arm64" ||
      profile.gpus.some(({ memoryType }) => memoryType === "unified"));
  // CPU cores are a throughput guard, not a memory-safety limit. Scale the guard by the model
  // fraction that remains on the CPU, and let Metal-backed unified-memory Macs use their GPU.
  const cpuPayloadFraction = hasUnifiedAcceleration
    ? 0
    : systemPayloadBytes / requirements.modelPayloadBytes;
  const requiredCpuLogicalCores = Math.max(
    2,
    Math.ceil(requirements.cpuLogicalCores * cpuPayloadFraction),
  );
  if (profile.cpuLogicalCores < requiredCpuLogicalCores) return false;
  const requiredRamBytes = requirements.hostOverheadBytes + systemPayloadBytes * 1.1;
  if (ramBudgetBytes < requiredRamBytes) return false;

  if (
    recommendation.id === "qwen3-coder-30b" &&
    profile.totalMemoryBytes < 48 * GIB &&
    gpuBudgetBytes < 16 * GIB
  ) {
    return false;
  }

  if (profile.freeDiskBytes !== null) {
    const smallestDownloadBytes = Math.min(
      ...recommendation.sources.map(({ estimatedDownloadBytes }) => estimatedDownloadBytes),
    );
    const requiredPayloadBytes = smallestDownloadBytes + LOCAL_MODEL_RUNTIME_STORAGE_RESERVE_BYTES;
    // Match the setup path: reserve the runtime, then keep extraction and temporary-file room.
    const safetyBytes = Math.max(2 * GIB, Math.ceil(requiredPayloadBytes * 0.1));
    if (profile.freeDiskBytes < requiredPayloadBytes + safetyBytes) return false;
  }
  return true;
}

function recommendationById(id: LocalModelRecommendationId): LocalModelRecommendation {
  const recommendation = LOCAL_MODEL_RECOMMENDATIONS.find((candidate) => candidate.id === id);
  if (!recommendation) throw new Error(`Missing curated local model: ${id}`);
  return recommendation;
}

function eligibleChampionTiers(input: number | LocalModelHardwareProfile) {
  // A profile has live RAM and accelerator budgets, so let the real fit test decide. Filtering
  // by total RAM first incorrectly caps a 16 GiB PC with a 24 GiB discrete GPU at the 12 GiB tier.
  return (
    typeof input === "number"
      ? LOCAL_MODEL_CHAMPION_TIERS.filter(({ minimumMemoryBytes }) => minimumMemoryBytes <= input)
      : LOCAL_MODEL_CHAMPION_TIERS
  ).toReversed();
}

function recommendLocalModelForInput(
  input: number | LocalModelHardwareProfile,
  useCase: LocalModelUseCase,
): LocalModelRecommendation | null {
  const seen = new Set<LocalModelRecommendationId>();
  for (const tier of eligibleChampionTiers(input)) {
    const id = tier.champions[useCase];
    if (seen.has(id)) continue;
    seen.add(id);
    const recommendation = recommendationById(id);
    if (
      typeof input === "number"
        ? recommendation.minimumMemoryBytes <= input
        : localModelRecommendationFitsHardware(recommendation, input)
    ) {
      return recommendation;
    }
  }
  return null;
}

export function isChampionRecommendationForUseCase(
  recommendationId: string,
  useCase: LocalModelUseCase,
): boolean {
  return LOCAL_MODEL_CHAMPION_TIERS.some(
    ({ champions }) => champions[useCase] === recommendationId,
  );
}

export function inferChampionUseCase(recommendationId: string): LocalModelUseCase | null {
  const useCases = ["general", "document", "reasoning", "coding"] as const;
  return (
    useCases.find((useCase) => isChampionRecommendationForUseCase(recommendationId, useCase)) ??
    null
  );
}

export function recommendLocalModel(
  totalMemoryBytes: number,
  useCase?: LocalModelUseCase,
): LocalModelRecommendation | null;
export function recommendLocalModel(
  profile: LocalModelHardwareProfile,
  useCase?: LocalModelUseCase,
): LocalModelRecommendation | null;
export function recommendLocalModel(
  input: number | LocalModelHardwareProfile,
  useCase: LocalModelUseCase = "general",
): LocalModelRecommendation | null {
  return recommendLocalModelForInput(input, useCase);
}

export function recommendLocalModelsByUseCase(
  input: number | LocalModelHardwareProfile,
): LocalModelRecommendationsByUseCase {
  return {
    general: recommendLocalModelForInput(input, "general")?.id ?? null,
    document: recommendLocalModelForInput(input, "document")?.id ?? null,
    reasoning: recommendLocalModelForInput(input, "reasoning")?.id ?? null,
    coding: recommendLocalModelForInput(input, "coding")?.id ?? null,
  };
}

export function localModelFallbackChain(
  recommendationId: string,
  useCase: LocalModelUseCase = "general",
): ReadonlyArray<LocalModelRecommendation> {
  const matchingTierIndex = LOCAL_MODEL_CHAMPION_TIERS.findLastIndex(
    ({ champions }) => champions[useCase] === recommendationId,
  );
  if (matchingTierIndex >= 0) {
    const seen = new Set<LocalModelRecommendationId>();
    return LOCAL_MODEL_CHAMPION_TIERS.slice(0, matchingTierIndex + 1)
      .toReversed()
      .flatMap(({ champions }) => {
        const id = champions[useCase];
        if (seen.has(id)) return [];
        seen.add(id);
        return [recommendationById(id)];
      });
  }

  // Keep explicit advanced setup requests compatible while still degrading conservatively.
  const catalogIndex = LOCAL_MODEL_RECOMMENDATIONS.findIndex(({ id }) => id === recommendationId);
  const lowerChampions = LOCAL_MODEL_CHAMPION_TIERS.flatMap(({ champions }) => [
    recommendationById(champions[useCase]),
  ]).filter(
    (recommendation, index, recommendations) =>
      recommendation.minimumMemoryBytes <
        (LOCAL_MODEL_RECOMMENDATIONS[catalogIndex]?.minimumMemoryBytes ?? 0) &&
      recommendations.findIndex(({ id }) => id === recommendation.id) === index,
  );
  return catalogIndex < 0
    ? []
    : [LOCAL_MODEL_RECOMMENDATIONS[catalogIndex], ...lowerChampions.toReversed()].filter(
        (recommendation): recommendation is LocalModelRecommendation => Boolean(recommendation),
      );
}

export function isCuratedLocalModel(runtime: string, modelId: string): boolean {
  return LOCAL_MODEL_RECOMMENDATIONS.some((recommendation) =>
    recommendation.sources.some(
      (source) => source.runtime === runtime && source.modelId === modelId,
    ),
  );
}

// Anything smaller than this cannot hold a tool-calling loop together well enough to drive the
// agent. Handing such a model tool definitions produces a silent stall, not an error.
const MINIMUM_TOOL_CALL_PARAMETERS = 3e9;

// Ollama reports `details.parameter_size` as a human string that mixes units: "7.6B", "494.03M".
export function parseParameterCount(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^([\d.]+)\s*([BM])$/iu.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return match[2]?.toUpperCase() === "B" ? amount * 1e9 : amount * 1e6;
}

// Returns false only when the model is provably too small. Unknown stays null so DJL never claims
// a capability it has not established either way.
export function toolCallSupportForParameterSize(value: unknown): boolean | null {
  const parameters = parseParameterCount(value);
  if (parameters === null) return null;
  return parameters < MINIMUM_TOOL_CALL_PARAMETERS ? false : null;
}

// The tier one step down from a model that turned out too slow here. The catalog is weight-ascending,
// so "smaller" is simply the preceding entry.
export function nextSmallerRecommendation(
  recommendationId: string,
): LocalModelRecommendation | null {
  const index = LOCAL_MODEL_RECOMMENDATIONS.findIndex(({ id }) => id === recommendationId);
  return index > 0 ? (LOCAL_MODEL_RECOMMENDATIONS[index - 1] ?? null) : null;
}

// Whether a curated tier can actually drive the agent, established by running real tool calls
// against it rather than inferred from its size. Returns null for anything outside the catalog.
export function curatedToolSupport(runtime: string, modelId: string): boolean | null {
  const match = LOCAL_MODEL_RECOMMENDATIONS.find((recommendation) =>
    recommendation.sources.some(
      (source) => source.runtime === runtime && source.modelId === modelId,
    ),
  );
  return match ? match.supportsToolCalls : null;
}

export function curatedModelDisplayName(runtime: string, modelId: string): string | null {
  return (
    LOCAL_MODEL_RECOMMENDATIONS.find((recommendation) =>
      recommendation.sources.some(
        (source) => source.runtime === runtime && source.modelId === modelId,
      ),
    )?.name ?? null
  );
}
