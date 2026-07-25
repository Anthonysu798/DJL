// FILE: ocrSidecar.ts
// Purpose: Signed, on-demand lifecycle and bounded protocol for DJL document intelligence.

import { spawn } from "node:child_process";
import { createHash, randomUUID, verify as verifySignature, type KeyLike } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { DocumentBlock } from "@synara/contracts";

const MAX_COMPONENT_BYTES = 1024 * 1024 * 1024;
const MAX_OCR_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_OCR_PAGES = 500;
const MAX_OCR_BLOCKS = 50_000;
const MAX_OCR_BLOCK_TEXT = 500_000;
const LOW_CONFIDENCE_THRESHOLD = 0.75;

export interface OcrReleaseBuild {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface OcrReleasePayload {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly engineVersion: string;
  readonly builds: ReadonlyArray<OcrReleaseBuild>;
}

export interface SignedOcrReleaseManifest {
  readonly release: OcrReleasePayload;
  readonly signature: string;
}

export interface OcrSidecarMetadata {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly engineVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly binaryPath: string;
  readonly installedAt: string;
}

export type OcrSidecarStatus =
  | { readonly state: "not_installed" }
  | {
      readonly state: "ready" | "unhealthy";
      readonly version: string;
      readonly engineVersion: string;
      readonly detail?: string;
    };

export interface OcrRecognitionResult {
  readonly blocks: ReadonlyArray<DocumentBlock>;
  readonly warnings: ReadonlyArray<string>;
  readonly engineVersion: string;
  readonly lowConfidencePages: ReadonlyArray<number>;
}

export class OcrSidecarError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_installed"
      | "invalid_manifest"
      | "invalid_signature"
      | "unsupported_platform"
      | "download_failed"
      | "hash_mismatch"
      | "unhealthy"
      | "invalid_output",
  ) {
    super(message);
    this.name = "OcrSidecarError";
  }
}

export interface OcrCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type OcrCommandRunner = (
  binaryPath: string,
  args: ReadonlyArray<string>,
  options: { readonly timeoutMs: number; readonly maxStdoutBytes: number },
) => Promise<OcrCommandResult>;

export interface OcrSidecarManagerOptions {
  readonly componentRoot: string;
  readonly manifestPublicKey: KeyLike;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly fetch?: typeof globalThis.fetch;
  readonly runCommand?: OcrCommandRunner;
  readonly now?: () => Date;
}

function canonicalReleaseBytes(release: OcrReleasePayload): Buffer {
  return Buffer.from(JSON.stringify(release), "utf8");
}

function assertSafeManifest(manifest: SignedOcrReleaseManifest): void {
  const { release } = manifest;
  if (
    release.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(release.version) ||
    !/^paddle-pp-ocrv6-medium\+pp-structurev3(?:[@+][A-Za-z0-9._-]+)?$/i.test(
      release.engineVersion.trim(),
    ) ||
    release.builds.length === 0 ||
    release.builds.length > 32 ||
    !/^[A-Za-z0-9+/=_-]+$/.test(manifest.signature)
  ) {
    throw new OcrSidecarError("The OCR release manifest is invalid.", "invalid_manifest");
  }
  for (const build of release.builds) {
    if (
      !build.url.startsWith("https://") ||
      !/^[a-f0-9]{64}$/i.test(build.sha256) ||
      !Number.isSafeInteger(build.sizeBytes) ||
      build.sizeBytes <= 0 ||
      build.sizeBytes > MAX_COMPONENT_BYTES
    ) {
      throw new OcrSidecarError(
        "The OCR release manifest contains an invalid build.",
        "invalid_manifest",
      );
    }
  }
}

export function verifyOcrReleaseManifest(
  manifest: SignedOcrReleaseManifest,
  publicKey: KeyLike,
): void {
  assertSafeManifest(manifest);
  let signature: Buffer;
  try {
    signature = Buffer.from(manifest.signature, "base64");
  } catch {
    throw new OcrSidecarError("The OCR release signature is malformed.", "invalid_signature");
  }
  if (!verifySignature(null, canonicalReleaseBytes(manifest.release), publicKey, signature)) {
    throw new OcrSidecarError(
      "The OCR release signature could not be verified.",
      "invalid_signature",
    );
  }
}

