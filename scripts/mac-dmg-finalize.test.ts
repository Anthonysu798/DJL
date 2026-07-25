import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "@effect/vitest";

import { finalizeMacDmgUpdateMetadata } from "./lib/mac-dmg-finalize.ts";

const MANIFEST = `version: 0.5.2
files:
  - url: DJL-0.5.2-arm64.zip
    sha512: zip-sha
    size: 100
  - url: DJL-0.5.2-arm64.dmg
    sha512: stale-dmg-sha
    size: 200
path: DJL-0.5.2-arm64.zip
sha512: zip-sha
releaseDate: '2026-07-23T12:00:00.000Z'
`;

describe("finalizeMacDmgUpdateMetadata", () => {
  it("regenerates the blockmap and patches final stapled DMG metadata", async () => {
    const stageDistDir = mkdtempSync(join(tmpdir(), "djl-dmg-finalize-"));
    try {
      const dmgPath = join(stageDistDir, "DJL-0.5.2-arm64.dmg");
      const blockmapPath = `${dmgPath}.blockmap`;
      const manifestPath = join(stageDistDir, "latest-mac.yml");
      writeFileSync(dmgPath, "final-stapled-dmg");
      writeFileSync(blockmapPath, "stale-blockmap");
      writeFileSync(manifestPath, MANIFEST);
      const sha512 = createHash("sha512").update("final-stapled-dmg").digest("base64");

      const result = await finalizeMacDmgUpdateMetadata({
        stageDistDir,
        dmgPath,
        buildBlockmap: async (inputPath, outputPath) => {
          assert.equal(inputPath, dmgPath);
          assert.equal(outputPath, blockmapPath);
          writeFileSync(outputPath, "fresh-blockmap");
          return { sha512, size: statSync(inputPath).size };
        },
      });

      assert.equal(readFileSync(blockmapPath, "utf8"), "fresh-blockmap");
      const manifest = readFileSync(manifestPath, "utf8");
      assert.ok(manifest.includes(`sha512: ${sha512}`));
      assert.match(manifest, /size: 17/);
      assert.match(manifest, /sha512: zip-sha/);
      assert.deepStrictEqual(result.updatedManifestPaths, [manifestPath]);
    } finally {
      rmSync(stageDistDir, { recursive: true, force: true });
    }
  });

  it("fails closed when blockmap metadata does not match the final DMG", async () => {
    const stageDistDir = mkdtempSync(join(tmpdir(), "djl-dmg-finalize-"));
    try {
      const dmgPath = join(stageDistDir, "DJL-0.5.2-x64.dmg");
      writeFileSync(dmgPath, "final-stapled-dmg");
      writeFileSync(join(stageDistDir, "latest-mac.yml"), MANIFEST.replaceAll("arm64", "x64"));

      await assert.rejects(
        () =>
          finalizeMacDmgUpdateMetadata({
            stageDistDir,
            dmgPath,
            buildBlockmap: async (_inputPath, outputPath) => {
              writeFileSync(outputPath, "fresh-blockmap");
              return { sha512: "wrong", size: 17 };
            },
          }),
        /blockmap metadata does not match/i,
      );
    } finally {
      rmSync(stageDistDir, { recursive: true, force: true });
    }
  });

  it("uses the pinned app-builder binary for a final blockmap", async () => {
    const stageDistDir = mkdtempSync(join(tmpdir(), "djl-dmg-finalize-"));
    try {
      const dmgPath = join(stageDistDir, "DJL-0.5.2-arm64.dmg");
      writeFileSync(dmgPath, Buffer.alloc(64 * 1024, 7));
      writeFileSync(join(stageDistDir, "latest-mac.yml"), MANIFEST);

      const result = await finalizeMacDmgUpdateMetadata({ stageDistDir, dmgPath });

      assert.equal(statSync(result.blockmapPath).size > 0, true);
      assert.equal(result.size, statSync(dmgPath).size);
      assert.equal(
        result.sha512,
        createHash("sha512").update(readFileSync(dmgPath)).digest("base64"),
      );
    } finally {
      rmSync(stageDistDir, { recursive: true, force: true });
    }
  });
});
