// FILE: djlStorageMigration.ts
// Purpose: Non-destructively imports legacy DJL state into the canonical DJL layout.

import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

const OPENCODE_AUTH_RELATIVE_PATH = join("data", "opencode", "auth.json");

export interface DjlStorageMigrationResult {
  readonly copiedRelativePaths: ReadonlyArray<string>;
  readonly migratedProviderIds: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

interface MigrateLegacyDjlStorageInput {
  readonly canonicalBaseDir: string;
  readonly legacyBaseDir: string;
  readonly importLegacyDefault: boolean;
  readonly mergeDevelopmentIntoUserdata?: boolean;
}

function isMissingFileError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

function isExistingFileError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EEXIST";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (isMissingFileError(cause)) return false;
    throw cause;
  }
}

function isOpenCodeAuthPath(path: string): boolean {
  return path.endsWith(OPENCODE_AUTH_RELATIVE_PATH);
}

async function copyMissingTree(input: {
  source: string;
  target: string;
  canonicalBaseDir: string;
  copiedRelativePaths: string[];
  shouldSkip?: (source: string) => boolean;
}): Promise<void> {
  if (input.shouldSkip?.(input.source)) return;
  let stats;
  try {
    stats = await lstat(input.source);
  } catch (cause) {
    if (isMissingFileError(cause)) return;
    throw cause;
  }

  if (stats.isDirectory()) {
    await mkdir(input.target, { recursive: true });
    const entries = await readdir(input.source);
    for (const entry of entries) {
      await copyMissingTree({
        ...input,
        source: join(input.source, entry),
        target: join(input.target, entry),
      });
    }
    return;
  }

  if (!stats.isFile() || isOpenCodeAuthPath(input.source)) return;
  await mkdir(dirname(input.target), { recursive: true });
  try {
    await copyFile(input.source, input.target, constants.COPYFILE_EXCL);
    input.copiedRelativePaths.push(relative(input.canonicalBaseDir, input.target));
  } catch (cause) {
    if (!isExistingFileError(cause)) throw cause;
  }
}

async function readCredentialRecord(
  path: string,
  warnings: string[],
  warnOnInvalid: boolean,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Credential file must contain a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    if (isMissingFileError(cause)) return {};
    if (
      warnOnInvalid &&
      !warnings.includes("Skipped an invalid legacy OpenCode credential file.")
    ) {
      warnings.push("Skipped an invalid legacy OpenCode credential file.");
    }
    return {};
  }
}

async function writeJsonAtomically(path: string, value: unknown, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    try {
      await handle.sync();
    } catch (error) {
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") {
        throw error;
      }
    }
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
    await chmod(path, mode);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function migrateLegacyDjlStorage(
  input: MigrateLegacyDjlStorageInput,
): Promise<DjlStorageMigrationResult> {
  if (!input.importLegacyDefault) {
    return { copiedRelativePaths: [], migratedProviderIds: [], warnings: [] };
  }

  const sourceFingerprint = createHash("sha256")
    .update(resolve(input.legacyBaseDir))
    .digest("hex")
    .slice(0, 16);
  const markerPath = join(
    input.canonicalBaseDir,
    "migrations",
    `legacy-storage-v2-${sourceFingerprint}.json`,
  );
  if (await pathExists(markerPath)) {
    return { copiedRelativePaths: [], migratedProviderIds: [], warnings: [] };
  }

  const copiedRelativePaths: string[] = [];
  const migratedProviderIds: string[] = [];
  const warnings: string[] = [];
  const canonicalOpenCodeRoot = join(input.canonicalBaseDir, "userdata", "opencode");
  const canonicalAuthPath = join(canonicalOpenCodeRoot, OPENCODE_AUTH_RELATIVE_PATH);

  await copyMissingTree({
    source: join(input.legacyBaseDir, "userdata"),
    target: join(input.canonicalBaseDir, "userdata"),
    canonicalBaseDir: input.canonicalBaseDir,
    copiedRelativePaths,
  });
  const legacyDevelopmentRoot = join(input.legacyBaseDir, "dev");
  await copyMissingTree({
    source: legacyDevelopmentRoot,
    target: join(input.canonicalBaseDir, input.mergeDevelopmentIntoUserdata ? "userdata" : "dev"),
    canonicalBaseDir: input.canonicalBaseDir,
    copiedRelativePaths,
    ...(input.mergeDevelopmentIntoUserdata
      ? {
          shouldSkip: (source: string) =>
            /^state\.sqlite(?:-(?:wal|shm))?$/.test(relative(legacyDevelopmentRoot, source)),
        }
      : {}),
  });
  await copyMissingTree({
    source: join(input.legacyBaseDir, "dev", "opencode"),
    target: canonicalOpenCodeRoot,
    canonicalBaseDir: input.canonicalBaseDir,
    copiedRelativePaths,
  });

  const canonicalCredentials = await readCredentialRecord(canonicalAuthPath, warnings, false);
  const mergedCredentials = { ...canonicalCredentials };
  const legacyAuthPaths = [
    join(input.legacyBaseDir, "userdata", "opencode", OPENCODE_AUTH_RELATIVE_PATH),
    join(input.legacyBaseDir, "dev", "opencode", OPENCODE_AUTH_RELATIVE_PATH),
    join(input.canonicalBaseDir, "dev", "opencode", OPENCODE_AUTH_RELATIVE_PATH),
  ];

  for (const legacyAuthPath of legacyAuthPaths) {
    const legacyCredentials = await readCredentialRecord(legacyAuthPath, warnings, true);
    for (const [providerId, credential] of Object.entries(legacyCredentials)) {
      if (providerId in mergedCredentials) continue;
      mergedCredentials[providerId] = credential;
      migratedProviderIds.push(providerId);
    }
  }

  if (migratedProviderIds.length > 0 || (await pathExists(canonicalAuthPath))) {
    await writeJsonAtomically(canonicalAuthPath, mergedCredentials, 0o600);
  }

  await writeJsonAtomically(
    markerPath,
    { version: 2, source: resolve(input.legacyBaseDir), completedAt: new Date().toISOString() },
    0o600,
  );

  return {
    copiedRelativePaths: copiedRelativePaths.toSorted(),
    migratedProviderIds: [...new Set(migratedProviderIds)].toSorted(),
    warnings,
  };
}
