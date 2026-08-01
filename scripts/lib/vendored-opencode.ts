import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DJL_OPENCODE_VERSION = "1.17.18";
export const DJL_OPENCODE_COMMIT = "b1fc8113948b518835c2a39ece49553cffe9b30c";
export const DJL_OPENCODE_BUN_VERSION = "1.3.14";
export const DJL_OPENCODE_FINGERPRINT_PATHS = [
  "vendor/opencode/bun.lock",
  "vendor/opencode/DJL_UPSTREAM.md",
  "vendor/opencode/package.json",
  "vendor/opencode/packages/opencode/package.json",
  "vendor/opencode/packages/opencode/script/build.ts",
  "vendor/opencode/packages/opencode/src/provider/provider.ts",
  "vendor/opencode/packages/opencode/src/session/llm.ts",
  "vendor/opencode/packages/opencode/src/session/llm/local-model-prompt.ts",
  "vendor/opencode/packages/opencode/src/session/llm/local-tool-call-middleware.ts",
  "vendor/opencode/packages/opencode/src/session/llm/request.ts",
  "vendor/opencode/packages/opencode/src/session/prompt.ts",
  "vendor/opencode/packages/opencode/src/session/tools.ts",
  "vendor/opencode/packages/schema/src/v1/session.ts",
  "scripts/lib/vendored-opencode.ts",
] as const;

export type OpenCodeTargetPlatform = "darwin" | "linux" | "win32";
export type OpenCodeTargetArch = "arm64" | "x64";

export function resolveVendoredOpenCodeInstallArgs(input: {
  platform: OpenCodeTargetPlatform;
  arch: OpenCodeTargetArch;
}): ReadonlyArray<string> {
  return [
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--os",
    input.platform,
    "--cpu",
    input.arch,
  ];
}

export function resolveBunExecutable(): string {
  if (process.versions.bun) return process.execPath;
  const installRoot = process.env.BUN_INSTALL ?? join(homedir(), ".bun");
  const candidate = join(installRoot, "bin", process.platform === "win32" ? "bun.exe" : "bun");
  return existsSync(candidate) ? candidate : "bun";
}

export function resolveVendoredOpenCodeCacheBinary(input: {
  repoRoot: string;
  platform?: OpenCodeTargetPlatform;
  arch?: OpenCodeTargetArch;
}): string {
  const platform = input.platform ?? (process.platform as OpenCodeTargetPlatform);
  const arch = input.arch ?? (process.arch as OpenCodeTargetArch);
  return join(
    input.repoRoot,
    ".cache",
    "djl",
    "opencode",
    `${platform}-${arch}`,
    platform === "win32" ? "opencode.exe" : "opencode",
  );
}

export function computeVendoredOpenCodeFingerprint(repoRoot: string): string {
  const hash = createHash("sha256");
  hash.update(DJL_OPENCODE_VERSION);
  hash.update(DJL_OPENCODE_COMMIT);
  hash.update(DJL_OPENCODE_BUN_VERSION);
  for (const relativePath of DJL_OPENCODE_FINGERPRINT_PATHS) {
    hash.update(relativePath);
    hash.update(readFileSync(join(repoRoot, relativePath)));
  }
  return hash.digest("hex");
}

function run(command: string, args: ReadonlyArray<string>, cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, OPENCODE_VERSION: DJL_OPENCODE_VERSION },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with code ${result.status ?? "unknown"}${result.signal ? ` (signal ${result.signal})` : ""}${result.error ? `: ${result.error.message}` : ""}`,
    );
  }
}

export function prepareVendoredOpenCode(input: {
  repoRoot: string;
  platform?: OpenCodeTargetPlatform;
  arch?: OpenCodeTargetArch;
}): string {
  const repoRoot = resolve(input.repoRoot);
  const platform = input.platform ?? (process.platform as OpenCodeTargetPlatform);
  const arch = input.arch ?? (process.arch as OpenCodeTargetArch);
  const vendorRoot = join(repoRoot, "vendor", "opencode");
  const bunExecutable = resolveBunExecutable();
  const runPinnedBun = (args: ReadonlyArray<string>) =>
    run(bunExecutable, ["x", `bun@${DJL_OPENCODE_BUN_VERSION}`, ...args], vendorRoot);
  const destination = resolveVendoredOpenCodeCacheBinary({ repoRoot, platform, arch });
  const stampPath = `${destination}.fingerprint`;
  const fingerprint = computeVendoredOpenCodeFingerprint(repoRoot);
  if (
    existsSync(destination) &&
    existsSync(stampPath) &&
    readFileSync(stampPath, "utf8").trim() === fingerprint
  ) {
    return destination;
  }

  // A native host install contains only the host's optional packages. Re-run the
  // frozen install for the requested target so, for example, Intel macOS builds
  // on Apple Silicon include the x64 OpenTUI and FFF binaries.
  runPinnedBun(resolveVendoredOpenCodeInstallArgs({ platform, arch }));
  runPinnedBun([
    "run",
    "packages/opencode/script/build.ts",
    "--single",
    "--skip-embed-web-ui",
    "--skip-install",
    "--target-os",
    platform,
    "--target-arch",
    arch,
  ]);

  const targetName = `opencode-${platform === "win32" ? "windows" : platform}-${arch}`;
  const builtBinary = join(
    vendorRoot,
    "packages",
    "opencode",
    "dist",
    targetName,
    "bin",
    platform === "win32" ? "opencode.exe" : "opencode",
  );
  if (!existsSync(builtBinary)) {
    throw new Error(`OpenCode build did not produce ${builtBinary}`);
  }
  mkdirSync(resolve(destination, ".."), { recursive: true });
  copyFileSync(builtBinary, destination);
  if (platform !== "win32") chmodSync(destination, 0o755);
  writeFileSync(stampPath, `${fingerprint}\n`);
  return destination;
}
