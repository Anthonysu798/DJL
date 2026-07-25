export const VPS_DOWNLOAD_FALLBACK_URL = "https://downloads.slcor.com/stable/SHA256SUMS";
export const VPS_MAC_COMPATIBILITY_DOWNLOAD_URL = "https://downloads.slcor.com/download/mac";

export type MacArchitecture = "arm64" | "x64";

export type DesktopDownloadTarget =
  | { platform: "windows"; arch: "x64" }
  | { platform: "mac"; arch: MacArchitecture };

const DOWNLOAD_URLS = {
  windows: "https://downloads.slcor.com/download/windows",
  macArm64: "https://downloads.slcor.com/download/mac/arm64",
  macX64: "https://downloads.slcor.com/download/mac/x64",
} as const;

export function resolveVpsDesktopDownload(target: DesktopDownloadTarget): string {
  if (target.platform === "windows") return DOWNLOAD_URLS.windows;
  return target.arch === "arm64" ? DOWNLOAD_URLS.macArm64 : DOWNLOAD_URLS.macX64;
}
