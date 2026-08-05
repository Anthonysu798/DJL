import { describe, expect, it } from "vitest";

import { createDesktopBuildInfo } from "./desktopBuildInfo";

describe("createDesktopBuildInfo", () => {
  it("reports the installed package version for packaged builds", () => {
    expect(
      createDesktopBuildInfo({ isPackaged: true, version: "0.5.9", commit: "c04e8d15" }),
    ).toEqual({
      kind: "packaged",
      version: "0.5.9",
      commit: "c04e8d15",
    });
  });

  it("does not present the package.json baseline as a development version", () => {
    expect(
      createDesktopBuildInfo({ isPackaged: false, version: "0.5.0", commit: "c04e8d15" }),
    ).toEqual({
      kind: "development",
      version: null,
      commit: "c04e8d15",
    });
  });
});
