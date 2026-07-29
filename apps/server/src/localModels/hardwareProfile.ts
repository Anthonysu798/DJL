// FILE: hardwareProfile.ts
// Purpose: Detects the acceleration this computer can actually give a local model, and converts it
// into a byte budget for model weights.
// Layer: Desktop local-model services
// Exports: acceleration detection and the weight budget used to pick a recommendation.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { arch as osArch, cpus, platform as osPlatform, totalmem } from "node:os";
import { promisify } from "node:util";

import type { LocalHardwareAcceleration, LocalHardwareProfile } from "@synara/contracts";

const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;
const PROBE_TIMEOUT_MS = 4_000;

// Apple's unified memory is shared with the OS and the app itself; Metal refuses to allocate much
// beyond this share. Discrete VRAM is nearly all usable. A CPU-only machine has to keep the model
// well clear of system memory or the whole computer swaps.
const MEMORY_BUDGET_FRACTION: Record<LocalHardwareAcceleration, number> = {
  apple_unified: 0.6,
  discrete_gpu: 0.9,
  cpu_only: 0.35,
};

// Weights are only part of the resident set: the 8K KV cache, context, and runtime overhead have to
// fit alongside them. Reserving this share is also what biases the catalog one tier down, which is
// the deliberate trade of capability for tokens per second.
const CONTEXT_HEADROOM_FRACTION = 0.7;

// Integrated adapters report a slice of system memory as "VRAM". Treating them as discrete GPUs
// would hand them a 0.9 budget over memory they do not really own.
const DISCRETE_GPU_MINIMUM_VRAM_BYTES = 4 * GIB;

// Linux exposes AMD VRAM per card; probing the first few covers every realistic desktop layout.
const LINUX_DRM_CARD_COUNT = 4;

export interface HardwareProbeOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly totalMemoryBytes?: number;
  readonly cpuModel?: string | null;
  readonly cpuCores?: number;
  readonly runCommand?: (
    command: string,
    args: ReadonlyArray<string>,
  ) => Promise<{ readonly stdout: string }>;
  readonly readTextFile?: (path: string) => Promise<string>;
}

interface DetectedGpu {
  readonly name: string | null;
  readonly vramBytes: number | null;
}

const NO_GPU: DetectedGpu = { name: null, vramBytes: null };

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
    : 0;
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function usableModelBytes(input: {
  readonly acceleration: LocalHardwareAcceleration;
  readonly totalMemoryBytes: number;
  readonly vramBytes?: number | null;
}): number {
  const total = finiteNonNegative(input.totalMemoryBytes);
  const vram = finiteNonNegative(input.vramBytes);
  // A discrete GPU with no readable VRAM tells us nothing, so fall back to the conservative budget
  // rather than inventing capacity the card may not have.
  const acceleration =
    input.acceleration === "discrete_gpu" && vram <= 0 ? "cpu_only" : input.acceleration;
  const base = acceleration === "discrete_gpu" ? vram : total;
  return Math.max(
    0,
    Math.floor(base * MEMORY_BUDGET_FRACTION[acceleration] * CONTEXT_HEADROOM_FRACTION),
  );
}

async function defaultRunCommand(
  command: string,
  args: ReadonlyArray<string>,
): Promise<{ readonly stdout: string }> {
  const { stdout } = await execFileAsync(command, [...args], {
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  return { stdout };
}

function parseWindowsAdapters(stdout: string): DetectedGpu {
  const parsed = JSON.parse(stdout) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  let best: DetectedGpu = NO_GPU;
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const adapter = entry as Record<string, unknown>;
    // WMI's Win32_VideoController.AdapterRAM is a signed 32-bit value and wraps above 4 GB. The
    // registry qwMemorySize is the only reliable source for modern cards.
    const vram = finiteNonNegative(adapter["HardwareInformation.qwMemorySize"]);
    if (vram <= (best.vramBytes ?? 0)) continue;
    best = { name: trimmedOrNull(adapter.DriverDesc), vramBytes: vram };
  }
  return best;
}

async function detectWindowsGpu(
  runCommand: NonNullable<HardwareProbeOptions["runCommand"]>,
): Promise<DetectedGpu> {
  try {
    const { stdout } = await runCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' " +
        "| Select-Object DriverDesc,'HardwareInformation.qwMemorySize' | ConvertTo-Json -Compress",
    ]);
    return parseWindowsAdapters(stdout);
  } catch {
    return NO_GPU;
  }
}

