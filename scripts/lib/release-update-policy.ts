// FILE: release-update-policy.ts
// Purpose: Orders release versions and selects the one-time GitHub updater bridge version.

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

interface ParsedReleaseVersion {
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

export interface ObservedReleaseVersion {
  readonly source: string;
  readonly version: string;
}

function parseReleaseVersion(rawVersion: string): ParsedReleaseVersion {
  const version = rawVersion.trim();
  const match = VERSION_PATTERN.exec(version);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      `Invalid release version '${rawVersion}'. Expected X.Y.Z or X.Y.Z-prerelease syntax.`,
    );
  }
  const core = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (core.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Invalid release version '${rawVersion}': core number is too large.`);
  }
  return {
    version,
    major: core[0]!,
    minor: core[1]!,
    patch: core[2]!,
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrereleaseIdentifiers(
  leftIdentifiers: readonly string[],
  rightIdentifiers: readonly string[],
): number {
  if (leftIdentifiers.length === 0 && rightIdentifiers.length === 0) return 0;
  if (leftIdentifiers.length === 0) return 1;
  if (rightIdentifiers.length === 0) return -1;
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < length; index += 1) {
    const left = leftIdentifiers[index];
    const right = rightIdentifiers[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(left, right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

export function compareReleaseVersions(left: string, right: string): number {
  const parsedLeft = parseReleaseVersion(left);
  const parsedRight = parseReleaseVersion(right);
  for (const field of ["major", "minor", "patch"] as const) {
    const difference = parsedLeft[field] - parsedRight[field];
    if (difference !== 0) return difference;
  }
  return comparePrereleaseIdentifiers(parsedLeft.prerelease, parsedRight.prerelease);
}

function normalizeObservedVersion(rawVersion: string): string {
  const trimmed = rawVersion.trim();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

export function assertReleaseVersionIsNewer(
  rawVersion: string,
  observedVersions: readonly ObservedReleaseVersion[],
): string {
  const requested = parseReleaseVersion(rawVersion).version;
  for (const observed of observedVersions) {
    const version = normalizeObservedVersion(observed.version);
    parseReleaseVersion(version);
    if (compareReleaseVersions(requested, version) <= 0) {
      throw new Error(
        `Release ${requested} is not newer than ${observed.source} ${observed.version}.`,
      );
    }
  }
  return requested;
}

export type ReleaseBumpLevel = "patch" | "minor" | "major" | "rc";

// Picks the version that `ship` will tag next. A prerelease resolves to its own release line first
// (0.6.0-rc.1 -> 0.6.0 on patch) so a finished candidate ships as the stable build it was testing,
// rather than skipping ahead to an unrelated version.
export function nextReleaseVersion(rawCurrentVersion: string, level: ReleaseBumpLevel): string {
  const current = parseReleaseVersion(normalizeObservedVersion(rawCurrentVersion));
  const isPrerelease = current.prerelease.length > 0;

  if (level === "rc") {
    if (isPrerelease && current.prerelease[0] === "rc") {
      const counter = Number(current.prerelease[1]);
      const next = Number.isSafeInteger(counter) ? counter + 1 : 1;
      return `${current.major}.${current.minor}.${current.patch}-rc.${next}`;
    }
    // A stable release becomes the candidate for the following patch line.
    return `${current.major}.${current.minor}.${current.patch + 1}-rc.1`;
  }

  if (level === "major") {
    return `${current.major + 1}.0.0`;
  }
  if (level === "minor") {
    return `${current.major}.${current.minor + 1}.0`;
  }
  return isPrerelease
    ? `${current.major}.${current.minor}.${current.patch}`
    : `${current.major}.${current.minor}.${current.patch + 1}`;
}

export function highestReleaseVersion(
  observedVersions: readonly ObservedReleaseVersion[],
): string | null {
  let highest: string | null = null;
  for (const observed of observedVersions) {
    const version = normalizeObservedVersion(observed.version);
    parseReleaseVersion(version);
    if (highest === null || compareReleaseVersions(version, highest) > 0) {
      highest = version;
    }
  }
  return highest;
}

export function selectBridgeVersion(
  rawObservedVersions: readonly string[],
  preferredVersion = "0.5.5",
): string {
  const preferred = parseReleaseVersion(preferredVersion).version;
  const observed = rawObservedVersions.map((version) =>
    parseReleaseVersion(normalizeObservedVersion(version)),
  );
  if (observed.every((version) => compareReleaseVersions(preferred, version.version) > 0)) {
    return preferred;
  }
  if (observed.length === 0) return preferred;

  const highest = observed.reduce((current, candidate) =>
    compareReleaseVersions(candidate.version, current.version) > 0 ? candidate : current,
  );
  if (highest.prerelease.length > 0) {
    return `${highest.major}.${highest.minor}.${highest.patch}`;
  }
  return `${highest.major}.${highest.minor}.${highest.patch + 1}`;
}
