// FILE: hardwareProfile.ts
// Purpose: Detects the acceleration this computer can actually give a local model, and converts it
// into a byte budget for model weights.
// Layer: Desktop local-model services
// Exports: acceleration detection and the weight budget used to pick a recommendation.

import { execFile } from "node:child_process";
import { mkdir, readFile, statfs } from "node:fs/promises";
import {
  arch,
  arch as osArch,
  cpus,
  freemem,
  platform as osPlatform,
  release,
  totalmem,
} from "node:os";
import { promisify } from "node:util";

import type {
  LocalHardwareAcceleration,
  LocalHardwareProfile,
  LocalModelGpu,
  LocalModelHardwareProfile,
} from "@synara/contracts";

import { queryWindowsDxgiGpuInventory, type WindowsDxgiAdapter } from "./windowsDxgiQuery";
import { queryWindowsVulkanDeviceInventory, type WindowsVulkanDevice } from "./windowsVulkanQuery";

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

const GPU_QUERY_TIMEOUT_MS = 8_000;
const MAX_GPU_COUNT = 16;
const MIB = 1024 ** 2;

export interface HardwareProfileCollectionOptions {
  readonly stateDir: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: NodeJS.Architecture;
  readonly processArchitecture?: NodeJS.Architecture;
  readonly runningUnderTranslation?: boolean;
  readonly osVersion?: string;
  readonly totalMemoryBytes?: number;
  readonly availableMemoryBytes?: number;
  readonly readAvailableMemory?: () => number;
  readonly cpuLogicalCores?: number;
  readonly freeDiskBytes?: number | null;
  readonly gpus?: ReadonlyArray<LocalModelGpu>;
  readonly runNvidiaSmiQuery?: () => Promise<string>;
  readonly runWindowsDxgiQuery?: () => Promise<string>;
  readonly runWindowsVulkanQuery?: () => Promise<string>;
  readonly runWindowsGpuQuery?: () => Promise<string>;
  readonly runMacGpuQuery?: () => Promise<string>;
  readonly runMacOsVersionQuery?: () => Promise<string>;
}
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

function optionalBytes(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) return optionalBytes(Number(value));
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
}

