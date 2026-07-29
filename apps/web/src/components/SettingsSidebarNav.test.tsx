// FILE: SettingsSidebarNav.test.tsx
// Purpose: Guards the settings sidebar search surface and its ranking index.
// Layer: Component rendering tests
// Depends on: SettingsSidebarNav, the settings search index, and React server rendering.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { SettingsRow } from "./settings/SettingsPanelPrimitives";
import {
  SETTINGS_SEARCH_ENTRIES,
  rankSettingsSearchEntries,
  settingsSearchEntryTarget,
} from "../settingsSearchIndex";
import { initializeI18nInstance } from "../i18n";
import englishCatalog from "../i18n/locales/en.json";
import simplifiedChineseCatalog from "../i18n/locales/zh-Hans.json";
import traditionalChineseCatalog from "../i18n/locales/zh-Hant.json";
import japaneseCatalog from "../i18n/locales/ja.json";
import koreanCatalog from "../i18n/locales/ko.json";
import latinAmericanSpanishCatalog from "../i18n/locales/es-419.json";
import frenchCatalog from "../i18n/locales/fr.json";
import { resolveSettingsSearchEntry } from "../settingsSearchIndex";
import { normalizeSettingsSection } from "../settingsNavigation";

describe("rankSettingsSearchEntries", () => {
  it("returns nothing for an empty query", () => {
    expect(rankSettingsSearchEntries("", 12)).toHaveLength(0);
    expect(rankSettingsSearchEntries("   ", 12)).toHaveLength(0);
  });

  it("ranks an exact title match first", () => {
    const [top] = rankSettingsSearchEntries("theme", 12);
    expect(top?.id).toBe("appearance:theme");
  });

  it("matches on description keywords, not just titles", () => {
    const results = rankSettingsSearchEntries("wrap", 12);
    expect(results.some((entry) => entry.id === "behavior:diff-line-wrapping")).toBe(true);
  });

  it("includes the activity toasts notification row", () => {
    const results = rankSettingsSearchEntries("toasts", 12);
    expect(results.some((entry) => entry.id === "notifications:activity-toasts")).toBe(true);
  });

  it("does not expose the unfinished remote-control section", () => {
    expect(rankSettingsSearchEntries("remote", SETTINGS_SEARCH_ENTRIES.length)).toEqual([]);
    expect(normalizeSettingsSection("remote")).toBe("general");
  });

  it("surfaces every row in a section when searching the section label", () => {
    const results = rankSettingsSearchEntries("appearance", SETTINGS_SEARCH_ENTRIES.length);
    expect(results.some((entry) => entry.section === "appearance")).toBe(true);
  });

  it("respects the result limit", () => {
    expect(rankSettingsSearchEntries("e", 3)).toHaveLength(3);
  });

  it("uses stable deep-link anchors that do not depend on translated titles", async () => {
    const themeEntry = SETTINGS_SEARCH_ENTRIES.find((entry) => entry.id === "appearance:theme")!;
    expect(settingsSearchEntryTarget(themeEntry)).toBe("setting-theme");
    const { instance } = await initializeI18nInstance({
      preference: "fr",
      documentElement: null,
    });
    const frenchT = instance.getFixedT("fr", "settings");
    const [translatedTheme] = rankSettingsSearchEntries("thème", 1, (key) => frenchT(key as never));
    expect(translatedTheme?.title).toBe("Thème");
    expect(settingsSearchEntryTarget(themeEntry)).toBe("setting-theme");
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      if (entry.target === null) {
        expect(settingsSearchEntryTarget(entry)).toBeNull();
      } else {
        expect(settingsSearchEntryTarget(entry)?.startsWith("setting-")).toBe(true);
      }
    }
  });

  it("preserves every stable search target including the legacy studio anchor", () => {
    const expectedTargets: Record<string, string | null> = {
      "general:new-threads": "setting-new-threads",
      "general:project-order": "setting-project-order",
      "general:thread-order": "setting-thread-order",
      "general:chats-section": "setting-chats",
      "general:studio-section": "setting-studio",
      "general:workspace-section": "setting-workspace",
      "general:environment-default-open": "setting-open-by-default",
      "general:environment-usage": "setting-usage",
      "general:environment-repository": "setting-repository",
      "general:environment-pull-request": "setting-pull-request",
      "general:environment-editor": "setting-editor",
      "general:environment-recap": "setting-recap",
      "general:environment-pinned": "setting-pinned-messages",
      "general:environment-markers": "setting-text-markers",
      "general:environment-notepad": "setting-notepad",
      "appearance:language": "setting-app-language",
      "appearance:theme": "setting-theme",
      "appearance:ui-density": "setting-ui-density",
      "appearance:base-font-size": "setting-base-font-size",
      "appearance:terminal-font-size": "setting-terminal-font-size",
      "appearance:terminal-font": "setting-terminal-font",
      "appearance:font-smoothing": null,
      "appearance:time-format": "setting-time-format",
      "notifications:activity-toasts": "setting-activity-toasts",
      "notifications:desktop-notifications": "setting-desktop-notifications",
      "behavior:assistant-output": "setting-assistant-output",
      "behavior:diff-line-wrapping": "setting-diff-line-wrapping",
      "behavior:delete-confirmation": "setting-delete-confirmation",
      "behavior:archive-confirmation": "setting-archive-confirmation",
      "behavior:terminal-close-confirmation": "setting-terminal-close-confirmation",
      "shortcuts:keyboard-shortcuts": null,
      "worktrees:managed-worktrees": null,
      "archived:archived-threads": null,
      "models:git-writing-model": "setting-git-writing-model",
      "models:configured-models": null,
      "local-models:runtimes": null,
      "local-models:recommended": null,
      "skills:skills": null,
      "usage:usage": null,
      "advanced:keybindings": "setting-keybindings",
      "advanced:recovery-tools": "setting-recovery-tools",
      "advanced:version": "setting-version",
      "advanced:release-history": "setting-release-history",
      "remote:remote-access": "setting-remote-access",
    };
    expect(
      Object.fromEntries(SETTINGS_SEARCH_ENTRIES.map((entry) => [entry.id, entry.target])),
    ).toEqual(expectedTargets);
  });

  it("resolves every search title and keyword in every real locale", () => {
    const catalogs = [
      englishCatalog,
      simplifiedChineseCatalog,
      traditionalChineseCatalog,
      japaneseCatalog,
      koreanCatalog,
      latinAmericanSpanishCatalog,
      frenchCatalog,
    ];
    const makeT = (catalog: (typeof catalogs)[number]) => (key: string) => {
      let value: unknown = catalog.settings;
      for (const segment of key.split(".")) value = (value as Record<string, unknown>)?.[segment];
      return typeof value === "string" ? value : key;
    };

    for (const catalog of catalogs) {
      for (const entry of SETTINGS_SEARCH_ENTRIES) {
        const resolved = resolveSettingsSearchEntry(entry, makeT(catalog));
        expect(resolved.title, `${entry.id} title`).not.toContain("search.entries.");
        expect(resolved.keywords, `${entry.id} keywords`).not.toContain("search.entries.");
        expect(resolved.title.trim()).not.toBe("");
        expect(resolved.keywords.trim()).not.toBe("");
      }
    }
  });
});

