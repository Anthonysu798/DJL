import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseLocalePreferenceForIpc,
  parsePreferredSystemLanguagesForIpc,
} from "./desktopLocaleIpc";

describe("desktop locale IPC validation", () => {
  it("keeps the sandboxed preload off the runtime contracts schema barrel", () => {
    const source = readFileSync(new URL("./desktopLocaleIpc.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/from ["']@synara\/contracts["']/);
  });

  it("accepts only exact app locale preferences", () => {
    expect(parseLocalePreferenceForIpc("system")).toBe("system");
    expect(parseLocalePreferenceForIpc("es-419")).toBe("es-419");
    expect(() => parseLocalePreferenceForIpc("ja-JP")).toThrow("Invalid locale preference");
    expect(() => parseLocalePreferenceForIpc(null)).toThrow("Invalid locale preference");
  });

  it("returns only non-empty system language strings from synchronous IPC", () => {
    expect(parsePreferredSystemLanguagesForIpc(["fr-CA", "", 4, " ja-JP "])).toEqual([
      "fr-CA",
      "ja-JP",
    ]);
    expect(parsePreferredSystemLanguagesForIpc({ languages: ["fr"] })).toEqual([]);
  });
});
