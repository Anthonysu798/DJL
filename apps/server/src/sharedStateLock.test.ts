import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireSharedStateLock, SharedStateInUseError } from "@synara/shared/sharedStateLock";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "djl-shared-lock-"));
  roots.push(root);
  return root;
}

describe("shared DJL state lock", () => {
  it("rejects a second live owner and releases only its own token", async () => {
    const root = await makeRoot();
    const first = await acquireSharedStateLock(root, { pid: process.pid });

    await expect(acquireSharedStateLock(root, { pid: process.pid })).rejects.toBeInstanceOf(
      SharedStateInUseError,
    );
    await first.release();
    const second = await acquireSharedStateLock(root, { pid: process.pid });
    await second.release();
  });

  it("recovers a stale lock whose process is no longer alive", async () => {
    const root = await makeRoot();
    const lockPath = path.join(root, ".runtime.lock");
    await writeFile(
      lockPath,
      JSON.stringify({ version: 1, pid: 999_999_999, token: "stale", startedAt: "old" }),
    );

    const lock = await acquireSharedStateLock(root, {
      pid: process.pid,
      isProcessAlive: () => false,
    });
    expect(JSON.parse(await readFile(lockPath, "utf8")).token).not.toBe("stale");
    await lock.release();
  });
});
