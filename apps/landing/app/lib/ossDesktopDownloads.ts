// FILE: ossDesktopDownloads.ts
// Purpose: Builds immutable Alibaba Cloud OSS installer URLs for the China mirror button.
// Layer: Landing download routing

export const DEFAULT_OSS_DOWNLOAD_BASE_URL =
  "https://djl-china-releases.oss-accelerate.aliyuncs.com";

function normalizeBaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function readOssDownloadBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return normalizeBaseUrl(env.DJL_OSS_DOWNLOAD_BASE_URL) ?? DEFAULT_OSS_DOWNLOAD_BASE_URL;
}

export function resolveOssDesktopDownload(
  baseUrl: string,
  version: string,
  assetName: string,
): string {
  return `${baseUrl}/releases/${version}/${assetName}`;
}
