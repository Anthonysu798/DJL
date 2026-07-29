import { describe, expect, it } from "vitest";

import {
  curatedModelDisplayName,
  curatedToolSupport,
  isCuratedLocalModel,
  localModelOperatingSystemSupported,
  LOCAL_MODEL_CHAMPION_TIERS,
  LOCAL_MODEL_RECOMMENDATIONS,
  localModelFallbackChain,
  nextSmallerRecommendation,
  parseParameterCount,
  recommendLocalModel,
  recommendLocalModelsByUseCase,
  toolCallSupportForParameterSize,
} from "./catalog";
import { buildOpenCodeLocalProviderConfig } from "./openCodeConfig";

const GIB = 1024 ** 3;

const windowsCpuOnlyProfile = (memoryGib: number) => ({
  platform: "win32" as const,
  osVersion: "10.0.19045",
  totalMemoryBytes: memoryGib * 1024 ** 3,
  availableMemoryBytes: memoryGib * 1024 ** 3,
  cpuLogicalCores: 4,
  cpuArchitecture: "x64",
  gpus: [],
  freeDiskBytes: 128 * 1024 ** 3,
});

const verifiedDedicatedGpu = (
  id: number,
  computeBackend?: "cuda" | "vulkan" | "metal" | "unknown",
) => ({
  id: `gpu-${id}`,
  name: `Verified GPU ${id}`,
  dedicatedMemoryBytes: 12 * 1024 ** 3,
  availableMemoryBytes: 11 * 1024 ** 3,
  memoryType: "dedicated" as const,
  computeCompatible: true,
  ...(computeBackend === undefined ? {} : { computeBackend }),
});

const monotonicWindowsProfile = (totalGib: number, availableGib: number) => ({
  platform: "win32" as const,
  osVersion: "10.0.19045",
  totalMemoryBytes: totalGib * 1024 ** 3,
  availableMemoryBytes: availableGib * 1024 ** 3,
  cpuLogicalCores: 24,
  cpuArchitecture: "x64",
  gpus: [],
  freeDiskBytes: 128 * 1024 ** 3,
});

