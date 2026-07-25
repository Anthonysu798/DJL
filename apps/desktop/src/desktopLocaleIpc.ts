import {
  APP_LOCALE_PREFERENCES,
  type AppLocalePreferenceValue,
} from "@synara/contracts/locale-values";

export const DESKTOP_LOCALE_IPC_CHANNELS = {
  preferredSystemLanguages: "desktop:locale-preferred-system-languages",
  applyPreference: "desktop:locale-apply-preference",
} as const;

const preferenceSet = new Set<unknown>(APP_LOCALE_PREFERENCES);

export function parseLocalePreferenceForIpc(value: unknown): AppLocalePreferenceValue {
  if (!preferenceSet.has(value)) {
    throw new TypeError("Invalid locale preference.");
  }
  return value as AppLocalePreferenceValue;
}

export function parsePreferredSystemLanguagesForIpc(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const normalized = candidate.trim();
    return normalized ? [normalized] : [];
  });
}
