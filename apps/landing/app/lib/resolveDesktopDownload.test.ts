import { describe, expect, it } from "vitest";

import { resolveDesktopDownload } from "./resolveDesktopDownload";

const GITHUB_URL =
  "https://github.com/Anthonysu798/DJL/releases/download/v0.5.10/DJL-0.5.10-arm64.dmg";
const OSS_URL =
  "https://djl-china-releases.oss-accelerate.aliyuncs.com/releases/0.5.10/DJL-0.5.10-arm64.dmg";
const RELEASE_PAGE = "https://github.com/Anthonysu798/DJL/releases/latest";
const target = { platform: "mac", arch: "arm64" } as const;
const release = async () => ({
  ok: true,
  json: async () => ({
    tag_name: "v0.5.10",
    assets: [{ name: "DJL-0.5.10-arm64.dmg", browser_download_url: GITHUB_URL }],
  }),
});

describe("resolveDesktopDownload", () => {
  it("uses GitHub when no mirror was requested", async () => {
    await expect(
      resolveDesktopDownload(target, new Request("https://djl.test/download/mac/arm64"), {
        fetchImpl: release,
      }),
    ).resolves.toEqual({
      destination: GITHUB_URL,
      report: {
        platform: "mac",
        arch: "arm64",
        source: "github",
        country: null,
        version: "0.5.10",
      },
    });
  });

  it("uses the immutable Hong Kong OSS object for an explicit China request", async () => {
    await expect(
      resolveDesktopDownload(target, new Request("https://djl.test/download/mac/arm64?mirror=cn"), {
        fetchImpl: release,
      }),
    ).resolves.toEqual({
      destination: OSS_URL,
      report: { platform: "mac", arch: "arm64", source: "oss", country: null, version: "0.5.10" },
    });
  });

  it("keeps an unknown mirror on GitHub", async () => {
    await expect(
      resolveDesktopDownload(
        target,
        new Request("https://djl.test/download/mac/arm64?mirror=other"),
        { fetchImpl: release },
      ),
    ).resolves.toEqual({
      destination: GITHUB_URL,
      report: {
        platform: "mac",
        arch: "arm64",
        source: "github",
        country: null,
        version: "0.5.10",
      },
    });
  });

  it("uses the GitHub release page when the release cannot be resolved", async () => {
    await expect(
      resolveDesktopDownload(target, new Request("https://djl.test/download/mac/arm64?mirror=cn"), {
        fetchImpl: async () => ({ ok: false, json: async () => null }),
      }),
    ).resolves.toEqual({
      destination: RELEASE_PAGE,
      report: { platform: "mac", arch: "arm64", source: "github", country: null, version: null },
    });
  });

  it("includes the visitor country without changing mirror selection", async () => {
    await expect(
      resolveDesktopDownload(
        target,
        new Request("https://djl.test/download/mac/arm64", {
          headers: { "x-vercel-ip-country": "cn" },
        }),
        { fetchImpl: release },
      ),
    ).resolves.toEqual({
      destination: GITHUB_URL,
      report: {
        platform: "mac",
        arch: "arm64",
        source: "github",
        country: "CN",
        version: "0.5.10",
      },
    });
  });
});
