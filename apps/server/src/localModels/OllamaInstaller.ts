import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_API_URL = "https://api.github.com/repos/ollama/ollama/releases/latest";
const MAX_ARCHIVE_BYTES = 2_000_000_000;
const RELEASE_REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

export type OllamaInstallProgress = {
  readonly state: "downloading" | "verifying" | "installing";
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly message: string;
};

export type LocalModelFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OllamaInstallOptions {
  readonly stateDir: string;
  readonly fetch?: LocalModelFetch;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly onProgress: (progress: OllamaInstallProgress) => void | Promise<void>;
  readonly runCommand?: (
    command: string,
    args: ReadonlyArray<string>,
  ) => Promise<{ readonly stdout: string }>;
}

export interface OllamaInstallResult {
  readonly command: string;
  readonly version: string;
}

type ReleaseAsset = {
  readonly name: string;
  readonly size: number;
  readonly digest: unknown;
  readonly browser_download_url: string;
};

type Release = {
  readonly tag_name: string;
  readonly assets: ReadonlyArray<ReleaseAsset>;
};

export type SelectedOllamaReleaseAsset = {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly url: string;
  readonly version: string;
  readonly archiveType: "tgz" | "tar.zst" | "zip";
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function expectedAsset(platform: NodeJS.Platform, arch: NodeJS.Architecture): string {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return "ollama-darwin.tgz";
  }
  if (platform === "linux" && arch === "x64") return "ollama-linux-amd64.tar.zst";
  if (platform === "linux" && arch === "arm64") return "ollama-linux-arm64.tar.zst";
  if (platform === "win32" && arch === "x64") return "ollama-windows-amd64.zip";
  if (platform === "win32" && arch === "arm64") return "ollama-windows-arm64.zip";
  throw new Error(`One-click Ollama installation is not available for ${platform}/${arch}.`);
}

function releaseFromUnknown(value: unknown): Release {
  const root = object(value);
  if (!root || typeof root.tag_name !== "string" || !Array.isArray(root.assets)) {
    throw new Error("Ollama's release service returned an invalid response.");
  }
  const assets = root.assets.flatMap((value): ReleaseAsset[] => {
    const asset = object(value);
    return asset &&
      typeof asset.name === "string" &&
      typeof asset.size === "number" &&
      typeof asset.browser_download_url === "string"
      ? [
          {
            name: asset.name,
            size: asset.size,
            digest: asset.digest,
            browser_download_url: asset.browser_download_url,
          },
        ]
      : [];
  });
  return { tag_name: root.tag_name, assets };
}

export function selectOllamaReleaseAsset(
  releaseValue: unknown,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): SelectedOllamaReleaseAsset {
  const release = releaseFromUnknown(releaseValue);
  const name = expectedAsset(platform, arch);
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) throw new Error(`Ollama did not publish ${name} in its latest release.`);
  const digest = typeof asset.digest === "string" ? asset.digest : "";
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest);
  const url = new URL(asset.browser_download_url);
  if (
    !match ||
    asset.size <= 0 ||
    asset.size > MAX_ARCHIVE_BYTES ||
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !url.pathname.startsWith("/ollama/ollama/releases/download/")
  ) {
    throw new Error("Ollama did not provide a safe, verified download for this computer.");
  }
  return {
    name,
    size: Math.floor(asset.size),
    sha256: match[1]!.toLowerCase(),
    url: url.toString(),
    version: release.tag_name,
    archiveType: name.endsWith(".tgz") ? "tgz" : name.endsWith(".tar.zst") ? "tar.zst" : "zip",
  };
}

export function validateArchiveEntries(entries: ReadonlyArray<string>): void {
  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const normalized = entry.replaceAll("\\", "/");
    if (
      isAbsolute(entry) ||
      win32.isAbsolute(entry) ||
      normalized.split("/").includes("..") ||
      posix.normalize(normalized).startsWith("../")
    ) {
      throw new Error(`Ollama's archive contains an unsafe path: ${entry}`);
    }
  }
}