function defaultCommandRunner(
  binaryPath: string,
  args: ReadonlyArray<string>,
  options: { readonly timeoutMs: number; readonly maxStdoutBytes: number },
): Promise<OcrCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8" },
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    const finish = (error?: Error, result?: OcrCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("The OCR sidecar timed out."));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > options.maxStdoutBytes) {
        child.kill("SIGKILL");
        finish(new Error("The OCR sidecar returned too much data."));
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.reduce((total, entry) => total + entry.byteLength, 0) < 64 * 1024) {
        stderr.push(Buffer.from(chunk));
      }
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) =>
      finish(undefined, {
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OcrSidecarError("The OCR sidecar returned an invalid object.", "invalid_output");
  }
  return value as Record<string, unknown>;
}

function boundedConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function boundedUnit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function parseRecognitionOutput(stdout: string, engineVersion: string): OcrRecognitionResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout);
  } catch {
    throw new OcrSidecarError("The OCR sidecar returned malformed JSON.", "invalid_output");
  }
  const root = asObject(decoded);
  if (!Array.isArray(root.pages) || root.pages.length > MAX_OCR_PAGES) {
    throw new OcrSidecarError(
      "The OCR sidecar returned too many or invalid pages.",
      "invalid_output",
    );
  }
  const blocks: DocumentBlock[] = [];
  const lowConfidencePages = new Set<number>();
  for (const [pageIndex, rawPage] of root.pages.entries()) {
    const page = asObject(rawPage);
    const pageNumber =
      typeof page.page === "number" && Number.isSafeInteger(page.page) && page.page > 0
        ? page.page
        : pageIndex + 1;
    if (!Array.isArray(page.blocks)) {
      throw new OcrSidecarError("The OCR sidecar returned invalid page blocks.", "invalid_output");
    }
    for (const rawBlock of page.blocks) {
      if (blocks.length >= MAX_OCR_BLOCKS) {
        throw new OcrSidecarError("The OCR sidecar returned too many blocks.", "invalid_output");
      }
      const block = asObject(rawBlock);
      const text = typeof block.text === "string" ? block.text.slice(0, MAX_OCR_BLOCK_TEXT) : "";
      if (!text.trim()) continue;
      const confidence = boundedConfidence(block.confidence);
      if (confidence < LOW_CONFIDENCE_THRESHOLD) lowConfidencePages.add(pageNumber);
      const box = block.boundingBox ? asObject(block.boundingBox) : null;
      blocks.push({
        id: `ocr-${pageNumber}-${blocks.length + 1}`,
        kind: "text",
        text,
        locator: {
          page: pageNumber,
          ...(box
            ? {
                boundingBox: {
                  x: boundedUnit(box.x),
                  y: boundedUnit(box.y),
                  width: boundedUnit(box.width),
                  height: boundedUnit(box.height),
                },
              }
            : {}),
        },
        confidence,
      });
    }
  }
  const warnings = Array.isArray(root.warnings)
    ? root.warnings
        .filter((warning): warning is string => typeof warning === "string")
        .map((warning) => warning.slice(0, 2_000))
        .slice(0, 100)
    : [];
  if (lowConfidencePages.size > 0) {
    warnings.push(
      `Low-confidence OCR requires review on pages ${[...lowConfidencePages].join(", ")}.`,
    );
  }
  return {
    blocks,
    warnings,
    engineVersion,
    lowConfidencePages: [...lowConfidencePages],
  };
}

export class OcrSidecarManager {
  readonly #componentRoot: string;
  readonly #metadataPath: string;
  readonly #publicKey: KeyLike;
  readonly #platform: NodeJS.Platform;
  readonly #arch: NodeJS.Architecture;
  readonly #fetch: typeof globalThis.fetch;
  readonly #runCommand: OcrCommandRunner;
  readonly #now: () => Date;

