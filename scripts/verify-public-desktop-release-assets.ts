// FILE: verify-public-desktop-release-assets.ts
// Purpose: Verifies GitHub's reported release-asset names, sizes, and SHA-256 digests.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  publishedPublicDesktopReleaseAssetNames,
  validatePublicDesktopReleaseRemoteAssets,
  type PublicDesktopReleaseAsset,
} from "./lib/public-desktop-release.ts";

const RECEIPT_NAMES = [
  "receipt-mac-arm64.json",
  "receipt-mac-x64.json",
  "receipt-win-x64.json",
] as const;

export function verifyPublicDesktopReleaseAssets(
  version: string,
  receiptDirectory: string,
  metadataDirectory: string,
  githubAssetsPath: string,
): void {
  const receipts = RECEIPT_NAMES.map(
    (name) => JSON.parse(readFileSync(resolve(receiptDirectory, name), "utf8")) as unknown,
  );
  const metadataNames = publishedPublicDesktopReleaseAssetNames(version).filter(
    (name) => !name.startsWith(`DJL-${version}-`),
  );
  const metadata: PublicDesktopReleaseAsset[] = metadataNames.map((name) => ({
    name,
    contents: readFileSync(resolve(metadataDirectory, name)),
  }));
  const remoteAssets = JSON.parse(readFileSync(resolve(githubAssetsPath), "utf8")) as unknown;
  if (!Array.isArray(remoteAssets)) {
    throw new Error("GitHub assets response must be an array.");
  }
  validatePublicDesktopReleaseRemoteAssets(version, receipts, metadata, remoteAssets);
}

function main(args: readonly string[]): void {
  const [version, receiptDirectory, metadataDirectory, githubAssetsPath, ...unexpected] = args;
  if (
    !version ||
    !receiptDirectory ||
    !metadataDirectory ||
    !githubAssetsPath ||
    unexpected.length > 0
  ) {
    throw new Error(
      "Usage: node scripts/verify-public-desktop-release-assets.ts <version> <receipt-directory> <metadata-directory> <github-assets.json>",
    );
  }
  verifyPublicDesktopReleaseAssets(version, receiptDirectory, metadataDirectory, githubAssetsPath);
  console.log("GitHub reports the exact verified 15-asset desktop release inventory.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
