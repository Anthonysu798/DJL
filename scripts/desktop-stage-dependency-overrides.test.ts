import { describe, expect, it } from "vitest";

import { DESKTOP_STAGE_DEPENDENCY_OVERRIDES } from "./lib/desktop-stage-dependency-overrides.ts";

describe("DESKTOP_STAGE_DEPENDENCY_OVERRIDES", () => {
  it("pins ONNX to the last release with both macOS architectures", () => {
    expect(DESKTOP_STAGE_DEPENDENCY_OVERRIDES["onnxruntime-node"]).toBe("1.23.2");
  });
});
