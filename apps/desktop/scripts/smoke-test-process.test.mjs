import { describe, expect, it } from "vitest";

import {
  buildSmokeEnvironment,
  buildSmokeLaunchArguments,
  findSmokeFailures,
  unixProcessGroupTarget,
} from "./smoke-test-process.mjs";

describe("desktop smoke process isolation", () => {
  it("removes inherited authentication and isolates all writable state", () => {
    const environment = buildSmokeEnvironment(
      {
        HOME: "/Users/example",
        DJL_HOME: "/Users/example/.djl",
        SYNARA_HOME: "/Users/example/.synara",
        DJL_DESKTOP_USER_DATA_DIR: "/Users/example/Library/DJL",
        SYNARA_DESKTOP_USER_DATA_DIR: "/Users/example/Library/Synara",
        ELECTRON_RUN_AS_NODE: "1",
        VITE_DEV_SERVER_URL: "http://localhost:5733",
        SYNARA_AUTH_TOKEN: "must-not-leak",
      },
      "/tmp/djl-smoke",
      "4317",
    );

    expect(environment).not.toHaveProperty("SYNARA_AUTH_TOKEN");
    expect(environment).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(environment).not.toHaveProperty("VITE_DEV_SERVER_URL");
    expect(environment).toMatchObject({
      HOME: "/tmp/djl-smoke/home",
      DJL_HOME: "/tmp/djl-smoke/state",
      SYNARA_HOME: "/tmp/djl-smoke/state",
      DJL_DESKTOP_USER_DATA_DIR: "/tmp/djl-smoke/profile",
      SYNARA_DESKTOP_USER_DATA_DIR: "/tmp/djl-smoke/profile",
      SYNARA_PORT_OFFSET: "4317",
      SYNARA_NO_BROWSER: "1",
      SYNARA_DISABLE_AUTO_UPDATE: "1",
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
    expect(buildSmokeLaunchArguments("/app/main.js", "/tmp/djl-smoke/profile")).toEqual([
      "/app/main.js",
      "--user-data-dir=/tmp/djl-smoke/profile",
    ]);
  });

  it("targets the entire detached Unix process group", () => {
    expect(unixProcessGroupTarget(4123)).toBe(-4123);
  });
});
