import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";

import { LocalImageErrorCard } from "../components/LocalImagePreview";
import BrowserPanel from "../components/BrowserPanel";
import GitActionsControl from "../components/GitActionsControl";
import BranchToolbar from "../components/BranchToolbar";
import { TerminalSearch } from "../components/TerminalSearch";
import englishCatalog from "./locales/en.json";
import simplifiedChineseCatalog from "./locales/zh-Hans.json";
import frenchCatalog from "./locales/fr.json";

function WorkspaceProbe({ fileCount, rawDetail }: { fileCount: number; rawDetail: string }) {
  const { t } = useTranslation("workspace");
  return (
    <section>
      <output>{t("diff.fileCount", { count: fileCount })}</output>
      <strong>{t("preview.errors.document.title")}</strong>
      <p>{t("preview.errors.document.summary")}</p>
      <pre>{rawDetail}</pre>
    </section>
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

describe("workspace localization", () => {
  it("loads the localized browser, branch, and Git chrome modules", () => {
    expect(BrowserPanel).toBeTypeOf("function");
    expect(BranchToolbar).toBeTypeOf("function");
    expect(GitActionsControl).toBeTypeOf("function");
  });

  it("updates workspace chrome, accessibility copy, plurals, and error summaries live", async () => {
    const instance = await createTestI18n();
    const rawDetail = "pdf.js: InvalidPDFException at byte 0x1f";
    const renderProbe = () =>
      renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <TerminalSearch searchAddon={null} isOpen onClose={() => undefined} />
          <LocalImageErrorCard downloadUrl="/preview/image.png" downloadName="image.png" />
          <WorkspaceProbe fileCount={2} rawDetail={rawDetail} />
        </I18nextProvider>,
      );

    const english = renderProbe();
    expect(english).toContain('placeholder="Find"');
    expect(english).toContain('aria-label="Match case"');
    expect(english).toContain("Couldn’t open this image");
    expect(english).toContain("2 files");
    expect(english).toContain("Couldn’t open this document");
    expect(english).toContain(rawDetail);

    await instance.changeLanguage("zh-Hans");
    const chinese = renderProbe();
    expect(chinese).toContain('placeholder="查找"');
    expect(chinese).toContain('aria-label="区分大小写"');
    expect(chinese).toContain("无法打开此图片");
    expect(chinese).toContain("2 个文件");
    expect(chinese).toContain("无法打开此文档");
    expect(chinese).toContain(rawDetail);

    await instance.changeLanguage("fr");
    const french = renderProbe();
    expect(french).toContain('placeholder="Rechercher"');
    expect(french).toContain('aria-label="Respecter la casse"');
    expect(french).toContain("Impossible d’ouvrir cette image");
    expect(french).toContain("2 fichiers");
    expect(french).toContain("Impossible d’ouvrir ce document");
    expect(french).toContain(rawDetail);
  });
});
