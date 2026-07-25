import { describe, expect, it } from "vitest";

import { findPublicLicenseViolations, findPublicSourceViolations } from "./check-public-source";

const file = (path: string, contents = "safe source", size = Buffer.byteLength(contents)) => ({
  path,
  size,
  contents: Buffer.from(contents),
});
const legacyRuntimePrefix = `.${String.fromCharCode(100, 112, 99, 111, 100, 101)}`;
const legacyRuntimeDirectory = `.${String.fromCharCode(116, 51)}`;

describe("public source audit", () => {
  it("accepts ordinary source and retained third-party license files", () => {
    expect(
      findPublicSourceViolations([
        file("apps/desktop/src/main.ts"),
        file("vendor/opencode/LICENSE", "MIT License"),
        file("apps/ios/UPSTREAM_LICENSE", "Apache License"),
      ]),
    ).toEqual([]);
  });

  it("rejects private runtime state, databases, logs, and signing material", () => {
    const violations = findPublicSourceViolations([
      file(".djl/history/session.json"),
      file("tmp/.synara/auth.json"),
      file(`${legacyRuntimePrefix}-cache/state`),
      file(`runtime/${legacyRuntimeDirectory}/history.json`),
      file("apps/landing/.wrangler/state.json"),
      file("data/events.sqlite-wal"),
      file("logs/desktop.log"),
      file("signing/AuthKey_TEST.p8"),
    ]);

    expect(violations.map(({ path }) => path)).toEqual([
      ".djl/history/session.json",
      "tmp/.synara/auth.json",
      `${legacyRuntimePrefix}-cache/state`,
      `runtime/${legacyRuntimeDirectory}/history.json`,
      "apps/landing/.wrangler/state.json",
      "data/events.sqlite-wal",
      "logs/desktop.log",
      "signing/AuthKey_TEST.p8",
    ]);
  });

  it("rejects LFS pointers and files at GitHub's regular-file limit", () => {
    expect(
      findPublicSourceViolations([
        file(
          "large.a",
          [
            "version https://git-lfs.github.com/spec/v1",
            "oid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "size 23000000",
          ].join("\n"),
        ),
        file("too-large.bin", "x", 100_000_000),
      ]).map(({ rule }) => rule),
    ).toEqual(["git-lfs-pointer", "github-file-size"]);
  });

  it("rejects embedded tokens and hard-coded private release infrastructure", () => {
    const personalToken = ["gh", "p_", "A".repeat(40)].join("");
    const privatePath = ["/Users", "maintainer", ".ssh", "djl-release"].join("/");
    const releaseTokenName = ["DJL", "RELEASES", "TOKEN"].join("_");
    const documentationAddress = ["203", "0", "113", "42"].join(".");
    const violations = findPublicSourceViolations([
      file("scripts/release.sh", `host=root@${documentationAddress}\nkey=${privatePath}`),
      file("apps/landing/assets/build.py", "/Users/maintainer/Documents/output"),
      file("workflow.yml", `token: ${personalToken}`),
      file("docs/old.md", releaseTokenName),
    ]);

    expect(violations.map(({ rule }) => rule)).toEqual([
      "hard-coded-release-host",
      "hard-coded-local-secret-path",
      "hard-coded-local-secret-path",
      "embedded-api-key",
      "legacy-cross-repository-token",
    ]);
  });

  it("requires retained project and third-party license markers", () => {
    const licenses = [
      file(
        "LICENSE",
        [
          "Copyright (c) 2026 Emanuele Di Pietro",
          "Copyright (c) 2026 Anthony Su",
          "Permission is hereby granted",
        ].join("\n"),
      ),
      file("THIRD_PARTY_NOTICES.md", "Synara Remodex OpenCode Ghostty"),
      file("apps/ios/UPSTREAM_LICENSE", "Apache License Version 2.0"),
      file("apps/remote-gateway/UPSTREAM_LICENSE", "Apache License Version 2.0"),
      file("vendor/opencode/LICENSE", "MIT License Copyright (c) 2025 opencode"),
      file(
        "apps/ios/DJL/Terminal/Vendor/GHOSTTY_LICENSE",
        "MIT License Mitchell Hashimoto Ghostty contributors",
      ),
    ];

    expect(findPublicLicenseViolations(licenses)).toEqual([]);
    expect(findPublicLicenseViolations(licenses.slice(1))).toEqual([
      expect.objectContaining({ path: "LICENSE", rule: "third-party-license" }),
    ]);
  });
});
