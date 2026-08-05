import { readFileSync } from "node:fs";
import { ThreadId } from "@synara/contracts";
import { createInstance, type TFunction } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";

import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { ProfileSettingsPanel } from "../components/settings/ProfileSettingsPanel";
import { ProviderUsageSettingsPanel } from "../components/settings/ProviderUsageSettingsPanel";
import { SkillsSettingsPanel } from "../components/settings/SkillsSettingsPanel";
import { KeyboardShortcutsSettingsPanel } from "../components/settings/KeyboardShortcutsSettingsPanel";
import {
  buildInputNeededCopy,
  buildTaskCompletionCopy,
} from "../notifications/taskCompletion.logic";
import { showDesktopThreadNotification } from "../notifications/taskCompletion";
import {
  formatSettingsRouteDiagnostic,
  localizeCustomModelValidationError,
  type CustomModelValidationError,
} from "../routes/_chat.settings";
import englishCatalog from "./locales/en.json";
import simplifiedChineseCatalog from "./locales/zh-Hans.json";
import frenchCatalog from "./locales/fr.json";
import { SETTINGS_SEARCH_ENTRIES } from "../settingsSearchIndex";

function SettingsNotificationsProbe({ count }: { count: number }) {
  const { t } = useTranslation(["settings", "notifications", "whatsNew"]);
  return (
    <div>
      <SettingsSection title={t("profile.activity.title", { ns: "settings" })}>
        <SettingsRow
          title={t("notifications.desktop.title", { ns: "settings" })}
          description={t("notifications.desktop.description", { ns: "settings" })}
          control={
            <button aria-label={t("notifications.desktop.testAriaLabel", { ns: "settings" })}>
              {t("notifications.desktop.test", { ns: "settings" })}
            </button>
          }
        />
      </SettingsSection>
      <output>{t("profile.plugins.runCount", { ns: "settings", count })}</output>
      <p>{t("history.olderEntriesNotice", { ns: "whatsNew" })}</p>
    </div>
  );
}

function SettingsRouteProbe({ count, rawDetail }: { count: number; rawDetail: string }) {
  const { t } = useTranslation("settings");
  return (
    <div>
      <h2>{t("route.general.sections.coreDefaults")}</h2>
      <button
        aria-label={t("route.general.environment.showAriaLabel", {
          section: t("search.entries.general.environment-usage.title"),
        })}
      >
        {t("search.entries.general.environment-usage.title")}
      </button>
      <output>{t("route.providers.picker.hiddenCount", { count })}</output>
      <p>{t("route.confirmations.restoreDefaults.description", { settings: "Theme, Work" })}</p>
      <p>{t("route.errors.providerUpdate.recovery")}</p>
      <pre>{rawDetail}</pre>
    </div>
  );
}

async function createTestI18n() {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: "common",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    lng: "en",
    resources: {
      en: englishCatalog,
      "zh-Hans": simplifiedChineseCatalog,
      fr: frenchCatalog,
    },
  });
  return instance;
}