export async function validateExtractedSymlinks(rootPath: string): Promise<void> {
  const root = resolve(rootPath);
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isSymbolicLink()) continue;
      const target = await readlink(entryPath);
      const resolvedTarget = resolve(dirname(entryPath), target);
      const relativeTarget = relative(root, resolvedTarget);
      if (
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${sep}`) ||
        isAbsolute(relativeTarget)
      ) {
        throw new Error(`Ollama's archive contains an unsafe symbolic link: ${entry.name}`);
      }
    }
  };
  await walk(root);
}

async function defaultRunCommand(
  command: string,
  args: ReadonlyArray<string>,
): Promise<{ readonly stdout: string }> {
  const result = await execFileAsync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout: result.stdout };
}

function tarArguments(
  asset: SelectedOllamaReleaseAsset,
  operation: "list" | "extract",
  archivePath: string,
  destinationPath: string,
): string[] {
  const mode =
    asset.archiveType === "tgz"
      ? operation === "list"
        ? "-tzf"
        : "-xzf"
      : operation === "list"
        ? "-tf"
        : "-xf";
  const compression = asset.archiveType === "tar.zst" ? ["--zstd"] : [];
  return operation === "list"
    ? [...compression, mode, archivePath]
    : [...compression, mode, archivePath, "-C", destinationPath];
}

async function downloadArchive(
  fetchImpl: LocalModelFetch,
  asset: SelectedOllamaReleaseAsset,
  archivePath: string,
  onProgress: OllamaInstallOptions["onProgress"],
): Promise<void> {
  const controller = new AbortController();
  let idleTimeout: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimeout = (): void => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  resetIdleTimeout();
  let response: Response;
  try {
    response = await fetchImpl(asset.url, {
      headers: { Accept: "application/octet-stream", "User-Agent": "DJL-local-model-installer" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (cause) {
    clearTimeout(idleTimeout);
    if (controller.signal.aborted) {
      throw new Error("Ollama's download timed out. Check your connection and retry.", {
        cause,
      });
    }
    throw cause;
  }
  if (!response.ok || !response.body) {
    clearTimeout(idleTimeout);
    throw new Error(`Ollama download failed (HTTP ${response.status}).`);
  }
  const finalUrl = new URL(response.url || asset.url);
  if (
    finalUrl.protocol !== "https:" ||
    ![
      "github.com",
      "objects.githubusercontent.com",
      "release-assets.githubusercontent.com",
    ].includes(finalUrl.hostname)
  ) {
    clearTimeout(idleTimeout);
    throw new Error("Ollama's download redirected to an untrusted server.");
  }

  const file = await open(archivePath, "wx", 0o600).catch((cause) => {
    clearTimeout(idleTimeout);
    throw cause;
  });
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let downloadedBytes = 0;
  let lastProgressAt = 0;
  try {
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new Error("Ollama's download timed out. Check your connection and retry.", {
            cause,
          });
        }
        throw cause;
      }
      resetIdleTimeout();
      const { done, value } = chunk;
      if (done) break;
      downloadedBytes += value.byteLength;
      if (downloadedBytes > asset.size || downloadedBytes > MAX_ARCHIVE_BYTES) {
        throw new Error("Ollama's download exceeded the expected size.");
      }
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset, null);
        if (bytesWritten <= 0) throw new Error("Could not save the Ollama download.");
        offset += bytesWritten;
      }
      if (Date.now() - lastProgressAt >= 200) {
        lastProgressAt = Date.now();
        await onProgress({
          state: "downloading",
          downloadedBytes,
          totalBytes: asset.size,
          message: "Downloading Ollama…",
        });
      }
    }
  } finally {
    clearTimeout(idleTimeout);
    await file.close();
  }
  if (downloadedBytes !== asset.size) {
    throw new Error(`Ollama download was incomplete (${downloadedBytes} of ${asset.size} bytes).`);
  }
  await onProgress({
    state: "verifying",
    downloadedBytes,
    totalBytes: asset.size,
    message: "Verifying Ollama…",
  });
  if (hash.digest("hex") !== asset.sha256) {
    throw new Error("Ollama's download failed its SHA-256 integrity check.");
  }
}

