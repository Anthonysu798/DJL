// FILE: whatsNew/githubReleases.ts
// Purpose: Parse, validate, fetch, and cache DJL's published GitHub release notes.
// Layer: renderer release-feed utility (React-free for deterministic tests).

export const GITHUB_RELEASES_URL = "https://github.com/Anthonysu798/DJL/releases";
export const GITHUB_RELEASES_API_URL =
  "https://api.github.com/repos/Anthonysu798/DJL/releases?per_page=30";
export const GITHUB_RELEASE_CACHE_KEY = "djl:github-releases:v1";
export const GITHUB_RELEASE_CACHE_TTL_MS = 10 * 60 * 1_000;

export interface ReleaseSection {
  readonly heading: string;
  readonly items: readonly string[];
}

export interface ParsedReleaseNotes {
  readonly intro: readonly string[];
  readonly sections: readonly ReleaseSection[];
}

export interface GithubReleaseNote extends ParsedReleaseNotes {
  readonly version: string;
  readonly publishedAt: string;
  readonly htmlUrl: string;
  readonly prerelease: boolean;
}

export interface GithubReleaseCache {
  readonly fetchedAt: number;
  readonly releases: readonly GithubReleaseNote[];
  readonly fresh: boolean;
}

export interface ReleaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface GithubReleaseListItem {
  readonly tag_name?: string;
  readonly body?: string | null;
  readonly html_url?: string;
  readonly published_at?: string | null;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
}

function releaseNotesBeforeBoilerplate(body: string): string[] {
  const lines = body.replace(/\r\n/gu, "\n").split("\n");
  const cut = lines.findIndex(
    (line) =>
      /^\s*---\s*$/u.test(line) || /^##\s+/u.test(line) || /^\*\*Full Changelog\*\*/u.test(line),
  );
  return cut === -1 ? lines : lines.slice(0, cut);
}

export function parseReleaseNotes(
  body: string | null | undefined,
  version = "",
): ParsedReleaseNotes {
  if (typeof body !== "string" || body.trim() === "") {
    return { intro: [], sections: [] };
  }

  const intro: string[] = [];
  const sections: { heading: string; items: string[] }[] = [];
  let current: { heading: string; items: string[] } | null = null;
  let openEntry = false;
  const target = () => (current ? current.items : intro);

  for (const raw of releaseNotesBeforeBoilerplate(body)) {
    const line = raw.trim();
    if (line === "") {
      openEntry = false;
      continue;
    }
    if (line.startsWith("|")) continue;

    const heading = /^#{2,4}\s+(.*)$/u.exec(line);
    if (heading?.[1]) {
      current = { heading: heading[1].trim(), items: [] };
      sections.push(current);
      openEntry = false;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/u.exec(line);
    if (bullet?.[1]) {
      target().push(bullet[1].trim());
      openEntry = true;
      continue;
    }

    const isTitleEcho =
      intro.length === 0 &&
      current === null &&
      (line === `DJL v${version}` || line === `v${version}` || line === version);
    if (isTitleEcho) continue;

    const list = target();
    const previous = list.at(-1);
    if (openEntry && previous !== undefined) {
      list[list.length - 1] = `${previous} ${line}`;
    } else {
      list.push(line);
      openEntry = true;
    }
  }

  return {
    intro,
    sections: sections.filter((section) => section.items.length > 0),
  };
}

function toGithubReleaseNote(value: unknown): GithubReleaseNote | null {
  if (value === null || typeof value !== "object") return null;
  const release = value as GithubReleaseListItem;
  if (release.draft === true) return null;

  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  const version = tag.replace(/^v/u, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) return null;
  if (typeof release.published_at !== "string" || typeof release.html_url !== "string") return null;

  return {
    version,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    prerelease: release.prerelease === true,
    ...parseReleaseNotes(release.body, version),
  };
}

export function parseGithubReleasePayload(payload: unknown): readonly GithubReleaseNote[] | null {
  if (!Array.isArray(payload)) return null;
  const releases = payload
    .map(toGithubReleaseNote)
    .filter((release): release is GithubReleaseNote => release !== null);
  return releases.length > 0 ? releases : null;
}

export function selectLatestStableRelease(
  releases: readonly GithubReleaseNote[],
): GithubReleaseNote | null {
  return releases.find((release) => !release.prerelease) ?? null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isCachedRelease(value: unknown): value is GithubReleaseNote {
  if (value === null || typeof value !== "object") return false;
  const release = value as Partial<GithubReleaseNote>;
  return (
    typeof release.version === "string" &&
    typeof release.publishedAt === "string" &&
    typeof release.htmlUrl === "string" &&
    typeof release.prerelease === "boolean" &&
    isStringArray(release.intro) &&
    Array.isArray(release.sections) &&
    release.sections.every(
      (section) =>
        section !== null &&
        typeof section === "object" &&
        typeof (section as ReleaseSection).heading === "string" &&
        isStringArray((section as ReleaseSection).items),
    )
  );
}

export function readGithubReleaseCache(
  storage: ReleaseStorage,
  now = Date.now(),
): GithubReleaseCache | null {
  try {
    const raw = storage.getItem(GITHUB_RELEASE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const cache = parsed as { fetchedAt?: unknown; releases?: unknown };
    if (
      typeof cache.fetchedAt !== "number" ||
      !Number.isFinite(cache.fetchedAt) ||
      !Array.isArray(cache.releases) ||
      cache.releases.length === 0 ||
      !cache.releases.every(isCachedRelease)
    ) {
      return null;
    }
    return {
      fetchedAt: cache.fetchedAt,
      releases: cache.releases,
      fresh: now - cache.fetchedAt < GITHUB_RELEASE_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

export async function refreshGithubReleases(
  storage: ReleaseStorage,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<readonly GithubReleaseNote[]> {
  const response = await fetchImpl(GITHUB_RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`github-release-http-${response.status}`);
  }

  const releases = parseGithubReleasePayload(await response.json());
  if (!releases) {
    throw new Error("github-release-invalid-response");
  }

  storage.setItem(GITHUB_RELEASE_CACHE_KEY, JSON.stringify({ fetchedAt: now, releases }));
  return releases;
}
