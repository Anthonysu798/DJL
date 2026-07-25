// FILE: AppTranslate.ts
// Purpose: Structural translation boundary compatible with i18next and deterministic test doubles.

export interface AppTranslate {
  (key: string): string;
  (key: string, options: Record<string, unknown>): string;
}
