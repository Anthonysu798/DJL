import { readFileSync } from "node:fs";
import * as Path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import {
  CLOUD_AUTH_PROTOCOL,
  findCloudAuthCallbackInArgv,
  parseCloudAuthCallbackUrl,
} from "./cloudAuthDeepLink";

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

describe("registerCloudAuthProtocol source behavior without Electron or registry access", () => {
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const implementations = Array.from(
    source.matchAll(/^function registerCloudAuthProtocol\(\): void \{\r?\n([\s\S]*?)^\}\r?$/gm),
  );
  const body = implementations[0]?.[1];
  if (implementations.length !== 1 || body === undefined) {
    throw new Error("Expected exactly one registerCloudAuthProtocol implementation in main.ts");
  }

  // Execute the real function body, not main.ts startup, with only synthetic side effects.
  function runRegistration(smoke: string | undefined, defaultApp = false, registered = true) {
    const setAsDefaultProtocolClient = vi.fn(() => registered);
    const writeDesktopLogHeader = vi.fn();
    runInNewContext(`(() => {\n${body}\n})()`, {
      app: { setAsDefaultProtocolClient },
      process: {
        env: smoke === undefined ? {} : { DJL_DESKTOP_SMOKE_TEST: smoke },
        defaultApp,
        execPath: "/qa/electron",
        argv: ["/qa/electron", "./qa-main.js"],
      },
      Path,
      CLOUD_AUTH_PROTOCOL,
      writeDesktopLogHeader,
    });
    return { setAsDefaultProtocolClient, writeDesktopLogHeader };
  }

  it.each([false, true])("does not register in smoke mode (defaultApp=%s)", (defaultApp) => {
    const result = runRegistration("1", defaultApp);
    expect(result.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    expect(result.writeDesktopLogHeader).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "0", "false", "true"])(
    "preserves packaged and development registration when smoke=%s",
    (smoke) => {
      for (const defaultApp of [false, true]) {
        const result = runRegistration(smoke, defaultApp);
        expect(result.setAsDefaultProtocolClient.mock.calls).toEqual(
          defaultApp
            ? [[CLOUD_AUTH_PROTOCOL, "/qa/electron", [Path.resolve("./qa-main.js")]]]
            : [[CLOUD_AUTH_PROTOCOL]],
        );
        expect(result.writeDesktopLogHeader).not.toHaveBeenCalled();
      }
    },
  );

  it.each([false, true])("preserves failed registration logging (defaultApp=%s)", (defaultApp) => {
    const result = runRegistration(undefined, defaultApp, false);
    expect(result.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1);
    expect(result.writeDesktopLogHeader.mock.calls).toEqual([
      [`could not register ${CLOUD_AUTH_PROTOCOL}:// handler`],
    ]);
  });
});
