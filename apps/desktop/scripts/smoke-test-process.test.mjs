import { describe, expect, it } from "vitest";

import {
  buildSmokeEnvironment,
  buildSmokeLaunchArguments,
  unixProcessGroupTarget,
} from "./smoke-test-process.mjs";

describe("desktop smoke process isolation", () => {
  it("removes inherited authentication and isolates all writable state", () => {
    const environment = buildSmokeEnvironment(
      {
        HOME: "/Users/example",
        SYNARA_AUTH_TOKEN: "must-not-leak",
      },
      "/tmp/djl-smoke",
      "4317",
    );

    expect(environment).not.toHaveProperty("SYNARA_AUTH_TOKEN");
    expect(environment).toMatchObject({
      HOME: "/tmp/djl-smoke/home",
      SYNARA_HOME: "/tmp/djl-smoke/state",
      SYNARA_PORT_OFFSET: "4317",
      SYNARA_NO_BROWSER: "1",
      SYNARA_DISABLE_AUTO_UPDATE: "1",
    });
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
