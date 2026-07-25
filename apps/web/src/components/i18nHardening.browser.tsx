import "../index.css";

import { createInstance, type Resource } from "i18next";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";
import {
  CommandId,
  EventId,
  ThreadId,
  type OrchestrationThreadActivity,
  type WorkTask,
} from "@synara/contracts";

import englishCatalog from "../i18n/locales/en.json";
import simplifiedChineseCatalog from "../i18n/locales/zh-Hans.json";
import traditionalChineseCatalog from "../i18n/locales/zh-Hant.json";
import latinAmericanSpanishCatalog from "../i18n/locales/es-419.json";
import frenchCatalog from "../i18n/locales/fr.json";
import japaneseCatalog from "../i18n/locales/ja.json";
import koreanCatalog from "../i18n/locales/ko.json";
import { APP_LANGUAGE_OPTIONS, selectableLanguageOptions } from "../i18n/appLocaleOptions";
import { WorkspaceFileOpenerContext } from "../lib/workspaceFileOpener";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { ChatEmptyStateHero } from "./chat/ChatEmptyStateHero";
import { ThreadErrorBanner } from "./chat/ThreadErrorBanner";
import { WorkErrorMessage, WorkTaskPanel } from "./work/WorkTaskPanel";

const CATALOGS = {
  en: englishCatalog,
  "zh-Hans": simplifiedChineseCatalog,
  "zh-Hant": traditionalChineseCatalog,
  "es-419": latinAmericanSpanishCatalog,
  fr: frenchCatalog,
  ja: japaneseCatalog,
  ko: koreanCatalog,
} as const;

const ALL_RESOURCES = Object.fromEntries(
  Object.entries(CATALOGS).map(([locale, catalog]) => [locale, catalog]),
) as Resource;

function LocalizationLayoutProbe() {
  const { t } = useTranslation("notifications");
  return (
    <main
      data-testid="localized-layout"
      className="grid w-full max-w-full min-w-0 gap-3 overflow-hidden p-3 sm:grid-cols-2"
    >
      <section className="min-w-0 overflow-hidden rounded-lg border p-1">
        <SettingsSidebarNav
          activeSection="appearance"
          onBack={() => undefined}
          onSelectSection={() => undefined}
        />
      </section>
      <section className="min-w-0 rounded-lg border p-3">
        <ChatEmptyStateHero projectName="Production_DJL" />
      </section>
      <section className="min-w-0 rounded-lg border p-3">
        <ThreadErrorBanner error="raw provider diagnostic" onDismiss={() => undefined} />
        <WorkErrorMessage error={{ code: "localServiceConnecting", detail: "raw work detail" }} />
      </section>
      <section
        aria-label={t("task.completeTitle", { ns: "notifications" })}
        className="min-w-0 rounded-lg border p-3"
      >
        <p className="break-words">{t("task.finishedWorking", { ns: "notifications" })}</p>
      </section>
    </main>
  );
}

function LanguageSelectorProbe({ production }: { production: boolean }) {
  const { t } = useTranslation("settings");
  return (
    <label>
      <span>{production ? "Production languages" : "Development languages"}</span>
      <select aria-label={production ? "Production languages" : "Development languages"}>
        {selectableLanguageOptions({ production, preference: "system" }).map((option) => (
          <option key={option.value} value={option.value}>
            {option.nativeLabel ?? t("appearance.language.options.system")}
          </option>
        ))}
      </select>
    </label>
  );
}

function WorkTaskTimestampProbe() {
  const [timestampFormat, setTimestampFormat] = useState<"12-hour" | "24-hour">("12-hour");
  const createdAt = new Date(2026, 6, 15, 18, 5).toISOString();
  const task = {
    threadId: ThreadId.makeUnsafe("thread-i18n"),
    phase: "working",
    condition: "active",
    status: "working",
    resumePhase: "working",
    progress: 50,
    statusReason: "In progress",
    lastTransitionCommandId: CommandId.makeUnsafe("test"),
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
  } as WorkTask;
  const activities = [
    {
      id: EventId.makeUnsafe("activity-i18n"),
      tone: "info",
      kind: "test.activity",
      summary: "Real activity timestamp",
      payload: {},
      turnId: null,
      createdAt,
    },
  ] satisfies ReadonlyArray<OrchestrationThreadActivity>;
  return (
    <section>
      <button type="button" onClick={() => setTimestampFormat("12-hour")}>
        12-hour
      </button>
      <button type="button" onClick={() => setTimestampFormat("24-hour")}>
        24-hour
      </button>
      <WorkspaceFileOpenerContext.Provider value={{ openFile: () => false }}>
        <WorkTaskPanel
          task={task}
          activities={activities}
          timestampFormat={timestampFormat}
          busy={false}
          onComplete={() => undefined}
          onRequestChanges={() => undefined}
          onRetry={() => undefined}
          onReopen={() => undefined}
          onCancel={() => undefined}
          onProvideInput={() => undefined}
        />
      </WorkspaceFileOpenerContext.Provider>
    </section>
  );
}

