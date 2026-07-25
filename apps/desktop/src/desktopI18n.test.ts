import { describe, expect, it } from "vitest";
import { APP_LOCALES, type AppLocale } from "@synara/contracts";
import { createDesktopI18n, DESKTOP_CATALOGS, desktopCatalogShape } from "./desktopI18n";

describe("desktop i18n", () => {
  it("keeps all seven desktop catalogs in exact key parity", () => {
    expect(Object.keys(DESKTOP_CATALOGS)).toEqual([...APP_LOCALES]);
    const englishShape = desktopCatalogShape(DESKTOP_CATALOGS.en);
    for (const locale of APP_LOCALES) {
      expect(desktopCatalogShape(DESKTOP_CATALOGS[locale])).toEqual(englishShape);
    }
  });

  it("resolves system candidates and retains English fallback", async () => {
    const runtime = await createDesktopI18n("system", ["de-DE", "ja-JP"]);
    expect(runtime.locale).toBe("ja");
    expect(runtime.t("menu.file")).toBe("ファイル");

    runtime.instance.removeResourceBundle("ja", "translation");
    expect(runtime.t("menu.file")).toBe("File");
    expect(runtime.t("remote.gatewayExited", { reason: "SIGTERM" })).toBe(
      "Remote gateway exited (SIGTERM). Reconnecting…",
    );
  });

  it("applies an explicit locale and re-resolves system preferences", async () => {
    const runtime = await createDesktopI18n("fr", ["ko-KR"]);
    expect(await runtime.applyPreference("ko", ["fr-FR"])).toBe("ko");
    expect(runtime.t("menu.settings")).toBe("설정…");
    expect(await runtime.applyPreference("system", ["zh-TW"])).toBe("zh-Hant");
  });

  it("reconciles persisted drafts and draft system locales to English in production", async () => {
    const system = await createDesktopI18n("system", ["fr-FR"], true);
    const persisted = await createDesktopI18n("fr", ["en-US"], true);

    expect(system.locale).toBe("en");
    expect(persisted.preference).toBe("system");
    expect(persisted.locale).toBe("en");
    expect(await system.applyPreference("system", ["ja-JP"])).toBe("en");
  });
});
