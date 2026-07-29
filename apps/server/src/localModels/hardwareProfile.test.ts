import { describe, expect, it, vi } from "vitest";

import { detectHardwareProfile, usableModelBytes } from "./hardwareProfile";

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
    expect(budget).toBeLessThan(usableModelBytes({ acceleration: "cpu_only", totalMemoryBytes: 64 * GIB }));
  });

  it("budgets CPU-only machines conservatively", () => {
    expect(usableModelBytes({ acceleration: "cpu_only", totalMemoryBytes: 16 * GIB })).toBe(
      Math.floor(16 * GIB * 0.35 * 0.7),
    );
  });

  it("falls back to the CPU budget when a discrete GPU reports no VRAM", () => {
    expect(
      usableModelBytes({ acceleration: "discrete_gpu", totalMemoryBytes: 16 * GIB, vramBytes: null }),
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