async function mount(locale: keyof typeof CATALOGS, width: number) {
  await page.viewport(width, 720);
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: "common",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    lng: locale,
    resources: ALL_RESOURCES,
  });
  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.maxWidth = "100%";
  document.body.append(host);
  const screen = await render(
    <I18nextProvider i18n={instance}>
      <LocalizationLayoutProbe />
    </I18nextProvider>,
    { container: host },
  );
  return { host, instance, screen };
}

describe.each(Object.keys(CATALOGS) as Array<keyof typeof CATALOGS>)(
  "%s localization layout",
  (locale) => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    it.each([
      ["narrow", 360],
      ["desktop", 1100],
    ])("renders representative copy accessibly at %s width", async (_name, width) => {
      const { host, screen } = await mount(locale, width);
      const catalog = CATALOGS[locale];

      await expect.element(page.getByLabelText(catalog.settings.search.ariaLabel)).toBeVisible();
      await expect
        .element(
          page.getByRole("button", { name: catalog.settings.navigation.items.appearance.label }),
        )
        .toHaveAttribute("aria-current", "page");
      await expect.element(page.getByText(catalog.chat.empty.title)).toBeVisible();
      await expect
        .element(page.getByText(catalog.chat.errors.providerFailure.generic.title))
        .toBeVisible();
      await expect
        .element(page.getByText(catalog.chat.errors.providerFailure.generic.action))
        .toBeVisible();
      await page.getByRole("button", { name: catalog.chat.errors.showTechnicalDetails }).click();
      await expect.element(page.getByText("raw provider diagnostic")).toBeVisible();
      await expect
        .element(page.getByText(catalog.work.errors.localServiceConnecting))
        .toBeVisible();
      await expect.element(page.getByText("raw work detail")).toBeVisible();
      await expect
        .element(page.getByLabelText(catalog.notifications.task.completeTitle))
        .toHaveTextContent(catalog.notifications.task.finishedWorking);

      const overflow = [...host.querySelectorAll<HTMLElement>("*")].filter(
        (element) => element.scrollWidth > element.clientWidth + 1,
      );
      expect(overflow.map((element) => element.outerHTML.slice(0, 160))).toEqual([]);

      await screen.unmount();
      host.remove();
    });
  },
);

describe("live locale and formatting controls", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("updates mounted real UI through every supported changeLanguage locale", async () => {
    const { host, instance, screen } = await mount("en", 1100);
    for (const locale of Object.keys(CATALOGS) as Array<keyof typeof CATALOGS>) {
      await instance.changeLanguage(locale);
      await expect
        .element(page.getByLabelText(CATALOGS[locale].settings.search.ariaLabel))
        .toBeVisible();
      await expect.element(page.getByText(CATALOGS[locale].chat.empty.title)).toBeVisible();
    }
    await screen.unmount();
    host.remove();
  });

  it("keeps all locales in development and only reviewed locales in production", async () => {
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      defaultNS: "common",
      fallbackLng: "en",
      lng: "en",
      resources: ALL_RESOURCES,
    });
    const screen = await render(
      <I18nextProvider i18n={instance}>
        <LanguageSelectorProbe production={false} />
        <LanguageSelectorProbe production />
      </I18nextProvider>,
    );
    await expect.element(page.getByLabelText("Development languages")).toBeVisible();
    const [development, production] = [...document.querySelectorAll<HTMLSelectElement>("select")];
    expect(development?.options).toHaveLength(APP_LANGUAGE_OPTIONS.length);
    expect([...(production?.options ?? [])].map((option) => option.value)).toEqual([
      "system",
      "en",
      "zh-Hans",
      "zh-Hant",
    ]);
    await screen.unmount();
  });

  it("updates a real WorkTaskPanel timestamp when switching 12/24-hour settings", async () => {
    const screen = await render(<WorkTaskTimestampProbe />);
    expect(document.querySelector('[data-testid="work-activity-timestamp"]')?.textContent).toBe(
      "6:05 PM",
    );
    await page.getByRole("button", { name: "24-hour" }).click();
    await expect
      .poll(() => document.querySelector('[data-testid="work-activity-timestamp"]')?.textContent)
      .toBe("18:05");
    await page.getByRole("button", { name: "12-hour" }).click();
    await expect
      .poll(() => document.querySelector('[data-testid="work-activity-timestamp"]')?.textContent)
      .toBe("6:05 PM");
    await screen.unmount();
  });
});