  constructor(options: OcrSidecarManagerOptions) {
    this.#componentRoot = path.resolve(options.componentRoot);
    this.#metadataPath = path.join(this.#componentRoot, "current.json");
    this.#publicKey = options.manifestPublicKey;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#runCommand = options.runCommand ?? defaultCommandRunner;
    this.#now = options.now ?? (() => new Date());
  }

  async #readMetadata(): Promise<OcrSidecarMetadata | null> {
    try {
      const decoded = JSON.parse(await readFile(this.#metadataPath, "utf8")) as OcrSidecarMetadata;
      if (
        decoded.schemaVersion !== 1 ||
        decoded.platform !== this.#platform ||
        decoded.arch !== this.#arch ||
        !decoded.binaryPath.startsWith(`${this.#componentRoot}${path.sep}`) ||
        !/^[a-f0-9]{64}$/i.test(decoded.sha256)
      ) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  async #verifiedMetadata(): Promise<OcrSidecarMetadata> {
    const metadata = await this.#readMetadata();
    if (!metadata) {
      throw new OcrSidecarError("Document intelligence is not installed.", "not_installed");
    }
    const binaryRealPath = await realpath(metadata.binaryPath).catch(() => null);
    const info = binaryRealPath ? await lstat(binaryRealPath).catch(() => null) : null;
    if (!binaryRealPath || !info?.isFile() || info.isSymbolicLink()) {
      throw new OcrSidecarError("The OCR sidecar installation is incomplete.", "unhealthy");
    }
    const bytes = await readFile(binaryRealPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== metadata.sha256 || bytes.byteLength !== metadata.sizeBytes) {
      throw new OcrSidecarError("The OCR sidecar failed integrity verification.", "hash_mismatch");
    }
    return { ...metadata, binaryPath: binaryRealPath };
  }

  async status(): Promise<OcrSidecarStatus> {
    const metadata = await this.#readMetadata();
    if (!metadata) return { state: "not_installed" };
    try {
      const verified = await this.#verifiedMetadata();
      const health = await this.#runCommand(verified.binaryPath, ["--health", "--json"], {
        timeoutMs: 10_000,
        maxStdoutBytes: 1024 * 1024,
      });
      if (health.code !== 0) throw new Error(health.stderr || `exit ${health.code}`);
      return {
        state: "ready",
        version: verified.version,
        engineVersion: verified.engineVersion,
      };
    } catch (error) {
      return {
        state: "unhealthy",
        version: metadata.version,
        engineVersion: metadata.engineVersion,
        detail: error instanceof Error ? error.message.slice(0, 2_000) : String(error),
      };
    }
  }

  async install(manifest: SignedOcrReleaseManifest): Promise<OcrSidecarStatus> {
    verifyOcrReleaseManifest(manifest, this.#publicKey);
    const build = manifest.release.builds.find(
      (candidate) => candidate.platform === this.#platform && candidate.arch === this.#arch,
    );
    if (!build) {
      throw new OcrSidecarError(
        `Document intelligence is unavailable for ${this.#platform}/${this.#arch}.`,
        "unsupported_platform",
      );
    }
    const response = await this.#fetch(build.url, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/octet-stream" },
    }).catch((cause) => {
      throw new OcrSidecarError(
        `OCR component download failed: ${String(cause)}`,
        "download_failed",
      );
    });
    if (!response.ok || !response.body) {
      throw new OcrSidecarError(
        `OCR component download failed with HTTP ${response.status}.`,
        "download_failed",
      );
    }
    const contentLengthHeader = response.headers.get("content-length");
    const declaredLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (
      declaredLength !== null &&
      Number.isFinite(declaredLength) &&
      declaredLength !== build.sizeBytes
    ) {
      throw new OcrSidecarError(
        "OCR component download size does not match the manifest.",
        "download_failed",
      );
    }

