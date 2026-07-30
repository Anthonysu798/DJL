// FILE: githubReleases.ts
// Purpose: Reads published releases from GitHub and reduces each body to renderable sections.
// Layer: Landing changelog
// Exports: release listing for the changelog page, and the notes parser it depends on.
// Depends on: the public GitHub Releases API, sharing headers and caching with the download routes.

import {
  GITHUB_RELEASE_REPOSITORY,
  requestHeaders,
  type ReleaseFetch,
} from "./githubDesktopDownloads";

export const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_RELEASE_REPOSITORY}/releases?per_page=30`;

// Matches the download routes: one read per window per deployment keeps the site far below GitHub's
// unauthenticated ceiling, while still surfacing a new release within ten minutes of publication
// without anyone editing or redeploying this site.
const RELEASES_REVALIDATE_SECONDS = 600;

export interface ReleaseSection {
  readonly heading: string;
  readonly items: readonly string[];
}

export interface ParsedReleaseNotes {
  /** Free prose before the first heading, one entry per paragraph. */
  readonly intro: readonly string[];
  readonly sections: readonly ReleaseSection[];
}

export interface ChangelogRelease extends ParsedReleaseNotes {
  /** Tag with any leading "v" removed, e.g. "0.5.7". */
  readonly version: string;
  readonly publishedAt: string | null;
  readonly htmlUrl: string | null;
  readonly prerelease: boolean;
}

interface GithubReleaseListItem {
  readonly tag_name?: string;
  readonly name?: string;
  readonly body?: string | null;
  readonly html_url?: string;
  readonly published_at?: string | null;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
}

// Every release body carries a trailing block the release workflow appends — a horizontal rule, the
// installer/notarization notice, then GitHub's own "What's Changed", "New Contributors" and
// "Full Changelog". It is byte-identical between releases and describes download mechanics rather
// than what changed, so repeating it under every version would bury the actual notes. The page links
// out to the GitHub release for anyone who wants the whole thing.
function releaseNotesBeforeBoilerplate(body: string): string[] {
  const lines = body.replace(/\r\n/gu, "\n").split("\n");
  const cut = lines.findIndex(
    (line) =>
      /^\s*---\s*$/u.test(line) ||
      // Defensive: if the rule is ever dropped, GitHub's h2 sections still terminate our notes.
      /^##\s+/u.test(line) ||
      /^\*\*Full Changelog\*\*/u.test(line),
  );
  return cut === -1 ? lines : lines.slice(0, cut);
}

/**
 * Reduces a release body to an intro and headed bullet sections.
 *
 * Deliberately not a markdown renderer. The release-notes shape is fixed by the repository's own
 * shipping rules, a parser this size covers it, and it keeps both a dependency and any
 * dangerouslySetInnerHTML sink out of the page. Anything it cannot represent — notably the markdown
 * download table in the first public release — is dropped rather than shown broken.
 */
export function parseReleaseNotes(body: string | null | undefined, version = ""): ParsedReleaseNotes {
  if (typeof body !== "string" || body.trim() === "") {
    return { intro: [], sections: [] };
  }

  const intro: string[] = [];
  const sections: { heading: string; items: string[] }[] = [];
  let current: { heading: string; items: string[] } | null = null;
  // Whether the entry pushed last is still open to continuation lines. A blank line closes it, which
  // is what keeps two consecutive prose paragraphs from merging into one.
  let openEntry = false;

  const target = () => (current ? current.items : intro);

  for (const raw of releaseNotesBeforeBoilerplate(body)) {
    const line = raw.trim();

    if (line === "") {
      openEntry = false;
      continue;
    }

    // Markdown table rows and separators: unrepresentable here, and the download links already live
    // on the site. Skipping them leaves the section empty, and empty sections are dropped below.
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

    // The first non-heading line of the body usually just repeats the release title ("DJL v0.5.7").
    // The page already renders the version, so showing it again is noise.
    const isTitleEcho =
      intro.length === 0 &&
      current === null &&
      (line === `DJL v${version}` || line === `v${version}` || line === version);
    if (isTitleEcho) continue;

    // Release notes are hard-wrapped around 90 characters, so an unmarked line directly below an
    // open entry continues it rather than starting a new one.
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
    // A section left empty by a dropped table carries no information; omit it rather than render a
    // bare heading.
    sections: sections.filter((section) => section.items.length > 0),
  };
}

function toChangelogRelease(release: GithubReleaseListItem): ChangelogRelease | null {
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  const version = tag.replace(/^v/u, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    return null;
  }

  return {
    version,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
    htmlUrl: typeof release.html_url === "string" ? release.html_url : null,
    prerelease: release.prerelease === true,
    ...parseReleaseNotes(release.body, version),
  };
}

/**
 * Published releases, newest first.
 *
 * Drafts are excluded: a draft is an in-progress or failed release, and the repository's own release
 * rules treat a half-uploaded draft as something to recover from, not to advertise. Prereleases are
 * kept but flagged so the page can mark them.
 *
 * Every failure collapses to an empty array. A changelog is not worth an error page, so the page
 * renders its empty state and links to GitHub instead.
 */
export async function fetchChangelogReleases(
  fetchImpl: ReleaseFetch = fetch,
): Promise<readonly ChangelogRelease[]> {
  try {
    const response = await fetchImpl(GITHUB_RELEASES_API_URL, {
      headers: requestHeaders(),
      next: { revalidate: RELEASES_REVALIDATE_SECONDS },
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return [];

    return payload
      .filter(
        (release): release is GithubReleaseListItem =>
          release !== null && typeof release === "object" && (release as GithubReleaseListItem).draft !== true,
      )
      .map(toChangelogRelease)
      .filter((release): release is ChangelogRelease => release !== null);
  } catch {
    return [];
  }
}