describe("local model catalog", () => {
  it("keeps the legacy numeric overload aligned with the general champion", () => {
    expect(recommendLocalModel(3 * 1024 ** 3)).toBeNull();
    expect(recommendLocalModel(5 * 1024 ** 3)?.id).toBe("qwen3-1.7b");
    expect(recommendLocalModel(6 * 1024 ** 3)?.id).toBe("qwen3.5-2b");
    expect(recommendLocalModel(8 * 1024 ** 3)?.id).toBe("granite-4.1-3b");
    expect(recommendLocalModel(12 * 1024 ** 3)?.id).toBe("granite-4.1-3b");
    expect(recommendLocalModel(24 * 1024 ** 3)?.id).toBe("gpt-oss-20b");
    expect(recommendLocalModel(48 * 1024 ** 3)?.id).toBe("gpt-oss-20b");
  });

  it("defines exactly one curated champion for every use case at every device tier", () => {
    expect(
      LOCAL_MODEL_CHAMPION_TIERS.map(({ minimumMemoryBytes, champions }) => ({
        memoryGib: minimumMemoryBytes / 1024 ** 3,
        champions,
      })),
    ).toEqual([
      {
        memoryGib: 4,
        champions: {
          general: "qwen3-1.7b",
          document: "qwen3-1.7b",
          reasoning: "qwen3-1.7b",
          coding: "qwen3-1.7b",
        },
      },
      {
        memoryGib: 6,
        champions: {
          general: "qwen3.5-2b",
          document: "qwen3.5-2b",
          reasoning: "qwen3.5-2b",
          coding: "qwen3.5-2b",
        },
      },
      {
        memoryGib: 8,
        champions: {
          general: "granite-4.1-3b",
          document: "granite-4.1-3b",
          reasoning: "qwen3.5-2b",
          coding: "granite-4.1-3b",
        },
      },
      {
        memoryGib: 12,
        champions: {
          general: "granite-4.1-3b",
          document: "granite-4.1-3b",
          reasoning: "qwen3.5-2b",
          coding: "qwen2.5-coder-7b",
        },
      },
      {
        memoryGib: 24,
        champions: {
          general: "gpt-oss-20b",
          document: "granite-4.1-3b",
          reasoning: "gpt-oss-20b",
          coding: "qwen2.5-coder-14b",
        },
      },
      {
        memoryGib: 48,
        champions: {
          general: "gpt-oss-20b",
          document: "granite-4.1-3b",
          reasoning: "gpt-oss-20b",
          coding: "qwen3-coder-30b",
        },
      },
    ]);

    const recommendationIds = new Set(LOCAL_MODEL_RECOMMENDATIONS.map(({ id }) => id));
    for (const { champions } of LOCAL_MODEL_CHAMPION_TIERS) {
      expect(Object.keys(champions).toSorted()).toEqual([
        "coding",
        "document",
        "general",
        "reasoning",
      ]);
      expect(Object.values(champions).every((id) => recommendationIds.has(id))).toBe(true);
    }
  });

  it.each([
    [
      6,
      {
        general: "qwen3.5-2b",
        document: "qwen3.5-2b",
        reasoning: "qwen3.5-2b",
        coding: "qwen3.5-2b",
      },
    ],
    [
      8,
      {
        general: "granite-4.1-3b",
        document: "granite-4.1-3b",
        reasoning: "qwen3.5-2b",
        coding: "granite-4.1-3b",
      },
    ],
    [
      12,
      {
        general: "granite-4.1-3b",
        document: "granite-4.1-3b",
        reasoning: "qwen3.5-2b",
        coding: "qwen2.5-coder-7b",
      },
    ],
    [
      24,
      {
        general: "gpt-oss-20b",
        document: "granite-4.1-3b",
        reasoning: "gpt-oss-20b",
        coding: "qwen2.5-coder-14b",
      },
    ],
    [
      48,
      {
        general: "gpt-oss-20b",
        document: "granite-4.1-3b",
        reasoning: "gpt-oss-20b",
        coding: "qwen3-coder-30b",
      },
    ],
  ])("returns all four champions for the %d GiB tier", (memoryGib, expected) => {
    expect(recommendLocalModelsByUseCase(memoryGib * 1024 ** 3)).toEqual(expected);
  });

  it("does not recommend the 2B model below its safe Windows CPU-only floor", () => {
    expect(recommendLocalModel(windowsCpuOnlyProfile(4))).toBeNull();
    expect(recommendLocalModel(windowsCpuOnlyProfile(6))?.id).toBe("qwen3.5-2b");
  });

  it("does not recommend 20B on the current PC while memory and VRAM are busy", () => {
    const currentPc = {
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 4.9 * 1024 ** 3,
      cpuLogicalCores: 20,
      cpuArchitecture: "x64",
      gpus: [
        {
          name: "NVIDIA GeForce RTX 4070 SUPER",
          dedicatedMemoryBytes: 12 * 1024 ** 3,
          availableMemoryBytes: 5.5 * 1024 ** 3,
          memoryType: "dedicated",
          computeCompatible: true,
        },
      ],
      freeDiskBytes: 46 * 1024 ** 3,
    } as const;

    expect(recommendLocalModelsByUseCase(currentPc)).toEqual({
      general: "granite-4.1-3b",
      document: "granite-4.1-3b",
      reasoning: "qwen3.5-2b",
      coding: "granite-4.1-3b",
    });
    expect(recommendLocalModel(currentPc)?.id).not.toBe("gpt-oss-20b");
  });

  it("still selects GPU-resident champions when Windows has little free RAM but ample VRAM", () => {
    const currentPcWhileDjlIsRunning = {
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 3.6 * 1024 ** 3,
      cpuLogicalCores: 20,
      cpuArchitecture: "x64",
      gpus: [
        {
          name: "NVIDIA GeForce RTX 4070 SUPER",
          dedicatedMemoryBytes: 12 * 1024 ** 3,
          availableMemoryBytes: 11 * 1024 ** 3,
          memoryType: "dedicated",
          computeCompatible: true,
        },
      ],
      freeDiskBytes: 46 * 1024 ** 3,
    } as const;

    expect(recommendLocalModelsByUseCase(currentPcWhileDjlIsRunning)).toEqual({
      general: "granite-4.1-3b",
      document: "granite-4.1-3b",
      reasoning: "qwen3.5-2b",
      coding: "qwen2.5-coder-7b",
    });
  });

  it("keeps the screenshot PC on a safe general model at 7.5 GiB free RAM", () => {
    expect(
      recommendLocalModelsByUseCase({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 32 * 1024 ** 3,
        availableMemoryBytes: 7.5 * 1024 ** 3,
        cpuLogicalCores: 20,
        cpuArchitecture: "x64",
        gpus: [
          {
            name: "NVIDIA GeForce RTX 4070 SUPER",
            dedicatedMemoryBytes: 12 * 1024 ** 3,
            availableMemoryBytes: 11 * 1024 ** 3,
            memoryType: "dedicated",
            computeCompatible: true,
          },
        ],
        freeDiskBytes: 46 * 1024 ** 3,
      }),
    ).toEqual({
      general: "granite-4.1-3b",
      document: "granite-4.1-3b",
      reasoning: "qwen3.5-2b",
      coding: "qwen2.5-coder-14b",
    });
  });

  it("recommends 20B on the same PC when enough RAM and VRAM are actually available", () => {
    expect(
      recommendLocalModel({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 32 * 1024 ** 3,
        availableMemoryBytes: 24 * 1024 ** 3,
        cpuLogicalCores: 20,
        cpuArchitecture: "x64",
        gpus: [
          {
            name: "NVIDIA GeForce RTX 4070 SUPER",
            dedicatedMemoryBytes: 12 * 1024 ** 3,
            availableMemoryBytes: 11.5 * 1024 ** 3,
            memoryType: "dedicated",
            computeCompatible: true,
          },
        ],
        freeDiskBytes: 46 * 1024 ** 3,
      })?.id,
    ).toBe("gpt-oss-20b");
  });

  it("does not cap a high-VRAM Windows PC by total system RAM before the real fit test", () => {
    const highVramPc = {
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 12 * 1024 ** 3,
      cpuLogicalCores: 4,
      cpuArchitecture: "x64",
      gpus: [
        {
          id: "00000000:00000001",
          name: "Discrete GPU",
          dedicatedMemoryBytes: 24 * 1024 ** 3,
          availableMemoryBytes: 23 * 1024 ** 3,
          memoryType: "dedicated" as const,
          computeCompatible: true,
        },
      ],
      freeDiskBytes: 64 * 1024 ** 3,
    } as const;

    expect(recommendLocalModel(highVramPc)?.id).toBe("gpt-oss-20b");
    expect(recommendLocalModelsByUseCase(highVramPc).coding).toBe("qwen3-coder-30b");
  });

  it.each([
    ["M1 Max", 64, 50, 10, "arm64", false, "gpt-oss-20b", "qwen3-coder-30b"],
    ["M3 Pro", 36, 28, 11, "arm64", false, "gpt-oss-20b", "qwen2.5-coder-14b"],
    ["M4 Pro", 48, 40, 14, "arm64", false, "gpt-oss-20b", "qwen3-coder-30b"],
    ["M1 Max under Rosetta", 64, 50, 10, "x64", true, "gpt-oss-20b", "qwen3-coder-30b"],
  ] as const)(
    "uses unified-memory and Metal capacity on %s",
    (name, totalGib, availableGib, cores, processArchitecture, translated, general, coding) => {
      expect(
        recommendLocalModelsByUseCase({
          platform: "darwin",
          osVersion: "15.6",
          totalMemoryBytes: totalGib * 1024 ** 3,
          availableMemoryBytes: availableGib * 1024 ** 3,
          cpuLogicalCores: cores,
          cpuArchitecture: "arm64",
          processArchitecture,
          runningUnderTranslation: translated,
          gpus: [
            {
              name: name.replace(" under Rosetta", ""),
              dedicatedMemoryBytes: null,
              availableMemoryBytes: null,
              memoryType: "unified",
            },
          ],
          freeDiskBytes: 128 * 1024 ** 3,
        }),
      ).toMatchObject({ general, coding });
    },
  );

  it("never counts Apple unified memory as both RAM and dedicated VRAM", () => {
    const busyAppleSilicon = {
      platform: "darwin",
      osVersion: "15.6",
      totalMemoryBytes: 24 * 1024 ** 3,
      availableMemoryBytes: 8 * 1024 ** 3,
      cpuLogicalCores: 12,
      cpuArchitecture: "arm64",
      gpus: [
        {
          name: "Apple M3 Pro",
          // Deliberately hostile legacy data: memoryType must prevent double counting.
          dedicatedMemoryBytes: 24 * 1024 ** 3,
          availableMemoryBytes: 24 * 1024 ** 3,
          memoryType: "unified" as const,
        },
      ],
      freeDiskBytes: 64 * 1024 ** 3,
    } as const;

    expect(recommendLocalModel(busyAppleSilicon)?.id).not.toBe("gpt-oss-20b");
  });

  it("rejects local setup on unsupported pre-macOS-14 systems", () => {
    expect(
      recommendLocalModel({
        platform: "darwin",
        osVersion: "13.6.9",
        totalMemoryBytes: 64 * 1024 ** 3,
        availableMemoryBytes: 56 * 1024 ** 3,
        cpuLogicalCores: 20,
        cpuArchitecture: "arm64",
        gpus: [],
        freeDiskBytes: 128 * 1024 ** 3,
      }),
    ).toBeNull();
  });

  it("rejects Windows releases older than Windows 10 22H2", () => {
    const profile = {
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 24 * 1024 ** 3,
      cpuLogicalCores: 20,
      cpuArchitecture: "x64",
      gpus: [],
      freeDiskBytes: 64 * 1024 ** 3,
    } as const;

    expect(recommendLocalModel({ ...profile, osVersion: "10.0.19044" })).toBeNull();
    expect(recommendLocalModel({ ...profile, osVersion: "10.0.19045" })?.id).toBe("gpt-oss-20b");
    expect(recommendLocalModel({ ...profile, osVersion: "10.0.26100" })?.id).toBe("gpt-oss-20b");
  });

  it.each([
    [{ platform: "win32" }, false],
    [{ platform: "win32", osVersion: "" }, false],
    [{ platform: "win32", osVersion: "garbage" }, false],
    [{ platform: "win32", osVersion: "10.0" }, false],
    [{ platform: "win32", osVersion: "10.0.foo" }, false],
    [{ platform: "win32", osVersion: "10.0.19044" }, false],
    [{ platform: "win32", osVersion: "10.0.19045" }, true],
    [{ platform: "win32", osVersion: "10.0.26100.1" }, true],
    [{ platform: "win32", osVersion: "11.0.1" }, true],
    [{ platform: "darwin" }, false],
    [{ platform: "darwin", osVersion: "garbage" }, false],
    [{ platform: "darwin", osVersion: "13.6.9" }, false],
    [{ platform: "darwin", osVersion: "14" }, true],
    [{ platform: "darwin", osVersion: "15.6.1" }, true],
    [{ platform: "linux" }, true],
  ] as const)("strictly validates local-model OS support for %o", (profile, expected) => {
    expect(localModelOperatingSystemSupported(profile)).toBe(expected);
  });

  it("fails closed when a Windows or macOS version is unavailable", () => {
    const capacity = {
      totalMemoryBytes: 64 * 1024 ** 3,
      availableMemoryBytes: 56 * 1024 ** 3,
      cpuLogicalCores: 24,
      cpuArchitecture: "x64",
      gpus: [],
      freeDiskBytes: 128 * 1024 ** 3,
    } as const;

    expect(recommendLocalModel({ platform: "win32", ...capacity })).toBeNull();
    expect(
      recommendLocalModel({ platform: "win32", osVersion: "garbage", ...capacity }),
    ).toBeNull();
    expect(recommendLocalModel({ platform: "darwin", ...capacity })).toBeNull();
  });

  it("caps an Intel Mac using CPU-only inference at the curated 7B tier", () => {
    expect(
      recommendLocalModelsByUseCase({
        platform: "darwin",
        osVersion: "15.6.1",
        totalMemoryBytes: 128 * 1024 ** 3,
        availableMemoryBytes: 112 * 1024 ** 3,
        cpuLogicalCores: 32,
        cpuArchitecture: "x64",
        processArchitecture: "x64",
        runningUnderTranslation: false,
        gpus: [],
        freeDiskBytes: 128 * 1024 ** 3,
      }),
    ).toEqual({
      general: "granite-4.1-3b",
      document: "granite-4.1-3b",
      reasoning: "qwen3.5-2b",
      coding: "qwen2.5-coder-7b",
    });
  });

  it("only budgets positively verified dedicated GPU memory", () => {
    const baseProfile = {
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 5 * 1024 ** 3,
      cpuLogicalCores: 4,
      cpuArchitecture: "x64",
      freeDiskBytes: 64 * 1024 ** 3,
    } as const;
    const gpu = {
      name: "24 GB GPU",
      dedicatedMemoryBytes: 24 * 1024 ** 3,
      availableMemoryBytes: 23 * 1024 ** 3,
      memoryType: "dedicated" as const,
    };

    expect(recommendLocalModel({ ...baseProfile, gpus: [{ ...gpu }] })?.id).toBe("qwen3-1.7b");
    expect(
      recommendLocalModel({
        ...baseProfile,
        gpus: [{ ...gpu, computeCompatible: false }],
      })?.id,
    ).toBe("qwen3-1.7b");
    expect(
      recommendLocalModel({
        ...baseProfile,
        gpus: [{ ...gpu, memoryType: "shared", computeCompatible: true }],
      })?.id,
    ).toBe("qwen3-1.7b");
    expect(
      recommendLocalModel({
        ...baseProfile,
        gpus: [{ ...gpu, computeCompatible: true }],
      })?.id,
    ).toBe("gpt-oss-20b");
  });

  it("combines verified dedicated VRAM across multiple GPUs", () => {
    const baseProfile = {
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 5 * 1024 ** 3,
      cpuLogicalCores: 4,
      cpuArchitecture: "x64",
      freeDiskBytes: 64 * 1024 ** 3,
    } as const;
    expect(
      recommendLocalModelsByUseCase({ ...baseProfile, gpus: [verifiedDedicatedGpu(1, "cuda")] }),
    ).toEqual({
      general: "granite-4.1-3b",
      document: "granite-4.1-3b",
      reasoning: "qwen3.5-2b",
      coding: "qwen2.5-coder-7b",
    });
    expect(
      recommendLocalModelsByUseCase({
        ...baseProfile,
        gpus: [verifiedDedicatedGpu(1, "cuda"), verifiedDedicatedGpu(2, "cuda")],
      }),
    ).toEqual({
      general: "gpt-oss-20b",
      document: "granite-4.1-3b",
      reasoning: "gpt-oss-20b",
      coding: "qwen2.5-coder-14b",
    });
  });

  it("never combines VRAM across incompatible or unverified compute backends", () => {
    const baseProfile = {
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 5 * 1024 ** 3,
      cpuLogicalCores: 4,
      cpuArchitecture: "x64",
      freeDiskBytes: 64 * 1024 ** 3,
    } as const;
    const oneGpu = recommendLocalModelsByUseCase({
      ...baseProfile,
      gpus: [verifiedDedicatedGpu(1, "cuda")],
    });

    expect(
      recommendLocalModelsByUseCase({
        ...baseProfile,
        gpus: [verifiedDedicatedGpu(1, "cuda"), verifiedDedicatedGpu(2, "vulkan")],
      }),
    ).toEqual(oneGpu);
    expect(
      recommendLocalModelsByUseCase({
        ...baseProfile,
        gpus: [verifiedDedicatedGpu(1), verifiedDedicatedGpu(2)],
      }),
    ).toEqual(oneGpu);
    expect(
      recommendLocalModelsByUseCase({
        ...baseProfile,
        gpus: [verifiedDedicatedGpu(1, "unknown"), verifiedDedicatedGpu(2, "unknown")],
      }),
    ).toEqual(oneGpu);
  });

  it("keeps every use-case recommendation monotonic across the Windows 12 GiB boundary", () => {
    const useCases = ["general", "document", "reasoning", "coding"] as const;
    const qualityRanks: Record<(typeof useCases)[number], readonly string[]> = {
      general: ["qwen3.5-2b", "granite-4.1-3b", "gpt-oss-20b"],
      document: ["qwen3.5-2b", "granite-4.1-3b"],
      reasoning: ["qwen3.5-2b", "gpt-oss-20b"],
      coding: [
        "qwen3.5-2b",
        "granite-4.1-3b",
        "qwen2.5-coder-7b",
        "qwen2.5-coder-14b",
        "qwen3-coder-30b",
      ],
    };
    const recommendationRank = (
      useCase: (typeof useCases)[number],
      recommendationId: string | null,
    ) => (recommendationId === null ? -1 : qualityRanks[useCase].indexOf(recommendationId));
    const formerCounterexample = recommendLocalModelsByUseCase(monotonicWindowsProfile(11.9, 6));
    const upgradedCounterexample = recommendLocalModelsByUseCase(
      monotonicWindowsProfile(12.15, 6.25),
    );
    expect(upgradedCounterexample).toEqual(formerCounterexample);

    for (let totalGib = 4; totalGib < 128; totalGib += 0.25) {
      for (const availableGib of [2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96]) {
        if (availableGib > totalGib) continue;
        const before = recommendLocalModelsByUseCase(
          monotonicWindowsProfile(totalGib, availableGib),
        );
        const after = recommendLocalModelsByUseCase(
          monotonicWindowsProfile(totalGib + 0.25, availableGib + 0.25),
        );
        for (const useCase of useCases) {
          expect(recommendationRank(useCase, after[useCase])).toBeGreaterThanOrEqual(
            recommendationRank(useCase, before[useCase]),
          );
        }
      }
    }
  });

  it("ignores VRAM from a GPU whose driver is not compute-compatible", () => {
    expect(
      recommendLocalModel({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 16 * 1024 ** 3,
        availableMemoryBytes: 8 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "x64",
        gpus: [
          {
            name: "Unsupported NVIDIA GPU",
            dedicatedMemoryBytes: 24 * 1024 ** 3,
            availableMemoryBytes: 23 * 1024 ** 3,
            memoryType: "dedicated",
            computeCompatible: false,
          },
        ],
        freeDiskBytes: 64 * 1024 ** 3,
      })?.id,
    ).toBe("granite-4.1-3b");
  });

  it("does not count total VRAM when available VRAM is unknown", () => {
    expect(
      recommendLocalModel({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 24 * 1024 ** 3,
        availableMemoryBytes: 16 * 1024 ** 3,
        cpuLogicalCores: 12,
        cpuArchitecture: "x64",
        gpus: [{ name: "GPU", dedicatedMemoryBytes: 12 * 1024 ** 3 }],
        freeDiskBytes: 64 * 1024 ** 3,
      })?.id,
    ).toBe("granite-4.1-3b");
  });

  it.each([
    [8, "granite-4.1-3b"],
    [16, "granite-4.1-3b"],
    [32, "gpt-oss-20b"],
  ])("selects a stable CPU-only model for a %d GiB PC", (memoryGib, expectedId) => {
    expect(
      recommendLocalModel({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: memoryGib * 1024 ** 3,
        availableMemoryBytes: memoryGib * 1024 ** 3,
        cpuLogicalCores: 20,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 128 * 1024 ** 3,
      })?.id,
    ).toBe(expectedId);
  });

  it("uses the same practical disk safety floor as one-click setup", () => {
    const profile = {
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 64 * 1024 ** 3,
      availableMemoryBytes: 56 * 1024 ** 3,
      cpuLogicalCores: 20,
      cpuArchitecture: "x64",
      gpus: [],
    } as const;

    expect(recommendLocalModel({ ...profile, freeDiskBytes: 10 * 1024 ** 3 })?.id).toBe(
      "granite-4.1-3b",
    );
    expect(recommendLocalModel({ ...profile, freeDiskBytes: 7 * 1024 ** 3 })).toBeNull();
  });

  it("keeps automatic canary fallbacks inside the selected champion category", () => {
    expect(localModelFallbackChain("qwen3-coder-30b", "coding").map(({ id }) => id)).toEqual([
      "qwen3-coder-30b",
      "qwen2.5-coder-14b",
      "qwen2.5-coder-7b",
      "granite-4.1-3b",
      "qwen3.5-2b",
      "qwen3-1.7b",
    ]);
    expect(localModelFallbackChain("gpt-oss-20b", "reasoning").map(({ id }) => id)).toEqual([
      "gpt-oss-20b",
      "qwen3.5-2b",
      "qwen3-1.7b",
    ]);
    expect(localModelFallbackChain("granite-4.1-3b", "document").map(({ id }) => id)).toEqual([
      "granite-4.1-3b",
      "qwen3.5-2b",
      "qwen3-1.7b",
    ]);
    expect(localModelFallbackChain("qwen3-coder-30b", "coding").map(({ id }) => id)).not.toContain(
      "gpt-oss-20b",
    );
    expect(localModelFallbackChain("missing", "coding")).toEqual([]);
  });

  it("has exact Ollama and LM Studio sources for each Qwen2.5 Coder size", () => {
    expect(
      LOCAL_MODEL_RECOMMENDATIONS.filter(({ id }) => id.startsWith("qwen2.5-coder")).map(
        ({ id, sources }) => ({
          id,
          sources: sources.map(({ runtime, modelId, estimatedDownloadBytes }) => ({
            runtime,
            modelId,
            estimatedDownloadBytes,
          })),
        }),
      ),
    ).toEqual([
      {
        id: "qwen2.5-coder-7b",
        sources: [
          {
            runtime: "ollama",
            modelId: "qwen2.5-coder:7b",
            estimatedDownloadBytes: Math.round(4.7 * 1024 ** 3),
          },
          {
            runtime: "lmstudio",
            modelId: "qwen/qwen2.5-coder-7b",
            estimatedDownloadBytes: Math.round(4.7 * 1024 ** 3),
          },
        ],
      },
      {
        id: "qwen2.5-coder-14b",
        sources: [
          {
            runtime: "ollama",
            modelId: "qwen2.5-coder:14b",
            estimatedDownloadBytes: 9 * 1024 ** 3,
          },
          {
            runtime: "lmstudio",
            modelId: "qwen/qwen2.5-coder-14b",
            estimatedDownloadBytes: 9 * 1024 ** 3,
          },
        ],
      },
    ]);

    const qwen35 = LOCAL_MODEL_RECOMMENDATIONS.find(({ id }) => id === "qwen3.5-2b");
    expect(qwen35?.sources).toEqual([
      {
        runtime: "ollama",
        modelId: "qwen3.5:2b-q4_K_M",
        estimatedDownloadBytes: Math.round(2.7 * 1024 ** 3),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3.5-2b",
        estimatedDownloadBytes: 2 * 1024 ** 3,
        quantization: "Q4_K_M",
      },
    ]);

    const gptOllama = LOCAL_MODEL_RECOMMENDATIONS.find(
      ({ id }) => id === "gpt-oss-20b",
    )?.sources.find(({ runtime }) => runtime === "ollama");
    expect(gptOllama?.estimatedDownloadBytes).toBe(14 * 1024 ** 3);
  });

  it("has an Ollama and LM Studio source for every recommendation", () => {
    for (const recommendation of LOCAL_MODEL_RECOMMENDATIONS) {
      expect(recommendation.sources.map(({ runtime }) => runtime).toSorted()).toEqual([
        "lmstudio",
        "ollama",
      ]);
      for (const source of recommendation.sources) {
        expect(source.estimatedDownloadBytes).toBeGreaterThan(0);
        expect(Number.isInteger(source.estimatedDownloadBytes)).toBe(true);
      }
    }
  });

  it("pins low-memory recommendations to the intended runtime models and Q4 builds", () => {
    const qwen3 = LOCAL_MODEL_RECOMMENDATIONS.find(({ id }) => id === "qwen3-1.7b");
    const qwen35 = LOCAL_MODEL_RECOMMENDATIONS.find(({ id }) => id === "qwen3.5-2b");

    expect(qwen3?.sources).toEqual([
      {
        runtime: "ollama",
        modelId: "qwen3:1.7b",
        estimatedDownloadBytes: Math.round(1.4 * 1024 ** 3),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3-1.7b",
        estimatedDownloadBytes: Math.round(1.4 * 1024 ** 3),
        quantization: "Q4_K_M",
      },
    ]);
    expect(qwen35?.sources).toEqual([
      {
        runtime: "ollama",
        modelId: "qwen3.5:2b-q4_K_M",
        estimatedDownloadBytes: Math.round(2.7 * 1024 ** 3),
      },
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3.5-2b",
        estimatedDownloadBytes: Math.round(2 * 1024 ** 3),
        quantization: "Q4_K_M",
      },
    ]);
  });
});

