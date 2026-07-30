import type { DesktopRuntimeArch, DesktopRuntimeInfo } from "@synara/contracts";

interface ResolveDesktopRuntimeInfoInput {
  readonly platform: NodeJS.Platform;
  readonly processArch: string;
  readonly runningUnderArm64Translation: boolean;
}

function normalizeDesktopArch(arch: string): DesktopRuntimeArch {
  if (arch === "arm64") return "arm64";
  if (arch === "x64") return "x64";
  return "other";
}

export function resolveDesktopRuntimeInfo(
  input: ResolveDesktopRuntimeInfoInput,
): DesktopRuntimeInfo {
  const appArch = normalizeDesktopArch(input.processArch);

  if (input.platform !== "darwin") {
    return {
      hostArch: appArch,
      appArch,
      runningUnderArm64Translation: false,
    };
  }

  const hostArch = appArch === "arm64" || input.runningUnderArm64Translation ? "arm64" : appArch;

  return {
    hostArch,
    appArch,
    runningUnderArm64Translation: input.runningUnderArm64Translation,
  };
}

// Update packages continue to follow the running app architecture on Windows. Local AI can use
// Electron's WOW signal to select the native ARM64 runtime when an x64 DJL build is emulated.
export function resolveLocalAiRuntimeInfo(
  input: ResolveDesktopRuntimeInfoInput,
): DesktopRuntimeInfo {
  const runtimeInfo = resolveDesktopRuntimeInfo(input);
  if (
    input.platform !== "win32" ||
    runtimeInfo.appArch !== "x64" ||
    !input.runningUnderArm64Translation
  ) {
    return runtimeInfo;
  }
  return {
    hostArch: "arm64",
    appArch: "x64",
    runningUnderArm64Translation: true,
  };
}

export function isArm64HostRunningIntelBuild(runtimeInfo: DesktopRuntimeInfo): boolean {
  return runtimeInfo.hostArch === "arm64" && runtimeInfo.appArch === "x64";
}
