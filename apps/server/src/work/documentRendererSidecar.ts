// Signed, on-demand LibreOffice component lifecycle for native document previews.

import { spawn } from "node:child_process";
import { createHash, randomUUID, verify as verifySignature, type KeyLike } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;

export interface DocumentRendererReleaseBuild {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly executablePath: string;
}

export interface DocumentRendererReleasePayload {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly rendererVersion: string;
  readonly fontPackVersion: string;
  readonly builds: ReadonlyArray<DocumentRendererReleaseBuild>;
}

export interface SignedDocumentRendererReleaseManifest {
  readonly release: DocumentRendererReleasePayload;
  readonly signature: string;
}

interface RendererMetadata {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly rendererVersion: string;
  readonly fontPackVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly archiveSha256: string;
  readonly executableSha256: string;
  readonly executablePath: string;
  readonly installedAt: string;
}

export type DocumentRendererSidecarStatus =
  | { readonly state: "not_installed" }
  | {
      readonly state: "ready" | "unhealthy";
      readonly version: string;
      readonly rendererVersion: string;
      readonly detail?: string;
    };

export class DocumentRendererSidecarError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_installed"
      | "invalid_manifest"
      | "invalid_signature"
      | "unsupported_platform"
      | "download_failed"
      | "hash_mismatch"
      | "unsafe_archive"
      | "unhealthy",
  ) {
    super(message);
    this.name = "DocumentRendererSidecarError";
  }
}

export type RendererHealthCommandRunner = (
  binaryPath: string,
  args: ReadonlyArray<string>,
) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;

type DocumentRendererFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DocumentRendererSidecarManagerOptions {
  readonly componentRoot: string;
  readonly manifestPublicKey: KeyLike;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly fetch?: DocumentRendererFetch;
  readonly runCommand?: RendererHealthCommandRunner;
  readonly now?: () => Date;
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new DocumentRendererSidecarError(
      "The renderer archive contains an unsafe path.",
      "unsafe_archive",
    );
  }
  return normalized;
}

function validateManifest(manifest: SignedDocumentRendererReleaseManifest): void {
  const { release } = manifest;
  if (
    release.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(release.version) ||
    !/^libreoffice-[A-Za-z0-9._+-]+$/i.test(release.rendererVersion) ||
    !/^[A-Za-z0-9._+-]{1,128}$/.test(release.fontPackVersion) ||
    release.builds.length < 1 ||
    release.builds.length > 32 ||
    !/^[A-Za-z0-9+/=_-]+$/.test(manifest.signature)
  ) {
    throw new DocumentRendererSidecarError(
      "The document renderer manifest is invalid.",
      "invalid_manifest",
    );
  }
  for (const build of release.builds) {
    safeRelativePath(build.executablePath);
    if (
      !build.url.startsWith("https://") ||
      !/^[a-f0-9]{64}$/i.test(build.sha256) ||
      !Number.isSafeInteger(build.sizeBytes) ||
      build.sizeBytes <= 0 ||
      build.sizeBytes > MAX_ARCHIVE_BYTES
    ) {
      throw new DocumentRendererSidecarError(
        "The document renderer manifest contains an invalid build.",
        "invalid_manifest",
      );
    }
  }
}

export function verifyDocumentRendererManifest(
  manifest: SignedDocumentRendererReleaseManifest,
  publicKey: KeyLike,
): void {
  validateManifest(manifest);
  if (
    !verifySignature(
      null,
      Buffer.from(JSON.stringify(manifest.release), "utf8"),
      publicKey,
      Buffer.from(manifest.signature, "base64"),
    )
  ) {
    throw new DocumentRendererSidecarError(
      "The document renderer release signature could not be verified.",
      "invalid_signature",
    );
  }
}

function defaultHealthRunner(
  binaryPath: string,
  args: ReadonlyArray<string>,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, code?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else
        resolve({
          code: code ?? -1,
          stdout: Buffer.concat(stdout).toString("utf8").slice(0, 2_000),
          stderr: Buffer.concat(stderr).toString("utf8").slice(0, 2_000),
        });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("LibreOffice health check timed out."));
    }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(undefined, code ?? -1));
  });
}

