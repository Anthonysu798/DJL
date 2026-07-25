import { describe, expect, it } from "vitest";

import {
  assertReleaseVersionIsNewer,
  compareReleaseVersions,
  selectBridgeVersion,
} from "./lib/release-update-policy";

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
