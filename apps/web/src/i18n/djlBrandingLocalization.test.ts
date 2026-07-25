import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("DJL localization branding", () => {
  it("does not expose the embedded OpenCode compatibility name in locale copy", () => {
    const localeDirectory = fileURLToPath(new URL("./locales", import.meta.url));
    const localeFiles = readdirSync(localeDirectory).filter((fileName) =>
      fileName.endsWith(".json"),
    );

    for (const fileName of localeFiles) {
      const contents = readFileSync(new URL(`./locales/${fileName}`, import.meta.url), "utf8");
      expect(contents, fileName).not.toContain("OpenCode");
    }
  });
});
