// Local, restart-safe Office/PDF rendering with sanitized inputs and a bounded PDF cache.

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  STREAMING_UPLOAD_MAX_FILE_BYTES,
  type DocumentRenderJobState,
  type DocumentRenderEvent,
  type ProjectId,
  type RenderedDocumentPreview,
  type ThreadId,
  type WorkGetDocumentRenderResult,
  type WorkRequestDocumentRenderResult,
} from "@synara/contracts";
import JSZip from "jszip";

import { validateOfficeArchive } from "./documentExtraction";
import { issueDocumentPreviewGrant, registerDocumentPreview } from "./documentPreviewFiles";

const CONVERSION_SETTINGS_VERSION = "1";
const FONT_PACK_VERSION = "noto-liberation-1";
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const CONVERSION_TIMEOUT_MS = 5 * 60_000;

export class DocumentRendererError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "not_installed"
      | "unsupported_format"
      | "invalid_source"
      | "conversion_failed"
      | "cancelled",
  ) {
    super(message);
    this.name = "DocumentRendererError";
  }
}

export interface LibreOfficeCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type LibreOfficeCommandRunner = (
  binaryPath: string,
  args: ReadonlyArray<string>,
  options: { readonly timeoutMs: number; readonly signal: AbortSignal },
) => Promise<LibreOfficeCommandResult>;

interface RendererBinary {
  readonly binaryPath: string;
  readonly version: string;
}

interface PersistedRenderJob {
  readonly schemaVersion: 1;
  readonly renderId: string;
  readonly threadId: string;
  readonly projectId?: string;
  readonly sourcePath: string;
  readonly originalName: string;
  readonly sourceType: "docx" | "pptx" | "pdf";
  readonly presentationMode: "document" | "slides";
  readonly cacheKey: string;
  readonly sourceHash: string;
  readonly rendererVersion: string;
  readonly state: DocumentRenderJobState;
  readonly pageCount?: number;
  readonly byteSize?: number;
  readonly outputPath?: string;
  readonly warnings: ReadonlyArray<string>;
  readonly error?: string;
  readonly updatedAt: string;
}

export interface DocumentRenderManagerOptions {
  readonly stateRoot: string;
  readonly renderer: () => Promise<RendererBinary>;
  readonly runCommand?: LibreOfficeCommandRunner;
  readonly now?: () => Date;
  readonly onEvent?: (event: DocumentRenderEvent) => void | Promise<void>;
}

function defaultCommandRunner(
  binaryPath: string,
  args: ReadonlyArray<string>,
  options: { readonly timeoutMs: number; readonly signal: AbortSignal },
): Promise<LibreOfficeCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "", HOME: "", LANG: "C.UTF-8" },
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error, result?: LibreOfficeCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(new DocumentRendererError("Document rendering was cancelled.", "cancelled"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("LibreOffice conversion timed out."));
    }, options.timeoutMs);
    options.signal.addEventListener("abort", abort, { once: true });
    for (const [stream, chunks] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ] as const) {
      stream.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(new Error("LibreOffice produced too much command output."));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
    }
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

async function countPdfPages(filePath: string): Promise<number> {
  const bytes = await readFile(filePath);
  if (bytes.byteLength > MAX_OUTPUT_BYTES || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new DocumentRendererError("The renderer produced an invalid PDF.", "conversion_failed");
  }
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const document = await task.promise;
  try {
    if (document.numPages < 1 || document.numPages > 5_000) {
      throw new DocumentRendererError(
        "The rendered document has an unsupported page count.",
        "conversion_failed",
      );
    }
    return document.numPages;
  } finally {
    await task.destroy();
  }
}

