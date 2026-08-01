// FILE: githubDesktopDownloads.ts
// Purpose: Resolves desktop download links to the newest published GitHub release assets.
// Layer: Landing download routing
// Exports: latest-release installer and release-page resolution for the download routes.
// Depends on: the public GitHub Releases API for the canonical DJL repository.

import type { DesktopDownloadTarget } from "./vpsDesktopDownloads";

export const GITHUB_RELEASE_REPOSITORY = "Anthonysu798/DJL";

export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_RELEASE_REPOSITORY}`;

export const GITHUB_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_RELEASE_REPOSITORY}/releases/latest`;

// `SHA256SUMS` keeps the same name in every release, so this static path always resolves to the
// newest one. Installer names embed their version and cannot use this form.
export const GITHUB_LATEST_RELEASE_CHECKSUMS_URL = `https://github.com/${GITHUB_RELEASE_REPOSITORY}/releases/latest/download/SHA256SUMS`;

// Installers are published as DJL-<version>-<arch>.<ext>, so the routes match on shape rather than
// on a pinned filename. That is what keeps every Download button correct for all future releases
// without anyone editing this file again.
const ASSET_PATTERNS = {
  windows: /^DJL-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-x64\.exe$/,
  macArm64: /^DJL-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-arm64\.dmg$/,
  macX64: /^DJL-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-x64\.dmg$/,
} as const;

function assetPatternFor(target: DesktopDownloadTarget): RegExp {
  if (target.platform === "windows") return ASSET_PATTERNS.windows;
  return target.arch === "arm64" ? ASSET_PATTERNS.macArm64 : ASSET_PATTERNS.macX64;
}

// The newest release is read at most once per window per deployment, which keeps the site far below
// GitHub's unauthenticated rate limit no matter how much download traffic arrives.
const LATEST_RELEASE_REVALIDATE_SECONDS = 600;

interface GithubReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

interface GithubRelease {
  readonly html_url?: string;
  readonly tag_name?: string;
  readonly assets?: readonly GithubReleaseAsset[];
}

type CachingRequestInit = RequestInit & {
  next?: { readonly revalidate?: number };
};

export type ReleaseFetch = (
  input: string,
  init?: CachingRequestInit,
) => Promise<{ readonly ok: boolean; json: () => Promise<unknown> }>;

// Exported so the changelog reads releases through the same headers and optional token rather than
// standing up a second, divergent GitHub client.
export function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "djl-agent-landing",
  };
  // Optional: raises the rate limit from 60/hr to 5000/hr. The site works without it.
  const token = process.env.GITHUB_RELEASES_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

// Every failure mode collapses to null so callers can fall back to the VPS mirror. A download
// button must never surface an error page just because the GitHub API had a bad minute.
async function readLatestRelease(fetchImpl: ReleaseFetch): Promise<GithubRelease | null> {
  try {
    const response = await fetchImpl(GITHUB_LATEST_RELEASE_API_URL, {
      headers: requestHeaders(),
      next: { revalidate: LATEST_RELEASE_REVALIDATE_SECONDS },
    });
    if (!response.ok) {
      return null;
    }
    const release = (await response.json()) as GithubRelease | null;
    return release && typeof release === "object" ? release : null;
  } catch {
    return null;
  }
}

export async function resolveGithubDesktopDownload(
  target: DesktopDownloadTarget,
  fetchImpl: ReleaseFetch = fetch,
): Promise<string | null> {
  const release = await readLatestRelease(fetchImpl);
  if (!release?.assets) {
    return null;
  }
  const pattern = assetPatternFor(target);
  const asset = release.assets.find(
    (candidate) =>
      typeof candidate?.name === "string" &&
      typeof candidate.browser_download_url === "string" &&
      pattern.test(candidate.name),
  );
  return asset?.browser_download_url ?? null;
}

// Used by the architecture-agnostic macOS entry point: sending a visitor to the release page lets
// them pick Apple Silicon or Intel themselves rather than guessing and handing them the wrong slice.
export async function resolveGithubLatestReleasePage(
  fetchImpl: ReleaseFetch = fetch,
): Promise<string | null> {
  const release = await readLatestRelease(fetchImpl);
  return typeof release?.html_url === "string" ? release.html_url : null;
}

// The version the site advertises comes from the same release the buttons serve, so the two can
// never disagree. Returns the bare version ("0.5.6") with the tag's leading "v" removed.
export async function resolveGithubLatestReleaseVersion(
  fetchImpl: ReleaseFetch = fetch,
): Promise<string | null> {
  const release = await readLatestRelease(fetchImpl);
  const tag = release?.tag_name;
  if (typeof tag !== "string") {
    return null;
  }
  const version = tag.replace(/^v/, "");
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null;
}
