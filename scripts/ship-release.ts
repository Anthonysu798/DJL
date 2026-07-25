// FILE: ship-release.ts
// Purpose: Turns "ship it" into a verified production release tag.
//
// The tag is the trigger for `.github/workflows/desktop-release.yml`, so everything this script
// refuses to do is a release that would either fail preflight minutes later or, worse, publish from
// an unverified commit. Every check below fails closed.
//
// Usage: bun run ship [patch|minor|major|rc] [--notes-file <path>] [--dry-run]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePublicDesktopReleaseVersion } from "./lib/public-desktop-release.ts";
import {
  assertReleaseVersionIsNewer,
  highestReleaseVersion,
  nextReleaseVersion,
  type ObservedReleaseVersion,
  type ReleaseBumpLevel,
} from "./lib/release-update-policy.ts";

const RELEASE_REPOSITORY = "Anthonysu798/DJL";
const LEGACY_RELEASE_REPOSITORY = "Anthonysu798/DJL-Releases";
const VPS_MANIFESTS = [
  { source: "Windows VPS manifest", url: "https://downloads.slcor.com/stable/latest.yml" },
  { source: "macOS VPS manifest", url: "https://downloads.slcor.com/stable/latest-mac.yml" },
];
const BUMP_LEVELS = new Set<ReleaseBumpLevel>(["patch", "minor", "major", "rc"]);

interface ShipOptions {
  readonly level: ReleaseBumpLevel;
  readonly notesFile: string | null;
  readonly dryRun: boolean;
}

class ShipError extends Error {}

function run(command: string, args: readonly string[]): string {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function tryRun(command: string, args: readonly string[]): string | null {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

function parseOptions(argv: readonly string[]): ShipOptions {
  let level: ReleaseBumpLevel = "patch";
  let notesFile: string | null = null;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--notes-file") {
      notesFile = argv[index + 1] ?? null;
      index += 1;
      if (!notesFile) throw new ShipError("--notes-file needs a path.");
    } else if (BUMP_LEVELS.has(argument as ReleaseBumpLevel)) {
      level = argument as ReleaseBumpLevel;
    } else {
      throw new ShipError(
        `Unknown argument '${argument}'. Usage: ship [patch|minor|major|rc] [--notes-file <path>] [--dry-run]`,
      );
    }
  }

  return { level, notesFile, dryRun };
}

// ─── PREFLIGHT ───────────────────────────────────────────────

function assertReleasableWorkingTree(): string {
  if (run("git", ["status", "--porcelain"]).length > 0) {
    throw new ShipError(
      "The working tree has uncommitted changes. Commit or stash them before shipping.",
    );
  }

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    throw new ShipError(`Releases ship from main, not '${branch}'.`);
  }

  run("git", ["fetch", "origin", "main", "--tags", "--quiet"]);
  const head = run("git", ["rev-parse", "HEAD"]);
  const remoteHead = run("git", ["rev-parse", "origin/main"]);
  if (head !== remoteHead) {
    throw new ShipError(
      `Local main (${head.slice(0, 8)}) does not match origin/main (${remoteHead.slice(0, 8)}). Push or pull first.`,
    );
  }
  return head;
}

function assertProtectedMain(): void {
  const protectedBranch = tryRun("gh", [
    "api",
    `repos/${RELEASE_REPOSITORY}/branches/main`,
    "--jq",
    ".protected",
  ]);
  if (protectedBranch !== "true") {
    throw new ShipError(
      `main is not protected, and the release preflight requires it. Run scripts/setup-release-branch-protection.sh.`,
    );
  }
}

// The release workflow demands a completed, successful Desktop CI run for this exact commit. Check
// it here so a bad tag is never created, instead of discovering it after the tag is public.
function assertDesktopCiSucceeded(commit: string): void {
  const runs = tryRun("gh", [
    "api",
    `repos/${RELEASE_REPOSITORY}/actions/workflows/desktop-ci.yml/runs?head_sha=${commit}&status=completed&per_page=100`,
    "--jq",
    '[.workflow_runs[] | select((.event == "push" or .event == "workflow_dispatch") and .conclusion == "success")] | length',
  ]);
  if (runs === null) {
    throw new ShipError("Could not read Desktop CI runs from GitHub.");
  }
  if (Number(runs) < 1) {
    throw new ShipError(
      `Commit ${commit.slice(0, 8)} has no successful full Desktop CI run. Wait for CI to finish before shipping.`,
    );
  }
}

