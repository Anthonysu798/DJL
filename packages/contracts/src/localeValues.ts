// Runtime-light locale constants shared with Electron's sandboxed preload.

export const APP_LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "es-419", "fr"] as const;

export type AppLocaleValue = (typeof APP_LOCALES)[number];

export const APP_LOCALE_PREFERENCES = ["system", ...APP_LOCALES] as const;

export type AppLocalePreferenceValue = (typeof APP_LOCALE_PREFERENCES)[number];

export const SOURCE_APP_LOCALE: AppLocaleValue = "en";
