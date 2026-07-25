import { describe, expect, it } from "vitest";

import {
  assertReleaseVersionIsNewer,
  compareReleaseVersions,
  highestReleaseVersion,
  nextReleaseVersion,
  selectBridgeVersion,
} from "./lib/release-update-policy";

describe("ship version selection", () => {
  it("picks the highest version across every observed feed", () => {
    expect(
      highestReleaseVersion([
        { source: "canonical GitHub release", version: "0.5.2" },
        { source: "legacy GitHub release", version: "v0.5.1" },
        { source: "Windows VPS manifest", version: "0.5.3" },
        { source: "macOS VPS manifest", version: "0.5.4" },
      ]),
    ).toBe("0.5.4");
    expect(highestReleaseVersion([])).toBeNull();
  });

  it.each([
    ["0.5.6", "patch", "0.5.7"],
    ["0.5.6", "minor", "0.6.0"],
    ["0.5.6", "major", "1.0.0"],
    ["0.5.6", "rc", "0.5.7-rc.1"],
    ["v0.5.6", "patch", "0.5.7"],
  ] as const)("bumps %s by %s to %s", (current, level, expected) => {
    expect(nextReleaseVersion(current, level)).toBe(expected);
  });

  it("promotes a release candidate to the version it was testing", () => {
    expect(nextReleaseVersion("0.6.0-rc.2", "patch")).toBe("0.6.0");
    expect(nextReleaseVersion("0.6.0-rc.2", "rc")).toBe("0.6.0-rc.3");
  });

  it("always produces a version newer than the one it bumped from", () => {
    for (const level of ["patch", "minor", "major", "rc"] as const) {
      expect(compareReleaseVersions(nextReleaseVersion("0.5.6", level), "0.5.6")).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("release update policy", () => {
  it("orders stable and prerelease semantic versions", () => {
    expect(compareReleaseVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.2.3", "1.2.3-rc.1")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.2.3-rc.2", "1.2.3-rc.10")).toBeLessThan(0);
    expect(compareReleaseVersions("1.2.3-beta", "1.2.3-10")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.2.3-rc.1", "1.2.3-rc.1")).toBe(0);
  });

  it("requires a release to be newer than every canonical, legacy, and VPS feed", () => {
    const observed = [
      { source: "canonical GitHub release", version: "0.5.2" },
      { source: "legacy GitHub release", version: "v0.5.1" },
      { source: "Windows VPS manifest", version: "0.5.3" },
      { source: "macOS VPS manifest", version: "0.5.4" },
    ];

    expect(assertReleaseVersionIsNewer("0.5.5", observed)).toBe("0.5.5");
    expect(() => assertReleaseVersionIsNewer("0.5.4", observed)).toThrow(
      "not newer than macOS VPS manifest 0.5.4",
    );
    expect(() => assertReleaseVersionIsNewer("0.5.3-rc.1", observed)).toThrow(
      "not newer than Windows VPS manifest 0.5.3",
    );
  });

  it("uses v0.5.5 as the bridge when available and otherwise selects the next patch", () => {
    expect(selectBridgeVersion(["0.5.3", "0.5.4"])).toBe("0.5.5");
    expect(selectBridgeVersion(["0.5.3", "0.5.4", "0.5.5"])).toBe("0.5.6");
    expect(selectBridgeVersion(["0.5.5", "0.6.0-rc.2"])).toBe("0.6.0");
    expect(selectBridgeVersion(["0.5.5", "0.6.0"])).toBe("0.6.1");
  });

  it("rejects loose or unsupported version syntax", () => {
    for (const invalid of ["v1.2", "1.2.3+build", "01.2.3", "1.2.3-01"]) {
      expect(() => compareReleaseVersions(invalid, "1.0.0")).toThrow("Invalid release version");
    }
  });
});
