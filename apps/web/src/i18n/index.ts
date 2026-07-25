import {
  APP_LOCALES,
  SOURCE_APP_LOCALE,
  type AppLocale,
  type AppLocalePreference,
} from "@synara/contracts";
import {
  normalizeAppLocalePreference,
  normalizeReleaseLocalePreference,
  resolveAppLocalePreference,
} from "@synara/shared/locale";
import { createInstance, type i18n as I18nInstance, type ResourceKey } from "i18next";
import { initReactI18next } from "react-i18next";
import englishCatalog from "./locales/en.json";
import { readStoredAppLocalePreference } from "../appSettingsStorage";
import { localeReviewStatus } from "./appLocaleOptions";

export const I18N_NAMESPACES = [
  "chat",
  "common",
  "notifications",
  "settings",
  "shell",
  "whatsNew",
  "work",
  "workspace",
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];
export type LocaleCatalog = Record<I18nNamespace, ResourceKey>;
export type LocaleCatalogLoader = (locale: AppLocale) => Promise<LocaleCatalog>;

const localeCatalogLoaders: Record<AppLocale, () => Promise<LocaleCatalog>> = {
  en: async () => englishCatalog,
  "zh-Hans": async () => (await import("./locales/zh-Hans.json")).default,
  "zh-Hant": async () => (await import("./locales/zh-Hant.json")).default,
  ja: async () => (await import("./locales/ja.json")).default,
  ko: async () => (await import("./locales/ko.json")).default,
  "es-419": async () => (await import("./locales/es-419.json")).default,
  fr: async () => (await import("./locales/fr.json")).default,
};

export const loadLocaleCatalog: LocaleCatalogLoader = (locale) => localeCatalogLoaders[locale]();

interface DocumentLocaleTarget {
  dir: string;
  lang: string;
}

export interface InitializeI18nOptions {
  readonly documentElement?: DocumentLocaleTarget | null;
  readonly instance?: I18nInstance;
  readonly languages?: readonly string[];
  readonly loadCatalog?: LocaleCatalogLoader;
  readonly preference?: unknown;
  readonly production?: boolean;
}

export interface InitializedI18n {
  changeLocale: (
    preference: AppLocalePreference,
    languages?: readonly string[],
  ) => Promise<AppLocale>;
  readonly instance: I18nInstance;
  readonly locale: AppLocale;
  readonly preference: AppLocalePreference;
}

function getSystemLanguages(): readonly string[] {
  if (typeof window !== "undefined") {
    try {
      const desktopLanguages = window.desktopBridge?.locale.getPreferredSystemLanguages();
      if (desktopLanguages && desktopLanguages.length > 0) return desktopLanguages;
    } catch {
      // Web and older desktop shells continue with the browser locale signal.
    }
  }
  if (typeof navigator === "undefined") return [];
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}

function getDocumentElement(): DocumentLocaleTarget | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

export async function initializeI18nInstance(
  options: InitializeI18nOptions = {},
): Promise<InitializedI18n> {
  const instance = options.instance ?? createInstance();
  const loadCatalog = options.loadCatalog ?? loadLocaleCatalog;
  const production = options.production ?? import.meta.env.PROD;
  let preference = normalizeReleaseLocalePreference(options.preference, production);
  const resolveLocale = (
    candidatePreference: AppLocalePreference,
    languages: readonly string[],
  ): AppLocale => {
    const candidate = resolveAppLocalePreference(candidatePreference, languages);
    return production &&
      candidatePreference === "system" &&
      localeReviewStatus[candidate] !== "approved"
      ? SOURCE_APP_LOCALE
      : candidate;
  };
  const requestedLocale = resolveLocale(preference, options.languages ?? getSystemLanguages());

  const sourceCatalog = await loadCatalog(SOURCE_APP_LOCALE);
  let locale = requestedLocale;
  let activeCatalog = sourceCatalog;

  if (requestedLocale !== SOURCE_APP_LOCALE) {
    try {
      activeCatalog = await loadCatalog(requestedLocale);
    } catch {
      locale = SOURCE_APP_LOCALE;
    }
  }

  const resources = {
    [SOURCE_APP_LOCALE]: sourceCatalog,
    ...(locale === SOURCE_APP_LOCALE ? {} : { [locale]: activeCatalog }),
  };

  await instance.use(initReactI18next).init({
    defaultNS: "common",
    fallbackLng: SOURCE_APP_LOCALE,
    interpolation: { escapeValue: false },
    lng: locale,
    load: "currentOnly",
    ns: [...I18N_NAMESPACES],
    resources,
    supportedLngs: [...APP_LOCALES],
  });

  const documentElement = options.documentElement ?? getDocumentElement();
  if (documentElement) {
    documentElement.lang = locale;
    documentElement.dir = instance.dir(locale);
  }

  let currentLocale = locale;
  let changeRevision = 0;

  const changeLocale = async (
    nextPreference: AppLocalePreference,
    languages = getSystemLanguages(),
  ): Promise<AppLocale> => {
    preference = normalizeReleaseLocalePreference(nextPreference, production);
    const revision = ++changeRevision;
    const requested = resolveLocale(preference, languages);
    let nextLocale = requested;

    if (!instance.hasResourceBundle(requested, I18N_NAMESPACES[0])) {
      try {
        const catalog = await loadCatalog(requested);
        for (const namespace of I18N_NAMESPACES) {
          instance.addResourceBundle(requested, namespace, catalog[namespace], true, true);
        }
      } catch {
        nextLocale = SOURCE_APP_LOCALE;
      }
    }

    if (revision !== changeRevision) return currentLocale;
    await instance.changeLanguage(nextLocale);
    if (revision !== changeRevision) {
      // A slower, older change may have mutated i18next after the latest request finished.
      // Restore the latest committed locale before returning without touching document state.
      // Repeat if another request commits while that repair is awaiting i18next.
      for (;;) {
        const repairRevision = changeRevision;
        const repairLocale = currentLocale;
        await instance.changeLanguage(repairLocale);
        if (repairRevision === changeRevision && repairLocale === currentLocale) break;
      }
      return currentLocale;
    }
    currentLocale = nextLocale;
    if (documentElement) {
      documentElement.lang = nextLocale;
      documentElement.dir = instance.dir(nextLocale);
    }
    return nextLocale;
  };

  return {
    changeLocale,
    instance,
    get locale() {
      return currentLocale;
    },
    get preference() {
      return preference;
    },
  };
}

