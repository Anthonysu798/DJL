import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoBundledOpenCode,
  assertNoBundledOpenCodeSource,
} from "./check-no-bundled-opencode";

const roots: string[] = [];
function fixture(path: string, content = ""): string {
  const root = mkdtempSync(join(tmpdir(), "djl-no-bundle-"));
  roots.push(root);
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("installed OpenCode packaging contract", () => {
  it("excludes developer state only in source scans, never in packaged artifacts", () => {
    const root = fixture(".djl/remote/userdata/opencode/opencode.json");
    expect(() => assertNoBundledOpenCodeSource(root)).not.toThrow();
    expect(() => assertNoBundledOpenCode(root)).toThrow("installed separately");
  });

  it.each([".claude", ".codex", ".worktrees", "worktrees"])(
    "excludes %s worktrees only from source scans",
    (directory) => {
      const root = fixture(`${directory}/ios-mobile/vendor/opencode/LICENSE`);
      expect(() => assertNoBundledOpenCodeSource(root)).not.toThrow();
      expect(() => assertNoBundledOpenCode(root)).toThrow("installed separately");
    },
  );
  it("respects a nested Git worktree at a custom path only in source scans", () => {
    const root = fixture("scratch/ios-mobile/vendor/opencode/LICENSE");
    writeFileSync(join(root, "scratch/ios-mobile/.git"), "gitdir: /external/worktree");
    expect(() => assertNoBundledOpenCodeSource(root)).not.toThrow();
    expect(() => assertNoBundledOpenCode(root)).toThrow("installed separately");
  });

  it.each([
    "vendor/opencode/LICENSE",
    "Contents/Resources/opencode/opencode",
    "resources/opencode.exe",
    "node_modules/opencode-darwin-arm64/bin/opencode",
    "scripts/prepare-vendored-opencode.ts",
  ])("rejects %s", (path) => {
    expect(() => assertNoBundledOpenCode(fixture(path))).toThrow("installed separately");
  });
  it("rejects normal CLI dependency installation as a bundling replacement", () => {
    expect(() =>
      assertNoBundledOpenCode(
        fixture("package.json", JSON.stringify({ dependencies: { "opencode-ai": "1.18.29" } })),
      ),
    ).toThrow("dependencies.opencode-ai");
  });
  it("permits the official SDK as an ordinary dependency", () => {
    expect(() =>
      assertNoBundledOpenCode(
        fixture(
          "package.json",
          JSON.stringify({ dependencies: { "@opencode-ai/sdk": "1.18.29" } }),
        ),
      ),
    ).not.toThrow();
  });
});
