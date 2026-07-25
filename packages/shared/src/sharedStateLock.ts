// FILE: sharedStateLock.ts
// Purpose: Prevents concurrent DJL runtimes from opening the same persistent state.

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

const LOCK_FILE = ".runtime.lock";

interface LockMetadata {
  readonly version: 1;
  readonly pid: number;
  readonly token: string;
  readonly startedAt: string;
}

export class SharedStateInUseError extends Error {
  readonly ownerPid: number | undefined;

  constructor(ownerPid?: number) {
    super(
      ownerPid
        ? `DJL data is already in use by process ${ownerPid}. Close the other DJL window and try again.`
        : "DJL data is already in use. Close the other DJL window and try again.",
    );
    this.name = "SharedStateInUseError";
    this.ownerPid = ownerPid;
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readMetadata(lockPath: string): Promise<LockMetadata | null> {
  try {
    const value: unknown = JSON.parse(await readFile(lockPath, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("pid" in value) ||
      typeof value.pid !== "number" ||
      !("token" in value) ||
      typeof value.token !== "string"
    ) {
      return null;
    }
    return value as LockMetadata;
  } catch {
    return null;
  }
}

export async function acquireSharedStateLock(
  baseDir: string,
  options: {
    readonly pid?: number;
    readonly isProcessAlive?: (pid: number) => boolean;
  } = {},
): Promise<{ readonly release: () => Promise<void> }> {
  const pid = options.pid ?? process.pid;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const token = randomUUID();
  const lockPath = path.join(baseDir, LOCK_FILE);
  const metadata: LockMetadata = {
    version: 1,
    pid,
    token,
    startedAt: new Date().toISOString(),
  };
  await mkdir(baseDir, { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return {
        release: async () => {
          const current = await readMetadata(lockPath);
          if (current?.token === token) await rm(lockPath, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readMetadata(lockPath);
      if (current && isProcessAlive(current.pid)) throw new SharedStateInUseError(current.pid);
      await rm(lockPath, { force: true });
    }
  }

  throw new SharedStateInUseError();
}