    const versionDir = path.join(
      this.#componentRoot,
      "versions",
      manifest.release.version,
      `${this.#platform}-${this.#arch}`,
    );
    await mkdir(versionDir, { recursive: true, mode: 0o700 });
    const binaryPath = path.join(
      versionDir,
      process.platform === "win32" ? "djl-ocr.exe" : "djl-ocr",
    );
    const tempPath = `${binaryPath}.${randomUUID()}.tmp`;
    const digest = createHash("sha256");
    let totalBytes = 0;
    const tempFile = await open(tempPath, "wx", 0o700);
    try {
      try {
        for await (const rawChunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          const chunk = Buffer.from(rawChunk);
          totalBytes += chunk.byteLength;
          if (totalBytes > build.sizeBytes || totalBytes > MAX_COMPONENT_BYTES) {
            throw new OcrSidecarError(
              "OCR component download exceeded its signed size.",
              "download_failed",
            );
          }
          digest.update(chunk);
          await tempFile.write(chunk);
        }
      } finally {
        await tempFile.close();
      }
      if (totalBytes !== build.sizeBytes) {
        throw new OcrSidecarError("OCR component download is incomplete.", "download_failed");
      }
      const actualHash = digest.digest("hex");
      if (actualHash !== build.sha256.toLowerCase()) {
        throw new OcrSidecarError("OCR component hash verification failed.", "hash_mismatch");
      }
      await chmod(tempPath, 0o700);
      await rename(tempPath, binaryPath);
      const metadata: OcrSidecarMetadata = {
        schemaVersion: 1,
        version: manifest.release.version,
        engineVersion: manifest.release.engineVersion,
        platform: this.#platform,
        arch: this.#arch,
        sha256: actualHash,
        sizeBytes: totalBytes,
        binaryPath,
        installedAt: this.#now().toISOString(),
      };
      await mkdir(this.#componentRoot, { recursive: true, mode: 0o700 });
      const metadataTemp = `${this.#metadataPath}.${randomUUID()}.tmp`;
      await writeFile(metadataTemp, JSON.stringify(metadata), { mode: 0o600, flag: "wx" });
      await rename(metadataTemp, this.#metadataPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    const installedStatus = await this.status();
    if (installedStatus.state !== "ready") {
      throw new OcrSidecarError(
        installedStatus.state === "unhealthy"
          ? (installedStatus.detail ?? "The OCR sidecar health check failed.")
          : "The OCR sidecar installation did not complete.",
        "unhealthy",
      );
    }
    return installedStatus;
  }

  async repair(manifest: SignedOcrReleaseManifest): Promise<OcrSidecarStatus> {
    await this.uninstall();
    return this.install(manifest);
  }

  async uninstall(): Promise<void> {
    const rootInfo = await lstat(this.#componentRoot).catch(() => null);
    if (rootInfo?.isSymbolicLink()) {
      throw new OcrSidecarError("Refusing to remove a symlinked OCR component root.", "unhealthy");
    }
    await rm(this.#componentRoot, { recursive: true, force: true });
  }

  async recognize(filePath: string): Promise<OcrRecognitionResult> {
    const metadata = await this.#verifiedMetadata();
    const inputPath = await realpath(filePath).catch(() => null);
    const inputInfo = inputPath ? await stat(inputPath).catch(() => null) : null;
    if (!inputPath || !inputInfo?.isFile()) {
      throw new OcrSidecarError("The OCR input is not a readable file.", "invalid_output");
    }
    const result = await this.#runCommand(
      metadata.binaryPath,
      ["recognize", "--input", inputPath, "--format", "json"],
      { timeoutMs: 5 * 60_000, maxStdoutBytes: MAX_OCR_STDOUT_BYTES },
    );
    if (result.code !== 0) {
      throw new OcrSidecarError(
        `Document intelligence failed: ${result.stderr.slice(0, 2_000) || `exit ${result.code}`}`,
        "unhealthy",
      );
    }
    return parseRecognitionOutput(result.stdout, metadata.engineVersion);
  }
}
