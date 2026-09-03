import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const MANIFEST_NAMES = ["djl-mac.yml", "djl.yml", "latest-mac.yml", "latest.yml"] as const;

function assertReleaseVersion(value: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`Invalid desktop release version: ${value}`);
  }
}

export function rebaseManifestToImmutableRelease(
  raw: string,
  version: string,
  sourceName: string,
): string {
  const declaredVersion = /^version:\s*([^\s]+)\s*$/m.exec(raw)?.[1];
  if (declaredVersion !== version) {
    throw new Error(`${sourceName} must declare version ${version}.`);
  }

  const expectedPrefix = `DJL-${version}-`;
  const immutablePrefix = `../releases/${version}/`;
  let urlCount = 0;
  const rebased = raw
    .split("\n")
    .map((line) => {
      const urlMatch = /^(\s*-\s+url:\s*)(\S+)\s*$/.exec(line);
      if (urlMatch?.[1] && urlMatch[2]) {
        if (!urlMatch[2].startsWith(expectedPrefix) || urlMatch[2].includes("/")) {
          throw new Error(`${sourceName} contains an unexpected updater URL: ${urlMatch[2]}`);
        }
        urlCount += 1;
        return `${urlMatch[1]}${immutablePrefix}${urlMatch[2]}`;
      }

      const pathMatch = /^(path:\s*)(\S+)\s*$/.exec(line);
      if (pathMatch?.[1] && pathMatch[2]) {
        if (!pathMatch[2].startsWith(expectedPrefix) || pathMatch[2].includes("/")) {
          throw new Error(`${sourceName} contains an unexpected updater path: ${pathMatch[2]}`);
        }
        return `${pathMatch[1]}${immutablePrefix}${pathMatch[2]}`;
      }
      return line;
    })
    .join("\n");

  if (urlCount === 0) {
    throw new Error(`${sourceName} contains no updater file URLs.`);
  }
  return rebased;
}

export function prepareOssStableManifests(
  version: string,
  sourceDirectory: string,
  outputDirectory: string,
): void {
  assertReleaseVersion(version);
  mkdirSync(outputDirectory, { recursive: true });
  for (const name of MANIFEST_NAMES) {
    const sourcePath = join(sourceDirectory, name);
    const raw = readFileSync(sourcePath, "utf8");
    writeFileSync(
      join(outputDirectory, name),
      rebaseManifestToImmutableRelease(raw, version, basename(sourcePath)),
    );
  }
}

function main(): void {
  const [version, sourceDirectory, outputDirectory] = process.argv.slice(2);
  if (!version || !sourceDirectory || !outputDirectory) {
    throw new Error(
      "Usage: scripts/prepare-oss-stable-manifests.ts <version> <source-directory> <output-directory>",
    );
  }
  prepareOssStableManifests(version, resolve(sourceDirectory), resolve(outputDirectory));
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
