// FILE: SplashScreen.test.tsx
// Purpose: Prevents route recovery from covering the app with a branded wake/loading screen.
// Layer: web UI tests

import { renderToStaticMarkup } from "react-dom/server";
import { createInstance, type i18n } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import type { ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { SplashScreen } from "./SplashScreen";
import englishCatalog from "../i18n/locales/en.json";

let testI18n: i18n;

beforeAll(async () => {
  testI18n = createInstance();
  await testI18n.use(initReactI18next).init({ lng: "en", resources: { en: englishCatalog } });
});

function renderSplash(element: ReactElement) {
  return renderToStaticMarkup(<I18nextProvider i18n={testI18n}>{element}</I18nextProvider>);
}

describe("SplashScreen", () => {
  it("renders nothing while route recovery is still in progress", () => {
    expect(renderSplash(<SplashScreen />)).toBe("");
  });

  it("keeps a compact retry surface when recovery fails", () => {
    const markup = renderSplash(
      <SplashScreen errorMessage="Could not restore this route." onRetry={vi.fn()} />,
    );

    expect(markup).toContain("Could not restore this route.");
    expect(markup).toContain("Retry");
    expect(markup).not.toContain("DJL");
    expect(markup).not.toContain("min-h-0");
  });

  it("renders the localized failure summary separately from the unchanged raw detail", () => {
    const rawDetail = "project.create failed: folder already owned by project-123";
    const markup = renderSplash(
      <SplashScreen
        errorMessage="Work can't use this folder."
        errorDetail={rawDetail}
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain("Work can&#x27;t use this folder.");
    expect(markup).toContain(rawDetail);
    expect(markup.indexOf("Work can&#x27;t use this folder.")).toBeLessThan(
      markup.indexOf(rawDetail),
    );
  });
});
