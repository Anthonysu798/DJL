import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { APP_LOCALE_PREFERENCES, APP_LOCALES, AppLocale, AppLocalePreference } from "./locale";

describe("locale contracts", () => {
  it("defines the supported app locale ids", () => {
    expect(APP_LOCALES).toEqual(["en", "zh-Hans", "zh-Hant", "ja", "ko", "es-419", "fr"]);
    expect(Schema.decodeUnknownSync(AppLocale)("es-419")).toBe("es-419");
    expect(() => Schema.decodeUnknownSync(AppLocale)("de")).toThrow();
  });

  it("adds system as a locale preference without making it an app locale", () => {
    expect(APP_LOCALE_PREFERENCES).toEqual(["system", ...APP_LOCALES]);
    expect(Schema.decodeUnknownSync(AppLocalePreference)("system")).toBe("system");
    expect(() => Schema.decodeUnknownSync(AppLocale)("system")).toThrow();
  });
});
