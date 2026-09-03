import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPackagedDesktopUpdateConfig,
  findPackagedDesktopUpdateConfigs,
} from "./desktop-update-config";

const expectedUrl = "https://djl-china-releases.oss-cn-hongkong.aliyuncs.com/stable";

describe("packaged desktop updater configuration", () => {
  it("accepts only the expected generic OSS feed", () => {
    expect(() =>
      assertPackagedDesktopUpdateConfig(`provider: generic\nurl: ${expectedUrl}\n`, expectedUrl),
    ).not.toThrow();
  });

  it.each([
    "provider: github\nowner: Anthonysu798\nrepo: DJL\n",
    "provider: generic\nurl: https://example.com/stable\n",
    `provider: generic\nurl: ${expectedUrl}\nowner: Anthonysu798\n`,
  ])("rejects a package that can bypass the OSS primary feed", (contents) => {
    expect(() => assertPackagedDesktopUpdateConfig(contents, expectedUrl)).toThrow();
  });

  it("finds the generated config inside an unpacked application", () => {
    const workspace = mkdtempSync(join(tmpdir(), "djl-update-config-"));
    try {
      const resources = join(workspace, "win-unpacked", "resources");
      mkdirSync(resources, { recursive: true });
      writeFileSync(join(resources, "app-update.yml"), "provider: generic\n");

      expect(findPackagedDesktopUpdateConfigs(workspace)).toEqual([
        join(resources, "app-update.yml"),
      ]);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});
