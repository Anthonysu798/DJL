import type { ServerProviderStatus } from "@synara/contracts";
import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";
import english from "../../i18n/locales/en.json";
import spanish from "../../i18n/locales/es-419.json";
import french from "../../i18n/locales/fr.json";
import japanese from "../../i18n/locales/ja.json";
import korean from "../../i18n/locales/ko.json";
import simplifiedChinese from "../../i18n/locales/zh-Hans.json";
import traditionalChinese from "../../i18n/locales/zh-Hant.json";
import { ProviderHealthBanner } from "./ProviderHealthBanner";
import { ThreadErrorBanner } from "./ThreadErrorBanner";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: english },
    interpolation: { escapeValue: false },
  });
});
const status: ServerProviderStatus = {
  provider: "opencode",
  status: "error",
  available: false,
  authStatus: "unknown",
  checkedAt: "2026-10-28T14:00:00.000Z",
  message: "Synthetic provider unavailable",
};
function renderBanner(next: ServerProviderStatus | null) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ProviderHealthBanner status={next} />
    </I18nextProvider>,
  );
}
describe("provider availability before sending", () => {
  it("gives factual preparation guidance for a generic availability error", () => {
    const html = renderBanner(status);
    expect(html).toContain("Check provider settings before sending a message.");
    expect(html).not.toContain("Retry the task");
  });
  it("keeps actual generic thread failure retry guidance unchanged", () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ThreadErrorBanner error="provider exited with code 1" />
      </I18nextProvider>,
    );
    expect(html).toContain(english.chat.errors.providerFailure.generic.action);
    expect(html).not.toContain("Check provider settings before sending a message.");
  });
  it.each([
    ["401 unauthorized: invalid API key", "authentication"],
    ["spawn codex ENOENT", "commandMissing"],
    ["Working folder is unavailable: /tmp/deleted", "workspaceMissing"],
    ["EACCES: permission denied", "permission"],
    ["429 too many requests", "rateLimit"],
    ["socket connection timed out", "connection"],
  ] as const)("preserves existing %s availability guidance", (message, kind) => {
    expect(renderBanner({ ...status, message })).toContain(
      renderToStaticMarkup(<span>{english.chat.errors.providerFailure[kind].action}</span>),
    );
  });
  it("preserves warning copy and hides ready or absent provider state", () => {
    expect(renderBanner({ ...status, status: "warning" })).toContain("limited availability");
    expect(renderBanner({ ...status, status: "ready" })).toBe("");
    expect(renderBanner(null)).toBe("");
  });
  it("localizes the preparation action in every supported catalog", () => {
    for (const catalog of [
      spanish,
      french,
      japanese,
      korean,
      simplifiedChinese,
      traditionalChinese,
    ]) {
      const health = catalog.chat.health as unknown as Record<string, string>;
      expect(health.checkSettingsBeforeSending).toBeTruthy();
      expect(health.checkSettingsBeforeSending).not.toBe(
        "Check provider settings before sending a message.",
      );
    }
  });
});