describe("parameter-size tool gating", () => {
  it("reads both the B and M suffixes Ollama reports", () => {
    expect(parseParameterCount("7.6B")).toBeCloseTo(7.6e9, -6);
    expect(parseParameterCount("494.03M")).toBeCloseTo(494.03e6, -3);
    expect(parseParameterCount("3.1B")).toBeCloseTo(3.1e9, -6);
  });

  it("returns null for values it cannot trust", () => {
    expect(parseParameterCount(undefined)).toBeNull();
    expect(parseParameterCount("")).toBeNull();
    expect(parseParameterCount("unknown")).toBeNull();
    expect(parseParameterCount(7.6)).toBeNull();
  });

  it("refuses tool calls for models too small to drive the agent", () => {
    expect(toolCallSupportForParameterSize("494.03M")).toBe(false);
    expect(toolCallSupportForParameterSize("1.2B")).toBe(false);
  });

  it("leaves larger and unknown models undecided rather than guessing", () => {
    expect(toolCallSupportForParameterSize("7.6B")).toBeNull();
    expect(toolCallSupportForParameterSize(undefined)).toBeNull();
  });
});

describe("curated display names", () => {
  it("names curated models the way the catalog does", () => {
    expect(curatedModelDisplayName("ollama", "qwen2.5-coder:7b")).toBe("Qwen2.5 Coder 7B");
    expect(curatedModelDisplayName("lmstudio", "qwen/qwen3-1.7b")).toBe("Qwen3 1.7B");
  });

  it("has no name for models outside the catalog", () => {
    expect(curatedModelDisplayName("ollama", "some-random:8b")).toBeNull();
  });
});

