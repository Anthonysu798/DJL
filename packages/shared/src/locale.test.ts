import { describe, expect, it } from "vitest";
import {
  normalizeAppLocale,
  normalizeAppLocalePreference,
  resolveAppLocale,
  resolveAppLocalePreference,
  normalizeReleaseLocalePreference,
} from "./locale";

describe("normalizeAppLocale", () => {
  it.each([
    ["zh-Hant", "zh-Hant"],
    ["zh-Hant-TW", "zh-Hant"],
    ["zh_TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-MO", "zh-Hant"],
    ["zh-Hans", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh", "zh-Hans"],
    ["en-CA", "en"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["es-MX", "es-419"],
    ["fr-CA", "fr"],
  ])("normalizes %s to %s", (candidate, expected) => {
    expect(normalizeAppLocale(candidate)).toBe(expected);
  });

  it("returns undefined for unsupported or malformed candidates", () => {
    expect(normalizeAppLocale("de-DE")).toBeUndefined();
    expect(normalizeAppLocale("not a locale")).toBeUndefined();
  });
});

describe("locale resolution", () => {
  it("keeps unapproved locales in development while preserving approved Chinese in production", () => {
    expect(normalizeReleaseLocalePreference("fr", false)).toBe("fr");
    expect(normalizeReleaseLocalePreference("fr", true)).toBe("system");
    expect(normalizeReleaseLocalePreference("en", true)).toBe("en");
    expect(normalizeReleaseLocalePreference("zh-Hans", true)).toBe("zh-Hans");
    expect(normalizeReleaseLocalePreference("zh-Hant", true)).toBe("zh-Hant");
  });
  it("uses the first supported candidate in order", () => {
    expect(resolveAppLocale(["de-DE", "fr-CA", "ja-JP"])).toBe("fr");
  });

  it("falls back to English when no candidate is supported", () => {
    expect(resolveAppLocale(["de-DE", "ar"])).toBe("en");
    expect(resolveAppLocale([])).toBe("en");
  });

  it("recovers invalid persisted preferences to system", () => {
    expect(normalizeAppLocalePreference("ja")).toBe("ja");
    expect(normalizeAppLocalePreference("system")).toBe("system");
    expect(normalizeAppLocalePreference("ja-JP")).toBe("system");
    expect(normalizeAppLocalePreference(null)).toBe("system");
  });

  it("resolves explicit preferences independently of system candidates", () => {
    expect(resolveAppLocalePreference("ko", ["fr-FR"])).toBe("ko");
    expect(resolveAppLocalePreference("system", ["fr-FR"])).toBe("fr");
  });
});
