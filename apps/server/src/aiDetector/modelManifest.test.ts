import { describe, expect, it } from "vitest";

import {
  AI_DETECTOR_MODELS,
  AI_DETECTOR_MODEL_HOSTS,
  getCalibrationBand,
  modelArtifactFingerprint,
} from "./modelManifest";

describe("AI detector model manifests", () => {
  it("pins every artifact with a safe URL, size, and checksum", () => {
    for (const manifest of Object.values(AI_DETECTOR_MODELS)) {
      expect(manifest.revision).toMatch(/^[a-f0-9]{40}$/);
      const licenseUrl = new URL(manifest.licenseUrl);
      expect(licenseUrl.protocol).toBe("https:");
      expect(licenseUrl.hostname).toBe("huggingface.co");
      expect(licenseUrl.pathname).toContain(
        manifest.language === "en" ? manifest.revision : "47695ff451b32c225dd938f4f478f7fdc6aa6bb0",
      );
      expect(manifest.humanThreshold).toBeLessThan(manifest.aiThreshold);
      expect(manifest.output).toEqual({
        probability: "two-logit-softmax",
        aiLabelIndex: 1,
      });
      expect(manifest.calibrationBands[0]?.minimumEligibleCharacters).toBe(0);
      expect(manifest.calibrationBands.at(-1)?.maximumEligibleCharacters).toBeNull();
      manifest.calibrationBands.forEach((band, index) => {
        if (band.aiThreshold !== null) {
          expect(band.humanThreshold).toBeLessThan(band.aiThreshold);
        }
        const previous = manifest.calibrationBands[index - 1];
        if (previous) {
          expect(previous.maximumEligibleCharacters).not.toBeNull();
          expect(band.minimumEligibleCharacters).toBe(
            (previous.maximumEligibleCharacters as number) + 1,
          );
        }
      });
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

  it("uses length-conditioned, selectively validated calibration", () => {
    const english = AI_DETECTOR_MODELS.en;
    expect(english.calibrationVersion).toBe("djl-en-conservative-length-bands-v8");
    expect(english.aiThreshold).toBe(0.99);
    expect(getCalibrationBand(english, 599).humanThreshold).toBe(0.35);
    expect(getCalibrationBand(english, 599).aiThreshold).toBeNull();
    expect(getCalibrationBand(english, 600)).toMatchObject({
      humanThreshold: 0.35,
      aiThreshold: 0.99,
    });
    expect(getCalibrationBand(english, 1_000).aiThreshold).toBe(0.99);

    const chinese = AI_DETECTOR_MODELS["zh-Hans"];
    expect(chinese.calibrationVersion).toBe("djl-zh-hans-selective-human-v3");
    expect(getCalibrationBand(chinese, 299)).toMatchObject({
      humanThreshold: 0.015,
      aiThreshold: 0.8,
    });
    expect(getCalibrationBand(chinese, 300)).toMatchObject({
      humanThreshold: 0.015,
      aiThreshold: 0.8,
    });
  });
});