describe("curated model membership", () => {
  it("recognizes curated tool-capable runtime model IDs", () => {
    expect(isCuratedLocalModel("ollama", "qwen3.5:2b-q4_K_M")).toBe(true);
    expect(isCuratedLocalModel("lmstudio", "qwen/qwen3.5-2b")).toBe(true);
    expect(isCuratedLocalModel("ollama", "qwen2.5-coder:7b")).toBe(true);
    expect(isCuratedLocalModel("lmstudio", "qwen/qwen2.5-coder-14b")).toBe(true);
    expect(isCuratedLocalModel("ollama", "qwen3-coder:30b")).toBe(true);
    expect(isCuratedLocalModel("lmstudio", "publisher/custom-model")).toBe(false);
  });
});

describe("OpenCode local provider config", () => {
  it("preserves unrelated config and projects installed models by runtime", () => {
    const config = buildOpenCodeLocalProviderConfig(
      { theme: "synara", provider: { openai: { name: "OpenAI" } } },
      [
        {
          runtime: "ollama",
          modelId: "granite4.1:3b",
          name: "Granite 4.1 3B",
          sizeBytes: 2_000,
          contextWindowTokens: null,
          supportsToolCalls: true,
        },
      ],
    );

    expect(config.theme).toBe("synara");
    expect(config.provider.openai).toEqual({ name: "OpenAI" });
    const ollama = config.provider.ollama as {
      options: { baseURL: string };
      models: Record<string, { tool_call: boolean }>;
    };
    expect(ollama.options.baseURL).toBe("http://127.0.0.1:11434/v1");
    expect(ollama.models["granite4.1:3b"]?.tool_call).toBe(true);
    expect(config.provider.lmstudio).toBeUndefined();
  });

  it("tells OpenCode a too-small model cannot take tool calls", () => {
    const config = buildOpenCodeLocalProviderConfig({}, [
      {
        runtime: "ollama",
        modelId: "llama3.2:1b",
        name: "llama3.2:1b",
        sizeBytes: 1_200,
        contextWindowTokens: null,
        supportsToolCalls: false,
      },
    ]);

    const ollama = config.provider.ollama as {
      name: string;
      models: Record<string, { tool_call?: boolean }>;
    };
    // Without this, OpenCode's `tool_call ?? true` default hands the agent a model that stalls.
    expect(ollama.models["llama3.2:1b"]?.tool_call).toBe(false);
    expect(ollama.name).toBe("Ollama");
  });

  it("uses the effective LM Studio context while reserving response headroom", () => {
    const config = buildOpenCodeLocalProviderConfig({}, [
      {
        runtime: "lmstudio",
        modelId: "ibm/granite-4.1-3b",
        name: "Granite 4.1 3B",
        sizeBytes: 2_099_546_710,
        contextWindowTokens: 16_384,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 16_384,
        toolContextWindowReady: true,
        supportsToolCalls: true,
      },
    ]);
    const lmstudio = config.provider.lmstudio as {
      name: string;
      models: Record<string, { limit?: { context: number; output: number }; tool_call?: boolean }>;
    };

    expect(lmstudio.name).toBe("LM Studio");
    expect(lmstudio.models["ibm/granite-4.1-3b"]).toMatchObject({
      limit: { context: 16_384, output: 4_096 },
      tool_call: true,
    });
  });

  it("caps local output at 8192 for larger effective contexts", () => {
    const config = buildOpenCodeLocalProviderConfig({}, [
      {
        runtime: "lmstudio",
        modelId: "ibm/granite-4.1-3b",
        name: "Granite 4.1 3B",
        sizeBytes: 2_099_546_710,
        contextWindowTokens: 32_768,
        supportsToolCalls: true,
      },
    ]);
    const lmstudio = config.provider.lmstudio as {
      models: Record<string, { limit?: { context: number; output: number } }>;
    };

    expect(lmstudio.models["ibm/granite-4.1-3b"]?.limit).toEqual({
      context: 32_768,
      output: 8_192,
    });
  });

  it("omits limits when the runtime has no effective context", () => {
    const config = buildOpenCodeLocalProviderConfig({}, [
      {
        runtime: "lmstudio",
        modelId: "qwen/qwen3-1.7b",
        name: "Qwen3 1.7B",
        sizeBytes: 1_400_000_000,
        contextWindowTokens: null,
        supportsToolCalls: false,
      },
    ]);
    const lmstudio = config.provider.lmstudio as {
      models: Record<string, { limit?: { context: number; output: number } }>;
    };

    expect(lmstudio.models["qwen/qwen3-1.7b"]?.limit).toBeUndefined();
  });

  it("preserves a stopped runtime that was not inventoried", () => {
    const current = {
      provider: {
        lmstudio: { name: "LM Studio (local)", models: { "saved/model": {} } },
      },
    };
    const config = buildOpenCodeLocalProviderConfig(current, [], new Set(["ollama"]));

    expect(config.provider.lmstudio).toEqual(current.provider.lmstudio);
  });
});

