import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectHardwareProfile,
  detectHardwareProfile,
  parseMacGpuInventory,
  parseNvidiaSmiGpuInventory,
  parseWindowsGpuInventory,
  usableModelBytes,
} from "./hardwareProfile";

const GIB = 1024 ** 3;

function failingCommand() {
  return vi.fn(async () => {
    throw new Error("command unavailable");
  });
}

function failingRead() {
  return vi.fn(async () => {
    throw new Error("ENOENT");
  });
}

describe("usableModelBytes", () => {
  it("budgets Apple unified memory at 60% of RAM with context headroom", () => {
    expect(usableModelBytes({ acceleration: "apple_unified", totalMemoryBytes: 48 * GIB })).toBe(
      Math.floor(48 * GIB * 0.6 * 0.7),
    );
  });

  it("budgets discrete GPUs from VRAM, not system memory", () => {
    const budget = usableModelBytes({
      acceleration: "discrete_gpu",
      totalMemoryBytes: 64 * GIB,
      vramBytes: 8 * GIB,
    });
    expect(budget).toBe(Math.floor(8 * GIB * 0.9 * 0.7));
    expect(budget).toBeLessThan(
      usableModelBytes({ acceleration: "cpu_only", totalMemoryBytes: 64 * GIB }),
    );
  });

  it("budgets CPU-only machines conservatively", () => {
    expect(usableModelBytes({ acceleration: "cpu_only", totalMemoryBytes: 16 * GIB })).toBe(
      Math.floor(16 * GIB * 0.35 * 0.7),
    );
  });

  it("falls back to the CPU budget when a discrete GPU reports no VRAM", () => {
    expect(
      usableModelBytes({
        acceleration: "discrete_gpu",
        totalMemoryBytes: 16 * GIB,
        vramBytes: null,
      }),
    ).toBe(usableModelBytes({ acceleration: "cpu_only", totalMemoryBytes: 16 * GIB }));
  });

  it("never returns a negative budget", () => {
    expect(usableModelBytes({ acceleration: "cpu_only", totalMemoryBytes: 0 })).toBe(0);
  });
});

