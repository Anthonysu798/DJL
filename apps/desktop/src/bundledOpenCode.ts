import pathPosix from "node:path/posix";
import pathWin32 from "node:path/win32";

export function resolveBundledOpenCodePath(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const path = platform === "win32" ? pathWin32 : pathPosix;
  return path.join(resourcesPath, "opencode", platform === "win32" ? "opencode.exe" : "opencode");
}
