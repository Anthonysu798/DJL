import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalModelSnapshotCache } from "./localModelSnapshotCache";

const temporaryDirectories: string[] = [];

async function makeStateDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "djl-local-model-snapshot-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const snapshot = {
  totalMemoryBytes: 16 * 1024 ** 3,
  freeDiskBytes: 64 * 1024 ** 3,
  recommendedModelId: "granite-4.1-3b",
  runtimes: [],
  recommendations: [],
  installedModels: [],
  runtimeInstallJobs: [],
  installJobs: [],
  setupJobs: [],
} as const;

describe("LocalModelSnapshotCache", () => {
  it("restores the last local runtime snapshot", async () => {
    const stateDir = await makeStateDir();
    await new LocalModelSnapshotCache(stateDir).save(snapshot);

    await expect(new LocalModelSnapshotCache(stateDir).load()).resolves.toEqual(snapshot);
  });

  it("returns no snapshot for corrupt data", async () => {
    const stateDir = await makeStateDir();
    const path = join(stateDir, "local-models", "snapshot-v1.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "[]", "utf8");

    await expect(new LocalModelSnapshotCache(stateDir).load()).resolves.toBeNull();
  });
});
