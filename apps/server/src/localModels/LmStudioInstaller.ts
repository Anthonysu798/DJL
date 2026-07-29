import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import {
  validateArchiveEntries,
  validateExtractedSymlinks,
  type LocalModelFetch,
  type OllamaInstallProgress,
} from "./OllamaInstaller";

const execFileAsync = promisify(execFile);
const LLMSTER_VERSION = "0.0.19-2";
const DOWNLOAD_ROOT = "https://llmster.lmstudio.ai/download";
const MAX_ARCHIVE_BYTES = 2_000_000_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

export interface LmStudioInstallOptions {
  readonly stateDir: string;
  readonly fetch?: LocalModelFetch;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly env?: NodeJS.ProcessEnv;
  readonly onProgress: (progress: OllamaInstallProgress) => void | Promise<void>;
  readonly runCommand?: (
    command: string,
    args: ReadonlyArray<string>,
    options?: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv },
  ) => Promise<{ readonly stdout: string }>;
}

export interface LmStudioInstallResult {
  readonly command: string;
  readonly version: string;
  readonly homeDir: string;
}

export interface SelectedLmStudioReleaseAsset {
  readonly version: string;
  readonly name: string;
  readonly url: string;
  readonly checksumUrl: string;
  readonly archiveType: "tgz" | "zip";
}

function releasePlatform(platform: NodeJS.Platform, arch: NodeJS.Architecture): string {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return `darwin-${arch}`;
  }
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    return `win32-${arch}`;
  }
  throw new Error(
    `One-click LM Studio engine installation is not available for ${platform}/${arch}.`,
  );
}

export function selectLmStudioReleaseAsset(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): SelectedLmStudioReleaseAsset {
  const archiveType = platform === "win32" ? "zip" : "tgz";
  const extension = archiveType === "zip" ? ".zip" : ".tar.gz";
  const releaseName = `${LLMSTER_VERSION}-${releasePlatform(platform, arch)}.full`;
  const name = `${releaseName}${extension}`;
  const checksumName = `${releaseName}${platform === "win32" ? extension : ""}.sha512`;
  return {
    version: LLMSTER_VERSION,
    name,
    url: `${DOWNLOAD_ROOT}/${name}`,
    checksumUrl: `${DOWNLOAD_ROOT}/${checksumName}`,
    archiveType,
  };
}

async function defaultRunCommand(
  command: string,
  args: ReadonlyArray<string>,
  options?: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv },
): Promise<{ readonly stdout: string }> {
  const result = await execFileAsync(command, [...args], {
    cwd: options?.cwd,
    env: options?.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout: result.stdout };
}

async function fetchChecksum(fetchImpl: LocalModelFetch, url: string): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { Accept: "text/plain", "User-Agent": "DJL-local-model-installer" },
    redirect: "follow",
  });
  const finalUrl = new URL(response.url || url);
  if (
    !response.ok ||
    finalUrl.protocol !== "https:" ||
    finalUrl.hostname !== "llmster.lmstudio.ai"
  ) {
    throw new Error("LM Studio did not provide a trusted SHA-512 checksum for llmster.");
  }
  const checksum = (await response.text()).trim().split(/\s+/)[0] ?? "";
  if (!/^[a-f0-9]{128}$/i.test(checksum)) {
    throw new Error("LM Studio did not provide a valid SHA-512 checksum for llmster.");
  }
  return checksum.toLowerCase();
}

