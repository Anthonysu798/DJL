import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type DesktopStagePlatform = "linux" | "mac" | "win";
export type DesktopStageArch = "arm64" | "x64" | "universal";

export interface DesktopStageTarget {
  readonly platform: DesktopStagePlatform;
  readonly arch: DesktopStageArch;
}

export function resolveDesktopStageInstallArgs(target: DesktopStageTarget): ReadonlyArray<string> {
  const os = resolveTargetOs(target.platform);
  const cpu = target.arch === "universal" ? "*" : target.arch;
  return ["install", "--production", "--os", os, "--cpu", cpu];
}

export function ensureDesktopStageExecutableHelpers(
  input: DesktopStageTarget & { readonly stageAppDir: string },
): void {
  if (input.platform !== "mac") return;
  const arches = input.arch === "universal" ? (["arm64", "x64"] as const) : [input.arch];
  for (const arch of arches) {
    const helper = join(
      input.stageAppDir,
      "node_modules",
      "node-pty",
      "prebuilds",
      `darwin-${arch}`,
      "spawn-helper",
    );
    if (!existsSync(helper)) continue;
    chmodSync(helper, (statSync(helper).mode & 0o777) | 0o111);
  }
}

export function verifyDesktopStageNativeDependencies(
  input: DesktopStageTarget & { readonly stageAppDir: string },
): void {
  const os = resolveTargetOs(input.platform);
  const arches = input.arch === "universal" ? (["arm64", "x64"] as const) : [input.arch];
  const issues: string[] = [];

  for (const arch of arches) {
    for (const packageName of resolveRequiredVariantPackages(input.platform, os, arch)) {
      const manifestPath = join(
        input.stageAppDir,
        "node_modules",
        ...packageName.split("/"),
        "package.json",
      );
      if (!existsSync(manifestPath)) {
        issues.push(`${packageName} is missing`);
        continue;
      }

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          readonly os?: ReadonlyArray<string>;
          readonly cpu?: ReadonlyArray<string>;
        };
        if (!manifest.os?.includes(os) || !manifest.cpu?.includes(arch)) {
          issues.push(`${packageName} does not declare ${os}/${arch}`);
        }
      } catch (cause) {
        issues.push(
          `${packageName} has an unreadable package manifest: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
    }
  }

  if (input.platform === "mac") {
    verifyMacNodePty(input.stageAppDir, arches, issues);
  }
  verifyOnnxRuntime(input.stageAppDir, os, arches, issues);

  if (issues.length > 0) {
    throw new Error(
      `Staged native dependencies do not support ${os}/${input.arch}: ${issues.join("; ")}`,
    );
  }
}

function resolveTargetOs(platform: DesktopStagePlatform): "darwin" | "linux" | "win32" {
  if (platform === "mac") return "darwin";
  if (platform === "win") return "win32";
  return "linux";
}

function resolveRequiredVariantPackages(
  platform: DesktopStagePlatform,
  os: "darwin" | "linux" | "win32",
  arch: "arm64" | "x64",
): ReadonlyArray<string> {
  const clipboardSuffix =
    platform === "win"
      ? `${os}-${arch}-msvc`
      : platform === "linux"
        ? `${os}-${arch}-gnu`
        : `${os}-${arch}`;
  return [
    `@anthropic-ai/claude-agent-sdk-${os}-${arch}`,
    `@img/sharp-${os}-${arch}`,
    ...(platform === "win" ? [] : [`@img/sharp-libvips-${os}-${arch}`]),
    `@mariozechner/clipboard-${clipboardSuffix}`,
    ...(platform === "mac"
      ? [`@napi-rs/canvas-darwin-${arch}`, `@msgpackr-extract/msgpackr-extract-darwin-${arch}`]
      : []),
  ];
}

function verifyMacNodePty(
  stageAppDir: string,
  arches: ReadonlyArray<"arm64" | "x64">,
  issues: string[],
): void {
  const nodePtyRoot = join(stageAppDir, "node_modules", "node-pty");
  for (const arch of arches) {
    const prebuildRoot = join(nodePtyRoot, "prebuilds", `darwin-${arch}`);
    for (const fileName of ["pty.node", "spawn-helper"]) {
      verifyMachOFile(join(prebuildRoot, fileName), [arch], issues);
    }
  }

  for (const buildDirectory of ["Release", "Debug"]) {
    const buildRoot = join(nodePtyRoot, "build", buildDirectory);
    const ptyPath = join(buildRoot, "pty.node");
    if (!existsSync(ptyPath)) continue;
    verifyMachOFile(ptyPath, arches, issues);
    const helperPath = join(buildRoot, "spawn-helper");
    if (existsSync(helperPath)) {
      verifyMachOFile(helperPath, arches, issues);
    }
  }
}

function verifyOnnxRuntime(
  stageAppDir: string,
  os: "darwin" | "linux" | "win32",
  arches: ReadonlyArray<"arm64" | "x64">,
  issues: string[],
): void {
  const onnxRoot = join(stageAppDir, "node_modules", "onnxruntime-node");
  const manifestPath = join(onnxRoot, "package.json");
  let version: string | undefined;
  try {
    version = (
      JSON.parse(readFileSync(manifestPath, "utf8")) as {
        readonly version?: string;
      }
    ).version;
  } catch (cause) {
    issues.push(
      `onnxruntime-node has an unreadable package manifest: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return;
  }
  if (version !== "1.23.2") {
    issues.push(`onnxruntime-node must be 1.23.2, received ${version ?? "unknown"}`);
    return;
  }

  for (const arch of arches) {
    const nativeRoot = join(onnxRoot, "bin", "napi-v6", os, arch);
    const bindingPath = join(nativeRoot, "onnxruntime_binding.node");
    if (!existsSync(bindingPath)) {
      issues.push(`${bindingPath} is missing`);
      continue;
    }
    if (os !== "darwin") continue;

    const dylibPath = join(nativeRoot, `libonnxruntime.${version}.dylib`);
    for (const nativePath of [bindingPath, dylibPath]) {
      verifyMachOFile(nativePath, [arch], issues);
    }
  }
}

function verifyMachOFile(
  filePath: string,
  expectedArches: ReadonlyArray<"arm64" | "x64">,
  issues: string[],
): void {
  if (!existsSync(filePath)) {
    issues.push(`${filePath} is missing`);
    return;
  }
  const actualArches = readMachOArchitectures(readFileSync(filePath));
  const missingArches = expectedArches.filter((arch) => !actualArches.includes(arch));
  if (missingArches.length > 0) {
    issues.push(
      `${filePath} expected ${expectedArches.join("+")} Mach-O payload, found ${
        actualArches.length > 0 ? actualArches.join(", ") : "unrecognized architecture"
      }`,
    );
  }
}

function readMachOArchitectures(buffer: Buffer): ReadonlyArray<"arm64" | "x64"> {
  if (buffer.length < 8) return [];
  const architectures = new Set<"arm64" | "x64">();
  const recordCpu = (cpuType: number) => {
    if (cpuType >>> 0 === 0x01000007) architectures.add("x64");
    if (cpuType >>> 0 === 0x0100000c) architectures.add("arm64");
  };

  const littleMagic = buffer.readUInt32LE(0);
  if (littleMagic === 0xfeedfacf || littleMagic === 0xfeedface) {
    recordCpu(buffer.readUInt32LE(4));
    return [...architectures];
  }

  const bigMagic = buffer.readUInt32BE(0);
  if (bigMagic === 0xcafebabe || bigMagic === 0xcafebabf) {
    const count = buffer.readUInt32BE(4);
    const recordSize = bigMagic === 0xcafebabf ? 32 : 20;
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * recordSize;
      if (offset + 4 > buffer.length) break;
      recordCpu(buffer.readUInt32BE(offset));
    }
  }
  return [...architectures];
}
