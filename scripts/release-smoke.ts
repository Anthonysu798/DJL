// FILE: release-smoke.ts
// Purpose: Verifies the checked-in GitHub-first desktop release architecture.

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  PUBLIC_DESKTOP_RELEASE_REPOSITORY,
  publishedPublicDesktopReleaseAssetNames,
  validatePublicDesktopReleaseVersion,
} from "./lib/public-desktop-release.ts";
import { selectBridgeVersion } from "./lib/release-update-policy.ts";

const root = resolve(import.meta.dirname, "..");

function requireText(source: string, expected: string): void {
  if (!source.includes(expected)) throw new Error(`Release smoke is missing: ${expected}`);
}

function rejectText(source: string, forbidden: string): void {
  if (source.includes(forbidden))
    throw new Error(`Release smoke found forbidden text: ${forbidden}`);
}

if (PUBLIC_DESKTOP_RELEASE_REPOSITORY !== "Anthonysu798/DJL") {
  throw new Error(`Unexpected canonical release repository: ${PUBLIC_DESKTOP_RELEASE_REPOSITORY}`);
}
const release = validatePublicDesktopReleaseVersion("9.9.9-smoke.0");
if (!release.isPrerelease || release.tag !== "v9.9.9-smoke.0") {
  throw new Error("Strict prerelease resolution failed.");
}
if (publishedPublicDesktopReleaseAssetNames(release.version).length !== 13) {
  throw new Error("The public desktop release must contain exactly 13 assets.");
}
if (selectBridgeVersion(["0.5.3", "0.5.4"]) !== "0.5.5") {
  throw new Error("The unused bridge default must resolve to 0.5.5.");
}

const workflowDirectory = resolve(root, ".github/workflows");
const workflows = readdirSync(workflowDirectory).toSorted();
if (
  JSON.stringify(workflows) !==
  JSON.stringify([
    "desktop-ci.yml",
    "desktop-release.yml",
    "desktop-signed-update-e2e.yml",
    "landing-deploy.yml",
  ])
) {
  throw new Error(`Unexpected workflow inventory: ${workflows.join(", ")}`);
}
const ci = readFileSync(resolve(workflowDirectory, "desktop-ci.yml"), "utf8");
const production = readFileSync(resolve(workflowDirectory, "desktop-release.yml"), "utf8");

for (const runner of ["macos-14", "macos-15-intel", "windows-2022"]) {
  requireText(ci, `runner: ${runner}`);
  requireText(production, `runner: ${runner}`);
}
for (const expected of [
  "Create draft before native builds",
  "Upload large payloads directly to private draft",
  "retention-days: 1",
  "Upload updater manifests last",
  "Verify exact 13-asset draft inventory",
  "environment: production",
  "environment: windows-signing",
  "Azure login for Artifact Signing",
  "Get-AuthenticodeSignature",
  'Status -ne "Valid"',
  "TimeStamperCertificate",
  "djl-windows-release-prod",
  "http://timestamp.acs.microsoft.com",
]) {
  requireText(production, expected);
}
for (const expected of [
  "Azure login for Artifact Signing",
  'Status -ne "Valid"',
  "TimeStamperCertificate",
  "djl-windows-release-prod",
]) {
  requireText(ci, expected);
}
for (const forbidden of [
  "pull_request_target",
  ["DJL", "RELEASES", "TOKEN"].join("_"),
  "platform: linux",
  "AppImage",
  "apps/ios",
  "remote-relay",
  "apps/landing",
  "apps/marketing",
  "bun publish",
  "gh release delete",
]) {
  rejectText(ci, forbidden);
  rejectText(production, forbidden);
}
rejectText(ci, "AZURE_CLIENT_SECRET");
rejectText(production, "AZURE_CLIENT_SECRET");

console.log("Desktop release architecture smoke checks passed.");
