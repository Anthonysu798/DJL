import { constants } from "node:fs";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ComputerActivityGenerationError } from "./computerActivitySummarization";

const unavailable = () => new ComputerActivityGenerationError("provider-unavailable");
const failed = () => new ComputerActivityGenerationError("generation-failed");
function check(signal: AbortSignal) {
  if (signal.aborted) throw failed();
}

// Read through one checked regular-file descriptor. NONBLOCK avoids waiting on a
// FIFO before its type is known; max+1 bounds reads even if the file grows.
export async function readActivityProviderTextFile(
  file: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  check(signal);
  if (
    !path.isAbsolute(file) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 8 * 1024 * 1024
  )
    throw unavailable();
  let opened = false;
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    opened = true;
    let result: string;
    try {
      check(signal);
      const metadata = await handle.stat();
      check(signal);
      if (!metadata.isFile() || metadata.size > maxBytes) throw unavailable();
      const buffer = Buffer.alloc(maxBytes + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        check(signal);
        const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
        check(signal);
        if (!read.bytesRead) break;
        bytes += read.bytesRead;
      }
      if (bytes > maxBytes) throw unavailable();
      result = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes));
    } finally {
      await handle.close();
    }
    check(signal);
    return result;
  } catch (error) {
    check(signal);
    if (!opened && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error instanceof ComputerActivityGenerationError ? error : unavailable();
  }
}

interface ActivityProviderWorkspace {
  readonly root: string;
  readonly home: string;
  readonly work: string;
  readonly codexHome: string;
  readonly config: string;
  readonly data: string;
  readonly cache: string;
  readonly state: string;
  readonly temp: string;
}

// Trusted adapters must nest their process scope inside this scope, so children
// are reaped before removal. This is not a race against an uncooperative consumer.
export async function withActivityProviderWorkspace<T>(
  signal: AbortSignal,
  use: (workspace: ActivityProviderWorkspace) => Promise<T>,
): Promise<T> {
  check(signal);
  let root: string | undefined;
  let problem: ComputerActivityGenerationError | undefined;
  let result: T | undefined;
  try {
    root = await mkdtemp(path.join(os.tmpdir(), "djl-activity-provider-"));
    check(signal);
    const workspace = Object.freeze({
      root,
      home: path.join(root, "home"),
      work: path.join(root, "work"),
      codexHome: path.join(root, "codex"),
      config: path.join(root, "config"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      state: path.join(root, "state"),
      temp: path.join(root, "temp"),
    });
    for (const directory of Object.values(workspace)) {
      if (directory === root) continue;
      check(signal);
      await mkdir(directory, { mode: 0o700 });
    }
    check(signal);
    result = await use(workspace);
    check(signal);
  } catch (error) {
    problem = error instanceof ComputerActivityGenerationError ? error : failed();
  } finally {
    if (root) {
      try {
        await rm(root, { recursive: true, force: true });
      } catch {
        problem = failed();
      }
    }
  }
  check(signal);
  if (problem) throw problem;
  return result as T;
}