async function detectLinuxGpu(
  runCommand: NonNullable<HardwareProbeOptions["runCommand"]>,
  readTextFile: NonNullable<HardwareProbeOptions["readTextFile"]>,
): Promise<DetectedGpu> {
  try {
    const { stdout } = await runCommand("nvidia-smi", [
      "--query-gpu=name,memory.total",
      "--format=csv,noheader,nounits",
    ]);
    const [name, megabytes] = (stdout.split("\n")[0] ?? "").split(",");
    const vram = finiteNonNegative(Number(megabytes?.trim())) * 1024 ** 2;
    if (vram > 0) return { name: trimmedOrNull(name), vramBytes: vram };
  } catch {
    // No NVIDIA driver present; try the AMD/Intel sysfs node below.
  }

  for (let card = 0; card < LINUX_DRM_CARD_COUNT; card += 1) {
    try {
      const raw = await readTextFile(`/sys/class/drm/card${card}/device/mem_info_vram_total`);
      const vram = finiteNonNegative(Number(raw.trim()));
      if (vram > 0) return { name: null, vramBytes: vram };
    } catch {
      // This card index does not exist or exposes no VRAM node.
    }
  }
  return NO_GPU;
}

export async function detectHardwareProfile(
  options: HardwareProbeOptions = {},
): Promise<LocalHardwareProfile> {
  const platform = options.platform ?? osPlatform();
  const arch = options.arch ?? osArch();
  const totalMemoryBytes = finiteNonNegative(options.totalMemoryBytes ?? totalmem());
  const detectedCpus =
    options.cpuModel === undefined || options.cpuCores === undefined ? cpus() : [];
  const cpuModel =
    options.cpuModel !== undefined ? options.cpuModel : trimmedOrNull(detectedCpus[0]?.model);
  const cpuCores = finiteNonNegative(options.cpuCores ?? detectedCpus.length);
  const runCommand = options.runCommand ?? defaultRunCommand;
  const readTextFile = options.readTextFile ?? ((path: string) => readFile(path, "utf8"));

  // Apple Silicon is unified memory by construction, so there is nothing worth probing. Intel Macs
  // are CPU-only in practice: Ollama's Metal path requires Apple Silicon.
  if (platform === "darwin") {
    const appleSilicon = arch === "arm64";
    const acceleration: LocalHardwareAcceleration = appleSilicon ? "apple_unified" : "cpu_only";
    return {
      totalMemoryBytes,
      cpuModel,
      cpuCores,
      acceleration,
      gpuName: appleSilicon ? cpuModel : null,
      vramBytes: null,
      usableModelBytes: usableModelBytes({ acceleration, totalMemoryBytes }),
    };
  }

  const gpu =
    platform === "win32"
      ? await detectWindowsGpu(runCommand)
      : platform === "linux"
        ? await detectLinuxGpu(runCommand, readTextFile)
        : NO_GPU;

  const discrete = (gpu.vramBytes ?? 0) >= DISCRETE_GPU_MINIMUM_VRAM_BYTES;
  const acceleration: LocalHardwareAcceleration = discrete ? "discrete_gpu" : "cpu_only";
  return {
    totalMemoryBytes,
    cpuModel,
    cpuCores,
    acceleration,
    gpuName: discrete ? gpu.name : null,
    vramBytes: discrete ? gpu.vramBytes : null,
    usableModelBytes: usableModelBytes({
      acceleration,
      totalMemoryBytes,
      vramBytes: gpu.vramBytes,
    }),
  };
}
