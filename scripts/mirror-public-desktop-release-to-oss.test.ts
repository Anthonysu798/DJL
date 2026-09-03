import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "mirror-public-desktop-release-to-oss.sh");
const version = "9.8.7";
const manifestNames = ["djl-mac.yml", "djl.yml", "latest-mac.yml", "latest.yml"] as const;
const assetNames = [
  `DJL-${version}-arm64.dmg`,
  `DJL-${version}-arm64.dmg.blockmap`,
  `DJL-${version}-arm64.zip`,
  `DJL-${version}-x64.dmg`,
  `DJL-${version}-x64.dmg.blockmap`,
  `DJL-${version}-x64.exe`,
  `DJL-${version}-x64.exe.blockmap`,
  `DJL-${version}-x64.zip`,
  ...manifestNames,
  "SHA256SUMS",
] as const;

function writeReleaseFixture(directory: string): void {
  const sums: string[] = [];
  for (const name of assetNames) {
    if (name === "SHA256SUMS") continue;
    const contents = name.endsWith(".yml")
      ? `version: ${version}\nfiles:\n  - url: DJL-${version}-x64.exe\n    sha512: fixture\n    size: 8\npath: DJL-${version}-x64.exe\nsha512: fixture\nreleaseDate: '2026-09-03T00:00:00.000Z'\n`
      : `fixture:${name}\n`;
    writeFileSync(join(directory, name), contents);
    sums.push(`${createHash("sha256").update(contents).digest("hex")}  ${name}`);
  }
  writeFileSync(join(directory, "SHA256SUMS"), `${sums.join("\n")}\n`);
}

function runMirror(
  workspace: string,
  directory: string,
  phase: "upload-immutable" | "promote-stable",
) {
  const fakeOssutil = join(workspace, "ossutil");
  writeFileSync(
    fakeOssutil,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$OSS_LOG"
command="$1"
target="$2"
if [[ "$command" == "cp" ]]; then
  source="$2"
  target="$3"
  size="$(wc -c < "$source" | tr -d ' ')"
  printf '%s %s\\n' "$size" "$target" >> "$OSS_REMOTE"
elif [[ "$command" == "rm" ]]; then
  awk -v target="$target" '$2 != target' "$OSS_REMOTE" > "$OSS_REMOTE.next"
  mv "$OSS_REMOTE.next" "$OSS_REMOTE"
elif [[ "$command" == "ls" ]]; then
  while read -r size uri; do
    [[ "$uri" == "$target"* ]] || continue
    printf '2026-09-03 00:00:00 +0000 UTC %s Standard ETAG %s\\n' "$size" "$uri"
  done < "$OSS_REMOTE"
fi
`,
  );
  chmodSync(fakeOssutil, 0o755);
  const remote = join(workspace, "remote.txt");
  if (!existsSync(remote)) {
    writeFileSync(remote, "7 oss://djl-china-releases/stable/old-installer.exe\n");
  }
  if (!existsSync(join(workspace, "ossutil.log"))) {
    writeFileSync(join(workspace, "ossutil.log"), "");
  }
  return spawnSync("bash", [script, version, directory, phase], {
    encoding: "utf8",
    env: {
      ...process.env,
      OSS_ACCESS_KEY_ID: "test-key-id",
      OSS_ACCESS_KEY_SECRET: "test-key-secret",
      OSS_BUCKET: "djl-china-releases",
      OSS_ENDPOINT: "https://oss-cn-hongkong.aliyuncs.com",
      OSS_LOG: join(workspace, "ossutil.log"),
      OSS_REGION: "cn-hongkong",
      OSS_REMOTE: remote,
      OSSUTIL_BIN: fakeOssutil,
    },
  });
}

describe("Hong Kong OSS desktop release mirror", () => {
  it("verifies immutable files before promoting only stable updater metadata", () => {
    const workspace = mkdtempSync(join(tmpdir(), "djl-oss-mirror-"));
    const releaseDirectory = join(workspace, "release");
    try {
      mkdirSync(releaseDirectory);
      writeReleaseFixture(releaseDirectory);
      const immutableResult = runMirror(workspace, releaseDirectory, "upload-immutable");
      expect(immutableResult.status, immutableResult.stderr || immutableResult.stdout).toBe(0);
      const immutableOperations = readFileSync(join(workspace, "ossutil.log"), "utf8");
      expect(immutableOperations).not.toContain("/stable/");

      const result = runMirror(workspace, releaseDirectory, "promote-stable");

      expect(result.status, result.stderr || result.stdout).toBe(0);
      const operations = readFileSync(join(workspace, "ossutil.log"), "utf8").trim().split("\n");
      const immutableVerification = operations.indexOf(
        "ls oss://djl-china-releases/releases/9.8.7/ --recursive",
      );
      const firstStableManifest = operations.findIndex((line) =>
        line.includes("oss://djl-china-releases/stable/djl-mac.yml"),
      );
      expect(immutableVerification).toBeGreaterThan(-1);
      expect(firstStableManifest).toBeGreaterThan(immutableVerification);
      expect(operations).toContain("rm oss://djl-china-releases/stable/old-installer.exe --force");
      expect(operations.at(-1)).toBe("ls oss://djl-china-releases/stable/ --recursive");
      expect(operations.some((line) => line.includes("--checksum"))).toBe(false);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  it("rejects an incomplete release before calling OSS", () => {
    const workspace = mkdtempSync(join(tmpdir(), "djl-oss-mirror-missing-"));
    const releaseDirectory = join(workspace, "release");
    try {
      mkdirSync(releaseDirectory);
      writeReleaseFixture(releaseDirectory);
      unlinkSync(join(releaseDirectory, `DJL-${version}-x64.exe`));

      const result = runMirror(workspace, releaseDirectory, "upload-immutable");

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Release asset inventory does not match");
      expect(readFileSync(join(workspace, "ossutil.log"), "utf8")).toBe("");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  it("rejects a checksum mismatch before calling OSS", () => {
    const workspace = mkdtempSync(join(tmpdir(), "djl-oss-mirror-checksum-"));
    const releaseDirectory = join(workspace, "release");
    try {
      mkdirSync(releaseDirectory);
      writeReleaseFixture(releaseDirectory);
      writeFileSync(join(releaseDirectory, `DJL-${version}-arm64.dmg`), "corrupt\n");

      const result = runMirror(workspace, releaseDirectory, "upload-immutable");

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(`DJL-${version}-arm64.dmg`);
      expect(readFileSync(join(workspace, "ossutil.log"), "utf8")).toBe("");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});
