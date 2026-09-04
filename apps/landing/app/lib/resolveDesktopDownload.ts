// FILE: resolveDesktopDownload.ts
// Purpose: Chooses GitHub or Hong Kong OSS for a landing-page installer request.
// Layer: Landing download routing

import { readRequestedMirror, readVisitorCountry } from "./downloadRegion";
import type { DownloadReport } from "./downloadStats";
import {
  GITHUB_LATEST_RELEASE_PAGE_URL,
  resolveGithubDesktopDownloadAsset,
  type DesktopDownloadTarget,
  type ReleaseFetch,
} from "./githubDesktopDownloads";
import { readOssDownloadBaseUrl, resolveOssDesktopDownload } from "./ossDesktopDownloads";

export interface DesktopDownloadDecision {
  readonly destination: string;
  readonly report: DownloadReport;
}

export async function resolveDesktopDownload(
  target: DesktopDownloadTarget,
  request: Request,
  options: { readonly ossBaseUrl?: string; readonly fetchImpl?: ReleaseFetch } = {},
): Promise<DesktopDownloadDecision> {
  const country = readVisitorCountry(request);
  const asset = await resolveGithubDesktopDownloadAsset(target, options.fetchImpl ?? fetch);
  const base = { platform: target.platform, arch: target.arch, country } as const;
  if (!asset) {
    return {
      destination: GITHUB_LATEST_RELEASE_PAGE_URL,
      report: { ...base, source: "github", version: null },
    };
  }

  if (readRequestedMirror(request) === "cn" && asset.version) {
    return {
      destination: resolveOssDesktopDownload(
        options.ossBaseUrl ?? readOssDownloadBaseUrl(),
        asset.version,
        asset.name,
      ),
      report: { ...base, source: "oss", version: asset.version },
    };
  }

  return {
    destination: asset.url,
    report: { ...base, source: "github", version: asset.version },
  };
}
