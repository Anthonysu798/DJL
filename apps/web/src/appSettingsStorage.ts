import type { AppLocalePreference } from "@synara/contracts";
import { normalizeReleaseLocalePreference } from "@synara/shared/locale";

export const APP_SETTINGS_STORAGE_KEY = "synara:app-settings:v1";

/** Reads only the locale field so renderer i18n can initialize before React mounts. */
export function readStoredAppLocalePreference(
  storage?: Pick<Storage, "getItem"> | null,
  production = import.meta.env.PROD,
): AppLocalePreference {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    const raw = target?.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return "system";
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "system";
    return normalizeReleaseLocalePreference(
      (parsed as { language?: unknown }).language,
      production,
    );
  } catch {
    return "system";
  }
}
