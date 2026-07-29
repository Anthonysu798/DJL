import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LOCAL_MODEL_RECOMMENDATIONS,
  localModelRecommendationFitsHardware,
  recommendLocalModelsByUseCase,
} from "./catalog";
import { collectHardwareProfile } from "./hardwareProfile";
import { runWindowsVulkanQuery } from "./windowsVulkanQuery";

describe("native hardware recommendation smoke", () => {
  it("collects this runner and only returns recommendations that fit it", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "djl-native-hardware-"));
    try {
      const profile = await collectHardwareProfile({ stateDir });
      expect(profile.platform).toBe(process.platform);
      expect(profile.totalMemoryBytes).toBeGreaterThan(0);
      expect(profile.availableMemoryBytes).toBeGreaterThanOrEqual(0);
      expect(profile.availableMemoryBytes).toBeLessThanOrEqual(profile.totalMemoryBytes);
      expect(profile.cpuLogicalCores).toBeGreaterThan(0);
      expect(profile.gpus.some(({ name }) => /Microsoft Basic Render/i.test(name))).toBe(false);

      if (process.platform === "darwin") {
        expect(Number.parseInt(profile.osVersion ?? "0", 10)).toBeGreaterThanOrEqual(14);
        if (process.arch === "arm64") {
          expect(profile.gpus.some(({ memoryType }) => memoryType === "unified")).toBe(true);
        }
      }

      if (process.platform === "win32") {
        try {
          expect(JSON.parse(await runWindowsVulkanQuery())).toBeInstanceOf(Array);
        } catch (error) {
          // A machine can legitimately lack a Vulkan 1.2 loader. C# source/ABI mistakes are not
          // runtime capability failures and must remain visible in the native smoke test.
          expect(String(error)).not.toMatch(/(?:Add-Type|Cannot add type|error CS\d{4})/iu);
        }
      }

      const recommendations = recommendLocalModelsByUseCase(profile);
      for (const recommendationId of Object.values(recommendations)) {
        if (recommendationId === null) continue;
        const recommendation = LOCAL_MODEL_RECOMMENDATIONS.find(
          ({ id }) => id === recommendationId,
        );
        expect(recommendation).toBeDefined();
        expect(localModelRecommendationFitsHardware(recommendation!, profile)).toBe(true);
      }
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 45_000);
});
