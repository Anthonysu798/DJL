import { describe, expect, it } from "vitest";

import {
  CANONICAL_GITHUB_UPDATE_FEED,
  isEligibleUpdateFeedFailure,
  resolveGenericUpdateFeed,
  runWithUpdateFeedFallback,
} from "./updateFeedFailover";

describe("update feed failover", () => {
  it("reads a credential-free generic HTTPS feed from packaged configuration", () => {
    expect(
      resolveGenericUpdateFeed({
        provider: "generic",
        url: "https://djl-china-releases.oss-cn-hongkong.aliyuncs.com/stable",
      }),
    ).toEqual({
      provider: "generic",
      url: "https://djl-china-releases.oss-cn-hongkong.aliyuncs.com/stable",
    });
  });

  it.each([
    null,
    { provider: "github", owner: "Anthonysu798", repo: "DJL" },
    { provider: "generic", url: "http://example.com/stable" },
    { provider: "generic", url: "https://user:secret@example.com/stable" },
  ])("does not treat an unsafe or non-generic config as the OSS primary", (rawConfig) => {
    expect(resolveGenericUpdateFeed(rawConfig)).toBeNull();
  });

  it("uses the canonical public GitHub release provider", () => {
    expect(CANONICAL_GITHUB_UPDATE_FEED).toEqual({
      provider: "github",
      owner: "Anthonysu798",
      repo: "DJL",
      releaseType: "release",
    });
  });

  it.each([
    Object.assign(new Error("missing checksum"), { code: "ERR_UPDATER_NO_CHECKSUM" }),
    Object.assign(new Error("invalid signature"), { code: "ERR_UPDATER_INVALID_SIGNATURE" }),
    Object.assign(new Error("invalid manifest"), { code: "ERR_UPDATER_INVALID_UPDATE_INFO" }),
    Object.assign(new Error("manifest has no files"), {
      code: "ERR_UPDATER_NO_FILES_PROVIDED",
    }),
    new Error("sha512 checksum mismatch (expected trusted, got tampered)"),
  ])("does not fail over after an integrity failure", (error) => {
    expect(isEligibleUpdateFeedFailure(error)).toBe(false);
  });

  it.each([
    Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    new Error("Timed out while checking for updates"),
    Object.assign(new Error("HTTP 404"), { statusCode: 404 }),
  ])("allows one fallback after a transport failure", async (error) => {
    let fallbackAttempts = 0;
    const result = await runWithUpdateFeedFallback({
      primary: async () => {
        throw error;
      },
      fallback: async () => {
        fallbackAttempts += 1;
        return "from-github";
      },
    });

    expect(result).toEqual({ source: "github", value: "from-github" });
    expect(fallbackAttempts).toBe(1);
  });

  it("returns primary success without contacting GitHub", async () => {
    let fallbackAttempts = 0;
    const result = await runWithUpdateFeedFallback({
      primary: async () => "from-oss",
      fallback: async () => {
        fallbackAttempts += 1;
        return "from-github";
      },
    });

    expect(result).toEqual({ source: "primary", value: "from-oss" });
    expect(fallbackAttempts).toBe(0);
  });

  it("surfaces the GitHub failure without starting another fallback loop", async () => {
    let fallbackAttempts = 0;
    await expect(
      runWithUpdateFeedFallback({
        primary: async () => {
          throw Object.assign(new Error("OSS unavailable"), { code: "ECONNRESET" });
        },
        fallback: async () => {
          fallbackAttempts += 1;
          throw new Error("GitHub unavailable");
        },
      }),
    ).rejects.toThrow("GitHub unavailable");
    expect(fallbackAttempts).toBe(1);
  });

  it("does not call GitHub when the primary failure is ineligible", async () => {
    let fallbackAttempts = 0;
    await expect(
      runWithUpdateFeedFallback({
        primary: async () => {
          throw Object.assign(new Error("unsigned"), {
            code: "ERR_UPDATER_INVALID_SIGNATURE",
          });
        },
        fallback: async () => {
          fallbackAttempts += 1;
          return "unexpected";
        },
      }),
    ).rejects.toThrow("unsigned");
    expect(fallbackAttempts).toBe(0);
  });
});
