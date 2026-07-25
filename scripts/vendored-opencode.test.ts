import { describe, expect, it } from "vitest";

import {
  resolveVendoredOpenCodeCacheBinary,
  resolveVendoredOpenCodeInstallArgs,
} from "./lib/vendored-opencode.ts";

describe("resolveVendoredOpenCodeCacheBinary", () => {
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
