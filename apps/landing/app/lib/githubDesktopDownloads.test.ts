import { describe, expect, it } from "vitest";
import {
  resolveGithubDesktopDownload,
  resolveGithubLatestReleasePage,
  type ReleaseFetch,
} from "./githubDesktopDownloads";
import type { DesktopDownloadTarget } from "./vpsDesktopDownloads";

const RELEASE_ASSETS = [
  { name: "DJL-0.5.6-arm64.dmg", browser_download_url: "https://example.test/arm64.dmg" },
  { name: "DJL-0.5.6-arm64.dmg.blockmap", browser_download_url: "https://example.test/arm64.map" },
  { name: "DJL-0.5.6-arm64.zip", browser_download_url: "https://example.test/arm64.zip" },
  { name: "DJL-0.5.6-x64.dmg", browser_download_url: "https://example.test/x64.dmg" },
  { name: "DJL-0.5.6-x64.exe", browser_download_url: "https://example.test/x64.exe" },
  { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
];

function releaseFetch(release: unknown, ok = true): ReleaseFetch {
  return async () => ({ ok, json: async () => release });
}

describe("resolveGithubDesktopDownload", () => {
  it.each([
    [{ platform: "windows", arch: "x64" }, "https://example.test/x64.exe"],
    [{ platform: "mac", arch: "arm64" }, "https://example.test/arm64.dmg"],
    [{ platform: "mac", arch: "x64" }, "https://example.test/x64.dmg"],
  ] satisfies ReadonlyArray<[DesktopDownloadTarget, string]>)(
    "resolves %o to the matching installer in the newest release",
    async (target, expected) => {
      const resolved = await resolveGithubDesktopDownload(
        target,
        releaseFetch({ assets: RELEASE_ASSETS }),
      );

      expect(resolved).toBe(expected);
    },
  );

  it("matches any future version without a code change", async () => {
    const resolved = await resolveGithubDesktopDownload(
      { platform: "mac", arch: "arm64" },
      releaseFetch({
        assets: [
          { name: "DJL-9.14.2-arm64.dmg", browser_download_url: "https://example.test/next.dmg" },
        ],
      }),
    );

    expect(resolved).toBe("https://example.test/next.dmg");
  });

  it("matches prerelease versions", async () => {
    const resolved = await resolveGithubDesktopDownload(
      { platform: "windows", arch: "x64" },
      releaseFetch({
        assets: [
          { name: "DJL-0.6.0-rc.1-x64.exe", browser_download_url: "https://example.test/rc.exe" },
        ],
      }),
    );

    expect(resolved).toBe("https://example.test/rc.exe");
  });

  it("never confuses the macOS disk image with the Windows installer", async () => {
    const resolved = await resolveGithubDesktopDownload(
      { platform: "mac", arch: "x64" },
      releaseFetch({
        assets: [
          { name: "DJL-0.5.6-x64.exe", browser_download_url: "https://example.test/x64.exe" },
        ],
      }),
    );

    expect(resolved).toBeNull();
  });

  it("returns null when the release carries no matching installer", async () => {
    const resolved = await resolveGithubDesktopDownload(
      { platform: "windows", arch: "x64" },
      releaseFetch({ assets: [{ name: "SHA256SUMS", browser_download_url: "https://x.test/s" }] }),
    );

    expect(resolved).toBeNull();
  });

  it("returns null when GitHub answers with an error status", async () => {
    const resolved = await resolveGithubDesktopDownload(
      { platform: "windows", arch: "x64" },
      releaseFetch({ assets: RELEASE_ASSETS }, false),
    );

    expect(resolved).toBeNull();
  });

  it("returns null when the request throws so callers can fall back", async () => {
    const resolved = await resolveGithubDesktopDownload({ platform: "mac", arch: "arm64" }, () => {
      throw new Error("network down");
    });

    expect(resolved).toBeNull();
  });

  it("returns null when no release has been published yet", async () => {
    const resolved = await resolveGithubDesktopDownload(
      { platform: "mac", arch: "arm64" },
      releaseFetch(null, false),
    );

    expect(resolved).toBeNull();
  });
});

describe("resolveGithubLatestReleasePage", () => {
  it("returns the release listing so visitors pick their own architecture", async () => {
    const resolved = await resolveGithubLatestReleasePage(
      releaseFetch({ html_url: "https://example.test/releases/tag/v0.5.6" }),
    );

    expect(resolved).toBe("https://example.test/releases/tag/v0.5.6");
  });

  it("returns null when GitHub is unreachable", async () => {
    const resolved = await resolveGithubLatestReleasePage(() => {
      throw new Error("network down");
    });

    expect(resolved).toBeNull();
  });
});
