import {
  assessEvidenceSummary,
  roundEvidencePercentages,
} from "../../apps/server/src/aiDetector/textPipeline";

import type { BenchmarkPrediction } from "./metrics";

export interface LegacyProfileRow {
  readonly eligibleCharacters: number;
  readonly regions: readonly {
    readonly start: number;
    readonly end: number;
    readonly language?: "en" | "zh-Hans" | "other";
    readonly score?: number;
  }[];
}

/**
 * Reconstructs the production decision policy that preceded the 2026
 * length-conditioned calibration. Keeping it in the harness makes before/after
 * comparisons reproducible without checking out and executing older code.
 */
export function legacyProductionPrediction(row: LegacyProfileRow): BenchmarkPrediction {
  if (row.eligibleCharacters < 120) return "uncertain";

  const englishEligibleCharacters = row.regions
    .filter(
      (region) =>
        region.language === "en" && region.score !== undefined && Number.isFinite(region.score),
    )
    .reduce((sum, region) => sum + Math.max(0, region.end - region.start), 0);
  const counts: [number, number, number] = [0, 0, 0];
  for (const region of row.regions) {
    if (
      (region.language !== "en" && region.language !== "zh-Hans") ||
      region.score === undefined ||
      !Number.isFinite(region.score)
    ) {
      continue;
    }
    const length = Math.max(0, region.end - region.start);
    const humanThreshold = region.language === "en" ? 0.35 : 0.25;
    const aiThreshold = region.language === "en" ? 0.985 : 0.8;
    if (region.score <= humanThreshold) {
      counts[2] += length;
    } else if (
      region.score >= aiThreshold &&
      (region.language !== "en" || englishEligibleCharacters >= 600)
    ) {
      counts[0] += length;
    } else {
      counts[1] += length;
    }
  }
  const assessment = assessEvidenceSummary(
    roundEvidencePercentages(counts),
    row.eligibleCharacters,
  );
  return assessment === "likely-ai" ? "ai" : assessment === "likely-human" ? "human" : "uncertain";
}
