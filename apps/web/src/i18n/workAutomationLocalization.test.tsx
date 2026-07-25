import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";

import { KanbanTaskExpandedImageOverlay } from "../components/kanban/KanbanTaskExpandedImageOverlay";
import { DocumentIntelligenceStatusCard, WorkErrorMessage } from "../components/work/WorkTaskPanel";
import {
  formatAutomationIntentCadence,
  parseChatAutomationIntent,
  type ChatAutomationIntent,
} from "../lib/automationIntent";
import { AutomationApprovalBanner } from "../routes/-automations.shared";
import englishCatalog from "./locales/en.json";
import simplifiedChineseCatalog from "./locales/zh-Hans.json";
import frenchCatalog from "./locales/fr.json";

function WorkAutomationProbe({ taskCount }: { readonly taskCount: number }) {
  const { t } = useTranslation("work");
  return <output>{t("kanban.taskCount", { count: taskCount })}</output>;
}

function AutomationIntentProbe({ intent }: { readonly intent: ChatAutomationIntent }) {
  const { t, i18n } = useTranslation("work");
  return (
    <output>
      {formatAutomationIntentCadence(
        intent.schedule,
        i18n.resolvedLanguage || i18n.language,
        (key, defaultValue, values) => t(`automations.intent.${key}`, { defaultValue, ...values }),
      )}
    </output>
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

describe("Work, Kanban, and automation localization", () => {
  it("switches visible, accessible, plural, and summarized error copy live", async () => {
    const instance = await createTestI18n();
    const rawDetail = "provider: unsafe-full-access at /tmp/worktree";
    const intent = parseChatAutomationIntent("/automation every 6h check the queue");
    if (!intent) throw new Error("Expected the automation intent fixture to parse.");
    const renderProbe = () =>
      renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <WorkAutomationProbe taskCount={2} />
          <AutomationIntentProbe intent={intent} />
          <DocumentIntelligenceStatusCard
            status={null}
            busy={false}
            error={{ code: "documentStatus", detail: rawDetail }}
            onInstall={() => undefined}
            onRepair={() => undefined}
          />
          <WorkErrorMessage error={{ code: "loadPreviews", detail: rawDetail }} />
          <WorkErrorMessage error={{ code: "openFile", detail: rawDetail }} />
          <KanbanTaskExpandedImageOverlay
            expandedImage={{
              index: 0,
              images: [{ name: "diagram.png", src: "data:image/png;base64,AA==" }],
            }}
            onClose={() => undefined}
            onNavigate={() => undefined}
          />
          <AutomationApprovalBanner
            busy={false}
            onApprove={() => undefined}
            onApproveAndRun={() => undefined}
            warnings={[
              {
                id: "full-access",
                title: "Full access",
                detail: rawDetail,
                requiresAcknowledgement: true,
              },
            ]}
          />
        </I18nextProvider>,
      );

    const english = renderProbe();
    expect(english).toContain("2 tasks");
    expect(english).toContain("Every 6h");
    expect(english).toContain("Checking the local document reader");
    expect(english).toContain("Couldn’t check the local document reader.");
    expect(english).toContain("Could not load document previews.");
    expect(english).toContain("Could not open this file.");
    expect(english).toContain('aria-label="Expanded image preview"');
    expect(english).toContain("Approval needed");
    expect(english).toContain(rawDetail);

    await instance.changeLanguage("zh-Hans");
    const chinese = renderProbe();
    expect(chinese).toContain("2 个任务");
    expect(chinese).toContain("每 6小时");
    expect(chinese).toContain("正在检查本地文档读取器");
    expect(chinese).toContain("无法检查本地文档读取器。");
    expect(chinese).toContain("无法加载文档预览。");
    expect(chinese).toContain("无法打开此文件。");
    expect(chinese).toContain('aria-label="展开的图片预览"');
    expect(chinese).toContain("需要批准");
    expect(chinese).toContain(rawDetail);

    await instance.changeLanguage("fr");
    const french = renderProbe();
    expect(french).toContain("2 tâches");
    expect(french).toContain("Toutes les 6 h");
    expect(french).toContain("Vérification du lecteur de documents local");
    expect(french).toContain("Impossible de vérifier le lecteur de documents local.");
    expect(french).toContain("Impossible de charger les aperçus des documents.");
    expect(french).toContain("Impossible d’ouvrir ce fichier.");
    expect(french).toContain('aria-label="Aperçu agrandi de l’image"');
    expect(french).toContain("Approbation requise");
    expect(french).toContain(rawDetail);
  });
});
