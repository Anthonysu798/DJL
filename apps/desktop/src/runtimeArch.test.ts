import { describe, expect, it } from "vitest";

import {
  isArm64HostRunningIntelBuild,
  resolveDesktopRuntimeInfo,
  resolveLocalAiRuntimeInfo,
} from "./runtimeArch";

describe("resolveDesktopRuntimeInfo", () => {
  it("detects Rosetta-translated Intel builds on Apple Silicon", () => {
    const runtimeInfo = resolveDesktopRuntimeInfo({
      platform: "darwin",
      processArch: "x64",
      runningUnderArm64Translation: true,
    });

    expect(runtimeInfo).toEqual({
      hostArch: "arm64",
      appArch: "x64",
      runningUnderArm64Translation: true,
    });
    expect(isArm64HostRunningIntelBuild(runtimeInfo)).toBe(true);
  });

  it("detects native Apple Silicon builds", () => {
    const runtimeInfo = resolveDesktopRuntimeInfo({
      platform: "darwin",
      processArch: "arm64",
      runningUnderArm64Translation: false,
    });

    expect(runtimeInfo).toEqual({
      hostArch: "arm64",
      appArch: "arm64",
      runningUnderArm64Translation: false,
    });
    expect(isArm64HostRunningIntelBuild(runtimeInfo)).toBe(false);
  });

  it("passes through non-mac builds without translation", () => {
    const runtimeInfo = resolveDesktopRuntimeInfo({
      platform: "linux",
      processArch: "x64",
      runningUnderArm64Translation: true,
    });

    expect(runtimeInfo).toEqual({
      hostArch: "x64",
      appArch: "x64",
      runningUnderArm64Translation: false,
    });
  });

  it("preserves the updater architecture while exposing a Windows ARM host to local AI", () => {
    const input = {
      platform: "win32" as const,
      processArch: "x64" as const,
      runningUnderArm64Translation: true,
    };
    const updaterRuntimeInfo = resolveDesktopRuntimeInfo(input);
    const localAiRuntimeInfo = resolveLocalAiRuntimeInfo(input);

    expect(updaterRuntimeInfo).toEqual({
      hostArch: "x64",
      appArch: "x64",
      runningUnderArm64Translation: false,
    });
    expect(isArm64HostRunningIntelBuild(updaterRuntimeInfo)).toBe(false);
    expect(localAiRuntimeInfo).toEqual({
      hostArch: "arm64",
      appArch: "x64",
      runningUnderArm64Translation: true,
    });
  });
});