async function sanitizeOfficeInput(
  source: Buffer,
  destination: string,
): Promise<ReadonlyArray<string>> {
  validateOfficeArchive(source);
  const zip = await JSZip.loadAsync(source, { checkCRC32: true, createFolders: false });
  let removedExternalRelationships = false;
  const relationshipNames = Object.keys(zip.files).filter((name) => name.endsWith(".rels"));
  for (const name of relationshipNames) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("text");
    const sanitized = xml.replace(
      /<Relationship\b(?=[^>]*\bTargetMode\s*=\s*["']External["'])[^>]*(?:\/>|>[\s\S]*?<\/Relationship>)/gi,
      "",
    );
    if (sanitized !== xml) {
      removedExternalRelationships = true;
      zip.file(name, sanitized);
    }
  }
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  validateOfficeArchive(bytes);
  await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  return removedExternalRelationships
    ? ["External Office relationships were removed before rendering."]
    : [];
}

export class DocumentRenderManager {
  readonly #stateRoot: string;
  readonly #jobsRoot: string;
  readonly #cacheRoot: string;
  readonly #temporaryRoot: string;
  readonly #renderer: () => Promise<RendererBinary>;
  readonly #runCommand: LibreOfficeCommandRunner;
  readonly #now: () => Date;
  readonly #onEvent: (event: DocumentRenderEvent) => void | Promise<void>;
  readonly #abortControllers = new Map<string, AbortController>();
  readonly #queue: Array<() => void> = [];
  #activeConversions = 0;

  constructor(options: DocumentRenderManagerOptions) {
    this.#stateRoot = path.resolve(options.stateRoot);
    this.#jobsRoot = path.join(this.#stateRoot, "jobs");
    this.#cacheRoot = path.join(this.#stateRoot, "cache");
    this.#temporaryRoot = path.join(this.#stateRoot, "tmp");
    this.#renderer = options.renderer;
    this.#runCommand = options.runCommand ?? defaultCommandRunner;
    this.#now = options.now ?? (() => new Date());
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  async #ensureDirectories(): Promise<void> {
    await Promise.all(
      [this.#jobsRoot, this.#cacheRoot, this.#temporaryRoot].map((directory) =>
        mkdir(directory, { recursive: true, mode: 0o700 }),
      ),
    );
  }

  #jobPath(renderId: string): string {
    return path.join(this.#jobsRoot, `${renderId}.json`);
  }

  async #writeJob(job: PersistedRenderJob): Promise<void> {
    await this.#ensureDirectories();
    const target = this.#jobPath(job.renderId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(job), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  }

  async #readJob(renderId: string): Promise<PersistedRenderJob | null> {
    if (!/^[a-z0-9_-]{1,128}$/i.test(renderId)) return null;
    try {
      const job = JSON.parse(await readFile(this.#jobPath(renderId), "utf8")) as PersistedRenderJob;
      if (job.schemaVersion !== 1 || job.renderId !== renderId) return null;
      return job;
    } catch {
      return null;
    }
  }

  async #withConversionSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#activeConversions >= 2) {
      await new Promise<void>((resolve) => this.#queue.push(resolve));
    }
    this.#activeConversions += 1;
    try {
      return await operation();
    } finally {
      this.#activeConversions -= 1;
      this.#queue.shift()?.();
    }
  }

  async requestRender(input: {
    readonly threadId: ThreadId;
    readonly projectId?: ProjectId;
    readonly filePath: string;
  }): Promise<WorkRequestDocumentRenderResult> {
    await this.#ensureDirectories();
    const inputInfo = await lstat(input.filePath).catch(() => null);
    if (!inputInfo?.isFile() || inputInfo.isSymbolicLink()) {
      throw new DocumentRendererError(
        "The requested document is not a regular file.",
        "invalid_source",
      );
    }
    if (inputInfo.size > STREAMING_UPLOAD_MAX_FILE_BYTES) {
      throw new DocumentRendererError(
        "The requested document exceeds the 100 MiB Work limit.",
        "invalid_source",
      );
    }
    const sourcePath = await realpath(input.filePath);
    const extension = path.extname(sourcePath).toLowerCase();
    const sourceType =
      extension === ".docx"
        ? "docx"
        : extension === ".pptx"
          ? "pptx"
          : extension === ".pdf"
            ? "pdf"
            : null;
    if (!sourceType) {
      throw new DocumentRendererError(
        "Only DOCX, PPTX, and PDF files can use the native viewer.",
        "unsupported_format",
      );
    }
    const source = await readFile(sourcePath);
    const sourceHash = createHash("sha256").update(source).digest("hex");
    const renderer =
      sourceType === "pdf"
        ? { binaryPath: "", version: "pdfjs-5.7.284" }
        : await this.#renderer().catch((cause) => {
            throw new DocumentRendererError(
              cause instanceof Error ? cause.message : "Install the local document viewer.",
              "not_installed",
            );
          });
    const cacheKey = createHash("sha256")
      .update(
        `${sourceHash}\0${renderer.version}\0${CONVERSION_SETTINGS_VERSION}\0${FONT_PACK_VERSION}`,
      )
      .digest("hex");
    const renderId = `render-${createHash("sha256")
      .update(`${input.threadId}\0${cacheKey}`)
      .digest("hex")}`;
    const existing = await this.#readJob(renderId);
    if (existing) {
      if (existing.state === "queued" || existing.state === "rendering") {
        void this.#resumeJob(existing).catch(() => undefined);
      }
      return { renderId, state: existing.state };
    }

    const cachePath = path.join(this.#cacheRoot, `${cacheKey}.pdf`);
    const cachedInfo = await stat(cachePath).catch(() => null);
    const baseJob: PersistedRenderJob = {
      schemaVersion: 1,
      renderId,
      threadId: input.threadId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      sourcePath,
      originalName: path.basename(sourcePath),
      sourceType,
      presentationMode: sourceType === "pptx" ? "slides" : "document",
      cacheKey,
      sourceHash,
      rendererVersion: renderer.version,
      state: "queued",
      warnings: [],
      updatedAt: this.#now().toISOString(),
    };
    if (cachedInfo?.isFile() && cachedInfo.size <= MAX_OUTPUT_BYTES) {
      try {
        const pageCount = await countPdfPages(cachePath);
        const ready = {
          ...baseJob,
          state: "ready" as const,
          pageCount,
          byteSize: cachedInfo.size,
          outputPath: cachePath,
        };
        await this.#writeJob(ready);
        await registerDocumentPreview(renderId, cachePath);
        return { renderId, state: "ready" };
      } catch {
        await rm(cachePath, { force: true });
      }
    }
    await this.#writeJob(baseJob);
    await this.#publish({
      threadId: input.threadId,
      renderId,
      state: "queued",
      progress: 0,
      message: "Document preview queued",
    });
    const controller = new AbortController();
    this.#abortControllers.set(renderId, controller);
    void this.#execute(baseJob, renderer, source, controller.signal).catch(() => undefined);
    return { renderId, state: "queued" };
  }

  async #execute(
    job: PersistedRenderJob,
    renderer: RendererBinary,
    source: Buffer,
    signal: AbortSignal,
  ): Promise<void> {
    const rendering: PersistedRenderJob = {
      ...job,
      state: "rendering",
      updatedAt: this.#now().toISOString(),
    };
    await this.#writeJob(rendering);
    await this.#publish({
      threadId: job.threadId as ThreadId,
      renderId: job.renderId,
      state: "rendering",
      progress: 0.1,
      message: "Rendering document pages",
    });
    const jobRoot = path.join(this.#temporaryRoot, `${job.renderId}-${randomUUID()}`);
    try {
      await this.#withConversionSlot(async () => {
        if (signal.aborted)
          throw new DocumentRendererError("Rendering was cancelled.", "cancelled");
        await mkdir(jobRoot, { recursive: true, mode: 0o700 });
        const outputPath = path.join(this.#cacheRoot, `${job.cacheKey}.pdf`);
        let warnings: ReadonlyArray<string> = [];
        if (job.sourceType === "pdf") {
          const temporaryOutput = `${outputPath}.${randomUUID()}.tmp`;
          await writeFile(temporaryOutput, source, { flag: "wx", mode: 0o600 });
          await rename(temporaryOutput, outputPath);
        } else {
          const inputPath = path.join(jobRoot, `source.${job.sourceType}`);
          warnings = await sanitizeOfficeInput(source, inputPath);
          const outputDir = path.join(jobRoot, "output");
          const profileDir = path.join(jobRoot, "profile");
          await Promise.all([
            mkdir(outputDir, { recursive: true, mode: 0o700 }),
            mkdir(profileDir, { recursive: true, mode: 0o700 }),
          ]);
          const profileUrl = new URL(
            `file://${profileDir.endsWith("/") ? profileDir : `${profileDir}/`}`,
          ).href;
          const result = await this.#runCommand(
            renderer.binaryPath,
            [
              "--headless",
              "--nologo",
              "--nodefault",
              "--nofirststartwizard",
              "--norestore",
              "--nolockcheck",
              `-env:UserInstallation=${profileUrl}`,
              "--convert-to",
              "pdf",
              "--outdir",
              outputDir,
              inputPath,
            ],
            { timeoutMs: CONVERSION_TIMEOUT_MS, signal },
          );
          if (result.code !== 0) {
            throw new DocumentRendererError(
              `LibreOffice conversion failed: ${result.stderr.slice(0, 2_000) || `exit ${result.code}`}`,
              "conversion_failed",
            );
          }
          const convertedPath = path.join(outputDir, "source.pdf");
          const convertedInfo = await stat(convertedPath).catch(() => null);
          if (!convertedInfo?.isFile() || convertedInfo.size > MAX_OUTPUT_BYTES) {
            throw new DocumentRendererError(
              "LibreOffice did not produce a bounded PDF preview.",
              "conversion_failed",
            );
          }
          await rename(convertedPath, outputPath).catch(async () => {
            await writeFile(outputPath, await readFile(convertedPath), { mode: 0o600 });
          });
        }
        const outputInfo = await stat(outputPath);
        const pageCount = await countPdfPages(outputPath);
        const ready: PersistedRenderJob = {
          ...rendering,
          state: "ready",
          pageCount,
          byteSize: outputInfo.size,
          outputPath,
          warnings,
          updatedAt: this.#now().toISOString(),
        };
        await this.#writeJob(ready);
        await registerDocumentPreview(job.renderId, outputPath);
        await this.#publish({
          threadId: job.threadId as ThreadId,
          renderId: job.renderId,
          state: "ready",
          progress: 1,
          message: "Document preview ready",
        });
      });
    } catch (cause) {
      const cancelled =
        signal.aborted || (cause instanceof DocumentRendererError && cause.code === "cancelled");
      await this.#writeJob({
        ...rendering,
        state: cancelled ? "cancelled" : "failed",
        error:
          cause instanceof Error ? cause.message.slice(0, 2_000) : String(cause).slice(0, 2_000),
        updatedAt: this.#now().toISOString(),
      });
      await this.#publish({
        threadId: job.threadId as ThreadId,
        renderId: job.renderId,
        state: cancelled ? "cancelled" : "failed",
        message: cancelled ? "Document rendering cancelled" : "Document rendering failed",
      });
    } finally {
      this.#abortControllers.delete(job.renderId);
      await rm(jobRoot, { recursive: true, force: true }).catch(() => undefined);
      void this.#pruneCache().catch(() => undefined);
    }
  }

  async getRender(input: {
    readonly threadId: ThreadId;
    readonly renderId: string;
  }): Promise<WorkGetDocumentRenderResult> {
    const job = await this.#readJob(input.renderId);
    if (!job || job.threadId !== input.threadId) {
      throw new DocumentRendererError("The requested document render was not found.", "not_found");
    }
    if (job.state === "queued" || job.state === "rendering") {
      void this.#resumeJob(job).catch(() => undefined);
    }
    if (job.state !== "ready" || !job.outputPath || !job.pageCount || job.byteSize === undefined) {
      return { state: job.state, ...(job.error ? { error: job.error } : {}) };
    }
    const info = await stat(job.outputPath).catch(() => null);
    if (!info?.isFile() || info.size !== job.byteSize) {
      return { state: "failed", error: "The cached document preview is unavailable." };
    }
    await registerDocumentPreview(job.renderId, job.outputPath);
    const issued = issueDocumentPreviewGrant(job.renderId);
    const preview: RenderedDocumentPreview = {
      renderId: job.renderId,
      originalName: job.originalName,
      sourceType: job.sourceType,
      presentationMode: job.presentationMode,
      pageCount: job.pageCount,
      byteSize: job.byteSize,
      previewUrl: `/api/work/document-previews/${encodeURIComponent(job.renderId)}`,
      previewGrant: issued.grant,
      grantExpiresAt: issued.expiresAt,
      rendererVersion: job.rendererVersion,
      warnings: [...job.warnings],
    };
    return { state: "ready", preview };
  }

  async #resumeJob(job: PersistedRenderJob): Promise<void> {
    if (this.#abortControllers.has(job.renderId)) return;
    try {
      const source = await readFile(job.sourcePath);
      const sourceHash = createHash("sha256").update(source).digest("hex");
      if (sourceHash !== job.sourceHash) {
        throw new DocumentRendererError(
          "The source document changed before rendering could resume.",
          "invalid_source",
        );
      }
      const renderer =
        job.sourceType === "pdf"
          ? { binaryPath: "", version: job.rendererVersion }
          : await this.#renderer();
      if (renderer.version !== job.rendererVersion) {
        throw new DocumentRendererError(
          "The document viewer changed before rendering could resume. Request a new preview.",
          "conversion_failed",
        );
      }
      const controller = new AbortController();
      this.#abortControllers.set(job.renderId, controller);
      await this.#execute({ ...job, state: "queued" }, renderer, source, controller.signal);
    } catch (cause) {
      await this.#writeJob({
        ...job,
        state: "failed",
        error:
          cause instanceof Error ? cause.message.slice(0, 2_000) : String(cause).slice(0, 2_000),
        updatedAt: this.#now().toISOString(),
      });
    }
  }

  async cancelRender(input: { readonly threadId: ThreadId; readonly renderId: string }) {
    const job = await this.#readJob(input.renderId);
    if (!job || job.threadId !== input.threadId) {
      throw new DocumentRendererError("The requested document render was not found.", "not_found");
    }
    this.#abortControllers.get(job.renderId)?.abort();
    const cancelled: PersistedRenderJob = {
      ...job,
      state: "cancelled",
      updatedAt: this.#now().toISOString(),
    };
    await this.#writeJob(cancelled);
    await this.#publish({
      threadId: job.threadId as ThreadId,
      renderId: job.renderId,
      state: "cancelled",
      message: "Document rendering cancelled",
    });
    return { renderId: job.renderId, state: "cancelled" as const };
  }

  async #publish(event: DocumentRenderEvent): Promise<void> {
    try {
      await this.#onEvent(event);
    } catch {
      // Rendering must not fail because a transient UI subscriber disappeared.
    }
  }

  async #pruneCache(): Promise<void> {
    const directory = await import("node:fs/promises").then((fs) => fs.readdir(this.#cacheRoot));
    const now = this.#now().getTime();
    const entries = (
      await Promise.all(
        directory
          .filter((name) => name.endsWith(".pdf"))
          .map(async (name) => {
            const filePath = path.join(this.#cacheRoot, name);
            const info = await stat(filePath);
            return { filePath, size: info.size, modifiedAt: info.mtimeMs };
          }),
      )
    ).sort((left, right) => left.modifiedAt - right.modifiedAt);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (now - entry.modifiedAt > CACHE_MAX_AGE_MS || total > MAX_CACHE_BYTES) {
        await rm(entry.filePath, { force: true });
        total -= entry.size;
      }
    }
  }
}
