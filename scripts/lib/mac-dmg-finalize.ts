// FILE: mac-dmg-finalize.ts
// Purpose: Regenerates update metadata after a signed macOS DMG is notarized and stapled.
// Layer: Release/build helper

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import { appBuilderPath } from "app-builder-bin";

import {
  assertMacUpdateManifestArtifactMetadata,
  resolveMacUpdateManifestFileNames,
  updateMacUpdateManifestArtifactEntry,
} from "./mac-update-zip.ts";

interface DmgMetadata {
  readonly sha512: string;
  readonly size: number;
}

export interface FinalizeMacDmgUpdateMetadataOptions {
  readonly stageDistDir: string;
  readonly dmgPath: string;
  readonly buildBlockmap?: (
    inputPath: string,
    outputPath: string,
  ) => Promise<DmgMetadata> | DmgMetadata;
}

export interface FinalizedMacDmgUpdateMetadata extends DmgMetadata {
  readonly blockmapPath: string;
  readonly updatedManifestPaths: ReadonlyArray<string>;
}

function defaultBuildBlockmap(inputPath: string, outputPath: string): DmgMetadata {
  rmSync(outputPath, { force: true });
  chmodSync(appBuilderPath, 0o755);
  const result = spawnSync(
    appBuilderPath,
    ["blockmap", "--input", inputPath, "--output", outputPath, "--compression", "gzip"],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    const detail =
      result.stderr ||
      result.stdout ||
      (result.error instanceof Error ? result.error.message : "") ||
      `exit ${result.status ?? "unknown"}`;
    throw new Error(`app-builder blockmap failed: ${detail.trim()}`);
  }
  try {
    const metadata = JSON.parse(result.stdout) as Partial<DmgMetadata>;
    if (
      typeof metadata.sha512 !== "string" ||
      metadata.sha512.length === 0 ||
      typeof metadata.size !== "number" ||
      !Number.isSafeInteger(metadata.size)
    ) {
      throw new Error("response omitted sha512 or size");
    }
    return { sha512: metadata.sha512, size: metadata.size };
  } catch (cause) {
    throw new Error(
      `Could not parse app-builder blockmap metadata: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
}

function computeSha512Base64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}

export async function finalizeMacDmgUpdateMetadata(
  options: FinalizeMacDmgUpdateMetadataOptions,
): Promise<FinalizedMacDmgUpdateMetadata> {
  const dmgStat = statSync(options.dmgPath);
  if (!dmgStat.isFile()) {
    throw new Error(`Final notarized DMG was not found at ${options.dmgPath}`);
  }

  const blockmapPath = `${options.dmgPath}.blockmap`;
  const metadata = await (options.buildBlockmap ?? defaultBuildBlockmap)(
    options.dmgPath,
    blockmapPath,
  );
  if (
    !existsSync(blockmapPath) ||
    !statSync(blockmapPath).isFile() ||
    statSync(blockmapPath).size <= 0
  ) {
    throw new Error(`Final DMG blockmap was not created at ${blockmapPath}`);
  }

  const finalSha512 = await computeSha512Base64(options.dmgPath);
  if (metadata.size !== dmgStat.size || metadata.sha512 !== finalSha512) {
    throw new Error(`DMG blockmap metadata does not match final notarized DMG ${options.dmgPath}.`);
  }

  const dmgFileName = basename(options.dmgPath);
  const updatedManifestPaths: string[] = [];
  const entries = readdirSync(options.stageDistDir);
  for (const manifestName of resolveMacUpdateManifestFileNames(entries)) {
    const manifestPath = join(options.stageDistDir, manifestName);
    const updatedManifest = updateMacUpdateManifestArtifactEntry(
      readFileSync(manifestPath, "utf8"),
      dmgFileName,
      metadata,
    );
    assertMacUpdateManifestArtifactMetadata(updatedManifest, dmgFileName, metadata);
    writeFileSync(manifestPath, updatedManifest);
    updatedManifestPaths.push(manifestPath);
  }

  return {
    ...metadata,
    blockmapPath,
    updatedManifestPaths,
  };
}
