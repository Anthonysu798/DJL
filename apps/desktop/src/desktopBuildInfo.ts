// FILE: desktopBuildInfo.ts
// Purpose: Shares the synchronous desktop build-provenance IPC channel.
// Exports: IPC channel name used by Electron main and preload.

import type { DesktopBuildInfo } from "@synara/contracts";

export const DESKTOP_BUILD_INFO_CHANNEL = "desktop:get-build-info";

export function createDesktopBuildInfo(input: {
  readonly isPackaged: boolean;
  readonly version: string;
  readonly commit: string | null;
}): DesktopBuildInfo {
  return {
    kind: input.isPackaged ? "packaged" : "development",
    version: input.isPackaged ? input.version : null,
    commit: input.commit,
  };
}
