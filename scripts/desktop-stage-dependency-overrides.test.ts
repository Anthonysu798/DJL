import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DESKTOP_STAGE_DEPENDENCY_OVERRIDES } from "./lib/desktop-stage-dependency-overrides.ts";

describe("DESKTOP_STAGE_DEPENDENCY_OVERRIDES", () => {
  it("pins ONNX to the last release with both macOS architectures", () => {
    expect(DESKTOP_STAGE_DEPENDENCY_OVERRIDES["onnxruntime-node"]).toBe("1.23.2");
  });

  it.each(["@aws-sdk/credential-provider-http", "@aws-sdk/middleware-eventstream"])(
    "stages the workspace-tested version of %s instead of floating to an unavailable release",
    (packageName) => {
      const lockfile = readFileSync(new URL("../bun.lock", import.meta.url), "utf8");
      const overrides: Record<string, string> = DESKTOP_STAGE_DEPENDENCY_OVERRIDES;
      const version = overrides[packageName];
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(lockfile).toContain(`"${packageName}": ["${packageName}@${version}",`);
    },
  );
});
