import { chmodSync, mkdtempSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ensureDesktopStageExecutableHelpers,
  resolveDesktopStageInstallArgs,
  verifyDesktopStageNativeDependencies,
} from "./lib/desktop-stage-native-dependencies.ts";

type Target = {
  readonly platform: "linux" | "mac" | "win";
  readonly arch: "arm64" | "x64" | "universal";
};

function writePackage(
  stageAppDir: string,
  name: string,
  target: { readonly os: string; readonly cpu: string },
) {
  const packageDir = join(stageAppDir, "node_modules", ...name.split("/"));
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name, os: [target.os], cpu: [target.cpu] }),
  );
}

function writeMachO(filePath: string, arch: "arm64" | "x64") {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(arch === "x64" ? 0x01000007 : 0x0100000c, 4);
  writeFileSync(filePath, header);
}

function writeRequiredPackages(stageAppDir: string, target: Target) {
  const os = target.platform === "mac" ? "darwin" : target.platform === "win" ? "win32" : "linux";
  const arches = target.arch === "universal" ? (["arm64", "x64"] as const) : [target.arch];

  for (const arch of arches) {
    writePackage(stageAppDir, `@anthropic-ai/claude-agent-sdk-${os}-${arch}`, { os, cpu: arch });
    writePackage(stageAppDir, `@img/sharp-${os}-${arch}`, { os, cpu: arch });
    if (target.platform !== "win") {
      writePackage(stageAppDir, `@img/sharp-libvips-${os}-${arch}`, { os, cpu: arch });
    }
    const clipboardSuffix =
      target.platform === "win"
        ? `${os}-${arch}-msvc`
        : target.platform === "linux"
          ? `${os}-${arch}-gnu`
          : `${os}-${arch}`;
    writePackage(stageAppDir, `@mariozechner/clipboard-${clipboardSuffix}`, { os, cpu: arch });
    if (target.platform === "mac") {
      writePackage(stageAppDir, `@napi-rs/canvas-darwin-${arch}`, { os, cpu: arch });
      writePackage(stageAppDir, `@msgpackr-extract/msgpackr-extract-darwin-${arch}`, {
        os,
        cpu: arch,
      });
      const nodePtyRoot = join(stageAppDir, "node_modules", "node-pty");
      const nodePtyPrebuildRoot = join(nodePtyRoot, "prebuilds", `darwin-${arch}`);
      writeMachO(join(nodePtyPrebuildRoot, "pty.node"), arch);
      writeMachO(join(nodePtyPrebuildRoot, "spawn-helper"), arch);
      const onnxRoot = join(stageAppDir, "node_modules", "onnxruntime-node");
      mkdirSync(onnxRoot, { recursive: true });
      writeFileSync(
        join(onnxRoot, "package.json"),
        JSON.stringify({ name: "onnxruntime-node", version: "1.23.2" }),
      );
      const nativeRoot = join(onnxRoot, "bin", "napi-v6", "darwin", arch);
      writeMachO(join(nativeRoot, "onnxruntime_binding.node"), arch);
      writeMachO(join(nativeRoot, "libonnxruntime.1.23.2.dylib"), arch);
    }
  }
}

describe("resolveDesktopStageInstallArgs", () => {
  it("installs Intel macOS optional dependencies when cross-building on Apple Silicon", () => {
    expect(resolveDesktopStageInstallArgs({ platform: "mac", arch: "x64" })).toEqual([
      "install",
      "--production",
      "--os",
      "darwin",
      "--cpu",
      "x64",
    ]);
  });

  it("installs both architectures for a universal macOS artifact", () => {
    expect(resolveDesktopStageInstallArgs({ platform: "mac", arch: "universal" })).toEqual([
      "install",
      "--production",
      "--os",
      "darwin",
      "--cpu",
      "*",
    ]);
  });
});

describe("ensureDesktopStageExecutableHelpers", () => {
  it("repairs Bun-installed macOS node-pty helper permissions", () => {
    const stageAppDir = mkdtempSync(join(tmpdir(), "djl-native-stage-"));
    const helper = join(stageAppDir, "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper");
    writeMachO(helper, "x64");
    chmodSync(helper, 0o644);

    ensureDesktopStageExecutableHelpers({ stageAppDir, platform: "mac", arch: "x64" });

    expect(statSync(helper).mode & 0o111).not.toBe(0);
  });
});

describe("verifyDesktopStageNativeDependencies", () => {
  it("accepts native packages whose manifests match the target", () => {
    const stageAppDir = mkdtempSync(join(tmpdir(), "djl-native-stage-"));
    writeRequiredPackages(stageAppDir, { platform: "mac", arch: "x64" });

    expect(() =>
      verifyDesktopStageNativeDependencies({
        stageAppDir,
        platform: "mac",
        arch: "x64",
      }),
    ).not.toThrow();
  });

  it("fails closed when a host-architecture install omits target packages", () => {
    const stageAppDir = mkdtempSync(join(tmpdir(), "djl-native-stage-"));
    writeRequiredPackages(stageAppDir, { platform: "mac", arch: "arm64" });

    expect(() =>
      verifyDesktopStageNativeDependencies({
        stageAppDir,
        platform: "mac",
        arch: "x64",
      }),
    ).toThrow(
      /claude-agent-sdk-darwin-x64.*sharp-darwin-x64.*sharp-libvips-darwin-x64.*clipboard-darwin-x64.*canvas-darwin-x64.*msgpackr-extract-darwin-x64/s,
    );
  });

  it("requires both native architectures for universal macOS artifacts", () => {
    const stageAppDir = mkdtempSync(join(tmpdir(), "djl-native-stage-"));
    writeRequiredPackages(stageAppDir, { platform: "mac", arch: "arm64" });

    expect(() =>
      verifyDesktopStageNativeDependencies({
        stageAppDir,
        platform: "mac",
        arch: "universal",
      }),
    ).toThrow(/darwin-x64/);
  });

  it("rejects an Intel ONNX binding whose Mach-O payload is ARM64", () => {
    const stageAppDir = mkdtempSync(join(tmpdir(), "djl-native-stage-"));
    writeRequiredPackages(stageAppDir, { platform: "mac", arch: "x64" });
    writeMachO(
      join(
        stageAppDir,
        "node_modules/onnxruntime-node/bin/napi-v6/darwin/x64/onnxruntime_binding.node",
      ),
      "arm64",
    );

    expect(() =>
      verifyDesktopStageNativeDependencies({
        stageAppDir,
        platform: "mac",
        arch: "x64",
      }),
    ).toThrow(/onnxruntime_binding\.node.*x64.*arm64/i);
  });

  it("rejects a host node-pty build that would shadow the target prebuild", () => {
    const stageAppDir = mkdtempSync(join(tmpdir(), "djl-native-stage-"));
    writeRequiredPackages(stageAppDir, { platform: "mac", arch: "x64" });
    writeMachO(join(stageAppDir, "node_modules/node-pty/build/Release/pty.node"), "arm64");

    expect(() =>
      verifyDesktopStageNativeDependencies({
        stageAppDir,
        platform: "mac",
        arch: "x64",
      }),
    ).toThrow(/node-pty.*build\/Release\/pty\.node.*x64.*arm64/is);
  });
});