export class DocumentRendererSidecarManager {
  readonly #componentRoot: string;
  readonly #metadataPath: string;
  readonly #publicKey: KeyLike;
  readonly #platform: NodeJS.Platform;
  readonly #arch: NodeJS.Architecture;
  readonly #fetch: DocumentRendererFetch;
  readonly #runCommand: RendererHealthCommandRunner;
  readonly #now: () => Date;

  constructor(options: DocumentRendererSidecarManagerOptions) {
    this.#componentRoot = path.resolve(options.componentRoot);
    this.#metadataPath = path.join(this.#componentRoot, "current.json");
    this.#publicKey = options.manifestPublicKey;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#runCommand = options.runCommand ?? defaultHealthRunner;
    this.#now = options.now ?? (() => new Date());
  }

  async #readMetadata(): Promise<RendererMetadata | null> {
    try {
      const metadata = JSON.parse(await readFile(this.#metadataPath, "utf8")) as RendererMetadata;
      if (
        metadata.schemaVersion !== 1 ||
        metadata.platform !== this.#platform ||
        metadata.arch !== this.#arch ||
        !metadata.executablePath.startsWith(`${this.#componentRoot}${path.sep}`)
      ) {
        return null;
      }
      return metadata;
    } catch {
      return null;
    }
  }

  async #verifiedMetadata(): Promise<RendererMetadata> {
    const metadata = await this.#readMetadata();
    if (!metadata) {
      throw new DocumentRendererSidecarError(
        "The local document viewer is not installed.",
        "not_installed",
      );
    }
    const executablePath = await realpath(metadata.executablePath).catch(() => null);
    const info = executablePath ? await lstat(executablePath).catch(() => null) : null;
    if (!executablePath || !info?.isFile() || info.isSymbolicLink()) {
      throw new DocumentRendererSidecarError(
        "The local document viewer installation is incomplete.",
        "unhealthy",
      );
    }
    const hash = createHash("sha256")
      .update(await readFile(executablePath))
      .digest("hex");
    if (hash !== metadata.executableSha256) {
      throw new DocumentRendererSidecarError(
        "The local document viewer failed integrity verification.",
        "hash_mismatch",
      );
    }
    return { ...metadata, executablePath };
  }

  async status(): Promise<DocumentRendererSidecarStatus> {
    const metadata = await this.#readMetadata();
    if (!metadata) return { state: "not_installed" };
    try {
      const verified = await this.#verifiedMetadata();
      const result = await this.#runCommand(verified.executablePath, ["--headless", "--version"]);
      if (result.code !== 0) throw new Error(result.stderr || `exit ${result.code}`);
      return {
        state: "ready",
        version: verified.version,
        rendererVersion: verified.rendererVersion,
      };
    } catch (cause) {
      return {
        state: "unhealthy",
        version: metadata.version,
        rendererVersion: metadata.rendererVersion,
        detail: cause instanceof Error ? cause.message.slice(0, 2_000) : String(cause),
      };
    }
  }

  async renderer(): Promise<{ readonly binaryPath: string; readonly version: string }> {
    const metadata = await this.#verifiedMetadata();
    return { binaryPath: metadata.executablePath, version: metadata.rendererVersion };
  }

  async install(
    manifest: SignedDocumentRendererReleaseManifest,
  ): Promise<DocumentRendererSidecarStatus> {
    verifyDocumentRendererManifest(manifest, this.#publicKey);
    const build = manifest.release.builds.find(
      (entry) => entry.platform === this.#platform && entry.arch === this.#arch,
    );
    if (!build) {
      throw new DocumentRendererSidecarError(
        `The document viewer is unavailable for ${this.#platform}/${this.#arch}.`,
        "unsupported_platform",
      );
    }
    const response = await this.#fetch(build.url, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/zip" },
    }).catch((cause) => {
      throw new DocumentRendererSidecarError(
        `Document viewer download failed: ${String(cause)}`,
        "download_failed",
      );
    });
    if (!response.ok || !response.body) {
      throw new DocumentRendererSidecarError(
        `Document viewer download failed with HTTP ${response.status}.`,
        "download_failed",
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== build.sizeBytes || bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new DocumentRendererSidecarError(
        "Document viewer download size does not match the signed manifest.",
        "download_failed",
      );
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== build.sha256.toLowerCase()) {
      throw new DocumentRendererSidecarError(
        "Document viewer archive hash verification failed.",
        "hash_mismatch",
      );
    }
    await this.installArchiveForTests({
      bytes,
      executablePath: build.executablePath,
      version: manifest.release.version,
      rendererVersion: manifest.release.rendererVersion,
      fontPackVersion: manifest.release.fontPackVersion,
      archiveSha256: hash,
    });
    const installed = await this.status();
    if (installed.state !== "ready") {
      throw new DocumentRendererSidecarError(
        installed.state === "unhealthy"
          ? (installed.detail ?? "Document viewer health check failed.")
          : "Document viewer installation did not complete.",
        "unhealthy",
      );
    }
    return installed;
  }

