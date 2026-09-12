import { describe, expect, it } from "vitest";

import {
  resolveDesktopGitHubPublishConfig,
  resolveDesktopPublishConfig,
} from "./desktop-publish-config";

describe("desktop publish config", () => {
  it("falls back to the canonical DJL repository outside CI", () => {
    expect(
      resolveDesktopGitHubPublishConfig({
        packageRepository: {
          type: "git",
          url: "https://github.com/Anthonysu798/DJL",
          directory: "apps/server",
        },
      }),
    ).toEqual({
      provider: "github",
      owner: "Anthonysu798",
      repo: "DJL",
      releaseType: "release",
    });
  });

  it("prefers the explicit update repository over CI and package metadata", () => {
    expect(
      resolveDesktopGitHubPublishConfig({
        configuredRepository: "configured/djl",
        githubRepository: "ci/repository",
        packageRepository: "https://github.com/package/repository.git",
      }),
    ).toMatchObject({ owner: "configured", repo: "djl" });
  });

  it("rejects malformed or non-GitHub repository metadata", () => {
    expect(
      resolveDesktopGitHubPublishConfig({ packageRepository: "https://example.com/owner/repo" }),
    ).toBeUndefined();
    expect(
      resolveDesktopGitHubPublishConfig({ configuredRepository: "owner/repo/extra" }),
    ).toBeUndefined();
  });

  it("uses an explicit validated HTTPS download origin before GitHub metadata", () => {
    expect(
      resolveDesktopPublishConfig({
        configuredUpdateBaseUrl: "https://djl-china-releases.oss-accelerate.aliyuncs.com/stable/",
        configuredRepository: "configured/djl",
      }),
    ).toEqual({
      provider: "generic",
      url: "https://djl-china-releases.oss-accelerate.aliyuncs.com/stable",
    });
  });

  it.each([
    "http://djl-china-releases.oss-accelerate.aliyuncs.com/stable",
    "https://user:password@djl-china-releases.oss-accelerate.aliyuncs.com/stable",
    "https://djl-china-releases.oss-accelerate.aliyuncs.com/stable?token=secret",
    "https://djl-china-releases.oss-accelerate.aliyuncs.com/stable#fragment",
  ])("fails closed for an unsafe explicit update origin: %s", (configuredUpdateBaseUrl) => {
    expect(() =>
      resolveDesktopPublishConfig({
        configuredUpdateBaseUrl,
        configuredRepository: "configured/djl",
      }),
    ).toThrow("DJL_DESKTOP_UPDATE_BASE_URL must be a credential-free HTTPS base URL");
  });
});