describe("downgrade target", () => {
  it("names the next smaller model when one is too slow", () => {
    expect(nextSmallerRecommendation("qwen3-coder-30b")?.id).toBe("gpt-oss-20b");
    expect(nextSmallerRecommendation("gpt-oss-20b")?.id).toBe("qwen2.5-coder-14b");
    expect(nextSmallerRecommendation("qwen2.5-coder-7b")?.id).toBe("granite-4.1-3b");
  });

  it("has nothing smaller than the smallest model", () => {
    expect(nextSmallerRecommendation("qwen3-1.7b")).toBeNull();
  });

  it("returns null for an unknown model", () => {
    expect(nextSmallerRecommendation("not-a-model")).toBeNull();
  });
});

describe("curated tool capability is measured, not assumed", () => {
  it("marks the sub-3B tiers as unable to drive tools", () => {
    // Measured against a real Ollama: qwen3:1.7b (reported 2.0B) produced a valid tool call in
    // only 1 of 3 runs, and on failure returned empty content after a long thinking block.
    expect(curatedToolSupport("ollama", "qwen3:1.7b")).toBe(false);
    expect(curatedToolSupport("ollama", "qwen3.5:2b-q4_K_M")).toBe(false);
    expect(curatedToolSupport("lmstudio", "qwen/qwen3-1.7b")).toBe(false);
  });

  it("keeps the 3B-and-larger tiers tool-capable", () => {
    expect(curatedToolSupport("ollama", "granite4.1:3b")).toBe(true);
    expect(curatedToolSupport("ollama", "qwen2.5-coder:7b")).toBe(true);
    expect(curatedToolSupport("ollama", "qwen3-coder:30b")).toBe(true);
  });

  it("has no opinion about models outside the catalog", () => {
    expect(curatedToolSupport("ollama", "some-random:8b")).toBeNull();
  });

  it("never recommends a tool-incapable model as the machine's best fit unless nothing else fits", () => {
    // A 4 GB machine genuinely cannot run any tool-capable local model. Saying so is the honest
    // outcome; claiming the 1.7B tier can drive an agent is what shipped a broken experience.
    const tiny = recommendLocalModel(4 * GIB);
    expect(tiny && curatedToolSupport("ollama", tiny.sources[0]!.modelId)).toBe(false);
  });
});
