#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPUTER_USE_APP = "DJL Computer Use.app";
export const COMPUTER_USE_BUNDLE_ID = "com.djl.computer-use";
export const COMPUTER_USE_MINIMUM_MACOS = "14.4";
const PROVENANCE = "computer-use-provenance.json";
const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));
type Arch = "arm64" | "x64" | "universal";

function run(command: string, args: string[], env = process.env): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function sources(repoRoot: string) {
  const directory = path.join(repoRoot, "apps/desktop/native/computer-use");
  const sourceFiles = [
    "Info.plist",
    "build.sh",
    ...readdirSync(path.join(directory, "Sources"))
      .filter((name) => name.endsWith(".swift"))
      .toSorted()
      .map((name) => `Sources/${name}`),
  ];
  return Object.fromEntries(sourceFiles.map((name) => [name, digest(path.join(directory, name))]));
}
function executable(root: string): string {
  return path.join(root, COMPUTER_USE_APP, "Contents/MacOS/DJLComputerUse");
}
function architectures(arch: Arch): string[] {
  return arch === "universal" ? ["arm64", "x86_64"] : [arch === "x64" ? "x86_64" : "arm64"];
}

export function verifyComputerUseArchitecture(binary: string, arch: Arch): void {
  // Only the description may be searched: paths can contain a misleading architecture name.
  // For fat binaries, file can include a path on subsequent slice-detail lines.
  const description = run("file", ["-b", binary]).split("\n")[0]!;
  const actual = [...new Set(description.match(/\b(?:arm64e?|x86_64)\b/g) ?? [])].toSorted();
  if (
    !description.startsWith("Mach-O") ||
    JSON.stringify(actual) !== JSON.stringify(architectures(arch).toSorted())
  ) {
    throw new Error(
      `Computer-use executable architecture mismatch: expected ${arch}, received ${description}`,
    );
  }
}

export function verifyDesktopComputerUse(input: {
  root: string;
  arch: Arch;
  repoRoot?: string;
  packaged?: boolean;
  signed?: boolean;
}): void {
  const binary = executable(input.root);
  if (!existsSync(binary) || !statSync(binary).isFile())
    throw new Error("Missing computer-use executable.");
  if ((statSync(binary).mode & 0o111) === 0)
    throw new Error("Computer-use binary is not executable.");
  verifyComputerUseArchitecture(binary, input.arch);
  const plist = path.join(input.root, COMPUTER_USE_APP, "Contents/Info.plist");
  const field = (key: string) => run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]);
  if (field("CFBundleIdentifier") !== COMPUTER_USE_BUNDLE_ID)
    throw new Error("Incorrect computer-use bundle identity.");
  if (
    field("CFBundleExecutable") !== "DJLComputerUse" ||
    field("LSMinimumSystemVersion") !== COMPUTER_USE_MINIMUM_MACOS
  ) {
    throw new Error("Incorrect computer-use executable or deployment target.");
  }
  for (const key of ["NSAccessibilityUsageDescription", "NSScreenCaptureUsageDescription"]) {
    if (!field(key).trim()) throw new Error(`Missing computer-use usage description: ${key}`);
  }
  const minimums = [
    ...run("xcrun", ["vtool", "-show-build", binary]).matchAll(/\bminos\s+(\S+)/g),
  ].map((match) => match[1]);
  if (
    minimums.length !== architectures(input.arch).length ||
    minimums.some((version) => version !== COMPUTER_USE_MINIMUM_MACOS)
  ) {
    throw new Error("Computer-use Mach-O deployment target does not match its bundle.");
  }
  const receipt = JSON.parse(readFileSync(path.join(input.root, PROVENANCE), "utf8"));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.arch !== input.arch ||
    receipt.bundleId !== COMPUTER_USE_BUNDLE_ID ||
    receipt.minimumMacOS !== COMPUTER_USE_MINIMUM_MACOS ||
    JSON.stringify(receipt.sources) !== JSON.stringify(sources(input.repoRoot ?? defaultRepoRoot))
  ) {
    throw new Error("Computer-use source provenance does not match this checkout.");
  }
  // Electron Builder re-signs nested code; signing legitimately changes its bytes.
  if (!input.packaged && receipt.binarySha256 !== digest(binary))
    throw new Error("Computer-use staged executable digest mismatch.");
  run("/usr/bin/codesign", ["--verify", "--strict", path.join(input.root, COMPUTER_USE_APP)]);
  if (input.signed) {
    const result = spawnSync(
      "/usr/bin/codesign",
      ["-dv", "--verbose=4", path.join(input.root, COMPUTER_USE_APP)],
      { encoding: "utf8" },
    );
    const details = result.stderr;
    if (
      result.status !== 0 ||
      !details.includes("Authority=Developer ID Application:") ||
      details.includes("Signature=adhoc")
    ) {
      throw new Error("Production computer-use helper requires a Developer ID signature.");
    }
  }
}

