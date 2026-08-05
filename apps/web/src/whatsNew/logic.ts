// FILE: whatsNew/logic.ts
// Purpose: Pure, stateless helpers for the "What's new" surfaces.
// Layer: shared UI logic (importable by hook, components, and tests).
// Depends on: nothing runtime — only types below.
//
// The logic here deliberately avoids React, storage, and the changelog data.
// That lets us unit-test version arithmetic and selection rules in isolation
// and keeps the hook thin.

import { formatLocaleDateTime } from "../i18n/intl";
import { selectLatestStableRelease, type GithubReleaseNote } from "./githubReleases";

export type WhatsNewEntry = GithubReleaseNote;

export function formatReleaseDate(publishedAt: string, locale?: string): string {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return publishedAt;
  return formatLocaleDateTime(date, locale ?? "en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Parse a `MAJOR.MINOR.PATCH` string into a numeric tuple. Non-numeric or
 * missing segments fall back to 0 so a malformed version never crashes the
 * dialog — it just sorts as the lowest possible value.
 */
export function parseVersion(version: string): readonly [number, number, number] {
  const [rawMajor = "0", rawMinor = "0", rawPatch = "0"] = version.split(".");
  const major = Number.parseInt(rawMajor, 10);
  const minor = Number.parseInt(rawMinor, 10);
  const patch = Number.parseInt(rawPatch, 10);
  return [
    Number.isFinite(major) ? major : 0,
    Number.isFinite(minor) ? minor : 0,
    Number.isFinite(patch) ? patch : 0,
  ] as const;
}

/**
 * Three-way version comparison. Returns a negative number when `a < b`, zero
 * when equal, and a positive number when `a > b`. Suitable for `Array.sort`.
 */
export function compareVersions(a: string, b: string): number {
  const [majorA, minorA, patchA] = parseVersion(a);
  const [majorB, minorB, patchB] = parseVersion(b);
  if (majorA !== majorB) return majorA - majorB;
  if (minorA !== minorB) return minorA - minorB;
  return patchA - patchB;
}

/**
 * Return the given entries sorted by version in descending order (newest
 * first). This is the canonical "display order" used everywhere we present a
 * list of releases to the user — both the post-update dialog and the
 * settings surface go through here to avoid drift between the two views.
 */
export function sortEntriesByVersionDesc(
  entries: readonly WhatsNewEntry[],
): readonly WhatsNewEntry[] {
  return entries.toSorted((left, right) => compareVersions(right.version, left.version));
}

export function resolveDefaultReleaseVersion(
  entries: readonly WhatsNewEntry[],
  installedVersion: string | null,
): string | null {
  const installedRelease = installedVersion
    ? entries.find((entry) => entry.version === installedVersion)
    : null;
  return (installedRelease ?? selectLatestStableRelease(entries))?.version ?? null;
}

/**
 * Inputs to `resolveWhatsNewState`. Kept as a plain object so the hook can
 * pass the same shape it already has — no parameter juggling.
 */
export interface WhatsNewInputs {
  /** All changelog entries known at build time. Order is not assumed. */
  readonly entries: readonly WhatsNewEntry[] | null;
  /** The currently installed app version (`import.meta.env.APP_VERSION`). */
  readonly currentVersion: string;
  /**
   * The last version the user acknowledged. `null` means "never dismissed a
   * What's New dialog", which on the very first launch we treat as a fresh
   * install — we silently mark the current version as seen instead of showing
   * the entire historical changelog.
   */
  readonly lastSeenVersion: string | null;
}

/**
 * Decision returned by `resolveWhatsNewState`:
 *
 * - `show`: there's a curated release entry matching the current version.
 *   `currentEntry` drives the default "What's new?" view; `allEntries` is
 *   the full history for the "Complete changelog" secondary view. On
 *   dismiss, persist `nextLastSeenVersion`.
 * - `silent-bootstrap`: first launch or no curated entry for this upgrade —
 *   no dialog, just record `nextLastSeenVersion` so we don't dump the
 *   backlog on the user or re-evaluate on every launch.
 * - `noop`: nothing to do. Either the user is already up to date or the
 *   current version is older than what they've seen (e.g. a downgrade).
 */
export type WhatsNewState =
  | { readonly kind: "pending" }
  | {
      readonly kind: "show";
      readonly currentEntry: WhatsNewEntry;
      readonly allEntries: readonly WhatsNewEntry[];
      readonly nextLastSeenVersion: string;
    }
  | {
      readonly kind: "silent-bootstrap";
      readonly nextLastSeenVersion: string;
    }
  | { readonly kind: "noop" };

/**
 * Compute what the dialog should do given the current version, the user's
 * last-seen version, and the known changelog entries. This is the single
 * place the rules live; the hook and the tests both go through here.
 *
 * The IndieDevs-style dialog always anchors on the *current* release entry
 * (the one matching `currentVersion`), then offers the full changelog as a
 * secondary view. So here we don't try to batch up "all skipped releases"
 * into the main view — we just confirm the current release has curated
 * notes and surface them, letting the accordion handle history.
 */
export function resolveWhatsNewState(inputs: WhatsNewInputs): WhatsNewState {
  const { entries, currentVersion, lastSeenVersion } = inputs;

  if (entries === null) {
    return { kind: "pending" };
  }

  // First-ever launch: record the current version and stay quiet. Showing a
  // "What's new" dialog to a brand-new user on their first boot would feel
  // like marketing spam.
  if (lastSeenVersion === null) {
    return { kind: "silent-bootstrap", nextLastSeenVersion: currentVersion };
  }

  // Already up to date, or the user somehow downgraded. Either way, don't
  // surface anything — we only move the marker forward, never backward.
  if (compareVersions(currentVersion, lastSeenVersion) <= 0) {
    return { kind: "noop" };
  }

  const currentEntry = entries.find(
    (entry) => compareVersions(entry.version, currentVersion) === 0,
  );
  if (!currentEntry) {
    // No curated notes for the installed build — silently advance so we
    // don't re-evaluate on every launch.
    return { kind: "silent-bootstrap", nextLastSeenVersion: currentVersion };
  }

  return {
    kind: "show",
    currentEntry,
    allEntries: sortEntriesByVersionDesc(entries),
    nextLastSeenVersion: currentVersion,
  };
}
