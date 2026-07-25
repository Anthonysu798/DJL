import {
  APP_LOCALES,
  SOURCE_APP_LOCALE,
  type AppLocale,
  type AppLocalePreference,
} from "@synara/contracts";
import {
  APP_LOCALE_REVIEW_STATUS,
  normalizeReleaseLocalePreference,
  resolveAppLocalePreference,
} from "@synara/shared/locale";
import { createInstance, type i18n } from "i18next";
import englishCatalog from "./locales/en.json";
import simplifiedChineseCatalog from "./locales/zh-Hans.json";
import traditionalChineseCatalog from "./locales/zh-Hant.json";
import japaneseCatalog from "./locales/ja.json";
import koreanCatalog from "./locales/ko.json";
import latinAmericanSpanishCatalog from "./locales/es-419.json";
import frenchCatalog from "./locales/fr.json";

export type DesktopCatalog = typeof englishCatalog;
export type DesktopTranslate = (key: string, options?: Record<string, unknown>) => string;

export const DESKTOP_CATALOGS: Record<AppLocale, DesktopCatalog> = {
  en: englishCatalog,
  "zh-Hans": simplifiedChineseCatalog,
  "zh-Hant": traditionalChineseCatalog,
  ja: japaneseCatalog,
  ko: koreanCatalog,
  "es-419": latinAmericanSpanishCatalog,
  fr: frenchCatalog,
};

export function desktopCatalogShape(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return typeof value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, desktopCatalogShape(nested)]),
  );
}

export interface DesktopI18nRuntime {
  readonly instance: i18n;
  readonly locale: AppLocale;
  readonly preference: AppLocalePreference;
  readonly t: DesktopTranslate;
  applyPreference(
    preference: AppLocalePreference,
    systemLocaleCandidates: readonly string[],
  ): Promise<AppLocale>;
}

export async function createDesktopI18n(
  initialPreference: AppLocalePreference,
  systemLocaleCandidates: readonly string[],
  production = false,
): Promise<DesktopI18nRuntime> {
  const instance = createInstance();
  let preference = normalizeReleaseLocalePreference(initialPreference, production);
  const resolveLocale = (
    candidatePreference: AppLocalePreference,
    candidates: readonly string[],
  ) => {
    const candidate = resolveAppLocalePreference(candidatePreference, candidates);
    return production &&
      candidatePreference === "system" &&
      APP_LOCALE_REVIEW_STATUS[candidate] !== "approved"
      ? SOURCE_APP_LOCALE
      : candidate;
  };
  let locale = resolveLocale(preference, systemLocaleCandidates);
  await instance.init({
    fallbackLng: SOURCE_APP_LOCALE,
    initAsync: false,
    interpolation: { escapeValue: false },
    lng: locale,
    load: "currentOnly",
    resources: Object.fromEntries(
      APP_LOCALES.map((id) => [id, { translation: DESKTOP_CATALOGS[id] }]),
    ),
    supportedLngs: [...APP_LOCALES],
  });

  return {
    instance,
    get locale() {
      return locale;
    },
    get preference() {
      return preference;
    },
    get t() {
      return instance.getFixedT(locale, "translation") as unknown as DesktopTranslate;
    },
    async applyPreference(nextPreference, candidates) {
      preference = normalizeReleaseLocalePreference(nextPreference, production);
      locale = resolveLocale(preference, candidates);
      await instance.changeLanguage(locale);
      return locale;
    },
  };
}

let activeDesktopI18n: DesktopI18nRuntime | null = null;

export async function initializeDesktopI18n(
  preference: AppLocalePreference,
  candidates: readonly string[],
  production = false,
): Promise<DesktopI18nRuntime> {
  activeDesktopI18n = await createDesktopI18n(preference, candidates, production);
  return activeDesktopI18n;
}

export function getDesktopI18n(): DesktopI18nRuntime {
  if (!activeDesktopI18n) throw new Error("Desktop i18n is not initialized.");
  return activeDesktopI18n;
}

export const desktopT: DesktopTranslate = (key, options) => getDesktopI18n().t(key, options);