async function readObservedVersions(): Promise<ObservedReleaseVersion[]> {
  const observed: ObservedReleaseVersion[] = [];
  const versionPattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

  for (const [repository, source] of [
    [RELEASE_REPOSITORY, "canonical GitHub release"],
    [LEGACY_RELEASE_REPOSITORY, "legacy GitHub release"],
  ] as const) {
    const tags = tryRun("gh", [
      "api",
      `repos/${repository}/releases?per_page=100`,
      "--jq",
      ".[].tag_name",
    ]);
    for (const tag of (tags ?? "").split("\n").filter(Boolean)) {
      if (versionPattern.test(tag)) observed.push({ source, version: tag });
    }
  }

  for (const manifest of VPS_MANIFESTS) {
    const response = await fetch(manifest.url);
    if (!response.ok) {
      throw new ShipError(`Could not read ${manifest.source} (${response.status}).`);
    }
    const version = /^version:\s*['"]?([^'"\s]+)['"]?$/m.exec(await response.text())?.[1];
    if (!version) {
      throw new ShipError(`${manifest.source} does not expose a version.`);
    }
    observed.push({ source: manifest.source, version });
  }

  return observed;
}

function assertVersionIsUnused(version: string, tag: string): void {
  if (tryRun("git", ["rev-parse", "--verify", `refs/tags/${tag}`]) !== null) {
    throw new ShipError(`Tag ${tag} already exists locally.`);
  }
  if (tryRun("gh", ["release", "view", tag, "--repo", RELEASE_REPOSITORY]) !== null) {
    throw new ShipError(`Release ${tag} already exists.`);
  }
  if (tryRun("gh", ["api", `repos/${RELEASE_REPOSITORY}/git/ref/tags/${version}`]) !== null) {
    throw new ShipError(`A duplicate non-canonical tag named ${version} already exists.`);
  }
}

// ─── RELEASE NOTES ───────────────────────────────────────────

// The tag annotation becomes the published release body (see desktop-release.yml). When the caller
// supplies notes we use them verbatim; otherwise we fall back to the commit subjects so a release is
// never published with an empty changelog.
function buildReleaseNotes(version: string, notesFile: string | null): string {
  if (notesFile) {
    const notes = readFileSync(resolve(notesFile), "utf8").trim();
    if (!notes) throw new ShipError(`${notesFile} is empty.`);
    return `DJL v${version}\n\n${notes}\n`;
  }

  const previousTag = tryRun("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const subjects = run("git", ["log", "--no-merges", "--format=- %s", range]);
  const changes = subjects.length > 0 ? subjects : "- Maintenance release.";
  return `DJL v${version}\n\n${changes}\n`;
}

// ─── ENTRY POINT ─────────────────────────────────────────────

async function main(argv: readonly string[]): Promise<void> {
  const options = parseOptions(argv);

  const commit = assertReleasableWorkingTree();
  assertProtectedMain();
  assertDesktopCiSucceeded(commit);

  const observed = await readObservedVersions();
  const highest = highestReleaseVersion(observed);
  if (!highest) {
    throw new ShipError("No published version was observed, so the next version is ambiguous.");
  }
  const { version, tag } = validatePublicDesktopReleaseVersion(
    nextReleaseVersion(highest, options.level),
  );
  assertReleaseVersionIsNewer(version, observed);
  assertVersionIsUnused(version, tag);

  const notes = buildReleaseNotes(version, options.notesFile);

  console.log(`Shipping ${tag} from ${commit.slice(0, 8)} (highest observed: ${highest})`);
  console.log(`\n${notes}`);

  if (options.dryRun) {
    console.log("Dry run: no tag created.");
    return;
  }

  run("git", ["tag", "-a", tag, "-m", notes, commit]);
  try {
    run("git", ["push", "origin", `refs/tags/${tag}`]);
  } catch (cause) {
    run("git", ["tag", "-d", tag]);
    throw new ShipError(`Could not push ${tag}; the local tag was removed. ${String(cause)}`);
  }

  console.log(`\nPushed ${tag}. Desktop Release is now running:`);
  console.log(`https://github.com/${RELEASE_REPOSITORY}/actions/workflows/desktop-release.yml`);
  console.log("Approve the 'production' environment when it reaches the promote job.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof ShipError ? error.message : error);
    process.exitCode = 1;
  });
}
