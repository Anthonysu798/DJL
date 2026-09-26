import { describe, expect, it } from "vitest";

import { findCloudAuthCallbackInArgv, parseCloudAuthCallbackUrl } from "./cloudAuthDeepLink";

const code = "c".repeat(43);
const state = "s".repeat(32);

describe("parseCloudAuthCallbackUrl", () => {
  it("accepts the exact callback with a code and state", () => {
    expect(parseCloudAuthCallbackUrl(`djl://auth/callback?code=${code}&state=${state}`)).toEqual({
      code,
      state,
    });
  });

  it("rejects other schemes, hosts, paths, and malformed values", () => {
    for (const url of [
      `https://auth/callback?code=${code}&state=${state}`,
      `synara://auth/callback?code=${code}&state=${state}`,
      `djl://evil/callback?code=${code}&state=${state}`,
      `djl://auth/other?code=${code}&state=${state}`,
      `djl://user:pw@auth/callback?code=${code}&state=${state}`,
      `djl://auth/callback?code=${code}`,
      `djl://auth/callback?state=${state}`,
      `djl://auth/callback?code=${code}&state=short`,
      `djl://auth/callback?code=${code}<script>&state=${state}`,
      `djl://auth/callback?code=${"c".repeat(3000)}&state=${state}`,
      "not a url",
      undefined,
    ])
      expect(parseCloudAuthCallbackUrl(url)).toBeNull();
  });
});

describe("findCloudAuthCallbackInArgv", () => {
  it("finds the callback among Electron's arguments (Windows and Linux cold start)", () => {
    expect(
      findCloudAuthCallbackInArgv([
        "C:\\Program Files\\DJL\\DJL.exe",
        "--allow-file-access-from-files",
        `djl://auth/callback?code=${code}&state=${state}`,
      ]),
    ).toEqual({ code, state });
  });

  it("ignores arguments without a valid callback", () => {
    expect(findCloudAuthCallbackInArgv(["/usr/bin/djl", "djl://auth/other"])).toBeNull();
  });
});
