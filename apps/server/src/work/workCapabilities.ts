import type { WorkCapabilityFlags } from "@synara/contracts";

export function resolveWorkReleaseStage(value: string | undefined): number {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off") return 0;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : 5;
}

export function resolveWorkCapabilityFlags(input: {
  readonly releaseStage: number;
  readonly localOcrInstallAvailable: boolean;
}): WorkCapabilityFlags {
  const stage = Math.max(0, Math.min(5, Math.trunc(input.releaseStage)));
  return {
    releaseStage: stage,
    workCore: stage >= 1,
    documentPreparation: stage >= 2,
    localDocumentIntelligence: stage >= 3 && input.localOcrInstallAvailable,
    projectMemory: stage >= 4,
    productionHardening: stage >= 5,
    // Cloud adapters stay disabled until a server-side credential and consent policy exist.
    cloudDocumentIntelligence: false,
  };
}
