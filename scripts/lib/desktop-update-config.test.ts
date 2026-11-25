import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPackagedDesktopUpdateConfig,
  assertPackagedWindowsUpdatePublisher,
  findPackagedDesktopUpdateConfigs,
  readPackagedUpdatePublisherNames,
} from "./desktop-update-config";

const expectedUrl = "https://djl-china-releases.oss-accelerate.aliyuncs.com/stable";

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

  it("requires a signed Windows package to pin the publisher its updates must be signed by", () => {
    // The shape electron-builder writes for azureSignOptions.publisherName.
    const packaged = `provider: generic\nurl: ${expectedUrl}\nupdaterCacheDirName: djl-updater\npublisherName:\n  - Anthony Su\n`;
    expect(readPackagedUpdatePublisherNames(packaged)).toEqual(["Anthony Su"]);
    expect(() => assertPackagedWindowsUpdatePublisher(packaged, "Anthony Su")).not.toThrow();
    expect(() =>
      assertPackagedWindowsUpdatePublisher(
        "publisherName:\r\n  - 'CN=Anthony Su, O=Anthony Su, C=US'\r\nprovider: generic\r\n",
        "CN=Anthony Su, O=Anthony Su, C=US",
      ),
    ).not.toThrow();
  });

  it.each([
    `provider: generic\nurl: ${expectedUrl}\n`,
    "provider: generic\npublisherName:\n  - Someone Else\n",
    "provider: generic\npublisherName:\n  - Anthony Su\n  - Someone Else\n",
    "provider: generic\npublisherName:\nupdaterCacheDirName: djl-updater\n",
  ])("rejects a Windows package that would accept unsigned or foreign updates", (contents) => {
    expect(() => assertPackagedWindowsUpdatePublisher(contents, "Anthony Su")).toThrow(
      /must verify updates against publisher "Anthony Su"/,
    );
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