describe("detectHardwareProfile", () => {
  it("treats Apple Silicon as unified memory without probing commands", async () => {
    const runCommand = failingCommand();
    const profile = await detectHardwareProfile({
      platform: "darwin",
      arch: "arm64",
      totalMemoryBytes: 48 * GIB,
      cpuModel: "Apple M4 Pro",
      cpuCores: 14,
      runCommand,
      readTextFile: failingRead(),
    });

    expect(profile.acceleration).toBe("apple_unified");
    expect(profile.gpuName).toBe("Apple M4 Pro");
    expect(profile.vramBytes).toBeNull();
    expect(profile.usableModelBytes).toBe(Math.floor(48 * GIB * 0.6 * 0.7));
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("treats Intel Macs as CPU-only because Ollama has no Metal path there", async () => {
    const profile = await detectHardwareProfile({
      platform: "darwin",
      arch: "x64",
      totalMemoryBytes: 32 * GIB,
      cpuModel: "Intel Core i9",
      cpuCores: 8,
      runCommand: failingCommand(),
      readTextFile: failingRead(),
    });

    expect(profile.acceleration).toBe("cpu_only");
    expect(profile.usableModelBytes).toBe(Math.floor(32 * GIB * 0.35 * 0.7));
  });

  it("reads true Windows VRAM from the registry qwMemorySize value", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify({
        DriverDesc: "NVIDIA GeForce RTX 4060",
        "HardwareInformation.qwMemorySize": 8 * GIB,
      }),
    }));
    const profile = await detectHardwareProfile({
      platform: "win32",
      arch: "x64",
      totalMemoryBytes: 32 * GIB,
      cpuModel: "AMD Ryzen 7",
      cpuCores: 16,
      runCommand,
      readTextFile: failingRead(),
    });

    expect(profile.acceleration).toBe("discrete_gpu");
    expect(profile.gpuName).toBe("NVIDIA GeForce RTX 4060");
    expect(profile.vramBytes).toBe(8 * GIB);
    expect(profile.usableModelBytes).toBe(Math.floor(8 * GIB * 0.9 * 0.7));
  });

  it("picks the largest adapter when Windows reports several", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify([
        { DriverDesc: "Intel UHD Graphics", "HardwareInformation.qwMemorySize": 1 * GIB },
        { DriverDesc: "NVIDIA GeForce RTX 4090", "HardwareInformation.qwMemorySize": 24 * GIB },
      ]),
    }));
    const profile = await detectHardwareProfile({
      platform: "win32",
      arch: "x64",
      totalMemoryBytes: 64 * GIB,
      runCommand,
      readTextFile: failingRead(),
    });

    expect(profile.gpuName).toBe("NVIDIA GeForce RTX 4090");
    expect(profile.vramBytes).toBe(24 * GIB);
  });

  it("classifies small integrated Windows adapters as CPU-only", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify({
        DriverDesc: "Intel UHD Graphics",
        "HardwareInformation.qwMemorySize": 2 * GIB,
      }),
    }));
    const profile = await detectHardwareProfile({
      platform: "win32",
      arch: "x64",
      totalMemoryBytes: 16 * GIB,
      runCommand,
      readTextFile: failingRead(),
    });

    expect(profile.acceleration).toBe("cpu_only");
    expect(profile.usableModelBytes).toBe(Math.floor(16 * GIB * 0.35 * 0.7));
  });

  it("reads Linux NVIDIA VRAM from nvidia-smi megabytes", async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === "nvidia-smi") {
        return { stdout: "NVIDIA GeForce RTX 3080, 10240\n" };
      }
      throw new Error("command unavailable");
    });
    const profile = await detectHardwareProfile({
      platform: "linux",
      arch: "x64",
      totalMemoryBytes: 32 * GIB,
      runCommand,
      readTextFile: failingRead(),
    });

    expect(profile.acceleration).toBe("discrete_gpu");
    expect(profile.gpuName).toBe("NVIDIA GeForce RTX 3080");
    expect(profile.vramBytes).toBe(10240 * 1024 ** 2);
  });

  it("falls back to the AMD sysfs VRAM node when nvidia-smi is absent", async () => {
    const readTextFile = vi.fn(async (path: string) => {
      if (path === "/sys/class/drm/card0/device/mem_info_vram_total") return `${16 * GIB}\n`;
      throw new Error("ENOENT");
    });
    const profile = await detectHardwareProfile({
      platform: "linux",
      arch: "x64",
      totalMemoryBytes: 32 * GIB,
      runCommand: failingCommand(),
      readTextFile,
    });

    expect(profile.acceleration).toBe("discrete_gpu");
    expect(profile.vramBytes).toBe(16 * GIB);
  });

  it("degrades to CPU-only when every probe fails", async () => {
    const profile = await detectHardwareProfile({
      platform: "linux",
      arch: "x64",
      totalMemoryBytes: 16 * GIB,
      runCommand: failingCommand(),
      readTextFile: failingRead(),
    });

    expect(profile.acceleration).toBe("cpu_only");
    expect(profile.vramBytes).toBeNull();
    expect(profile.gpuName).toBeNull();
  });

  it("degrades to CPU-only when a probe returns unparsable output", async () => {
    const runCommand = vi.fn(async () => ({ stdout: "not json at all" }));
    const profile = await detectHardwareProfile({
      platform: "win32",
      arch: "x64",
      totalMemoryBytes: 16 * GIB,
      runCommand,
      readTextFile: failingRead(),
    });

    expect(profile.acceleration).toBe("cpu_only");
    expect(profile.vramBytes).toBeNull();
  });
});

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function vulkanDevice(
  luid: string,
  deviceUuid: string,
  deviceType: 1 | 2 = 2,
): Record<string, unknown> {
  return {
    Luid: luid,
    DeviceUuid: deviceUuid,
    LuidValid: true,
    NodeMask: 1,
    DeviceType: deviceType,
    StorageBuffer16BitAccess: true,
    HasComputeQueue: true,
  };
}

