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
        configuredUpdateUrl: "https://downloads.slcor.com/stable/",
        configuredRepository: "configured/djl",
      }),
    ).toEqual({ provider: "generic", url: "https://downloads.slcor.com/stable" });
  });

  it("rejects unsafe generic update origins and retains the GitHub fallback", () => {
    expect(
      resolveDesktopPublishConfig({
        configuredUpdateUrl: "http://downloads.slcor.com/stable",
        configuredRepository: "configured/djl",
      }),
    ).toMatchObject({ provider: "github", owner: "configured", repo: "djl" });
  });
});
