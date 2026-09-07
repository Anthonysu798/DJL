import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// OpenCode names the external CLI/provider in these flows; DJL remains the product name.
const OPENCODE_PROVIDER_COPY = new Set([
  "settings.subscriptions.runtimeRequired",
  "settings.subscriptions.unavailable",
  "settings.subscriptions.modelPicker",
  "settings.tools.bundledNote",
  "settings.tools.incompatible",
  "settings.accounts.openCodeSharedLogin",
  "settings.accounts.openCodeTransfer",
  "settings.accounts.openCodeTransferComplete",
  "settings.accounts.codingPlansDescription",
  "workspace.agents.emptyDescription",
]);

function brandingViolations(value: unknown, path = ""): string[] {
  if (typeof value === "string") {
    return value.includes("OpenCode") && !OPENCODE_PROVIDER_COPY.has(path) ? [path] : [];
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    brandingViolations(item, path ? `${path}.${key}` : key),
  );
}

describe("DJL localization branding", () => {
  it("keeps DJL product identity while allowing explicit external provider copy", () => {
    const localeDirectory = fileURLToPath(new URL("./locales", import.meta.url));
    const localeFiles = readdirSync(localeDirectory).filter((fileName) =>
      fileName.endsWith(".json"),
    );

    for (const fileName of localeFiles) {
      const locale = JSON.parse(
        readFileSync(new URL(`./locales/${fileName}`, import.meta.url), "utf8"),
      );
      expect(locale.chat.a11y.djlLogo, fileName).toContain("DJL");
      expect(brandingViolations(locale), fileName).toEqual([]);
    }
  });

  it("does not allow the provider name to replace product branding", () => {
    expect(brandingViolations({ chat: { a11y: { djlLogo: "OpenCode logo" } } })).toEqual([
      "chat.a11y.djlLogo",
    ]);
    expect(brandingViolations({ settings: { tools: { title: "OpenCode settings" } } })).toEqual([
      "settings.tools.title",
    ]);
  });
});
