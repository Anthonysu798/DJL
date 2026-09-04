import { describe, expect, it } from "vitest";

import { readOssDownloadBaseUrl, resolveOssDesktopDownload } from "./ossDesktopDownloads";

const HONG_KONG_OSS = "https://djl-china-releases.oss-cn-hongkong.aliyuncs.com";

describe("readOssDownloadBaseUrl", () => {
  it("uses the Hong Kong bucket when no override is configured", () => {
    expect(readOssDownloadBaseUrl({})).toBe(HONG_KONG_OSS);
  });

  it("accepts a valid HTTPS override and removes trailing slashes", () => {
    expect(
      readOssDownloadBaseUrl({
        DJL_OSS_DOWNLOAD_BASE_URL: "https://downloads.example.test///",
      }),
    ).toBe("https://downloads.example.test");
  });

  it.each([
    "http://downloads.example.test",
    "https://user:secret@downloads.example.test",
    "https://downloads.example.test?token=secret",
    "https://downloads.example.test#fragment",
  ])("rejects the unsafe override %s", (override) => {
    expect(readOssDownloadBaseUrl({ DJL_OSS_DOWNLOAD_BASE_URL: override })).toBe(HONG_KONG_OSS);
  });
});

describe("resolveOssDesktopDownload", () => {
  it("builds the immutable mirrored release URL", () => {
    expect(resolveOssDesktopDownload(HONG_KONG_OSS, "0.5.10", "DJL-0.5.10-arm64.dmg")).toBe(
      `${HONG_KONG_OSS}/releases/0.5.10/DJL-0.5.10-arm64.dmg`,
    );
  });
});
