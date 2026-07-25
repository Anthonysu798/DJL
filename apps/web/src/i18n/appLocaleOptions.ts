import type { AppLocale, AppLocalePreference } from "@synara/contracts";
import { APP_LOCALE_REVIEW_STATUS } from "@synara/shared/locale";

export const APP_LANGUAGE_OPTIONS: readonly {
  value: AppLocalePreference;
  nativeLabel: string | null;
}[] = [
  { value: "system", nativeLabel: null },
  { value: "en", nativeLabel: "English" },
  { value: "zh-Hans", nativeLabel: "简体中文" },
  { value: "zh-Hant", nativeLabel: "繁體中文" },
  { value: "ja", nativeLabel: "日本語" },
  { value: "ko", nativeLabel: "한국어" },
  { value: "es-419", nativeLabel: "Español (Latinoamérica)" },
  { value: "fr", nativeLabel: "Français" },
];

export const APP_LANGUAGE_NATIVE_LABELS = Object.fromEntries(
  APP_LANGUAGE_OPTIONS.filter(
    (option): option is { value: AppLocale; nativeLabel: string } => option.value !== "system",
  ).map((option) => [option.value, option.nativeLabel]),
) as Record<AppLocale, string>;

/** Human review gate for release presentation; runtime support remains independent. */
export const localeReviewStatus = APP_LOCALE_REVIEW_STATUS;

export function selectableLanguageOptions(options: {
  readonly production: boolean;
  readonly preference: AppLocalePreference;
}): typeof APP_LANGUAGE_OPTIONS {
  if (!options.production) return APP_LANGUAGE_OPTIONS;
  return APP_LANGUAGE_OPTIONS.filter(
    (option) => option.value === "system" || localeReviewStatus[option.value] === "approved",
  );
}
