import {
  APP_LOCALES,
  APP_LOCALE_PREFERENCES,
  SOURCE_APP_LOCALE,
  type AppLocale,
  type AppLocalePreference,
} from "@synara/contracts";
import reviewStatus from "./localeReviewStatus.json";

export type LocaleReviewStatus = "approved" | "draft";

function parseLocaleReviewStatus(
  input: Record<AppLocale, string>,
): Record<AppLocale, LocaleReviewStatus> {
  const entries = APP_LOCALES.map((locale) => {
    const status = input[locale];
    if (status !== "approved" && status !== "draft") {
      throw new Error(`Invalid locale review status for ${locale}.`);
    }
    return [locale, status] as const;
  });
  return Object.fromEntries(entries) as Record<AppLocale, LocaleReviewStatus>;
}

export const APP_LOCALE_REVIEW_STATUS = parseLocaleReviewStatus(reviewStatus);

const APP_LOCALE_PREFERENCE_SET = new Set<string>(APP_LOCALE_PREFERENCES);
const TRADITIONAL_CHINESE_REGIONS = new Set(["HK", "MO", "TW"]);

export function normalizeAppLocale(candidate: string): AppLocale | undefined {
  const normalizedCandidate = candidate.trim().replaceAll("_", "-");
  if (!normalizedCandidate) return undefined;

  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(normalizedCandidate);
  } catch {
    return undefined;
  }

  switch (locale.language.toLowerCase()) {
    case "en":
      return "en";
    case "zh":
      return locale.script === "Hant" || TRADITIONAL_CHINESE_REGIONS.has(locale.region ?? "")
        ? "zh-Hant"
        : "zh-Hans";
    case "ja":
      return "ja";
    case "ko":
      return "ko";
    case "es":
      return "es-419";
    case "fr":
      return "fr";
    default:
      return undefined;
  }
}

export function resolveAppLocale(candidates: readonly string[]): AppLocale {
  for (const candidate of candidates) {
    const locale = normalizeAppLocale(candidate);
    if (locale) return locale;
  }
  return SOURCE_APP_LOCALE;
}

export function normalizeAppLocalePreference(value: unknown): AppLocalePreference {
  return typeof value === "string" && APP_LOCALE_PREFERENCE_SET.has(value)
    ? (value as AppLocalePreference)
    : "system";
}

export function normalizeReleaseLocalePreference(
  value: unknown,
  production: boolean,
): AppLocalePreference {
  const preference = normalizeAppLocalePreference(value);
  return production &&
    preference !== "system" &&
    APP_LOCALE_REVIEW_STATUS[preference] !== "approved"
    ? "system"
    : preference;
}

export function resolveAppLocalePreference(
  preference: unknown,
  systemLocaleCandidates: readonly string[],
): AppLocale {
  const normalizedPreference = normalizeAppLocalePreference(preference);
  return normalizedPreference === "system"
    ? resolveAppLocale(systemLocaleCandidates)
    : normalizedPreference;
}
