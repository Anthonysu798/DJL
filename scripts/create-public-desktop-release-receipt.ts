// FILE: create-public-desktop-release-receipt.ts
// Purpose: Creates a small, validated receipt for payloads uploaded from a native build runner.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicDesktopReleaseReceipt,
  publicDesktopReleaseReceiptAssetNames,
  type PublicDesktopReleaseArch,
  type PublicDesktopReleasePlatform,
} from "./lib/public-desktop-release.ts";

export function createPublicDesktopReleaseReceiptFile(
  version: string,
  platform: PublicDesktopReleasePlatform,
  arch: PublicDesktopReleaseArch,
  assetDirectory: string,
  outputPath: string,
): void {
  const assets = publicDesktopReleaseReceiptAssetNames(version, platform, arch).map((name) => ({
    name,
    contents: readFileSync(resolve(assetDirectory, name)),
  }));
  const receipt = createPublicDesktopReleaseReceipt(version, platform, arch, assets);
  writeFileSync(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
}

function main(args: readonly string[]): void {
  const [version, rawPlatform, rawArch, assetDirectory, outputPath, ...unexpected] = args;
  if (
    !version ||
    (rawPlatform !== "mac" && rawPlatform !== "win") ||
    (rawArch !== "arm64" && rawArch !== "x64") ||
    !assetDirectory ||
    !outputPath ||
    unexpected.length > 0
  ) {
    throw new Error(
      "Usage: node scripts/create-public-desktop-release-receipt.ts <version> <mac|win> <arm64|x64> <asset-directory> <output.json>",
    );
  }
  createPublicDesktopReleaseReceiptFile(version, rawPlatform, rawArch, assetDirectory, outputPath);
  console.log(`Created ${rawPlatform}/${rawArch} desktop release receipt at ${outputPath}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
