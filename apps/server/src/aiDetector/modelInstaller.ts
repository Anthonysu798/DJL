// FILE: modelInstaller.ts
// Purpose: Bounded, checksum-verified, atomic model installation.

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  getModelManifest,
  modelSizeBytes,
  type DetectorModelFile,
  type DetectorModelLanguage,
  type DetectorModelManifest,
} from "./modelManifest";

const INSTALL_METADATA = "install.json";
const MAX_REDIRECTS = 6;

function manifestFilePath(directory: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error("Model manifest contains an unsafe file path.");
  }
  const root = path.resolve(directory);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Model manifest file escapes the model directory.");
  }
  return resolved;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyModelFiles(
  directory: string,
  files: readonly DetectorModelFile[],
): Promise<boolean> {
  try {
    for (const file of files) {
      const filePath = manifestFilePath(directory, file.path);
      const info = await stat(filePath);
      if (!info.isFile() || info.size !== file.sizeBytes) return false;
      if ((await sha256File(filePath)) !== file.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function syncModelFileForDurability(
  handle: Pick<Awaited<ReturnType<typeof open>>, "sync">,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  try {
    await handle.sync();
  } catch (error) {
    // Bun on Windows currently reports EPERM for fsync on otherwise valid,
    // readable files. Integrity is established independently with byte counts
    // and SHA-256 before this best-effort durability step.
    if (platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return;
    throw error;
  }
}

async function syncStagedModelFiles(
  directory: string,
  files: readonly DetectorModelFile[],
): Promise<void> {
  for (const filePath of [
    ...files.map((file) => manifestFilePath(directory, file.path)),
    path.join(directory, INSTALL_METADATA),
  ]) {
    const handle = await open(filePath, "r");
    try {
      await syncModelFileForDurability(handle);
    } finally {
      await handle.close();
    }
  }
}

export interface ModelInstallProgress {
  readonly state: "downloading" | "verifying";
  readonly downloadedBytes: number;
  readonly totalBytes: number;
}

function isTrustedModelHost(hostname: string): boolean {
  return (
    hostname === "huggingface.co" ||
    hostname.endsWith(".huggingface.co") ||
    hostname === "hf.co" ||
    hostname.endsWith(".hf.co")
  );
}

function assertTrustedModelUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !isTrustedModelHost(url.hostname)) {
    throw new Error(`Model download URL is not trusted: ${url.origin}`);
  }
  return url;
}

async function fetchTrusted(rawUrl: string, signal: AbortSignal, redirects = 0): Promise<Response> {
  if (redirects > MAX_REDIRECTS) throw new Error("Model download exceeded the redirect limit.");
  const url = assertTrustedModelUrl(rawUrl);
  const response = await fetch(url, { redirect: "manual", signal });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Model download redirect had no destination.");
    return fetchTrusted(new URL(location, url).toString(), signal, redirects + 1);
  }
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed with HTTP ${response.status}.`);
  }
  return response;
}

async function downloadFile(input: {
  readonly file: DetectorModelFile;
  readonly destination: string;
  readonly signal: AbortSignal;
  readonly onBytes: (bytes: number) => void;
}): Promise<void> {
  const response = await fetchTrusted(input.file.url, input.signal);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > input.file.sizeBytes) {
    throw new Error(`Model file '${input.file.path}' exceeds its manifest size.`);
  }
  await mkdir(path.dirname(input.destination), { recursive: true });
  const hash = createHash("sha256");
  let bytes = 0;
  const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  source.on("data", (chunk: Buffer) => {
    input.signal.throwIfAborted();
    bytes += chunk.byteLength;
    if (bytes > input.file.sizeBytes) {
      source.destroy(new Error("Model file exceeded its limit."));
      return;
    }
    hash.update(chunk);
    input.onBytes(chunk.byteLength);
  });
  await pipeline(source, createWriteStream(input.destination, { flags: "wx", mode: 0o600 }), {
    signal: input.signal,
  });
  if (bytes !== input.file.sizeBytes) {
    throw new Error(
      `Model file '${input.file.path}' has size ${bytes}; expected ${input.file.sizeBytes}.`,
    );
  }
  const digest = hash.digest("hex");
  if (digest !== input.file.sha256) {
    throw new Error(`Model file '${input.file.path}' failed its SHA-256 check.`);
  }
}

export function modelDirectory(modelRoot: string, language: DetectorModelLanguage): string {
  return path.join(modelRoot, language);
}

export async function inspectInstalledModel(
  modelRoot: string,
  language: DetectorModelLanguage,
): Promise<boolean> {
  const manifest = getModelManifest(language);
  const directory = modelDirectory(modelRoot, language);
  try {
    const metadata = JSON.parse(await readFile(path.join(directory, INSTALL_METADATA), "utf8")) as {
      revision?: unknown;
      files?: Record<string, string>;
    };
    if (metadata.revision !== manifest.revision) return false;
    for (const file of manifest.files) {
      if (metadata.files?.[file.path] !== file.sha256) return false;
      const info = await stat(manifestFilePath(directory, file.path));
      if (!info.isFile() || info.size !== file.sizeBytes) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function verifyInstalledModel(
  modelRoot: string,
  language: DetectorModelLanguage,
): Promise<boolean> {
  if (!(await inspectInstalledModel(modelRoot, language))) return false;
  const manifest = getModelManifest(language);
  return verifyModelFiles(modelDirectory(modelRoot, language), manifest.files);
}

export async function replaceModelDirectoryAtomically(
  partialDirectory: string,
  targetDirectory: string,
  options: {
    readonly removeDirectory?: typeof rm;
  } = {},
): Promise<void> {
  const removeDirectory = options.removeDirectory ?? rm;
  const backupDirectory = path.join(
    path.dirname(targetDirectory),
    `.${path.basename(targetDirectory)}.backup-${randomUUID()}`,
  );
  let previousMoved = false;
  try {
    try {
      await rename(targetDirectory, backupDirectory);
      previousMoved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    try {
      await rename(partialDirectory, targetDirectory);
    } catch (promotionError) {
      if (previousMoved) {
        try {
          await rename(backupDirectory, targetDirectory);
        } catch (restoreError) {
          // oxlint-disable-next-line eslint/preserve-caught-error -- AggregateError preserves both caught failures in `errors` and also sets the immediate cause.
          throw new AggregateError(
            [promotionError, restoreError],
            "Model promotion failed and the previous install could not be restored.",
            { cause: restoreError },
          );
        }
      }
      throw promotionError;
    }

    if (previousMoved) {
      // Promotion has already succeeded. A stale backup is safe to recover on
      // the next startup and must not make the installed model look broken.
      await removeDirectory(backupDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  } catch (error) {
    if (!previousMoved) {
      await removeDirectory(backupDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

export async function recoverModelInstallState(
  modelRoot: string,
  language: DetectorModelLanguage,
): Promise<void> {
  await mkdir(modelRoot, { recursive: true, mode: 0o700 });
  const entries = await readdir(modelRoot, { withFileTypes: true });
  const backupPrefix = `.${language}.backup-`;
  const partialPrefix = `.${language}.partial-`;
  const backups = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(backupPrefix))
    .map((entry) => path.join(modelRoot, entry.name));
  const partials = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(partialPrefix))
    .map((entry) => path.join(modelRoot, entry.name));
  const target = modelDirectory(modelRoot, language);
  const targetExists = await stat(target)
    .then((info) => info.isDirectory())
    .catch(() => false);

  if (!targetExists && backups.length > 0) {
    const candidates = await Promise.all(
      backups.map(async (directory) => ({ directory, modified: (await stat(directory)).mtimeMs })),
    );
    candidates.sort((left, right) => right.modified - left.modified);
    await rename(candidates[0]!.directory, target);
  }

  await Promise.all([
    ...partials.map((directory) => rm(directory, { recursive: true, force: true })),
    ...backups.map((directory) =>
      directory === target ? Promise.resolve() : rm(directory, { recursive: true, force: true }),
    ),
  ]);
}

export async function installDetectorModel(input: {
  readonly modelRoot: string;
  readonly language: DetectorModelLanguage;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: ModelInstallProgress) => void;
}): Promise<void> {
  const manifest = getModelManifest(input.language);
  await mkdir(input.modelRoot, { recursive: true });
  const partial = path.join(input.modelRoot, `.${input.language}.partial-${randomUUID()}`);
  const target = modelDirectory(input.modelRoot, input.language);
  let downloadedBytes = 0;
  const totalBytes = modelSizeBytes(manifest);
  await mkdir(partial, { recursive: true, mode: 0o700 });
  try {
    for (const file of manifest.files) {
      await downloadFile({
        file,
        destination: manifestFilePath(partial, file.path),
        signal: input.signal,
        onBytes: (bytes) => {
          downloadedBytes += bytes;
          input.onProgress({ state: "downloading", downloadedBytes, totalBytes });
        },
      });
    }
    input.onProgress({ state: "verifying", downloadedBytes, totalBytes });
    input.signal.throwIfAborted();
    if (!(await verifyModelFiles(partial, manifest.files))) {
      throw new Error("The staged detector model failed its final integrity check.");
    }
    input.signal.throwIfAborted();
    const metadata = {
      schemaVersion: 1,
      id: manifest.id,
      revision: manifest.revision,
      language: manifest.language,
      license: manifest.license,
      installedAt: new Date().toISOString(),
      files: Object.fromEntries(manifest.files.map((file) => [file.path, file.sha256])),
    };
    await writeFile(
      path.join(partial, INSTALL_METADATA),
      `${JSON.stringify(metadata, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );
    await syncStagedModelFiles(partial, manifest.files);
    await replaceModelDirectoryAtomically(partial, target);
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeDetectorModel(
  modelRoot: string,
  language: DetectorModelLanguage,
): Promise<void> {
  await rm(modelDirectory(modelRoot, language), { recursive: true, force: true });
}

export function manifestForInstall(language: DetectorModelLanguage): DetectorModelManifest {
  return getModelManifest(language);
}
