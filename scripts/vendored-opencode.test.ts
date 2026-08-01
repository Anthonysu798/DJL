import { describe, expect, it } from "vitest";

import {
  DJL_OPENCODE_FINGERPRINT_PATHS,
  resolveVendoredOpenCodeCacheBinary,
  resolveVendoredOpenCodeInstallArgs,
} from "./lib/vendored-opencode.ts";

describe("resolveVendoredOpenCodeCacheBinary", () => {
  it("invalidates cached runtimes when DJL session policy patches change", () => {
    expect(DJL_OPENCODE_FINGERPRINT_PATHS).toEqual(
      expect.arrayContaining([
        "vendor/opencode/packages/opencode/src/session/prompt.ts",
        "vendor/opencode/packages/opencode/src/session/tools.ts",
        "vendor/opencode/packages/schema/src/v1/session.ts",
      ]),
    );
  });

  it("uses a DJL-owned platform and architecture cache", () => {
    expect(
      resolveVendoredOpenCodeCacheBinary({ repoRoot: "/repo", platform: "darwin", arch: "arm64" }),
    ).toBe("/repo/.cache/djl/opencode/darwin-arm64/opencode");
  });

  it("uses the executable suffix on Windows", () => {
    expect(
      resolveVendoredOpenCodeCacheBinary({ repoRoot: "C:\\repo", platform: "win32", arch: "x64" }),
    ).toContain("opencode.exe");
  });

  it("installs optional dependencies for the requested target architecture", () => {
    expect(resolveVendoredOpenCodeInstallArgs({ platform: "darwin", arch: "x64" })).toEqual([
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--os",
      "darwin",
      "--cpu",
      "x64",
    ]);
  });
});
