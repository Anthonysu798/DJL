import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import {
  DocumentRendererSidecarError,
  DocumentRendererSidecarManager,
  type SignedDocumentRendererReleaseManifest,
} from "./documentRendererSidecar";

const roots: string[] = [];

async function root() {
  const value = path.join(
    process.cwd(),
    ".tmp-renderer-sidecar-tests",
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  roots.push(value);
  await mkdir(value, { recursive: true });
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("DocumentRendererSidecarManager", () => {
  it("verifies and atomically installs a signed renderer archive", async () => {
    const archive = new JSZip();
    archive.file("LibreOffice/program/soffice", "test-renderer");
    const bytes = await archive.generateAsync({ type: "uint8array" });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const release = {
      schemaVersion: 1 as const,
      version: "24.8.5",
      rendererVersion: "libreoffice-24.8.5",
      fontPackVersion: "noto-liberation-1",
      builds: [
        {
          platform: process.platform,
          arch: process.arch,
          url: "https://downloads.example.test/djl-viewer.zip",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
          executablePath: "LibreOffice/program/soffice",
        },
      ],
    };
    const manifest: SignedDocumentRendererReleaseManifest = {
      release,
      signature: sign(null, Buffer.from(JSON.stringify(release)), privateKey).toString("base64"),
    };
    const manager = new DocumentRendererSidecarManager({
      componentRoot: await root(),
      manifestPublicKey: publicKey,
      fetch: async () => new Response(bytes),
      runCommand: async () => ({ code: 0, stdout: "LibreOffice 24.8.5", stderr: "" }),
    });

    const installed = await manager.install(manifest);
    expect(installed.state).toBe("ready");
    expect((await manager.renderer()).version).toBe("libreoffice-24.8.5");
  });

  it("rejects an archive whose bytes do not match the signed hash", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const release = {
      schemaVersion: 1 as const,
      version: "24.8.5",
      rendererVersion: "libreoffice-24.8.5",
      fontPackVersion: "noto-liberation-1",
      builds: [
        {
          platform: process.platform,
          arch: process.arch,
          url: "https://downloads.example.test/djl-viewer.zip",
          sha256: "a".repeat(64),
          sizeBytes: 4,
          executablePath: "LibreOffice/program/soffice",
        },
      ],
    };
    const manifest: SignedDocumentRendererReleaseManifest = {
      release,
      signature: sign(null, Buffer.from(JSON.stringify(release)), privateKey).toString("base64"),
    };
    const manager = new DocumentRendererSidecarManager({
      componentRoot: await root(),
      manifestPublicKey: publicKey,
      fetch: async () => new Response("nope"),
    });

    await expect(manager.install(manifest)).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(await manager.status()).toEqual({ state: "not_installed" });
  });

  it("rejects traversal in the signed renderer archive", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const manager = new DocumentRendererSidecarManager({
      componentRoot: await root(),
      manifestPublicKey: publicKey,
    });

    await expect(
      manager.installArchiveForTests({
        bytes: Buffer.from("not-a-zip"),
        executablePath: "../soffice",
        version: "24.8.5",
        rendererVersion: "libreoffice-24.8.5",
        fontPackVersion: "noto-liberation-1",
      }),
    ).rejects.toBeInstanceOf(DocumentRendererSidecarError);
  });
});
