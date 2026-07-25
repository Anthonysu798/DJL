import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdtemp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { DetectorModelFile } from "./modelManifest";
import {
  recoverModelInstallState,
  replaceModelDirectoryAtomically,
  syncModelFileForDurability,
  verifyModelFiles,
} from "./modelInstaller";

function manifestFile(relativePath: string, bytes: Uint8Array): DetectorModelFile {
  return {
    path: relativePath,
    url: "https://huggingface.co/example/model",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

describe("AI detector model verification", () => {
  it("tolerates Bun's unsupported Windows fsync result after verification", async () => {
    const syncError = Object.assign(new Error("operation not permitted"), { code: "EPERM" });

    await expect(
      syncModelFileForDurability({ sync: async () => Promise.reject(syncError) }, "win32"),
    ).resolves.toBeUndefined();
  });

  it("does not hide other durability failures", async () => {
    const syncError = Object.assign(new Error("input/output error"), { code: "EIO" });

    await expect(
      syncModelFileForDurability({ sync: async () => Promise.reject(syncError) }, "win32"),
    ).rejects.toBe(syncError);
    await expect(
      syncModelFileForDurability(
        { sync: async () => Promise.reject(Object.assign(new Error("denied"), { code: "EPERM" })) },
        "linux",
      ),
    ).rejects.toThrow("denied");
  });

  it("re-verifies every staged artifact before atomically promoting an install", () => {
    const source = readFileSync(new URL("./modelInstaller.ts", import.meta.url), "utf8");

    expect(source).toContain("verifyModelFiles(partial, manifest.files)");
    expect(source).toContain("syncStagedModelFiles(partial, manifest.files)");
  });

  it("restores the previous verified install when promotion fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "djl-ai-model-swap-"));
    const target = path.join(root, "en");
    await mkdir(target);
    await writeFile(path.join(target, "sentinel"), "previous verified model");

    await expect(
      replaceModelDirectoryAtomically(path.join(root, "missing-partial"), target),
    ).rejects.toThrow();

    await expect(readFile(path.join(target, "sentinel"), "utf8")).resolves.toBe(
      "previous verified model",
    );
  });

  it("keeps a successful promotion successful when stale-backup cleanup fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "djl-ai-model-cleanup-"));
    const target = path.join(root, "en");
    const partial = path.join(root, ".en.partial-ready");
    await mkdir(target);
    await mkdir(partial);
    await writeFile(path.join(target, "sentinel"), "previous verified model");
    await writeFile(path.join(partial, "sentinel"), "new verified model");

    let cleanupAttempted = false;
    await expect(
      replaceModelDirectoryAtomically(partial, target, {
        removeDirectory: async () => {
          cleanupAttempted = true;
          throw new Error("simulated cleanup failure");
        },
      }),
    ).resolves.toBeUndefined();

    expect(cleanupAttempted).toBe(true);
    await expect(readFile(path.join(target, "sentinel"), "utf8")).resolves.toBe(
      "new verified model",
    );
  });

  it("recovers an interrupted directory swap and removes abandoned partial data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "djl-ai-model-recovery-"));
    const target = path.join(root, "en");
    const backup = path.join(root, ".en.backup-interrupted");
    const partial = path.join(root, ".en.partial-interrupted");
    await mkdir(target);
    await writeFile(path.join(target, "sentinel"), "verified model");
    await rename(target, backup);
    await mkdir(partial);
    await writeFile(path.join(partial, "incomplete"), "partial model");

    await recoverModelInstallState(root, "en");

    await expect(readFile(path.join(target, "sentinel"), "utf8")).resolves.toBe("verified model");
    await expect(access(partial)).rejects.toThrow();
  });

  it("detects same-size corruption after installation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "djl-ai-model-"));
    const original = Buffer.from("verified model bytes");
    const file = manifestFile("onnx/model.onnx", original);
    await mkdir(path.join(directory, "onnx"));
    await writeFile(path.join(directory, file.path), original);
    await expect(verifyModelFiles(directory, [file])).resolves.toBe(true);

    await writeFile(path.join(directory, file.path), Buffer.from("corrupted model byte"));
    await expect(verifyModelFiles(directory, [file])).resolves.toBe(false);
  });

  it("rejects manifest paths outside the model directory", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "djl-ai-model-"));
    const bytes = Buffer.from("x");
    await expect(verifyModelFiles(directory, [manifestFile("../escape", bytes)])).resolves.toBe(
      false,
    );
  });
});
