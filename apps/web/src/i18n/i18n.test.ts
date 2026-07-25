import { describe, expect, it, vi } from "vitest";
import type { AppLocale } from "@synara/contracts";
import {
  applyDesktopLocalePreference,
  changeRendererLocale,
  I18N_NAMESPACES,
  initializeI18nInstance,
  installSystemLocaleListener,
  initializeRendererI18n,
  synchronizeDesktopLocalePreference,
  type LocaleCatalog,
} from "./index";
import englishCatalog from "./locales/en.json";
import simplifiedChineseCatalog from "./locales/zh-Hans.json";
import traditionalChineseCatalog from "./locales/zh-Hant.json";
import japaneseCatalog from "./locales/ja.json";
import koreanCatalog from "./locales/ko.json";
import latinAmericanSpanishCatalog from "./locales/es-419.json";
import frenchCatalog from "./locales/fr.json";
import {
  APP_LANGUAGE_OPTIONS,
  localeReviewStatus,
  selectableLanguageOptions,
} from "./appLocaleOptions";

const makeCatalog = (label: string): LocaleCatalog =>
  Object.fromEntries(
    I18N_NAMESPACES.map((namespace) => [namespace, { seed: `${label}:${namespace}` }]),
  ) as unknown as LocaleCatalog;

describe("renderer i18n initialization", () => {
  it("rejects invalid locale results returned by the desktop bridge", async () => {
    await expect(
      applyDesktopLocalePreference("system", {
        applyPreference: vi.fn(async () => "de-DE"),
      }),
    ).resolves.toBeNull();
  });

  it("reconciles the initial renderer preference with the desktop cache", async () => {
    const applyPreference = vi.fn(async () => "fr" as const);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          locale: {
            getPreferredSystemLanguages: () => ["fr-CA"],
            applyPreference,
          },
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    await initializeRendererI18n();
    await changeRendererLocale("ja");

    expect(applyPreference).toHaveBeenNthCalledWith(1, "system");
    expect(applyPreference).toHaveBeenNthCalledWith(2, "ja");
  });
  it("loads English and the resolved active locale before becoming ready", async () => {
    const loadCatalog = vi.fn(async (locale: AppLocale) => {
      const catalog = makeCatalog(locale);
      if (locale === "en") {
        (catalog.common as Record<string, string>).sourceOnly = "English fallback";
      }
      return catalog;
    });
    const documentElement = { lang: "", dir: "" };

    const result = await initializeI18nInstance({
      languages: ["de-DE", "zh-TW", "fr-FR"],
      loadCatalog,
      documentElement,
    });

    expect(loadCatalog.mock.calls.map(([locale]) => locale)).toEqual(["en", "zh-Hant"]);
    expect(result.locale).toBe("zh-Hant");
    expect(result.instance.isInitialized).toBe(true);
    expect(result.instance.t("seed", { ns: "common" })).toBe("zh-Hant:common");
    expect(result.instance.t("sourceOnly", { ns: "common" })).toBe("English fallback");
    expect(documentElement).toEqual({ lang: "zh-Hant", dir: "ltr" });
  });

  it("falls back safely to English when the active locale chunk fails", async () => {
    const loadCatalog = vi.fn(async (locale: AppLocale) => {
      if (locale === "ja") throw new Error("chunk unavailable");
      return makeCatalog("en");
    });
    const documentElement = { lang: "", dir: "" };

    const result = await initializeI18nInstance({
      languages: ["ja-JP"],
      loadCatalog,
      documentElement,
    });

    expect(loadCatalog.mock.calls.map(([locale]) => locale)).toEqual(["en", "ja"]);
    expect(result.locale).toBe("en");
    expect(result.instance.t("seed", { ns: "common" })).toBe("en:common");
    expect(documentElement).toEqual({ lang: "en", dir: "ltr" });
  });

  it("does not resolve a draft locale from the system in production", async () => {
    const result = await initializeI18nInstance({
      languages: ["fr-CA"],
      loadCatalog: async (locale) => makeCatalog(locale),
      documentElement: { lang: "", dir: "" },
      production: true,
    });

    expect(result.preference).toBe("system");
    expect(result.locale).toBe("en");
  });

  it("reconciles an explicitly persisted draft preference to system English in production", async () => {
    const result = await initializeI18nInstance({
      preference: "fr",
      languages: ["en-US"],
      loadCatalog: async (locale) => makeCatalog(locale),
      documentElement: { lang: "", dir: "" },
      production: true,
    });

    expect(result.preference).toBe("system");
    expect(result.locale).toBe("en");
  });

  it("lazy-loads live locale changes while retaining the English fallback", async () => {
    const loadCatalog = vi.fn(async (locale: AppLocale) => {
      const catalog = makeCatalog(locale);
      if (locale === "en") {
        (catalog.common as Record<string, string>).sourceOnly = "English fallback";
      }
      return catalog;
    });
    const documentElement = { lang: "", dir: "" };
    const result = await initializeI18nInstance({
      preference: "en",
      loadCatalog,
      documentElement,
    });

    await result.changeLocale("fr", ["en-US"]);

    expect(loadCatalog.mock.calls.map(([locale]) => locale)).toEqual(["en", "fr"]);
    expect(result.instance.t("seed", { ns: "common" })).toBe("fr:common");
    expect(result.instance.t("sourceOnly", { ns: "common" })).toBe("English fallback");
    expect(documentElement).toEqual({ lang: "fr", dir: "ltr" });
  });

  it("re-resolves browser language changes only while following the system", async () => {
    let languages = ["en-US"];
    const target = new EventTarget();
    const result = await initializeI18nInstance({
      preference: "system",
      languages,
      loadCatalog: async (locale) => makeCatalog(locale),
      documentElement: { lang: "", dir: "" },
    });
    const removeListener = installSystemLocaleListener({
      controller: result,
      eventTarget: target,
      getLanguages: () => languages,
    });

    languages = ["ja-JP"];
    target.dispatchEvent(new Event("languagechange"));
    await vi.waitFor(() => expect(result.instance.language).toBe("ja"));

    await result.changeLocale("fr", languages);
    languages = ["ko-KR"];
    target.dispatchEvent(new Event("languagechange"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.instance.language).toBe("fr");
    removeListener();
  });

  it("does not let a stale slow locale change overwrite the latest locale", async () => {
    const documentElement = { lang: "", dir: "" };
    const result = await initializeI18nInstance({
      preference: "en",
      loadCatalog: async (locale) => makeCatalog(locale),
      documentElement,
    });
    const originalChangeLanguage = result.instance.changeLanguage.bind(result.instance);
    let releaseJapanese!: () => void;
    const japaneseGate = new Promise<void>((resolve) => {
      releaseJapanese = resolve;
    });
    vi.spyOn(result.instance, "changeLanguage").mockImplementation(async (locale) => {
      if (locale === "ja") await japaneseGate;
      return originalChangeLanguage(locale);
    });

    const staleChange = result.changeLocale("ja", ["ja-JP"]);
    await Promise.resolve();
    await result.changeLocale("fr", ["fr-FR"]);
    releaseJapanese();
    await staleChange;

    expect(result.locale).toBe("fr");
    expect(result.instance.language).toBe("fr");
    expect(documentElement).toEqual({ lang: "fr", dir: "ltr" });
  });

  it("serializes rapid native preference updates so a stale apply cannot win", async () => {
    const controller = await initializeI18nInstance({
      preference: "en",
      loadCatalog: async (locale) => makeCatalog(locale),
      documentElement: { lang: "", dir: "" },
    });
    let nativePreference = "en";
    let releaseJapanese!: () => void;
    const japaneseGate = new Promise<void>((resolve) => {
      releaseJapanese = resolve;
    });
    const applyPreference = vi.fn(async (preference: string) => {
      if (preference === "ja") await japaneseGate;
      nativePreference = preference;
      return preference;
    });

    await controller.changeLocale("ja", ["ja-JP"]);
    const japaneseSync = synchronizeDesktopLocalePreference(controller, "ja", {
      applyPreference,
    } as never);
    await vi.waitFor(() => expect(applyPreference).toHaveBeenCalledWith("ja"));
    await controller.changeLocale("fr", ["fr-FR"]);
    const frenchSync = synchronizeDesktopLocalePreference(controller, "fr", {
      applyPreference,
    } as never);
    releaseJapanese();
    await Promise.all([japaneseSync, frenchSync]);

    expect(applyPreference.mock.calls.map(([preference]) => preference)).toEqual(["ja", "fr"]);
    expect(nativePreference).toBe("fr");
    expect(controller.preference).toBe("fr");
  });

  it("keeps system preference while reconciling to main's resolved locale", async () => {
    const controller = await initializeI18nInstance({
      preference: "system",
      languages: ["fr-FR"],
      loadCatalog: async (locale) => makeCatalog(locale),
      documentElement: { lang: "", dir: "" },
    });
    const applyPreference = vi.fn(async () => "ja" as const);

    await synchronizeDesktopLocalePreference(controller, "system", { applyPreference } as never);

    expect(applyPreference).toHaveBeenCalledTimes(1);
    expect(controller.preference).toBe("system");
    expect(controller.locale).toBe("ja");
    expect(controller.instance.language).toBe("ja");
  });

  it("reconciles a system languagechange through native resolution without a loop", async () => {
    let languages = ["en-US"];
    const target = new EventTarget();
    const controller = await initializeI18nInstance({
      preference: "system",
      languages,
      loadCatalog: async (locale) => makeCatalog(locale),
      documentElement: { lang: "", dir: "" },
    });
    const applyPreference = vi.fn(async () => "ko" as const);
    const remove = installSystemLocaleListener({
      controller,
      eventTarget: target,
      getLanguages: () => languages,
      onResolved: (preference) => {
        void synchronizeDesktopLocalePreference(controller, preference, { applyPreference });
      },
    });

    languages = ["ja-JP"];
    target.dispatchEvent(new Event("languagechange"));
    await vi.waitFor(() => expect(controller.locale).toBe("ko"));

    expect(controller.preference).toBe("system");
    expect(applyPreference).toHaveBeenCalledTimes(1);
    remove();
  });
});

describe("real locale catalogs", () => {
  it("ships approved English and Chinese while keeping other secondary locales development-only", () => {
    expect(localeReviewStatus.en).toBe("approved");
    expect(localeReviewStatus["zh-Hans"]).toBe("approved");
    expect(localeReviewStatus["zh-Hant"]).toBe("approved");
    expect(localeReviewStatus.fr).toBe("draft");
    expect(selectableLanguageOptions({ production: false, preference: "system" })).toEqual(
      APP_LANGUAGE_OPTIONS,
    );
    expect(
      selectableLanguageOptions({ production: true, preference: "system" }).map(
        (option) => option.value,
      ),
    ).toEqual(["system", "en", "zh-Hans", "zh-Hant"]);
    expect(
      selectableLanguageOptions({ production: true, preference: "fr" }).map(
        (option) => option.value,
      ),
    ).toEqual(["system", "en", "zh-Hans", "zh-Hant"]);
  });

  it("provides the complete language selector with native language names", () => {
    expect(APP_LANGUAGE_OPTIONS).toEqual([
      { value: "system", nativeLabel: null },
      { value: "en", nativeLabel: "English" },
      { value: "zh-Hans", nativeLabel: "简体中文" },
      { value: "zh-Hant", nativeLabel: "繁體中文" },
      { value: "ja", nativeLabel: "日本語" },
      { value: "ko", nativeLabel: "한국어" },
      { value: "es-419", nativeLabel: "Español (Latinoamérica)" },
      { value: "fr", nativeLabel: "Français" },
    ]);
    expect(frenchCatalog.settings.appearance.language.title).toBe("Langue de l’application");
  });

  it("keeps every namespace and nested key shape in parity with English", () => {
    const catalogs = [
      simplifiedChineseCatalog,
      traditionalChineseCatalog,
      japaneseCatalog,
      koreanCatalog,
      latinAmericanSpanishCatalog,
      frenchCatalog,
    ];
    const shape = (value: unknown): unknown =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, nested]) => [key, shape(nested)]),
          )
        : typeof value;

    expect(Object.keys(englishCatalog)).toEqual([...I18N_NAMESPACES]);
    for (const catalog of catalogs) {
      expect(shape(catalog)).toEqual(shape(englishCatalog));
    }
  });
});
