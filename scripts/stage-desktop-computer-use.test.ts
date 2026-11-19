import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMPUTER_USE_APP,
  stageDesktopComputerUse,
  verifyComputerUseArchitecture,
  verifyDesktopComputerUse,
} from "./stage-desktop-computer-use.ts";

it("exposes no native helper resource on unsupported platforms", () => {
  for (const platform of ["linux", "win"]) {
    expect(stageDesktopComputerUse({ platform, arch: "x64", root: "/does-not-exist" })).toBeNull();
  }
});

describe.skipIf(process.platform !== "darwin")("macOS computer-use artifact verification", () => {
  let temporary: string;
  let fixture: string;
  let repoRoot: string;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const otherArch = arch === "arm64" ? "x64" : "arm64";
  const binaryIn = (root: string) =>
    path.join(root, COMPUTER_USE_APP, "Contents/MacOS/DJLComputerUse");
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const verify = (root: string, signed = false) =>
    verifyDesktopComputerUse({ root, arch, repoRoot, signed });
  const variant = (name: string) => {
    const root = path.join(temporary, name);
    cpSync(fixture, root, { recursive: true });
    return root;
  };

  beforeAll(() => {
    temporary = mkdtempSync(path.join(os.tmpdir(), "djl-computer-artifact-test-"));
    fixture = path.join(temporary, "fixture");
    repoRoot = path.join(temporary, "repo");
    const sourceRoot = path.join(repoRoot, "apps/desktop/native/computer-use");
    mkdirSync(path.join(sourceRoot, "Sources"), { recursive: true });
    for (const name of ["Info.plist", "build.sh", "Sources/main.swift"])
      writeFileSync(path.join(sourceRoot, name), name);
    mkdirSync(path.dirname(binaryIn(fixture)), { recursive: true });
    copyFileSync(
      new URL("../apps/desktop/native/computer-use/Info.plist", import.meta.url),
      path.join(fixture, COMPUTER_USE_APP, "Contents/Info.plist"),
    );
    const cSource = path.join(temporary, "fixture.c");
    writeFileSync(cSource, "int main(void) { return 0; }\n");
    execFileSync("xcrun", [
      "clang",
      "-target",
      `${arch === "x64" ? "x86_64" : "arm64"}-apple-macos14.4`,
      cSource,
      "-o",
      binaryIn(fixture),
    ]);
    execFileSync(
      "/usr/bin/codesign",
      ["--force", "--sign", "-", path.join(fixture, COMPUTER_USE_APP)],
      { stdio: "pipe" },
    );
    writeFileSync(
      path.join(fixture, "computer-use-provenance.json"),
      JSON.stringify({
        schemaVersion: 1,
        arch,
        bundleId: "com.djl.computer-use",
        minimumMacOS: "14.4",
        sources: Object.fromEntries(
          ["Info.plist", "build.sh", "Sources/main.swift"].map((name) => [
            name,
            hash(path.join(sourceRoot, name)),
          ]),
        ),
        binarySha256: hash(binaryIn(fixture)),
      }),
    );
  });
  afterAll(() => {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  });

  it("accepts a valid native bundle, executable and source receipt", () => {
    expect(() => verify(fixture)).not.toThrow();
  });
  it("rejects real architecture mismatches despite a misleading directory name", () => {
    const root = variant(otherArch);
    expect(() => verifyComputerUseArchitecture(binaryIn(root), otherArch)).toThrow(
      /architecture mismatch/,
    );
  });
  it("rejects a missing executable", () => {
    const root = variant("missing");
    rmSync(binaryIn(root));
    expect(() => verify(root)).toThrow(/Missing computer-use executable/);
  });
  it("rejects a binary without executable mode", () => {
    const root = variant("mode");
    chmodSync(binaryIn(root), 0o644);
    expect(() => verify(root)).toThrow(/not executable/);
  });
  it("rejects an incorrect bundle ID before relying on its signature", () => {
    const root = variant("identity");
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "CFBundleIdentifier",
      "-string",
      "com.other.helper",
      path.join(root, COMPUTER_USE_APP, "Contents/Info.plist"),
    ]);
    expect(() => verify(root)).toThrow(/Incorrect computer-use bundle identity/);
  });
  it("rejects a bundle deployment target that disagrees with the native binary", () => {
    const root = variant("deployment");
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "LSMinimumSystemVersion",
      "-string",
      "13.0",
      path.join(root, COMPUTER_USE_APP, "Contents/Info.plist"),
    ]);
    expect(() => verify(root)).toThrow(/deployment target/);
  });
  it("rejects source provenance from another checkout", () => {
    const root = variant("source");
    const file = path.join(root, "computer-use-provenance.json");
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    receipt.sources["Sources/main.swift"] = "0".repeat(64);
    writeFileSync(file, JSON.stringify(receipt));
    expect(() => verify(root)).toThrow(/source provenance/);
  });
  it("rejects an ad-hoc signature for a production package", () => {
    expect(() => verify(fixture, true)).toThrow(/Developer ID signature/);
  });
  it("allows a valid packaging re-sign while retaining bundle and source checks", () => {
    const root = variant("resigned");
    execFileSync(
      "/usr/bin/codesign",
      ["--force", "--options", "runtime", "--sign", "-", path.join(root, COMPUTER_USE_APP)],
      { stdio: "pipe" },
    );
    expect(() => verify(root)).toThrow(/executable digest mismatch/);
    expect(() => verifyDesktopComputerUse({ root, arch, repoRoot, packaged: true })).not.toThrow();
  });
  it("still rejects invalid native signatures after packaging", () => {
    const root = variant("tampered");
    appendFileSync(binaryIn(root), "invalid-signature");
    expect(() => verifyDesktopComputerUse({ root, arch, repoRoot, packaged: true })).toThrow();
  });
});
