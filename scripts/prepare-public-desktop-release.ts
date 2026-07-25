// FILE: prepare-public-desktop-release.ts
// Purpose: Validates and prepares a public desktop release directory in place.

import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { preparePublicDesktopReleaseAssets } from "./lib/public-desktop-release.ts";

export function preparePublicDesktopReleaseDirectory(version: string, directory: string): string[] {
  const assetDirectory = resolve(directory);
  const sourceAssets = readdirSync(assetDirectory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile()) {
      throw new Error(`Release directory contains a non-file entry: ${entry.name}`);
    }
    return {
      name: entry.name,
      contents: readFileSync(resolve(assetDirectory, entry.name)),
    };
  });
  const prepared = preparePublicDesktopReleaseAssets(version, sourceAssets);
  const sourceNames = new Set(sourceAssets.map((asset) => asset.name));

  for (const asset of prepared) {
    if (sourceNames.has(asset.name)) continue;
    writeFileSync(resolve(assetDirectory, asset.name), asset.contents, { flag: "wx" });
  }
  for (const source of sourceAssets) {
    if (!prepared.some((asset) => asset.name === source.name)) {
      rmSync(resolve(assetDirectory, source.name));
    }
  }
  return prepared.map((asset) => asset.name);
}

function main(args: readonly string[]): void {
  const [version, directory, ...unexpected] = args;
  if (!version || !directory || unexpected.length > 0) {
    throw new Error(
      "Usage: node scripts/prepare-public-desktop-release.ts <version> <release-directory>",
    );
  }
  const prepared = preparePublicDesktopReleaseDirectory(version, directory);
  console.log(`Prepared ${prepared.length} public release assets: ${prepared.join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
