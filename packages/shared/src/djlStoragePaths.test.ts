import { describe, expect, it } from "vitest";

import { resolveDesktopDjlHome, resolveDjlHome, resolveDjlStatePaths } from "./djlStoragePaths";

describe("resolveDjlHome", () => {
  it("defaults to the DJL-branded home directory", () => {
    expect(resolveDjlHome({}, "/Users/tester")).toBe("/Users/tester/.djl");
  });

  it("prefers DJL_HOME while retaining SYNARA_HOME as a compatibility fallback", () => {
    expect(
      resolveDjlHome(
        { DJL_HOME: "/Users/tester/.custom-djl", SYNARA_HOME: "/legacy/synara" },
        "/Users/tester",
      ),
    ).toBe("/Users/tester/.custom-djl");
    expect(resolveDjlHome({ SYNARA_HOME: "/legacy/synara" }, "/Users/tester")).toBe(
      "/legacy/synara",
    );
  });
});

describe("resolveDesktopDjlHome", () => {
  it("stores default Windows desktop data under LocalAppData", () => {
    expect(
      resolveDesktopDjlHome({}, "C:\\Users\\tester", "C:\\Users\\tester\\AppData\\Local", "win32"),
    ).toBe("C:\\Users\\tester\\AppData\\Local\\DJL\\Data");
  });

  it("preserves explicit home overrides and non-Windows defaults", () => {
    expect(
      resolveDesktopDjlHome(
        { DJL_HOME: "D:\\isolated" },
        "C:\\Users\\tester",
        "C:\\Users\\tester\\AppData\\Local",
        "win32",
      ),
    ).toBe("D:\\isolated");
    expect(resolveDesktopDjlHome({}, "/Users/tester", undefined, "darwin")).toBe(
      "/Users/tester/.djl",
    );
  });
});

describe("resolveDjlStatePaths", () => {
  it("isolates dev state while sharing the packaged OpenCode credential root", () => {
    expect(resolveDjlStatePaths("/Users/tester/.djl", true)).toEqual({
      stateDir: "/Users/tester/.djl/dev",
      managedOpenCodeRootDir: "/Users/tester/.djl/userdata/opencode",
    });
    expect(resolveDjlStatePaths("/Users/tester/.djl", false)).toEqual({
      stateDir: "/Users/tester/.djl/userdata",
      managedOpenCodeRootDir: "/Users/tester/.djl/userdata/opencode",
    });
  });

  it("shares the complete state when requested by the desktop runtime", () => {
    expect(resolveDjlStatePaths("/Users/tester/.djl", true, true)).toEqual({
      stateDir: "/Users/tester/.djl/userdata",
      managedOpenCodeRootDir: "/Users/tester/.djl/userdata/opencode",
    });
  });
});
