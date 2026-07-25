import { describe, expect, it } from "vitest";

import { resolveWorkCapabilityFlags, resolveWorkReleaseStage } from "./workCapabilities";

describe("Work capability rollout", () => {
  it("defaults to the production-hardened stage and rejects invalid values", () => {
    expect(resolveWorkReleaseStage(undefined)).toBe(5);
    expect(resolveWorkReleaseStage("3")).toBe(3);
    expect(resolveWorkReleaseStage("99")).toBe(5);
    expect(resolveWorkReleaseStage("off")).toBe(0);
  });

  it("reports only server-enabled release capabilities", () => {
    expect(resolveWorkCapabilityFlags({ releaseStage: 2, localOcrInstallAvailable: true })).toEqual(
      {
        releaseStage: 2,
        workCore: true,
        documentPreparation: true,
        localDocumentIntelligence: false,
        projectMemory: false,
        productionHardening: false,
        cloudDocumentIntelligence: false,
      },
    );
    expect(resolveWorkCapabilityFlags({ releaseStage: 5, localOcrInstallAvailable: true })).toEqual(
      expect.objectContaining({
        productionHardening: true,
        localDocumentIntelligence: true,
      }),
    );
  });
});
