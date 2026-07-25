import { describe, expect, it } from "vitest";

import {
  AI_DETECTOR_MODELS,
  AI_DETECTOR_MODEL_HOSTS,
  modelArtifactFingerprint,
} from "./modelManifest";

describe("AI detector model manifests", () => {
  it("pins every artifact with a safe URL, size, and checksum", () => {
    for (const manifest of Object.values(AI_DETECTOR_MODELS)) {
      expect(manifest.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(manifest.humanThreshold).toBeLessThan(manifest.aiThreshold);
      expect(manifest.files.length).toBeGreaterThanOrEqual(4);
      expect(new Set(manifest.files.map((file) => file.path)).size).toBe(manifest.files.length);
      for (const file of manifest.files) {
        const url = new URL(file.url);
        expect(url.protocol).toBe("https:");
        expect(AI_DETECTOR_MODEL_HOSTS.has(url.hostname)).toBe(true);
        expect(file.path.startsWith("/")).toBe(false);
        expect(file.path.includes(".."), file.path).toBe(false);
        expect(file.sizeBytes).toBeGreaterThan(0);
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it("changes the cache identity when a tokenizer or config artifact changes", () => {
    const manifest = AI_DETECTOR_MODELS.en;
    const changed = {
      ...manifest,
      files: manifest.files.map((file, index) =>
        index === 0 ? { ...file, sha256: "0".repeat(64) } : file,
      ),
    };

    expect(modelArtifactFingerprint(changed)).not.toBe(modelArtifactFingerprint(manifest));
  });

  it("uses the holdout-calibrated conservative English threshold", () => {
    expect(AI_DETECTOR_MODELS.en.calibrationVersion).toBe("djl-en-hc3-short-evidence-v3");
    expect(AI_DETECTOR_MODELS.en.aiThreshold).toBe(0.985);
  });
});
