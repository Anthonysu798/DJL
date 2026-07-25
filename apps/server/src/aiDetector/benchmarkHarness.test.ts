import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("AI detector benchmark harness", () => {
  it("uses the production token-aware segmentation path for offline verification", () => {
    const source = readFileSync(
      new URL("../../../../tools/ai_detector_benchmark/verify-runtime.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("segmentPassagesTokenAware");
    expect(source).not.toMatch(/\bsegmentPassages\(/);
  });
});