async function relocateBootstrapMetadata(
  homeDir: string,
  platform: NodeJS.Platform,
): Promise<void> {
  const studioHome = join(homeDir, ".lmstudio");
  const installDir = join(studioHome, "llmster", LLMSTER_VERSION);
  const executable = platform === "win32" ? "llmster.exe" : "llmster";
  await writeFile(join(homeDir, ".lmstudio-home-pointer"), studioHome, { mode: 0o600 });
  await writeFile(
    join(studioHome, ".internal", "llmster-install-location.json"),
    JSON.stringify(
      {
        path: join(installDir, executable),
        argv: [],
        cwd: installDir,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

async function downloadArchive(
  fetchImpl: LocalModelFetch,
  asset: SelectedLmStudioReleaseAsset,
  archivePath: string,
  expectedSha512: string,
  onProgress: LmStudioInstallOptions["onProgress"],
): Promise<number> {
  const controller = new AbortController();
  let idleTimeout: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  resetTimeout();
  const response = await fetchImpl(asset.url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "DJL-local-model-installer" },
    redirect: "follow",
    signal: controller.signal,
  });
  const finalUrl = new URL(response.url || asset.url);
  if (
    !response.ok ||
    !response.body ||
    finalUrl.protocol !== "https:" ||
    finalUrl.hostname !== "llmster.lmstudio.ai"
  ) {
    clearTimeout(idleTimeout);
    throw new Error("The llmster download did not come from LM Studio's trusted server.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  const totalBytes =
    Number.isFinite(contentLength) && contentLength > 0 ? Math.floor(contentLength) : null;
  if (totalBytes !== null && totalBytes > MAX_ARCHIVE_BYTES) {
    clearTimeout(idleTimeout);
    throw new Error("The llmster download is larger than DJL's safety limit.");
  }
  const file = await open(archivePath, "wx", 0o600);
  const reader = response.body.getReader();
  const hash = createHash("sha512");
  let downloadedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      resetTimeout();
      if (done) break;
      downloadedBytes += value.byteLength;
      if (downloadedBytes > MAX_ARCHIVE_BYTES) {
        throw new Error("The llmster download exceeded DJL's safety limit.");
      }
      hash.update(value);
      let writeOffset = 0;
      while (writeOffset < value.byteLength) {
        const { bytesWritten } = await file.write(
          value,
          writeOffset,
          value.byteLength - writeOffset,
        );
        if (bytesWritten <= 0) {
          throw new Error("DJL could not finish writing the llmster download to disk.");
        }
        writeOffset += bytesWritten;
      }
      await onProgress({
        state: "downloading",
        downloadedBytes,
        totalBytes,
        message: "Downloading the LM Studio local engine…",
      });
    }
  } finally {
    clearTimeout(idleTimeout);
    await file.close();
  }
  await onProgress({
    state: "verifying",
    downloadedBytes,
    totalBytes: totalBytes ?? downloadedBytes,
    message: "Verifying the LM Studio local engine…",
  });
  if (hash.digest("hex") !== expectedSha512) {
    throw new Error("The llmster download failed its SHA-512 integrity check.");
  }
  return downloadedBytes;
}

export async function installLmStudioRuntime(
  options: LmStudioInstallOptions,
): Promise<LmStudioInstallResult> {
  const fetchImpl = options.fetch ?? fetch;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const asset = selectLmStudioReleaseAsset(platform, arch);
  const checksum = await fetchChecksum(fetchImpl, asset.checksumUrl);
  const runtimeRoot = join(options.stateDir, "local-models", "runtimes", "lmstudio");
  const nonce = randomUUID();
  const archivePath = join(runtimeRoot, `.download-${nonce}-${basename(asset.name)}`);
  const extractedPath = join(runtimeRoot, `.extracted-${nonce}`);
  const stagingHome = join(runtimeRoot, `.home-${nonce}`);
  const currentHome = join(runtimeRoot, "current");
  const backupHome = join(runtimeRoot, `.backup-${nonce}`);
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  let committed = false;
  try {
    const downloadedBytes = await downloadArchive(
      fetchImpl,
      asset,
      archivePath,
      checksum,
      options.onProgress,
    );
    await options.onProgress({
      state: "installing",
      downloadedBytes,
      totalBytes: downloadedBytes,
      message: "Installing the LM Studio local engine…",
    });
    await mkdir(extractedPath, { recursive: true, mode: 0o700 });
    await mkdir(stagingHome, { recursive: true, mode: 0o700 });
    const listed = await runCommand("tar", ["-tf", archivePath]);
    validateArchiveEntries(listed.stdout.split(/\r?\n/));
    await runCommand("tar", ["-xf", archivePath, "-C", extractedPath]);
    await validateExtractedSymlinks(extractedPath);
    const bootstrap = join(extractedPath, platform === "win32" ? "llmster.exe" : "llmster");
    await access(bootstrap, fsConstants.F_OK);
    if (platform !== "win32") await chmod(bootstrap, 0o700);
    const env = {
      ...options.env,
      HOME: stagingHome,
      USERPROFILE: stagingHome,
      LMS_BOOTSTRAP_INSTALL_SH: "1",
      LMS_NO_MODIFY_PATH: "1",
    };
    await runCommand(bootstrap, ["bootstrap"], { cwd: extractedPath, env });
    const command = join(stagingHome, ".lmstudio", "bin", platform === "win32" ? "lms.exe" : "lms");
    await access(command, fsConstants.F_OK);
    if (platform !== "win32") await chmod(command, 0o700);
    let hadCurrent = false;
    try {
      await access(currentHome, fsConstants.F_OK);
      hadCurrent = true;
      await rename(currentHome, backupHome);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    try {
      await rename(stagingHome, currentHome);
      await relocateBootstrapMetadata(currentHome, platform);
    } catch (cause) {
      await rm(currentHome, { recursive: true, force: true });
      if (hadCurrent) await rename(backupHome, currentHome);
      throw cause;
    }
    committed = true;
    await rm(backupHome, { recursive: true, force: true });
    return {
      command: join(currentHome, ".lmstudio", "bin", platform === "win32" ? "lms.exe" : "lms"),
      version: asset.version,
      homeDir: currentHome,
    };
  } finally {
    await Promise.all([
      rm(archivePath, { force: true }),
      rm(extractedPath, { recursive: true, force: true }),
      rm(stagingHome, { recursive: true, force: true }),
      committed ? rm(backupHome, { recursive: true, force: true }) : Promise.resolve(),
    ]);
  }
}
