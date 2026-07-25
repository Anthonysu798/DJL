import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";

import { ChatEmptyStateHero } from "../components/chat/ChatEmptyStateHero";
import { ThreadErrorBanner } from "../components/chat/ThreadErrorBanner";
import { SplashScreen } from "../components/SplashScreen";
import englishCatalog from "./locales/en.json";
import simplifiedChineseCatalog from "./locales/zh-Hans.json";
import frenchCatalog from "./locales/fr.json";

function ShellChatProbe({ threadCount }: { threadCount: number }) {
  const { t } = useTranslation(["shell", "chat"]);
  return (
    <div>
      <input
        aria-label={t("sidebar.search.ariaLabel", { ns: "shell" })}
        placeholder={t("sidebar.search.placeholder", { ns: "shell" })}
      />
      <textarea placeholder={t("composer.placeholder.default", { ns: "chat" })} />
      <output>{t("sidebar.threadCount", { ns: "shell", count: threadCount })}</output>
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

describe("shell and chat localization", () => {
  it("updates composer, sidebar, and accessibility copy when the locale changes", async () => {
    const instance = await createTestI18n();
    const renderProbe = () =>
      renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <ShellChatProbe threadCount={2} />
          <ChatEmptyStateHero projectName="Production_DJL" />
          <SplashScreen errorMessage="raw diagnostic" onRetry={() => undefined} />
          <ThreadErrorBanner error="raw provider exception" onDismiss={() => undefined} />
        </I18nextProvider>,
      );

    const english = renderProbe();
    expect(english).toContain('aria-label="Search chats and projects"');
    expect(english).toContain(
      'placeholder="Ask anything, @tag files/folders, or use / to show available commands"',
    );
    expect(english).toContain("2 threads");
    expect(english).toContain("Let&#x27;s build");
    expect(english).toContain("raw diagnostic");
    expect(english).toContain("Retry");
    expect(english).toContain("The task stopped");
    expect(english).toContain("Retry the task. If it fails again, check provider settings.");
    expect(english).toContain("raw provider exception");
    expect(english).toContain('aria-label="Dismiss error"');

    await instance.changeLanguage("zh-Hans");
    const chinese = renderProbe();
    expect(chinese).toContain('aria-label="搜索聊天和项目"');
    expect(chinese).toContain("2 个话题");
    expect(chinese).toContain("一起开始构建");
    expect(chinese).toContain("任务已停止");
    expect(chinese).toContain("重试任务。如果再次失败，请检查提供商设置。");
    expect(chinese).toContain("raw provider exception");

    await instance.changeLanguage("fr");
    const french = renderProbe();
    expect(french).toContain('aria-label="Rechercher des discussions et des projets"');
    expect(french).toContain("2 discussions");
    expect(french).toContain("Construisons ensemble");
  });
});