describe("settings, profile, notifications, and release localization", () => {
  it("keeps the embedded OpenCode harness out of General settings", () => {
    const source = readFileSync(new URL("../routes/_chat.settings.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('settingId="default-provider"');
    expect(SETTINGS_SEARCH_ENTRIES.some((entry) => entry.id === "general:default-provider")).toBe(
      false,
    );
    expect(englishCatalog.settings.navigation.items.general.description).toBe(
      "Thread mode and sidebar organization.",
    );
  });

  it("localizes semantic validation errors at render time after a live switch", async () => {
    const instance = await createTestI18n();
    const error: CustomModelValidationError = { kind: "required" };

    expect(localizeCustomModelValidationError(error, instance.t)).toBe("Enter a model slug.");

    await instance.changeLanguage("zh-Hans");
    expect(localizeCustomModelValidationError(error, instance.t)).toBe("请输入模型标识。");

    await instance.changeLanguage("fr");
    expect(localizeCustomModelValidationError(error, instance.t)).toBe(
      "Saisissez un identifiant de modèle.",
    );
  });

  it("preserves Error and non-Error diagnostics verbatim and falls back only when absent", () => {
    const fallback = "No additional diagnostic detail was provided.";
    const rawString = "spawn opencode ENOENT --diagnostic=raw";

    expect(formatSettingsRouteDiagnostic(new Error(rawString), fallback)).toBe(rawString);
    expect(formatSettingsRouteDiagnostic(rawString, fallback)).toBe(rawString);
    expect(formatSettingsRouteDiagnostic(17, fallback)).toBe("17");
    expect(formatSettingsRouteDiagnostic(null, fallback)).toBe(fallback);
    expect(formatSettingsRouteDiagnostic(undefined, fallback)).toBe(fallback);
  });

  it("retains worktree-verification rejection details for the user-visible recovery toast", () => {
    const source = readFileSync(new URL("../routes/_chat.settings.tsx", import.meta.url), "utf8");
    const verificationBlock = source.slice(
      source.indexOf("snapshot = await api.orchestration.getShellSnapshot()"),
      source.indexOf("const linkedThreadsFromSnapshot"),
    );

    expect(verificationBlock).toContain("catch (error)");
    expect(verificationBlock).toContain("route.errors.worktreeVerification.recovery");
    expect(verificationBlock).toContain("formatSettingsRouteDiagnostic(error");
    expect(verificationBlock).not.toContain("catch(() => null)");
  });

  it("keeps the localized settings panels loadable", () => {
    expect([
      ProfileSettingsPanel,
      ProviderUsageSettingsPanel,
      SkillsSettingsPanel,
      KeyboardShortcutsSettingsPanel,
    ]).toEqual(expect.arrayContaining([expect.any(Function)]));
  });
  it("switches representative visible, accessibility, and plural copy live", async () => {
    const instance = await createTestI18n();
    const renderProbe = () =>
      renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <SettingsNotificationsProbe count={2} />
        </I18nextProvider>,
      );

    expect(renderProbe()).toContain("Activity insights");
    expect(renderProbe()).toContain('aria-label="Send a test desktop notification"');
    expect(renderProbe()).toContain("2 runs");
    expect(renderProbe()).toContain("Older release notes are available in English only.");

    await instance.changeLanguage("zh-Hans");
    expect(renderProbe()).toContain("活动洞察");
    expect(renderProbe()).toContain('aria-label="发送测试桌面通知"');
    expect(renderProbe()).toContain("运行 2 次");
    expect(renderProbe()).toContain("较早的发行说明仅提供英文版本。");

    await instance.changeLanguage("fr");
    expect(renderProbe()).toContain("Aperçu de l’activité");
    expect(renderProbe()).toContain('aria-label="Envoyer une notification de bureau de test"');
    expect(renderProbe()).toContain("2 exécutions");
    expect(renderProbe()).toContain(
      "Les anciennes notes de version sont disponibles uniquement en anglais.",
    );
  });

  it("switches representative settings-route copy while preserving raw diagnostics", async () => {
    const instance = await createTestI18n();
    const rawDetail = "spawn opencode ENOENT --diagnostic=raw";
    const renderProbe = () =>
      renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <SettingsRouteProbe count={2} rawDetail={rawDetail} />
        </I18nextProvider>,
      );

    expect(renderProbe()).toContain("Core defaults");
    expect(renderProbe()).toContain('aria-label="Show Usage in the Environment panel"');
    expect(renderProbe()).toContain("2 providers hidden");
    expect(renderProbe()).toContain("This will reset: Theme, Work.");
    expect(renderProbe()).toContain("Copy the command below to update manually in a terminal.");
    expect(renderProbe()).toContain(rawDetail);

    await instance.changeLanguage("zh-Hans");
    expect(renderProbe()).toContain("核心默认设置");
    expect(renderProbe()).toContain('aria-label="在环境面板中显示用量"');
    expect(renderProbe()).toContain("已隐藏 2 个提供商");
    expect(renderProbe()).toContain("这将重置：Theme, Work。");
    expect(renderProbe()).toContain("请复制下方命令并在终端中手动更新。");
    expect(renderProbe()).toContain(rawDetail);

    await instance.changeLanguage("fr");
    expect(renderProbe()).toContain("Valeurs par défaut principales");
    expect(renderProbe()).toContain(
      'aria-label="Afficher la section Utilisation dans le panneau Environnement"',
    );
    expect(renderProbe()).toContain("2 fournisseurs masqués");
    expect(renderProbe()).toContain("Les réglages suivants seront réinitialisés : Theme, Work.");
    expect(renderProbe()).toContain(
      "Copiez la commande ci-dessous pour effectuer la mise à jour manuellement dans un terminal.",
    );
    expect(renderProbe()).toContain(rawDetail);
  });

  it("keeps settings search IDs and route deep-link anchors stable", () => {
    const source = readFileSync(new URL("../routes/_chat.settings.tsx", import.meta.url), "utf8");

    for (const settingId of [
      "new-threads",
      "project-order",
      "thread-order",
      "project-instructions",
      "git-writing-model",
      "keybindings",
      "release-history",
    ]) {
      expect(source).toMatch(new RegExp(`settingId(?:=|:)\\s*["']${settingId}["']`));
    }
    expect(source).toContain("id={SETTINGS_TARGETS.environmentPanel}");
    expect(source).toContain("id={SETTINGS_TARGETS.providerUpdates}");
    expect(source).toContain("id={SETTINGS_TARGETS.providerInstalls}");
    expect(source).not.toContain('t("search.entries.general.default-provider.title")');
  });

  it("localizes authored renderer notification copy before IPC and preserves raw detail", async () => {
    const instance = await createTestI18n();
    const completion = {
      threadId: "thread-1",
      projectId: "project-1",
      title: "User-authored thread title",
      completedAt: "2026-07-14T12:00:00.000Z",
      assistantSummary: "raw assistant detail",
    } as const;
    const attention = {
      kind: "approval",
      threadId: "thread-1",
      projectId: "project-1",
      title: "User-authored thread title",
      requestId: "request-1",
      createdAt: "2026-07-14T12:00:00.000Z",
      requestKind: "command",
      summary: "raw command diagnostic",
    } as const;

    const buildCompletion = buildTaskCompletionCopy as unknown as (
      candidate: typeof completion,
      t: TFunction,
    ) => { title: string; body: string };
    const buildAttention = buildInputNeededCopy as unknown as (
      candidate: typeof attention,
      t: TFunction,
    ) => { title: string; body: string };

    await instance.changeLanguage("zh-Hans");
    expect(buildCompletion(completion, instance.t)).toEqual({
      title: "任务完成",
      body: "User-authored thread title：raw assistant detail",
    });
    const sent: unknown[] = [];
    await showDesktopThreadNotification(
      {
        isSupported: async () => true,
        show: async (payload) => {
          sent.push(payload);
          return true;
        },
      },
      buildCompletion(completion, instance.t),
      ThreadId.makeUnsafe("thread-1"),
    );
    expect(sent).toEqual([
      {
        title: "任务完成",
        body: "User-authored thread title：raw assistant detail",
        silent: false,
        threadId: "thread-1",
      },
    ]);
    expect(buildAttention(attention, instance.t)).toEqual({
      title: "需要批准",
      body: "User-authored thread title：raw command diagnostic",
    });

    await instance.changeLanguage("fr");
    expect(buildCompletion(completion, instance.t)).toEqual({
      title: "Tâche terminée",
      body: "User-authored thread title : raw assistant detail",
    });
  });
});