export async function installOllamaRuntime(
  options: OllamaInstallOptions,
): Promise<OllamaInstallResult> {
  const fetchImpl = options.fetch ?? fetch;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const releaseController = new AbortController();
  const releaseTimeout = setTimeout(() => releaseController.abort(), RELEASE_REQUEST_TIMEOUT_MS);
  let releaseResponse: Response;
  try {
    releaseResponse = await fetchImpl(RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "DJL-local-model-installer",
      },
      signal: releaseController.signal,
    });
  } catch (cause) {
    if (releaseController.signal.aborted) {
      throw new Error("Checking for the latest Ollama version timed out. Please retry.", {
        cause,
      });
    }
    throw cause;
  } finally {
    clearTimeout(releaseTimeout);
  }
  if (!releaseResponse.ok) {
    throw new Error(`Could not check the latest Ollama release (HTTP ${releaseResponse.status}).`);
  }
  const asset = selectOllamaReleaseAsset(await releaseResponse.json(), platform, arch);
  const runtimeRoot = join(options.stateDir, "local-models", "runtimes", "ollama");
  const nonce = randomUUID();
  const archivePath = join(runtimeRoot, `.download-${nonce}-${basename(asset.name)}`);
  const stagingPath = join(runtimeRoot, `.staging-${nonce}`);
  const currentPath = join(runtimeRoot, "current");
  const backupPath = join(runtimeRoot, `.backup-${nonce}`);
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  let installationCommitted = false;

  try {
    await downloadArchive(fetchImpl, asset, archivePath, options.onProgress);
    await options.onProgress({
      state: "installing",
      downloadedBytes: asset.size,
      totalBytes: asset.size,
      message: "Installing Ollama…",
    });
    await mkdir(stagingPath, { recursive: true, mode: 0o700 });
    const listed = await runCommand("tar", tarArguments(asset, "list", archivePath, stagingPath));
    validateArchiveEntries(listed.stdout.split(/\r?\n/));
    await runCommand("tar", tarArguments(asset, "extract", archivePath, stagingPath));
    await validateExtractedSymlinks(stagingPath);
    const command = join(stagingPath, platform === "win32" ? "ollama.exe" : "ollama");
    await access(command, fsConstants.F_OK);
    if (platform !== "win32") await chmod(command, 0o700);
    await writeFile(
      join(stagingPath, "djl-install.json"),
      `${JSON.stringify({ version: asset.version, asset: asset.name, sha256: asset.sha256 }, null, 2)}\n`,
      { mode: 0o600 },
    );

    let hadCurrent = false;
    try {
      await access(currentPath, fsConstants.F_OK);
      hadCurrent = true;
      await rename(currentPath, backupPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    try {
      await rename(stagingPath, currentPath);
    } catch (cause) {
      if (hadCurrent) {
        try {
          await rename(backupPath, currentPath);
        } catch (restoreCause) {
          throw new AggregateError(
            [cause, restoreCause],
            `Could not replace Ollama. The previous installation is preserved at ${backupPath}.`,
          );
        }
      }
      throw cause;
    }
    installationCommitted = true;
    await rm(backupPath, { recursive: true, force: true });
    return {
      command: join(currentPath, platform === "win32" ? "ollama.exe" : "ollama"),
      version: asset.version,
    };
  } finally {
    await Promise.all([
      rm(archivePath, { force: true }),
      rm(stagingPath, { recursive: true, force: true }),
      installationCommitted ? rm(backupPath, { recursive: true, force: true }) : Promise.resolve(),
    ]);
  }
}