describe("hardware profile", () => {
  it("collects memory, CPU, Windows GPU VRAM, and disk information", async () => {
    const query = vi.fn(async () =>
      JSON.stringify([
        { Name: "NVIDIA RTX Test", AdapterRAM: 12 * 1024 ** 3 },
        { Name: "Integrated GPU", AdapterRAM: null },
      ]),
    );
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "x64",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 24 * 1024 ** 3,
      cpuLogicalCores: 16,
      freeDiskBytes: 80 * 1024 ** 3,
      runWindowsVulkanQuery: async () => "[]",
      runNvidiaSmiQuery: async () => {
        throw new Error("nvidia-smi unavailable");
      },
      runWindowsDxgiQuery: async () => {
        throw new Error("DXGI unavailable");
      },
      runWindowsGpuQuery: query,
    });

    expect(profile).toMatchObject({
      platform: "win32",
      cpuArchitecture: "x64",
      cpuLogicalCores: 16,
      availableMemoryBytes: 24 * 1024 ** 3,
      freeDiskBytes: 80 * 1024 ** 3,
    });
    expect(profile.gpus).toEqual([
      {
        name: "NVIDIA RTX Test",
        dedicatedMemoryBytes: 12 * 1024 ** 3,
        availableMemoryBytes: null,
      },
      { name: "Integrated GPU", dedicatedMemoryBytes: null, availableMemoryBytes: null },
    ]);
    expect(query).toHaveBeenCalledOnce();
  });

  it("fails safely when Windows device discovery is unavailable", async () => {
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      totalMemoryBytes: 8 * 1024 ** 3,
      availableMemoryBytes: 6 * 1024 ** 3,
      cpuLogicalCores: 4,
      freeDiskBytes: null,
      runWindowsVulkanQuery: async () => "[]",
      runNvidiaSmiQuery: async () => {
        throw new Error("nvidia-smi unavailable");
      },
      runWindowsDxgiQuery: async () => {
        throw new Error("DXGI unavailable");
      },
      runWindowsGpuQuery: async () => {
        throw new Error("CIM unavailable");
      },
    });

    expect(profile.gpus).toEqual([]);
    expect(profile.freeDiskBytes).toBeNull();
  });

  it("parses a single CIM object and rejects malformed output", () => {
    expect(
      parseWindowsGpuInventory(JSON.stringify({ Name: "GPU", AdapterRAM: "8589934592" })),
    ).toEqual([{ name: "GPU", dedicatedMemoryBytes: 8 * 1024 ** 3, availableMemoryBytes: null }]);
    expect(parseWindowsGpuInventory("not json")).toEqual([]);
  });

  it("preserves same-model NVIDIA adapters and parses zero available memory", () => {
    expect(
      parseNvidiaSmiGpuInventory(
        "NVIDIA GeForce RTX 4090, 24564, 6144\r\n" +
          "NVIDIA GeForce RTX 4090, 24564, 6144\r\n" +
          "NVIDIA RTX A6000, 49140 MiB, 0 MiB\r\nMalformed row\r\nGPU, N/A, N/A\r\n",
      ),
    ).toEqual([
      {
        name: "NVIDIA GeForce RTX 4090",
        dedicatedMemoryBytes: 24_564 * 1024 ** 2,
        availableMemoryBytes: 6_144 * 1024 ** 2,
      },
      {
        name: "NVIDIA GeForce RTX 4090",
        dedicatedMemoryBytes: 24_564 * 1024 ** 2,
        availableMemoryBytes: 6_144 * 1024 ** 2,
      },
      {
        name: "NVIDIA RTX A6000",
        dedicatedMemoryBytes: 49_140 * 1024 ** 2,
        availableMemoryBytes: 0,
      },
    ]);
  });

  it("only exposes NVIDIA VRAM when the compute capability and driver are supported", () => {
    expect(
      parseNvidiaSmiGpuInventory(
        "NVIDIA GeForce RTX 4070 SUPER, 12282, 10641, 8.9, 610.47\n" +
          "NVIDIA Tesla P4, 8192, 7000, 6.1, 530.94\n" +
          "NVIDIA legacy GPU, 4096, 3500, 3.5, 610.47\n",
      ),
    ).toEqual([
      {
        name: "NVIDIA GeForce RTX 4070 SUPER",
        dedicatedMemoryBytes: 12_282 * 1024 ** 2,
        availableMemoryBytes: 10_641 * 1024 ** 2,
        computeCompatible: true,
        computeBackend: "cuda",
      },
      {
        name: "NVIDIA Tesla P4",
        dedicatedMemoryBytes: 8_192 * 1024 ** 2,
        availableMemoryBytes: null,
        computeCompatible: false,
      },
      {
        name: "NVIDIA legacy GPU",
        dedicatedMemoryBytes: 4_096 * 1024 ** 2,
        availableMemoryBytes: null,
        computeCompatible: false,
      },
    ]);
  });

  it("enforces the exact NVIDIA driver boundaries for current and older compute capabilities", () => {
    expect(
      parseNvidiaSmiGpuInventory(
        "Modern below minimum, 8192, 7000, 8.9, 551.60\n" +
          "Modern at minimum, 8192, 7000, 8.9, 551.61\n" +
          "Older below minimum, 8192, 7000, 6.2, 569.99\n" +
          "Older at minimum, 8192, 7000, 6.2, 570.0\n" +
          "Newer boundary family, 8192, 7000, 6.3, 551.61\n",
      ).map(({ name, availableMemoryBytes, computeCompatible }) => ({
        name,
        availableMemoryBytes,
        computeCompatible,
      })),
    ).toEqual([
      { name: "Modern below minimum", availableMemoryBytes: null, computeCompatible: false },
      {
        name: "Modern at minimum",
        availableMemoryBytes: 7_000 * 1024 ** 2,
        computeCompatible: true,
      },
      { name: "Older below minimum", availableMemoryBytes: null, computeCompatible: false },
      {
        name: "Older at minimum",
        availableMemoryBytes: 7_000 * 1024 ** 2,
        computeCompatible: true,
      },
      {
        name: "Newer boundary family",
        availableMemoryBytes: 7_000 * 1024 ** 2,
        computeCompatible: true,
      },
    ]);
  });

  it("parses Apple unified memory without counting it as dedicated VRAM", () => {
    expect(
      parseMacGpuInventory(
        JSON.stringify({
          SPDisplaysDataType: [
            {
              _name: "Apple M4 Pro",
              _spdisplays_vram: "1536 MB",
              spdisplays_metal: "spdisplays_supported",
            },
          ],
        }),
        "arm64",
      ),
    ).toEqual([
      {
        name: "Apple M4 Pro",
        dedicatedMemoryBytes: null,
        availableMemoryBytes: null,
        memoryType: "unified",
        computeCompatible: true,
        computeBackend: "metal",
      },
    ]);
  });

  it("parses Intel Mac shared graphics and discrete AMD VRAM independently", () => {
    expect(
      parseMacGpuInventory(
        JSON.stringify({
          SPDisplaysDataType: [
            { sppci_model: "Intel UHD Graphics 630", _spdisplays_vram: "1536 MB" },
            { sppci_model: "AMD Radeon Pro 5500M", spdisplays_vram: "8 GB" },
          ],
        }),
        "x64",
      ),
    ).toEqual([
      {
        name: "Intel UHD Graphics 630",
        dedicatedMemoryBytes: 1.5 * 1024 ** 3,
        availableMemoryBytes: null,
        memoryType: "shared",
      },
      {
        name: "AMD Radeon Pro 5500M",
        dedicatedMemoryBytes: 8 * 1024 ** 3,
        availableMemoryBytes: null,
        memoryType: "dedicated",
      },
    ]);
    expect(parseMacGpuInventory("not json", "arm64")).toEqual([]);
  });

  it("uses reclaimable process memory and records Apple Silicon host details", async () => {
    const readAvailableMemory = vi.fn(() => 24 * 1024 ** 3);
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "darwin",
      architecture: "arm64",
      processArchitecture: "x64",
      runningUnderTranslation: true,
      totalMemoryBytes: 32 * 1024 ** 3,
      readAvailableMemory,
      cpuLogicalCores: 10,
      freeDiskBytes: 80 * 1024 ** 3,
      runMacGpuQuery: async () =>
        JSON.stringify({ SPDisplaysDataType: [{ _name: "Apple M1 Max" }] }),
      runMacOsVersionQuery: async () => "15.6.1\n",
    });

    expect(readAvailableMemory).toHaveBeenCalledOnce();
    expect(profile).toMatchObject({
      platform: "darwin",
      cpuArchitecture: "arm64",
      processArchitecture: "x64",
      runningUnderTranslation: true,
      osVersion: "15.6.1",
      availableMemoryBytes: 24 * 1024 ** 3,
      gpus: [{ name: "Apple M1 Max", memoryType: "unified" }],
    });
  });

  it("falls back safely to a generic unified Apple GPU when profiling is unavailable", async () => {
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "darwin",
      architecture: "arm64",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 12 * 1024 ** 3,
      cpuLogicalCores: 8,
      freeDiskBytes: null,
      runMacGpuQuery: async () => {
        throw new Error("system_profiler unavailable");
      },
      runMacOsVersionQuery: async () => "localized output",
    });

    expect(profile.gpus).toEqual([
      {
        name: "Apple GPU",
        dedicatedMemoryBytes: null,
        availableMemoryBytes: null,
        memoryType: "unified",
        computeCompatible: true,
        computeBackend: "metal",
      },
    ]);
    expect(profile.osVersion).toBeUndefined();
  });

  it("clamps impossible NVIDIA free VRAM and keeps older two-column output compatible", () => {
    expect(
      parseNvidiaSmiGpuInventory(
        "Overreported GPU, 8192, 9000\nLegacy GPU, 4096\nUnavailable GPU, 2048, N/A\n" +
          "NVIDIA, Test GPU, 1024, 256\n",
      ),
    ).toEqual([
      {
        name: "Overreported GPU",
        dedicatedMemoryBytes: 8_192 * 1024 ** 2,
        availableMemoryBytes: 8_192 * 1024 ** 2,
      },
      {
        name: "Legacy GPU",
        dedicatedMemoryBytes: 4_096 * 1024 ** 2,
        availableMemoryBytes: null,
      },
      {
        name: "Unavailable GPU",
        dedicatedMemoryBytes: 2_048 * 1024 ** 2,
        availableMemoryBytes: null,
      },
      {
        name: "NVIDIA, Test GPU",
        dedicatedMemoryBytes: 1_024 * 1024 ** 2,
        availableMemoryBytes: 256 * 1024 ** 2,
      },
    ]);
  });

  it("merges NVIDIA live memory into the stable DXGI adapter without consulting CIM", async () => {
    const cimQuery = vi.fn(async () =>
      JSON.stringify({ Name: "NVIDIA GeForce RTX 4090", AdapterRAM: 4 * 1024 ** 3 }),
    );
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "x64",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 24 * 1024 ** 3,
      cpuLogicalCores: 16,
      freeDiskBytes: 80 * 1024 ** 3,
      runWindowsVulkanQuery: async () =>
        JSON.stringify(vulkanDevice("00000000:00000001", "40112233445566778899aabbccddeeff")),
      runNvidiaSmiQuery: async () => "NVIDIA GeForce RTX 4090, 24564, 8192, 8.9, 610.47\r\n",
      runWindowsDxgiQuery: async () =>
        JSON.stringify({
          Luid: "00000000:00000001",
          Name: "NVIDIA GeForce RTX 4090",
          VendorId: 0x10de,
          DeviceId: 1,
          DedicatedMemoryBytes: String(24 * 1024 ** 3),
          SharedMemoryBytes: String(16 * 1024 ** 3),
          BudgetBytes: String(10 * 1024 ** 3),
          CurrentUsageBytes: "0",
          MemorySegment: "local",
        }),
      runWindowsGpuQuery: cimQuery,
    });

    expect(profile.gpus).toEqual([
      {
        id: "00000000:00000001",
        name: "NVIDIA GeForce RTX 4090",
        dedicatedMemoryBytes: 24 * 1024 ** 3,
        availableMemoryBytes: 8_192 * 1024 ** 2,
        memoryType: "dedicated",
        computeCompatible: true,
        computeBackend: "cuda",
      },
    ]);
    expect(cimQuery).not.toHaveBeenCalled();
  });

  it("pairs same-name NVIDIA adapters by live memory when enumeration orders differ", async () => {
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "x64",
      totalMemoryBytes: 64 * 1024 ** 3,
      availableMemoryBytes: 48 * 1024 ** 3,
      cpuLogicalCores: 24,
      freeDiskBytes: 100 * 1024 ** 3,
      runWindowsVulkanQuery: async () => "[]",
      runNvidiaSmiQuery: async () =>
        "NVIDIA GeForce RTX 4090, 24564, 20480, 8.9, 610.47\n" +
        "NVIDIA GeForce RTX 4090, 24564, 2048, 8.9, 610.47\n",
      runWindowsDxgiQuery: async () =>
        JSON.stringify([
          {
            Luid: "00000000:00000001",
            Name: "NVIDIA GeForce RTX 4090",
            VendorId: 0x10de,
            DeviceId: 1,
            DedicatedMemoryBytes: String(24 * 1024 ** 3),
            SharedMemoryBytes: String(32 * 1024 ** 3),
            BudgetBytes: String(2 * 1024 ** 3),
            CurrentUsageBytes: "0",
            MemorySegment: "local",
          },
          {
            Luid: "00000000:00000002",
            Name: "NVIDIA GeForce RTX 4090",
            VendorId: 0x10de,
            DeviceId: 2,
            DedicatedMemoryBytes: String(24 * 1024 ** 3),
            SharedMemoryBytes: String(32 * 1024 ** 3),
            BudgetBytes: String(20 * 1024 ** 3),
            CurrentUsageBytes: "0",
            MemorySegment: "local",
          },
        ]),
      runWindowsGpuQuery: async () => "[]",
    });

    expect(
      profile.gpus.map(({ id, availableMemoryBytes, computeCompatible }) => ({
        id,
        availableMemoryBytes,
        computeCompatible,
      })),
    ).toEqual([
      {
        id: "00000000:00000001",
        availableMemoryBytes: 2 * 1024 ** 3,
        computeCompatible: true,
      },
      {
        id: "00000000:00000002",
        availableMemoryBytes: 20 * 1024 ** 3,
        computeCompatible: true,
      },
    ]);
  });

  it("does not trust a DXGI NVIDIA budget when the driver cannot prove compute support", async () => {
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 24 * 1024 ** 3,
      cpuLogicalCores: 16,
      freeDiskBytes: 80 * 1024 ** 3,
      runWindowsVulkanQuery: async () => "[]",
      runNvidiaSmiQuery: async () => {
        throw new Error("unsupported driver");
      },
      runWindowsDxgiQuery: async () =>
        JSON.stringify({
          Luid: "00000000:00000001",
          Name: "NVIDIA GeForce Test",
          VendorId: 0x10de,
          DeviceId: 1,
          DedicatedMemoryBytes: String(24 * 1024 ** 3),
          SharedMemoryBytes: String(16 * 1024 ** 3),
          BudgetBytes: String(20 * 1024 ** 3),
          CurrentUsageBytes: "0",
          MemorySegment: "local",
        }),
      runWindowsGpuQuery: async () => "[]",
    });

    expect(profile.gpus[0]).toMatchObject({
      name: "NVIDIA GeForce Test",
      availableMemoryBytes: null,
      computeCompatible: false,
    });
  });

  it("falls back from unsupported NVIDIA CUDA to a verified Vulkan LUID", async () => {
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "x64",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 24 * 1024 ** 3,
      cpuLogicalCores: 16,
      freeDiskBytes: 80 * 1024 ** 3,
      runNvidiaSmiQuery: async () => "NVIDIA GeForce Vulkan Fallback, 12288, 10000, 8.9, 530.00\n",
      runWindowsVulkanQuery: async () =>
        JSON.stringify(vulkanDevice("00000000:00000031", "00112233445566778899aabbccddeeff")),
      runWindowsDxgiQuery: async () =>
        JSON.stringify({
          Luid: "00000000:00000031",
          Name: "NVIDIA GeForce Vulkan Fallback",
          VendorId: 0x10de,
          DeviceId: 1,
          DedicatedMemoryBytes: String(12 * 1024 ** 3),
          SharedMemoryBytes: String(16 * 1024 ** 3),
          BudgetBytes: String(10 * 1024 ** 3),
          CurrentUsageBytes: String(2 * 1024 ** 3),
          MemorySegment: "local",
        }),
      runWindowsGpuQuery: async () => "[]",
    });

    expect(profile.gpus[0]).toMatchObject({
      id: "00000000:00000031",
      availableMemoryBytes: 8 * 1024 ** 3,
      computeCompatible: true,
      computeBackend: "vulkan",
    });
  });

  it("falls back to CIM when nvidia-smi output is unavailable or invalid", async () => {
    const cimQuery = vi.fn(async () =>
      JSON.stringify({ Name: "Fallback GPU", AdapterRAM: 4 * 1024 ** 3 }),
    );
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "x64",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 12 * 1024 ** 3,
      cpuLogicalCores: 8,
      freeDiskBytes: 40 * 1024 ** 3,
      runWindowsVulkanQuery: async () => "[]",
      runNvidiaSmiQuery: async () => "driver query failed",
      runWindowsDxgiQuery: async () => {
        throw new Error("DXGI unavailable");
      },
      runWindowsGpuQuery: cimQuery,
    });

    expect(profile.gpus).toEqual([
      {
        name: "Fallback GPU",
        dedicatedMemoryBytes: 4 * 1024 ** 3,
        availableMemoryBytes: null,
      },
    ]);
    expect(cimQuery).toHaveBeenCalledOnce();
  });

  it("does not trust a Vulkan device whose LUID does not match the DXGI adapter", async () => {
    const cimQuery = vi.fn(async () => "[]");
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "x64",
      totalMemoryBytes: 24 * 1024 ** 3,
      availableMemoryBytes: 8 * 1024 ** 3,
      cpuLogicalCores: 12,
      freeDiskBytes: 64 * 1024 ** 3,
      runWindowsVulkanQuery: async () =>
        JSON.stringify(vulkanDevice("00000000:00000099", "50112233445566778899aabbccddeeff")),
      runNvidiaSmiQuery: async () => {
        throw new Error("not NVIDIA");
      },
      runWindowsDxgiQuery: async () =>
        JSON.stringify([
          {
            Luid: "00000000:00000011",
            Name: "AMD Radeon Test",
            VendorId: 0x1002,
            DeviceId: 1,
            DedicatedMemoryBytes: String(24 * 1024 ** 3),
            SharedMemoryBytes: String(12 * 1024 ** 3),
            BudgetBytes: String(23 * 1024 ** 3),
            CurrentUsageBytes: String(1 * 1024 ** 3),
            MemorySegment: "local",
          },
          {
            Luid: "00000000:00000022",
            Name: "Intel Integrated Test",
            VendorId: 0x8086,
            DeviceId: 2,
            DedicatedMemoryBytes: String(128 * 1024 ** 2),
            SharedMemoryBytes: String(12 * 1024 ** 3),
            BudgetBytes: String(10 * 1024 ** 3),
            CurrentUsageBytes: "0",
            MemorySegment: "local",
          },
        ]),
      runWindowsGpuQuery: cimQuery,
    });

    expect(profile.gpus).toEqual([
      {
        id: "00000000:00000011",
        name: "AMD Radeon Test",
        dedicatedMemoryBytes: 24 * 1024 ** 3,
        availableMemoryBytes: null,
        memoryType: "dedicated",
        computeCompatible: false,
      },
      {
        id: "00000000:00000022",
        name: "Intel Integrated Test",
        dedicatedMemoryBytes: null,
        availableMemoryBytes: null,
        memoryType: "shared",
      },
    ]);
    expect(cimQuery).not.toHaveBeenCalled();
  });

  it("enables Vulkan only for LUID-matched AMD, Intel, and unknown dedicated adapters", async () => {
    const adapters = [
      ["00000000:00000041", "AMD Vulkan", 0x1002, 16, 12],
      ["00000000:00000042", "Intel Arc Vulkan", 0x8086, 8, 6],
      ["00000000:00000043", "Other Vulkan", 0x1234, 4, 3],
    ] as const;
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "x64",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 24 * 1024 ** 3,
      cpuLogicalCores: 16,
      freeDiskBytes: 80 * 1024 ** 3,
      runNvidiaSmiQuery: async () => {
        throw new Error("not NVIDIA");
      },
      runWindowsVulkanQuery: async () =>
        JSON.stringify([
          vulkanDevice(adapters[0][0], "10112233445566778899aabbccddeeff"),
          vulkanDevice(adapters[1][0], "20112233445566778899aabbccddeeff", 1),
          vulkanDevice(adapters[2][0], "30112233445566778899aabbccddeeff"),
        ]),
      runWindowsDxgiQuery: async () =>
        JSON.stringify(
          adapters.map(([Luid, Name, VendorId, memoryGiB, availableGiB], index) => ({
            Luid,
            Name,
            VendorId,
            DeviceId: index + 1,
            DedicatedMemoryBytes: String(memoryGiB * 1024 ** 3),
            SharedMemoryBytes: String(16 * 1024 ** 3),
            BudgetBytes: String(availableGiB * 1024 ** 3),
            CurrentUsageBytes: "0",
            MemorySegment: "local",
          })),
        ),
      runWindowsGpuQuery: async () => "[]",
    });

    expect(
      profile.gpus.map(({ id, availableMemoryBytes, computeCompatible, computeBackend }) => ({
        id,
        availableMemoryBytes,
        computeCompatible,
        computeBackend,
      })),
    ).toEqual([
      {
        id: adapters[0][0],
        availableMemoryBytes: 12 * 1024 ** 3,
        computeCompatible: true,
        computeBackend: "vulkan",
      },
      {
        id: adapters[1][0],
        availableMemoryBytes: 6 * 1024 ** 3,
        computeCompatible: true,
        computeBackend: "vulkan",
      },
      {
        id: adapters[2][0],
        availableMemoryBytes: 3 * 1024 ** 3,
        computeCompatible: true,
        computeBackend: "vulkan",
      },
    ]);
  });

  it("preserves injected live GPU memory instead of dropping it", async () => {
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "x64",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 8 * 1024 ** 3,
      cpuLogicalCores: 8,
      freeDiskBytes: 40 * 1024 ** 3,
      gpus: [
        {
          name: "Injected GPU",
          dedicatedMemoryBytes: 8 * 1024 ** 3,
          availableMemoryBytes: 2 * 1024 ** 3,
        },
      ],
    });

    expect(profile.gpus).toEqual([
      {
        name: "Injected GPU",
        dedicatedMemoryBytes: 8 * 1024 ** 3,
        availableMemoryBytes: 2 * 1024 ** 3,
      },
    ]);
  });

  it("disables GPU acceleration on Windows ARM while retaining device identity", async () => {
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "arm64",
      processArchitecture: "x64",
      runningUnderTranslation: true,
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 24 * 1024 ** 3,
      cpuLogicalCores: 12,
      freeDiskBytes: 80 * 1024 ** 3,
      gpus: [
        {
          id: "gpu-1",
          name: "Windows ARM GPU",
          dedicatedMemoryBytes: 12 * 1024 ** 3,
          availableMemoryBytes: 11 * 1024 ** 3,
          memoryType: "dedicated",
          computeCompatible: true,
          computeBackend: "cuda",
        },
      ],
    });

    expect(profile).toMatchObject({
      cpuArchitecture: "arm64",
      processArchitecture: "x64",
      runningUnderTranslation: true,
      gpus: [
        {
          id: "gpu-1",
          name: "Windows ARM GPU",
          dedicatedMemoryBytes: 12 * 1024 ** 3,
          availableMemoryBytes: null,
          memoryType: "dedicated",
          computeCompatible: false,
        },
      ],
    });
    expect(profile.gpus[0]).not.toHaveProperty("computeBackend");
  });

  it("skips the Vulkan probe entirely on Windows ARM", async () => {
    const vulkanQuery = vi.fn(async () => {
      throw new Error("must not run on Windows ARM");
    });
    const profile = await collectHardwareProfile({
      stateDir: "unused",
      platform: "win32",
      architecture: "arm64",
      processArchitecture: "arm64",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 12 * 1024 ** 3,
      cpuLogicalCores: 8,
      freeDiskBytes: 40 * 1024 ** 3,
      runNvidiaSmiQuery: async () => {
        throw new Error("not NVIDIA");
      },
      runWindowsVulkanQuery: vulkanQuery,
      runWindowsDxgiQuery: async () =>
        JSON.stringify({
          Luid: "00000000:00000051",
          Name: "Windows ARM GPU",
          VendorId: 0x1002,
          DeviceId: 1,
          DedicatedMemoryBytes: String(8 * 1024 ** 3),
          SharedMemoryBytes: String(8 * 1024 ** 3),
          BudgetBytes: String(7 * 1024 ** 3),
          CurrentUsageBytes: "0",
          MemorySegment: "local",
        }),
      runWindowsGpuQuery: async () => "[]",
    });

    expect(vulkanQuery).not.toHaveBeenCalled();
    expect(profile.gpus[0]).toMatchObject({
      id: "00000000:00000051",
      availableMemoryBytes: null,
      computeCompatible: false,
    });
    expect(profile.gpus[0]).not.toHaveProperty("computeBackend");
  });

  it("reads free disk space without invoking Windows discovery on other platforms", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "djl-hardware-profile-"));
    roots.push(stateDir);
    const nvidiaQuery = vi.fn(async () => "NVIDIA GPU, 8192");
    const cimQuery = vi.fn(async () => "[]");
    const profile = await collectHardwareProfile({
      stateDir,
      platform: "linux",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 12 * 1024 ** 3,
      cpuLogicalCores: 8,
      runNvidiaSmiQuery: nvidiaQuery,
      runWindowsGpuQuery: cimQuery,
    });

    expect(profile.freeDiskBytes).toBeGreaterThan(0);
    expect(profile.gpus).toEqual([]);
    expect(nvidiaQuery).not.toHaveBeenCalled();
    expect(cimQuery).not.toHaveBeenCalled();
  });
});
