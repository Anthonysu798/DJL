import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSmokeEnvironment,
  buildSmokeLaunchArguments,
  findSmokeFailures,
  unixProcessGroupTarget,
} from "./smoke-test-process.mjs";

describe("desktop smoke process isolation", () => {
  it("removes inherited authentication and isolates all writable state", () => {
    const smokeRoot = "/tmp/djl-smoke";
    const environment = buildSmokeEnvironment(
      {
        HOME: "/Users/example",
        USERPROFILE: "C:\\fake-old-home",
        DJL_HOME: "/Users/example/.djl",
        DJL_DESKTOP_USER_DATA_DIR: "/Users/example/Library/DJL",
        ELECTRON_RUN_AS_NODE: "1",
        VITE_DEV_SERVER_URL: "http://localhost:5733",
        DJL_AUTH_TOKEN: "must-not-leak",
      },
      smokeRoot,
      "4317",
    );

    expect(environment).not.toHaveProperty("DJL_AUTH_TOKEN");
    expect(environment).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(environment).not.toHaveProperty("VITE_DEV_SERVER_URL");
    expect(environment).toMatchObject({
      HOME: join(smokeRoot, "home"),
      USERPROFILE: join(smokeRoot, "home"),
      DJL_HOME: join(smokeRoot, "state"),
      DJL_DESKTOP_USER_DATA_DIR: join(smokeRoot, "profile"),
      DJL_PORT_OFFSET: "4317",
      DJL_NO_BROWSER: "1",
      DJL_DISABLE_AUTO_UPDATE: "1",
    });
  });

  it("rejects early exits even when Electron returns zero", () => {
    expect(findSmokeFailures("[desktop-smoke] renderer ready", 0, false)).toContain(
      "Electron exited before the smoke observation period completed",
    );
  });

  it("requires renderer startup evidence and rejects raw Node errors", () => {
    expect(findSmokeFailures("TypeError: app is undefined", 1, false)).toEqual(
      expect.arrayContaining([
        "Electron exited with code 1",
        "TypeError:",
        "Renderer readiness was not observed",
      ]),
    );
    expect(findSmokeFailures("", null, true)).toContain("Renderer readiness was not observed");
  });

  it("accepts a renderer that survives until the planned shutdown", () => {
    expect(findSmokeFailures("[desktop-smoke] renderer ready", null, true)).toEqual([]);
    expect(findSmokeFailures("[desktop-smoke] renderer ready", 1, true, "win32")).toEqual([]);
  });

  it("passes an isolated Electron profile on launch", () => {
    expect(buildSmokeLaunchArguments("/app/main.js", "/tmp/djl-smoke/profile", "darwin")).toEqual([
      "/app/main.js",
      "--user-data-dir=/tmp/djl-smoke/profile",
    ]);
  });

  it("uses software rendering for Linux smoke tests", () => {
    expect(buildSmokeLaunchArguments("/app/main.js", "/tmp/djl-smoke/profile", "linux")).toEqual([
      "/app/main.js",
      "--user-data-dir=/tmp/djl-smoke/profile",
      "--disable-gpu",
    ]);
  });

  it("targets the entire detached Unix process group", () => {
    expect(unixProcessGroupTarget(4123)).toBe(-4123);
  });
});
