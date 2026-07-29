// FILE: localModelsFixture.ts
// Purpose: Shared local-model snapshot fixture pieces for tests and browser stories.
// Layer: Test support
// Exports: hardware profile builder matching the server's budget rules.

import type { LocalHardwareAcceleration, LocalHardwareProfile } from "@synara/contracts";

const BUDGET_FRACTION: Record<LocalHardwareAcceleration, number> = {
  apple_unified: 0.6,
  discrete_gpu: 0.9,
  cpu_only: 0.35,
};
const CONTEXT_HEADROOM_FRACTION = 0.7;

export function hardwareProfileFixture(
  overrides: Partial<LocalHardwareProfile> = {},
): LocalHardwareProfile {
  const acceleration = overrides.acceleration ?? "apple_unified";
  const totalMemoryBytes = overrides.totalMemoryBytes ?? 16 * 1024 ** 3;
  const vramBytes = overrides.vramBytes ?? null;
  const base = acceleration === "discrete_gpu" ? (vramBytes ?? 0) : totalMemoryBytes;
  return {
    totalMemoryBytes,
    cpuModel: "Apple M2",
    cpuCores: 8,
    acceleration,
    gpuName: acceleration === "cpu_only" ? null : "Apple M2",
    vramBytes,
    usableModelBytes: Math.floor(base * BUDGET_FRACTION[acceleration] * CONTEXT_HEADROOM_FRACTION),
    ...overrides,
  };
}
