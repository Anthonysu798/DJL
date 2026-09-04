// FILE: resolveDesktopDownload.ts
// Purpose: Chooses GitHub or Hong Kong OSS for a landing-page installer request.
// Layer: Landing download routing

import { readRequestedMirror } from "./downloadRegion";
import {
  GITHUB_LATEST_RELEASE_PAGE_URL,
  resolveGithubDesktopDownloadAsset,
  type DesktopDownloadTarget,
  type ReleaseFetch,
} from "./githubDesktopDownloads";
import { readOssDownloadBaseUrl, resolveOssDesktopDownload } from "./ossDesktopDownloads";

export async function resolveDesktopDownload(
  target: DesktopDownloadTarget,
  request: Request,
  options: { readonly ossBaseUrl?: string; readonly fetchImpl?: ReleaseFetch } = {},
): Promise<string> {
  const asset = await resolveGithubDesktopDownloadAsset(target, options.fetchImpl ?? fetch);
  if (!asset) return GITHUB_LATEST_RELEASE_PAGE_URL;

  if (readRequestedMirror(request) === "cn" && asset.version) {
    return resolveOssDesktopDownload(
      options.ossBaseUrl ?? readOssDownloadBaseUrl(),
      asset.version,
      asset.name,
    );
  }

  return asset.url;
}
