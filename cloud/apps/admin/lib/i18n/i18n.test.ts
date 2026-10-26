import { afterEach, describe, expect, it, vi } from "vitest";

import { catalogs, translate } from "./index";
import { formatCredits } from "./format";
import { LOCALE_BOOT_SCRIPT, resolveLocale } from "./locale";

afterEach(() => vi.restoreAllMocks());

describe("admin localization", () => {
  it("uses browser language before paint even when preference storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CA"]);
    new Function(LOCALE_BOOT_SCRIPT)();
    expect(document.documentElement.lang).toBe("fr");
  });
  it("resolves saved, regional and unsupported locales deterministically", () => {
    expect(resolveLocale("fr", ["zh-CN"])).toBe("fr");
    expect(resolveLocale("invalid", ["zh-HK", "en"])).toBe("zh-Hant");
    expect(resolveLocale(null, ["zh-SG"])).toBe("zh-Hans");
    expect(resolveLocale(null, ["es-ES"])).toBe("es-419");
    expect(resolveLocale(null, ["de-DE", "ko-KR"])).toBe("ko");
    expect(resolveLocale(null, ["de-DE"])).toBe("en");
  });

  it("has complete catalogs with matching interpolation placeholders", () => {
    const keys = Object.keys(catalogs.en).sort();
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const catalog of Object.values(catalogs)) {
      expect(Object.keys(catalog).sort()).toEqual(keys);
      for (const key of keys as (keyof typeof catalogs.en)[]) {
        expect(catalog[key].trim()).not.toBe("");
        expect(placeholders(catalog[key])).toEqual(placeholders(catalogs.en[key]));
      }
    }
  });

  it("translates named values without interpreting supplied data as a template", () => {
    expect(translate("zh-Hans", "common.required", { label: "Email" })).toBe("Email为必填项。");
    expect(translate("en", "common.required", { label: "{private}" })).toBe(
      "{private} is required.",
    );
  });

  it("preserves large and negative microcredit precision", () => {
    expect(formatCredits("9007199254740993123456", "en")).toBe("9,007,199,254,740,993.123456");
    expect(formatCredits("-1000001", "en")).toBe("-1.000001");
    expect(formatCredits("0", "en")).toBe("0.00");
    expect(formatCredits("1234567890", "fr")).toBe("1 234,56789");
  });
});