  async installArchiveForTests(input: {
    readonly bytes: Uint8Array;
    readonly executablePath: string;
    readonly version: string;
    readonly rendererVersion: string;
    readonly fontPackVersion: string;
    readonly archiveSha256?: string;
  }): Promise<void> {
    const executableRelativePath = safeRelativePath(input.executablePath);
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(input.bytes, { checkCRC32: true, createFolders: false });
    } catch {
      throw new DocumentRendererSidecarError(
        "The document viewer archive is malformed.",
        "unsafe_archive",
      );
    }
    const files = Object.values(zip.files);
    if (files.length > MAX_ARCHIVE_ENTRIES) {
      throw new DocumentRendererSidecarError(
        "The document viewer archive has too many entries.",
        "unsafe_archive",
      );
    }
    const installRoot = path.join(
      this.#componentRoot,
      "versions",
      input.version,
      `${this.#platform}-${this.#arch}`,
    );
    const temporaryRoot = `${installRoot}.${randomUUID()}.tmp`;
    await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    let totalBytes = 0;
    try {
      for (const entry of files) {
        const relative = safeRelativePath(entry.name);
        if (entry.dir) {
          await mkdir(path.join(temporaryRoot, relative), { recursive: true, mode: 0o700 });
          continue;
        }
        const bytes = Buffer.from(await entry.async("uint8array"));
        totalBytes += bytes.byteLength;
        if (bytes.byteLength > MAX_ENTRY_BYTES || totalBytes > MAX_EXTRACTED_BYTES) {
          throw new DocumentRendererSidecarError(
            "The document viewer archive expands beyond safe limits.",
            "unsafe_archive",
          );
        }
        const destination = path.join(temporaryRoot, relative);
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      }
      const executablePath = path.join(temporaryRoot, executableRelativePath);
      const executableInfo = await stat(executablePath).catch(() => null);
      if (!executableInfo?.isFile()) {
        throw new DocumentRendererSidecarError(
          "The document viewer executable is missing from the archive.",
          "unsafe_archive",
        );
      }
      await chmod(executablePath, 0o700);
      await rm(installRoot, { recursive: true, force: true });
      await mkdir(path.dirname(installRoot), { recursive: true, mode: 0o700 });
      await rename(temporaryRoot, installRoot);
      const finalExecutablePath = path.join(installRoot, executableRelativePath);
      const executableSha256 = createHash("sha256")
        .update(await readFile(finalExecutablePath))
        .digest("hex");
      const metadata: RendererMetadata = {
        schemaVersion: 1,
        version: input.version,
        rendererVersion: input.rendererVersion,
        fontPackVersion: input.fontPackVersion,
        platform: this.#platform,
        arch: this.#arch,
        archiveSha256:
          input.archiveSha256 ?? createHash("sha256").update(input.bytes).digest("hex"),
        executableSha256,
        executablePath: finalExecutablePath,
        installedAt: this.#now().toISOString(),
      };
      await mkdir(this.#componentRoot, { recursive: true, mode: 0o700 });
      const metadataTemp = `${this.#metadataPath}.${randomUUID()}.tmp`;
      await writeFile(metadataTemp, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
      await rename(metadataTemp, this.#metadataPath);
    } catch (cause) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
      throw cause;
    }
  }

  async repair(
    manifest: SignedDocumentRendererReleaseManifest,
  ): Promise<DocumentRendererSidecarStatus> {
    await this.uninstall();
    return this.install(manifest);
  }

  async uninstall(): Promise<void> {
    const info = await lstat(this.#componentRoot).catch(() => null);
    if (info?.isSymbolicLink()) {
      throw new DocumentRendererSidecarError(
        "Refusing to remove a symlinked document viewer root.",
        "unhealthy",
      );
    }
    await rm(this.#componentRoot, { recursive: true, force: true });
  }
}
