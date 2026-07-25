import { describe, expect, it } from "vitest";

import { resolveBundledOpenCodePath } from "./bundledOpenCode";

describe("resolveBundledOpenCodePath", () => {
  it("resolves the executable from Electron resources", () => {
    expect(resolveBundledOpenCodePath("/Applications/DJL.app/Contents/Resources", "darwin")).toBe(
      "/Applications/DJL.app/Contents/Resources/opencode/opencode",
    );
    expect(resolveBundledOpenCodePath("C:\\DJL\\resources", "win32")).toBe(
      "C:\\DJL\\resources\\opencode\\opencode.exe",
    );
  });
});
