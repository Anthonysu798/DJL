// FILE: check-public-desktop-release-version.ts
// Purpose: Fails unless a requested version is newer than every observed release feed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertReleaseVersionIsNewer,
  type ObservedReleaseVersion,
} from "./lib/release-update-policy.ts";

function isObservedReleaseVersion(value: unknown): value is ObservedReleaseVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.source === "string" && typeof candidate.version === "string";
}

export function checkPublicDesktopReleaseVersion(
  version: string,
  observedVersionsPath: string,
): string {
  const raw = JSON.parse(readFileSync(resolve(observedVersionsPath), "utf8")) as unknown;
  if (!Array.isArray(raw) || !raw.every(isObservedReleaseVersion)) {
    throw new Error("Observed release versions must be an array of source/version objects.");
  }
  return assertReleaseVersionIsNewer(version, raw);
}

function main(args: readonly string[]): void {
  const [version, observedVersionsPath, ...unexpected] = args;
  if (!version || !observedVersionsPath || unexpected.length > 0) {
    throw new Error(
      "Usage: node scripts/check-public-desktop-release-version.ts <version> <observed-versions.json>",
    );
  }
  const validated = checkPublicDesktopReleaseVersion(version, observedVersionsPath);
  console.log(`Release ${validated} is newer than every observed canonical and legacy feed.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