export function stageDesktopComputerUse(input: {
  platform: string;
  arch: Arch;
  root: string;
  repoRoot?: string;
}) {
  if (input.platform !== "mac" && input.platform !== "darwin") return null;
  if (process.platform !== "darwin")
    throw new Error("Build the macOS computer-use helper on macOS.");
  const repoRoot = input.repoRoot ?? defaultRepoRoot;
  mkdirSync(input.root, { recursive: true });
  const buildRoot = path.join(input.root, "build");
  const nativeRoot = path.join(repoRoot, "apps/desktop/native/computer-use");
  const sourceDigests = sources(repoRoot);
  for (const arch of architectures(input.arch)) {
    run("/bin/bash", [path.join(nativeRoot, "build.sh"), arch], {
      ...process.env,
      DJL_COMPUTER_USE_BUILD_DIR: path.join(buildRoot, arch),
    });
  }
  const app = path.join(input.root, COMPUTER_USE_APP);
  rmSync(app, { recursive: true, force: true });
  cpSync(path.join(buildRoot, architectures(input.arch)[0]!, COMPUTER_USE_APP), app, {
    recursive: true,
  });
  if (input.arch === "universal") {
    run("xcrun", [
      "lipo",
      "-create",
      ...architectures(input.arch).map((arch) => executable(path.join(buildRoot, arch))),
      "-output",
      executable(input.root),
    ]);
    run("/usr/bin/codesign", ["--force", "--sign", "-", app]);
  }
  if (JSON.stringify(sourceDigests) !== JSON.stringify(sources(repoRoot)))
    throw new Error("Computer-use sources changed during compilation; rebuild required.");
  writeFileSync(
    path.join(input.root, PROVENANCE),
    `${JSON.stringify({ schemaVersion: 1, arch: input.arch, bundleId: COMPUTER_USE_BUNDLE_ID, minimumMacOS: COMPUTER_USE_MINIMUM_MACOS, sources: sourceDigests, binarySha256: digest(executable(input.root)) }, null, 2)}\n`,
  );
  verifyDesktopComputerUse({ root: input.root, arch: input.arch, repoRoot });
  return [
    { from: app, to: `native/${COMPUTER_USE_APP}`, filter: ["**/*"] },
    { from: path.join(input.root, PROVENANCE), to: `native/${PROVENANCE}` },
  ];
}

export function findPackagedComputerUseRoots(distDir: string, productName = "DJL"): string[] {
  return readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(distDir, entry.name, `${productName}.app/Contents/Resources/native`))
    .filter((candidate) => existsSync(candidate));
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag: string, fallback?: string) => {
    const index = args.indexOf(flag),
      result = index < 0 ? fallback : args[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`Provide ${flag}.`);
    return result;
  };
  const platform = value("--platform", process.platform);
  const arch = value("--arch", process.arch);
  if (!["arm64", "x64", "universal"].includes(arch))
    throw new Error("Unsupported computer-use architecture.");
  const root = path.resolve(value("--root"));
  if (platform !== "mac" && platform !== "darwin") {
    console.log(
      JSON.stringify({
        supported: false,
        platform,
        reason: "Native computer use is supported only on macOS.",
      }),
    );
    return;
  }
  if (args.includes("--verify"))
    verifyDesktopComputerUse({
      root,
      arch: arch as Arch,
      packaged: args.includes("--packaged"),
      signed: args.includes("--signed"),
    });
  else stageDesktopComputerUse({ platform, arch: arch as Arch, root });
  console.log(JSON.stringify({ verified: true, platform, arch, root }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Computer-use staging failed.");
    process.exitCode = 1;
  }
}