function versionAtLeast(actual: ReadonlyArray<number>, minimum: ReadonlyArray<number>): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    const difference = (actual[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseWindowsGpuInventory(output: string): LocalModelGpu[] {
  try {
    const parsed = JSON.parse(output.replace(/^\uFEFF/, "").trim()) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const seen = new Set<string>();
    return values.flatMap((value): LocalModelGpu[] => {
      const item = record(value);
      const rawName = typeof item?.Name === "string" ? item.Name.trim() : "";
      if (!rawName) return [];
      const name = rawName.slice(0, 256);
      const dedicatedMemoryBytes = optionalBytes(item?.AdapterRAM);
      const fingerprint = `${name}\u0000${dedicatedMemoryBytes ?? "unknown"}`;
      if (seen.has(fingerprint) || seen.size >= MAX_GPU_COUNT) return [];
      seen.add(fingerprint);
      return [{ name, dedicatedMemoryBytes, availableMemoryBytes: null }];
    });
  } catch {
    return [];
  }
}

export function parseNvidiaSmiGpuInventory(output: string): LocalModelGpu[] {
  return output
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .flatMap((line): LocalModelGpu[] => {
      if (line.length === 0) return [];
      const columns = line.split(",");
      if (columns.length < 2) return [];
      const parseMemoryColumn = (column: string | undefined): number | null => {
        const rawMemoryMib = column?.trim().replace(/\s*MiB$/i, "") ?? "";
        return /^\d+(?:\.\d+)?$/.test(rawMemoryMib)
          ? finiteNonNegative(Number(rawMemoryMib) * MIB)
          : null;
      };
      const enhancedRow = columns.length >= 5;
      const totalColumn = enhancedRow ? columns.at(-4) : columns.at(-2);
      const availableColumn = enhancedRow ? columns.at(-3) : columns.at(-1);
      const lastMemoryBytes = parseMemoryColumn(availableColumn);
      const precedingMemoryBytes = parseMemoryColumn(totalColumn);
      const hasAvailableMemoryColumn =
        enhancedRow || (columns.length >= 3 && precedingMemoryBytes !== null);
      const rawName = columns
        .slice(0, enhancedRow ? -4 : hasAvailableMemoryColumn ? -2 : -1)
        .join(",")
        .trim();
      const dedicatedMemoryBytes = optionalBytes(
        hasAvailableMemoryColumn ? precedingMemoryBytes : lastMemoryBytes,
      );
      if (!rawName || dedicatedMemoryBytes === null) return [];
      const parsedAvailableMemoryBytes = hasAvailableMemoryColumn ? lastMemoryBytes : null;
      const availableMemoryBytes =
        parsedAvailableMemoryBytes === null
          ? null
          : Math.min(parsedAvailableMemoryBytes, dedicatedMemoryBytes);
      const name = rawName.slice(0, 256);
      if (!enhancedRow) return [{ name, dedicatedMemoryBytes, availableMemoryBytes }];

      const computeCapability = Number(columns.at(-2)?.trim());
      const driverVersion = columns.at(-1)?.trim() ?? "";
      const driverParts = /^\d+(?:\.\d+){0,2}$/.test(driverVersion)
        ? driverVersion.split(".").map((part) => Number.parseInt(part, 10))
        : [];
      const minimumDriverParts =
        computeCapability >= 5 && computeCapability <= 6.2 ? [570, 0, 0] : [551, 61, 0];
      const driverCompatible = versionAtLeast(driverParts, minimumDriverParts);
      const computeCompatible =
        Number.isFinite(computeCapability) &&
        computeCapability >= 5 &&
        driverParts.length > 0 &&
        driverCompatible;
      return [
        {
          name,
          dedicatedMemoryBytes,
          availableMemoryBytes: computeCompatible ? availableMemoryBytes : null,
          computeCompatible,
          ...(computeCompatible ? { computeBackend: "cuda" as const } : {}),
        },
      ];
    })
    .slice(0, MAX_GPU_COUNT);
}

function parseMemorySize(value: unknown): number | null {
  if (typeof value === "number") return optionalBytes(value);
  if (typeof value !== "string") return null;
  const match = value.trim().match(/([\d,.]+)\s*(KB|MB|GB|TB)\b/i);
  if (!match) return null;
  const amount = Number((match[1] ?? "").replaceAll(",", ""));
  const unit = (match[2] ?? "").toUpperCase();
  const multiplier =
    unit === "KB" ? 1024 : unit === "MB" ? 1024 ** 2 : unit === "GB" ? 1024 ** 3 : 1024 ** 4;
  return optionalBytes(amount * multiplier);
}

export function parseMacGpuInventory(
  output: string,
  hostArchitecture: NodeJS.Architecture,
): LocalModelGpu[] {
  try {
    const root = record(JSON.parse(output.replace(/^\uFEFF/, "").trim()));
    const displays = root?.SPDisplaysDataType;
    if (!Array.isArray(displays)) return [];
    return displays.slice(0, MAX_GPU_COUNT).flatMap((value): LocalModelGpu[] => {
      const item = record(value);
      if (!item) return [];
      const name = [item.sppci_model, item.spdisplays_chipset_model, item._name]
        .find(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.trim().length > 0,
        )
        ?.trim()
        .slice(0, 256);
      if (!name) return [];
      const normalizedName = name.toLocaleLowerCase("en-US");
      const unified =
        hostArchitecture === "arm64" ||
        /(?:^|\s)apple\s+(?:m\d|silicon|gpu)/i.test(name) ||
        /^apple m\d/i.test(name);
      const shared = !unified && /\bintel\b/i.test(normalizedName);
      const dedicatedMemoryBytes = unified
        ? null
        : parseMemorySize(
            item._spdisplays_vram ?? item.spdisplays_vram ?? item.spdisplays_vram_shared,
          );
      return [
        {
          name,
          dedicatedMemoryBytes,
          availableMemoryBytes: null,
          memoryType: unified ? "unified" : shared ? "shared" : "dedicated",
          ...(unified ? { computeCompatible: true, computeBackend: "metal" as const } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

async function execFileText(command: string, args: ReadonlyArray<string>): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: GPU_QUERY_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

async function runNvidiaSmiQuery(): Promise<string> {
  return await execFileText("nvidia-smi.exe", [
    "--query-gpu=name,memory.total,memory.free,compute_cap,driver_version",
    "--format=csv,noheader,nounits",
  ]);
}

async function runWindowsGpuQuery(): Promise<string> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
    "@(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop | ForEach-Object {",
    "  [PSCustomObject]@{ Name = [string]$_.Name; AdapterRAM = $_.AdapterRAM }",
    "}) | ConvertTo-Json -Compress",
  ].join("\n");
  return await execFileText("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
}

async function runMacGpuQuery(): Promise<string> {
  return await execFileText("/usr/sbin/system_profiler", [
    "SPDisplaysDataType",
    "-json",
    "-detailLevel",
    "mini",
  ]);
}

async function runMacOsVersionQuery(): Promise<string> {
  return await execFileText("/usr/bin/sw_vers", ["-productVersion"]);
}

async function detectMacGpus(
  hostArchitecture: NodeJS.Architecture,
  query: () => Promise<string> = runMacGpuQuery,
): Promise<LocalModelGpu[]> {
  try {
    const detected = parseMacGpuInventory(await query(), hostArchitecture);
    if (detected.length > 0) return detected;
  } catch {
    // system_profiler can be unavailable in restricted environments.
  }
  return hostArchitecture === "arm64"
    ? [
        {
          name: "Apple GPU",
          dedicatedMemoryBytes: null,
          availableMemoryBytes: null,
          memoryType: "unified",
          computeCompatible: true,
          computeBackend: "metal",
        },
      ]
    : [];
}

async function detectMacOsVersion(query: () => Promise<string> = runMacOsVersionQuery) {
  try {
    const value = (await query()).trim();
    return /^\d+(?:\.\d+){0,3}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function detectWindowsGpus(
  nvidiaQuery: () => Promise<string> = runNvidiaSmiQuery,
  dxgiQuery?: () => Promise<string>,
  cimQuery: () => Promise<string> = runWindowsGpuQuery,
  vulkanQuery?: () => Promise<string>,
  allowVulkan = true,
): Promise<LocalModelGpu[]> {
  const [nvidiaResult, dxgiGpus, vulkanDevices] = await Promise.all([
    nvidiaQuery()
      .then(parseNvidiaSmiGpuInventory)
      .catch((): LocalModelGpu[] => []),
    queryWindowsDxgiGpuInventory({
      platform: "win32",
      ...(dxgiQuery ? { runQuery: dxgiQuery } : {}),
    }),
    allowVulkan
      ? queryWindowsVulkanDeviceInventory({
          platform: "win32",
          ...(vulkanQuery ? { runQuery: vulkanQuery } : {}),
        })
      : Promise.resolve([]),
  ]);
  if (dxgiGpus.length > 0) {
    return mergeWindowsGpuInventories(dxgiGpus, nvidiaResult, vulkanDevices);
  }

  // Older Windows installations can lack IDXGIAdapter3. Keep NVIDIA's live query and merge CIM
  // names so hybrid Intel/NVIDIA or AMD/NVIDIA laptops do not hide a physical adapter.
  let cimGpus: LocalModelGpu[] = [];
  try {
    cimGpus = parseWindowsGpuInventory(await cimQuery());
  } catch {
    // CIM is a final name-only fallback.
  }
  if (nvidiaResult.length === 0) return cimGpus;
  const remainingByName = new Map<string, number>();
  for (const gpu of nvidiaResult) {
    const key = normalizedGpuName(gpu.name);
    remainingByName.set(key, (remainingByName.get(key) ?? 0) + 1);
  }
  const additions = cimGpus.filter((gpu) => {
    const key = normalizedGpuName(gpu.name);
    const remaining = remainingByName.get(key) ?? 0;
    if (remaining <= 0) return true;
    remainingByName.set(key, remaining - 1);
    return false;
  });
  return [...nvidiaResult.map(dedicatedGpu), ...additions].slice(0, MAX_GPU_COUNT);
}

function normalizedGpuName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function compareGpuMemoryDescending(
  left: {
    dedicatedMemoryBytes: number | null;
    availableMemoryBytes?: number | null | undefined;
  },
  right: {
    dedicatedMemoryBytes: number | null;
    availableMemoryBytes?: number | null | undefined;
  },
): number {
  return (
    (right.dedicatedMemoryBytes ?? -1) - (left.dedicatedMemoryBytes ?? -1) ||
    (right.availableMemoryBytes ?? -1) - (left.availableMemoryBytes ?? -1)
  );
}

function dedicatedGpu(gpu: LocalModelGpu): LocalModelGpu {
  return { ...copyGpu(gpu), memoryType: "dedicated" };
}

function copyGpu(gpu: LocalModelGpu, includeComputeBackend = true): LocalModelGpu {
  const copy: {
    id?: string;
    name: string;
    dedicatedMemoryBytes: number | null;
    availableMemoryBytes?: number | null;
    memoryType?: LocalModelGpu["memoryType"];
    computeCompatible?: boolean;
    computeBackend?: LocalModelGpu["computeBackend"];
  } = {
    name: gpu.name,
    dedicatedMemoryBytes: gpu.dedicatedMemoryBytes,
  };
  if (gpu.id !== undefined) copy.id = gpu.id;
  if (gpu.availableMemoryBytes !== undefined) {
    copy.availableMemoryBytes = gpu.availableMemoryBytes;
  }
  if (gpu.memoryType !== undefined) copy.memoryType = gpu.memoryType;
  if (gpu.computeCompatible !== undefined) copy.computeCompatible = gpu.computeCompatible;
  if (includeComputeBackend && gpu.computeBackend !== undefined) {
    copy.computeBackend = gpu.computeBackend;
  }
  return copy;
}

function mergeWindowsGpuInventories(
  dxgiGpus: ReadonlyArray<WindowsDxgiAdapter>,
  nvidiaGpus: ReadonlyArray<LocalModelGpu>,
  vulkanDevices: ReadonlyArray<WindowsVulkanDevice>,
): LocalModelGpu[] {
  const vulkanLuids = new Set(vulkanDevices.map(({ luid }) => luid));
  const nvidiaByName = new Map<string, LocalModelGpu[]>();
  for (const gpu of nvidiaGpus) {
    const key = normalizedGpuName(gpu.name);
    nvidiaByName.set(key, [...(nvidiaByName.get(key) ?? []), gpu]);
  }
  for (const [key, group] of nvidiaByName) {
    nvidiaByName.set(key, group.toSorted(compareGpuMemoryDescending));
  }

  // DXGI exposes a stable LUID while nvidia-smi exposes live compute data. Their enumeration
  // orders are not guaranteed to match, so pair equal-name adapters by capacity before merging.
  const dxgiByName = new Map<string, WindowsDxgiAdapter[]>();
  for (const gpu of dxgiGpus) {
    const key = normalizedGpuName(gpu.name);
    dxgiByName.set(key, [...(dxgiByName.get(key) ?? []), gpu]);
  }
  const nvidiaByLuid = new Map<string, LocalModelGpu>();
  const matchedNvidia = new Set<LocalModelGpu>();
  for (const [key, dxgiGroup] of dxgiByName) {
    const nvidiaGroup = nvidiaByName.get(key) ?? [];
    dxgiGroup.toSorted(compareGpuMemoryDescending).forEach((gpu, index) => {
      const matchingNvidia = nvidiaGroup[index];
      if (!matchingNvidia) return;
      nvidiaByLuid.set(gpu.luid, matchingNvidia);
      matchedNvidia.add(matchingNvidia);
    });
  }

  const merged = dxgiGpus.map((gpu): LocalModelGpu => {
    const isShared =
      gpu.memorySegment === "non_local" || (gpu.dedicatedMemoryBytes ?? 0) < 1024 ** 3;
    if (isShared) {
      return {
        id: gpu.luid,
        name: gpu.name,
        dedicatedMemoryBytes: null,
        availableMemoryBytes: null,
        memoryType: "shared",
      };
    }

    const matchingNvidia = nvidiaByLuid.get(gpu.luid);
    const isNvidia = gpu.vendorId === 0x10de;
    const cudaCompatible = isNvidia && matchingNvidia?.computeCompatible === true;
    const vulkanCompatible = vulkanLuids.has(gpu.luid);
    const computeBackend = cudaCompatible ? "cuda" : vulkanCompatible ? "vulkan" : null;
    const computeCompatible = computeBackend !== null;
    const dedicatedMemoryBytes = Math.max(
      gpu.dedicatedMemoryBytes ?? 0,
      matchingNvidia?.dedicatedMemoryBytes ?? 0,
    );
    const observedAvailable = [
      gpu.availableMemoryBytes,
      matchingNvidia?.availableMemoryBytes,
    ].filter((value): value is number => value !== null && value !== undefined);
    return {
      id: gpu.luid,
      name: gpu.name,
      dedicatedMemoryBytes: dedicatedMemoryBytes > 0 ? dedicatedMemoryBytes : null,
      availableMemoryBytes:
        computeCompatible === false || observedAvailable.length === 0
          ? null
          : Math.min(dedicatedMemoryBytes, ...observedAvailable),
      memoryType: "dedicated",
      computeCompatible,
      ...(computeBackend === null ? {} : { computeBackend }),
    };
  });

  for (const group of nvidiaByName.values()) {
    merged.push(...group.filter((gpu) => !matchedNvidia.has(gpu)).map(dedicatedGpu));
  }
  return merged.slice(0, MAX_GPU_COUNT);
}

function disableWindowsArmGpuAcceleration(gpu: LocalModelGpu): LocalModelGpu {
  return {
    ...copyGpu(gpu, false),
    availableMemoryBytes: null,
    computeCompatible: false,
  };
}

async function detectFreeDiskBytes(stateDir: string): Promise<number | null> {
  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const stats = await statfs(stateDir);
    return finiteNonNegative(Number(stats.bavail) * Number(stats.bsize));
  } catch {
    return null;
  }
}

export async function collectHardwareProfile(
  options: HardwareProfileCollectionOptions,
): Promise<LocalModelHardwareProfile> {
  const platform = options.platform ?? process.platform;
  const hostArchitecture = options.architecture ?? arch();
  const totalMemoryBytes = finiteNonNegative(options.totalMemoryBytes ?? totalmem());
  const detectedAvailableMemoryBytes =
    options.availableMemoryBytes ??
    options.readAvailableMemory?.() ??
    (typeof process.availableMemory === "function" ? process.availableMemory() : freemem());
  const availableMemoryBytes = Math.min(
    totalMemoryBytes,
    finiteNonNegative(detectedAvailableMemoryBytes),
  );
  const detectedCpuLogicalCores = options.cpuLogicalCores ?? cpus().length;
  const cpuLogicalCores =
    Number.isFinite(detectedCpuLogicalCores) && detectedCpuLogicalCores > 0
      ? Math.min(Math.floor(detectedCpuLogicalCores), Number.MAX_SAFE_INTEGER)
      : 1;
  const detectedGpus = options.gpus
    ? options.gpus.slice(0, MAX_GPU_COUNT).map((gpu) => copyGpu(gpu))
    : platform === "win32"
      ? await detectWindowsGpus(
          options.runNvidiaSmiQuery,
          options.runWindowsDxgiQuery,
          options.runWindowsGpuQuery,
          options.runWindowsVulkanQuery,
          hostArchitecture !== "arm64",
        )
      : platform === "darwin"
        ? await detectMacGpus(hostArchitecture, options.runMacGpuQuery)
        : [];
  // The managed Windows ARM Ollama runtime currently has no GPU acceleration libraries.
  const gpus =
    platform === "win32" && hostArchitecture === "arm64"
      ? detectedGpus.map(disableWindowsArmGpuAcceleration)
      : detectedGpus;
  const osVersion =
    options.osVersion ??
    (platform === "darwin"
      ? await detectMacOsVersion(options.runMacOsVersionQuery)
      : release().slice(0, 64));
  const freeDiskBytes =
    options.freeDiskBytes === undefined
      ? await detectFreeDiskBytes(options.stateDir)
      : options.freeDiskBytes === null
        ? null
        : finiteNonNegative(options.freeDiskBytes);

  return {
    platform,
    totalMemoryBytes,
    availableMemoryBytes,
    cpuLogicalCores,
    cpuArchitecture: hostArchitecture,
    processArchitecture: options.processArchitecture ?? arch(),
    runningUnderTranslation: options.runningUnderTranslation ?? false,
    ...(osVersion === undefined ? {} : { osVersion }),
    gpus,
    freeDiskBytes,
  };
}
