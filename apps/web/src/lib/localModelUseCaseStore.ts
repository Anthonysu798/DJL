import type { LocalModelUseCase } from "@synara/contracts";

const STORAGE_KEY = "djl.local-model-use-case.v1";
export const LOCAL_MODEL_USE_CASES = [
  "general",
  "document",
  "reasoning",
  "coding",
] as const satisfies ReadonlyArray<LocalModelUseCase>;
const LOCAL_MODEL_USE_CASE_SET = new Set<LocalModelUseCase>(LOCAL_MODEL_USE_CASES);

export function readLocalModelUseCase(): LocalModelUseCase {
  if (typeof window === "undefined") return "general";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY) as LocalModelUseCase | null;
    return value && LOCAL_MODEL_USE_CASE_SET.has(value) ? value : "general";
  } catch {
    return "general";
  }
}

export function writeLocalModelUseCase(useCase: LocalModelUseCase): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, useCase);
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}
