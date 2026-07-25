// FILE: finalize-public-desktop-release.ts
// Purpose: Creates updater manifests and checksums from small native-runner receipts.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  preparePublicDesktopReleaseMetadata,
  type PublicDesktopReleaseAsset,
} from "./lib/public-desktop-release.ts";

const RECEIPT_NAMES = [
  "receipt-mac-arm64.json",
  "receipt-mac-x64.json",
  "receipt-win-x64.json",
] as const;
const MANIFEST_NAMES = ["latest-mac-arm64.yml", "latest-mac-x64.yml", "latest.yml"] as const;

export function finalizePublicDesktopReleaseDirectory(
  version: string,
  inputDirectory: string,
  outputDirectory: string,
): readonly string[] {
  const input = resolve(inputDirectory);
  const receipts = RECEIPT_NAMES.map(
    (name) => JSON.parse(readFileSync(resolve(input, name), "utf8")) as unknown,
  );
  const manifests: PublicDesktopReleaseAsset[] = MANIFEST_NAMES.map((name) => ({
    name,
    contents: readFileSync(resolve(input, name)),
  }));
  const metadata = preparePublicDesktopReleaseMetadata(version, receipts, manifests);
  mkdirSync(resolve(outputDirectory), { recursive: true });
  for (const asset of metadata) {
    writeFileSync(resolve(outputDirectory, asset.name), asset.contents, { flag: "wx" });
  }
  return metadata.map((asset) => asset.name);
}

function main(args: readonly string[]): void {
  const [version, inputDirectory, outputDirectory, ...unexpected] = args;
  if (!version || !inputDirectory || !outputDirectory || unexpected.length > 0) {
    throw new Error(
      "Usage: node scripts/finalize-public-desktop-release.ts <version> <receipt-directory> <output-directory>",
    );
  }
  const names = finalizePublicDesktopReleaseDirectory(version, inputDirectory, outputDirectory);
  console.log(`Prepared ${names.length} release metadata assets: ${names.join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
