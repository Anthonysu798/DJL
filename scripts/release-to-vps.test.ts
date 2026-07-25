import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const releaseScript = readFileSync(resolve(import.meta.dirname, "release-to-vps.sh"), "utf8");

function macBuilderFunction(): string {
  const startMarker = "  build_mac() {\n";
  const endMarker = "\n\n  build_mac arm64\n";
  const start = releaseScript.indexOf(startMarker);
  const end = releaseScript.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Could not locate build_mac in release-to-vps.sh");
  return releaseScript
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^  /, ""))
    .join("\n");
}

describe("manual VPS macOS publisher", () => {
  it("returns on a failed builder before copying or continuing toward publication", () => {
    const workspace = mkdtempSync(join(tmpdir(), "djl-vps-builder-failure-"));
    try {
      const harness = `
set -euo pipefail
workspace="$1"
prepared_dir="$workspace/prepared"
mkdir -p "$prepared_dir"
apple_key="$workspace/AuthKey.p8"
apple_key_id="TESTKEY"
apple_issuer="test-issuer"
update_url="https://downloads.slcor.com/stable"
version="0.5.2"

bun() {
  return 23
}

cp() {
  touch "$workspace/copy-was-called"
  return 0
}

${macBuilderFunction()}

if build_mac x64; then
  touch "$workspace/publish-path-was-reached"
  exit 80
fi

test ! -e "$workspace/copy-was-called"
test ! -e "$workspace/publish-path-was-reached"
`;
      const result = spawnSync("bash", ["-c", harness, "release-to-vps-test", workspace], {
        encoding: "utf8",
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});