interface LanguageChangeEventTarget {
  addEventListener(type: "languagechange", listener: EventListener): void;
  removeEventListener(type: "languagechange", listener: EventListener): void;
}

export function installSystemLocaleListener(options: {
  readonly controller: InitializedI18n;
  readonly eventTarget: LanguageChangeEventTarget;
  readonly getLanguages?: () => readonly string[];
  readonly onResolved?: (preference: AppLocalePreference, locale: AppLocale) => void;
}): () => void {
  const handleLanguageChange: EventListener = () => {
    if (options.controller.preference !== "system") return;
    void options.controller
      .changeLocale("system", options.getLanguages?.() ?? getSystemLanguages())
      .then((locale) => options.onResolved?.("system", locale));
  };
  options.eventTarget.addEventListener("languagechange", handleLanguageChange);
  return () => options.eventTarget.removeEventListener("languagechange", handleLanguageChange);
}

export const rendererI18n: I18nInstance = createInstance();

export function rendererLocale(): string {
  return rendererI18n.resolvedLanguage || rendererI18n.language || SOURCE_APP_LOCALE;
}

/**
 * Translates copy used by non-React domain helpers, while keeping those helpers deterministic
 * before the renderer i18n instance has finished initializing (notably in isolated unit tests).
 */
export function translateRendererCopy(
  key: string,
  defaultValue: string,
  values?: Readonly<Record<string, unknown>>,
): string {
  const translated = rendererI18n.t(key, { defaultValue, ...values });
  if (translated && !translated.includes("{{")) return translated;

  return Object.entries(values ?? {}).reduce(
    (copy, [name, value]) => copy.replaceAll(`{{${name}}}`, String(value)),
    defaultValue,
  );
}
let rendererController: InitializedI18n | null = null;
let removeRendererLanguageListener: (() => void) | null = null;
const desktopLocaleSyncQueues = new WeakMap<InitializedI18n, Promise<void>>();
const appLocaleSet = new Set<unknown>(APP_LOCALES);

interface DesktopLocalePreferenceBridge {
  applyPreference(preference: AppLocalePreference): Promise<unknown>;
}

function getDesktopLocalePreferenceBridge(): DesktopLocalePreferenceBridge | null {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.locale ?? null;
}

export async function applyDesktopLocalePreference(
  preference: AppLocalePreference,
  bridge: DesktopLocalePreferenceBridge | null = getDesktopLocalePreferenceBridge(),
): Promise<AppLocale | null> {
  if (!bridge) return null;
  try {
    const locale = await bridge.applyPreference(preference);
    return appLocaleSet.has(locale) ? (locale as AppLocale) : null;
  } catch {
    // The renderer settings store remains authoritative; desktop sync is best-effort.
    return null;
  }
}

export function synchronizeDesktopLocalePreference(
  controller: InitializedI18n,
  requestedPreference: AppLocalePreference,
  bridge: DesktopLocalePreferenceBridge | null = getDesktopLocalePreferenceBridge(),
): Promise<AppLocale | null> {
  const previous = desktopLocaleSyncQueues.get(controller) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      // A newer renderer request supersedes queued work before it reaches native state.
      if (controller.preference !== requestedPreference) return null;
      const desktopLocale = await applyDesktopLocalePreference(requestedPreference, bridge);
      if (!desktopLocale || controller.preference !== requestedPreference) return desktopLocale;

      // Main is authoritative for system resolution (Electron sees the OS language list).
      // Re-resolve locally using its exact result while retaining the persisted `system` choice.
      if (requestedPreference === "system" && controller.locale !== desktopLocale) {
        await controller.changeLocale("system", [desktopLocale]);
      }
      return desktopLocale;
    });
  desktopLocaleSyncQueues.set(
    controller,
    operation.then(
      () => undefined,
      () => undefined,
    ),
  );
  return operation;
}

export async function initializeRendererI18n(): Promise<AppLocale> {
  rendererController = await initializeI18nInstance({
    instance: rendererI18n,
    preference: readStoredAppLocalePreference(),
  });
  await synchronizeDesktopLocalePreference(rendererController, rendererController.preference);
  removeRendererLanguageListener?.();
  if (typeof window !== "undefined") {
    removeRendererLanguageListener = installSystemLocaleListener({
      controller: rendererController,
      eventTarget: window,
      getLanguages: getSystemLanguages,
      onResolved: (preference) => {
        if (rendererController) {
          void synchronizeDesktopLocalePreference(rendererController, preference);
        }
      },
    });
  }
  return rendererController.locale;
}

export async function changeRendererLocale(preference: AppLocalePreference): Promise<AppLocale> {
  if (!rendererController) {
    await initializeRendererI18n();
  }
  const locale = await rendererController!.changeLocale(preference, getSystemLanguages());
  await synchronizeDesktopLocalePreference(rendererController!, preference);
  return rendererController!.locale ?? locale;
}
