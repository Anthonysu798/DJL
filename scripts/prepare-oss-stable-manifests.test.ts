import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "prepare-oss-stable-manifests.ts");
const version = "9.8.7";

const macManifest = `version: ${version}
files:
  - url: DJL-${version}-arm64.zip
    sha512: arm64zip
    size: 101
  - url: DJL-${version}-arm64.dmg
    sha512: arm64dmg
    size: 102
  - url: DJL-${version}-x64.zip
    sha512: x64zip
    size: 103
  - url: DJL-${version}-x64.dmg
    sha512: x64dmg
    size: 104
releaseDate: '2026-09-03T00:00:00.000Z'
`;

const windowsManifest = `version: ${version}
files:
  - url: DJL-${version}-x64.exe
    sha512: windows
    size: 105
path: DJL-${version}-x64.exe
sha512: windows
releaseDate: '2026-09-03T00:00:00.000Z'
`;

function runFixture(mutator?: (sourceDirectory: string) => void) {
  const workspace = mkdtempSync(join(tmpdir(), "djl-oss-stable-manifests-"));
  const sourceDirectory = join(workspace, "source");
  const outputDirectory = join(workspace, "output");
  mkdirSync(sourceDirectory);
  mkdirSync(outputDirectory);
  for (const name of ["djl-mac.yml", "latest-mac.yml"]) {
    writeFileSync(join(sourceDirectory, name), macManifest);
  }
  for (const name of ["djl.yml", "latest.yml"]) {
    writeFileSync(join(sourceDirectory, name), windowsManifest);
  }
  mutator?.(sourceDirectory);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", script, version, sourceDirectory, outputDirectory],
    { encoding: "utf8" },
  );
  return { outputDirectory, result, workspace };
}

describe("OSS stable updater manifests", () => {
  it("points every updater artifact at the immutable versioned prefix", () => {
    const fixture = runFixture();
    try {
      expect(fixture.result.status, fixture.result.stderr || fixture.result.stdout).toBe(0);
      expect(readFileSync(join(fixture.outputDirectory, "djl-mac.yml"), "utf8")).toBe(
        macManifest.replaceAll(
          `url: DJL-${version}-`,
          `url: ../releases/${version}/DJL-${version}-`,
        ),
      );
      expect(readFileSync(join(fixture.outputDirectory, "djl.yml"), "utf8")).toBe(
        windowsManifest
          .replaceAll(`url: DJL-${version}-`, `url: ../releases/${version}/DJL-${version}-`)
          .replace(`path: DJL-${version}-`, `path: ../releases/${version}/DJL-${version}-`),
      );
      expect(readFileSync(join(fixture.outputDirectory, "latest-mac.yml"), "utf8")).toContain(
        `url: ../releases/${version}/DJL-${version}-arm64.zip`,
      );
      expect(readFileSync(join(fixture.outputDirectory, "latest.yml"), "utf8")).toContain(
        `path: ../releases/${version}/DJL-${version}-x64.exe`,
      );
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects a manifest for a different release version", () => {
    const fixture = runFixture((sourceDirectory) => {
      writeFileSync(join(sourceDirectory, "djl.yml"), windowsManifest.replace(version, "9.8.6"));
    });
    try {
      expect(fixture.result.status).not.toBe(0);
      expect(fixture.result.stderr).toContain("must declare version 9.8.7");
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
    }
  });
});