describe("SettingsSidebarNav", () => {
  it("renders a stable anchor from a semantic row id instead of its translated title", () => {
    const markup = renderToStaticMarkup(
      <SettingsRow settingId="theme" title="Thème" description="Apparence" />,
    );
    expect(markup).toContain('id="setting-theme"');
    expect(markup).not.toContain('id="setting-th-me"');
  });

  it("renders the soft search input alongside the section list", async () => {
    await initializeI18nInstance({
      preference: "en",
      instance: (await import("../i18n")).rendererI18n,
      documentElement: null,
    });
    const markup = renderToStaticMarkup(
      <SettingsSidebarNav activeSection="general" onBack={vi.fn()} onSelectSection={vi.fn()} />,
    );

    expect(markup).toContain('aria-label="Search settings"');
    expect(markup).toContain('aria-label="Settings sections"');
    expect(markup).toContain("Back to app");
    expect(markup).toContain('data-onboarding-target="settings-section-general"');
    expect(markup).toContain('data-onboarding-target="settings-section-advanced"');
    expect(markup).not.toContain('data-onboarding-target="settings-section-remote"');
    expect(markup).not.toContain("iPhone remote access");
  });

  it("localizes navigation groups, labels, and search chrome", async () => {
    const { instance } = await initializeI18nInstance({
      preference: "fr",
      documentElement: null,
    });
    await instance.changeLanguage("fr");
    const markup = renderToStaticMarkup(
      <SettingsSidebarNav activeSection="appearance" onBack={vi.fn()} onSelectSection={vi.fn()} />,
    );

    expect(markup).toContain("Retour à l’application");
    expect(markup).toContain("Rechercher dans les paramètres…");
    expect(markup).toContain("Apparence");
  });
});
