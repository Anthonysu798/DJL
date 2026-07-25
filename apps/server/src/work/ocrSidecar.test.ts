import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  OcrSidecarError,
  OcrSidecarManager,
  type OcrReleasePayload,
  type SignedOcrReleaseManifest,
} from "./ocrSidecar.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function signManifest(
  release: OcrReleasePayload,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
): SignedOcrReleaseManifest {
  return {
    release,
    signature: sign(null, Buffer.from(JSON.stringify(release)), privateKey).toString("base64"),
  };
}

describe("OcrSidecarManager", () => {
  it("installs a signed platform build atomically and parses bounded low-confidence OCR", async () => {
    const componentRoot = await mkdtemp(path.join(os.tmpdir(), "djl-ocr-test-"));
    roots.push(componentRoot);
    const binary = Buffer.from("test-sidecar-binary");
    const keys = generateKeyPairSync("ed25519");
    const release: OcrReleasePayload = {
      schemaVersion: 1,
      version: "1.2.3",
      engineVersion: "paddle-pp-ocrv6-medium+pp-structurev3",
      builds: [
        {
          platform: process.platform,
          arch: process.arch,
          url: "https://downloads.example.test/djl-ocr",
          sha256: createHash("sha256").update(binary).digest("hex"),
          sizeBytes: binary.byteLength,
        },
      ],
    };
    const manager = new OcrSidecarManager({
      componentRoot,
      manifestPublicKey: keys.publicKey,
      fetch: (async () => new Response(binary, { status: 200 })) as unknown as typeof fetch,
      runCommand: async (_binaryPath, args) =>
        args[0] === "--health"
          ? { code: 0, stdout: '{"status":"ok"}', stderr: "" }
          : {
              code: 0,
              stdout: JSON.stringify({
                pages: [
                  {
                    page: 1,
                    blocks: [
                      {
                        text: "Invoice total: $42",
                        confidence: 0.61,
                        boundingBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
                      },
                    ],
                  },
                ],
              }),
              stderr: "",
            },
      now: () => new Date("2026-07-13T10:00:00.000Z"),
    });

    await expect(manager.install(signManifest(release, keys.privateKey))).resolves.toMatchObject({
      state: "ready",
      version: "1.2.3",
    });
    const inputPath = path.join(componentRoot, "scan.png");
    await writeFile(inputPath, "fixture");
    await expect(manager.recognize(inputPath)).resolves.toMatchObject({
      blocks: [
        {
          text: "Invoice total: $42",
          confidence: 0.61,
          locator: { page: 1 },
        },
      ],
      lowConfidencePages: [1],
      warnings: ["Low-confidence OCR requires review on pages 1."],
    });
  });

  it("rejects unsigned or hash-mismatched components", async () => {
    const componentRoot = await mkdtemp(path.join(os.tmpdir(), "djl-ocr-test-"));
    roots.push(componentRoot);
    const binary = Buffer.from("tampered");
    const signer = generateKeyPairSync("ed25519");
    const otherSigner = generateKeyPairSync("ed25519");
    const release: OcrReleasePayload = {
      schemaVersion: 1,
      version: "1.0.0",
      engineVersion: "paddle-pp-ocrv6-medium+pp-structurev3",
      builds: [
        {
          platform: process.platform,
          arch: process.arch,
          url: "https://downloads.example.test/djl-ocr",
          sha256: createHash("sha256").update("expected").digest("hex"),
          sizeBytes: binary.byteLength,
        },
      ],
    };
    const manager = new OcrSidecarManager({
      componentRoot,
      manifestPublicKey: signer.publicKey,
      fetch: (async () => new Response(binary, { status: 200 })) as unknown as typeof fetch,
    });

    await expect(
      manager.install(signManifest(release, otherSigner.privateKey)),
    ).rejects.toMatchObject({
      code: "invalid_signature",
    } satisfies Partial<OcrSidecarError>);
    await expect(manager.install(signManifest(release, signer.privateKey))).rejects.toMatchObject({
      code: "hash_mismatch",
    } satisfies Partial<OcrSidecarError>);
  });
});
