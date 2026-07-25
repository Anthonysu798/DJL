// FILE: settingsSearchIndex.ts
// Purpose: Locale-aware, stable settings search metadata and ranking.

import { rankProviderDiscoveryItems } from "~/lib/providerDiscovery";
import englishCatalog from "./i18n/locales/en.json";
import {
  isSettingsSectionVisible,
  settingRowAnchorId,
  SETTINGS_NAV_ITEMS,
  type SettingsSectionId,
} from "./settingsNavigation";

export interface SettingsSearchEntry {
  id: string;
  section: SettingsSectionId;
  /** Stable semantic row id; null marks a panel-only or conditional result. */
  target: string | null;
}

export interface ResolvedSettingsSearchEntry extends SettingsSearchEntry {
  title: string;
  keywords: string;
}

const row = (id: string, section: SettingsSectionId, target: string): SettingsSearchEntry => ({
  id,
  section,
  target: settingRowAnchorId(target),
});
const panel = (id: string, section: SettingsSectionId): SettingsSearchEntry => ({
  id,
  section,
  target: null,
});

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  row("general:new-threads", "general", "new-threads"),
  row("general:project-order", "general", "project-order"),
  row("general:thread-order", "general", "thread-order"),
  row("general:chats-section", "general", "chats"),
  row("general:studio-section", "general", "studio"),
  row("general:workspace-section", "general", "workspace"),
  row("general:environment-default-open", "general", "open-by-default"),
  row("general:environment-usage", "general", "usage"),
  row("general:environment-repository", "general", "repository"),
  row("general:environment-pull-request", "general", "pull-request"),
  row("general:environment-editor", "general", "editor"),
  row("general:environment-recap", "general", "recap"),
  row("general:environment-pinned", "general", "pinned-messages"),
  row("general:environment-markers", "general", "text-markers"),
  row("general:environment-notepad", "general", "notepad"),
  row("appearance:language", "appearance", "app-language"),
  row("appearance:theme", "appearance", "theme"),
  row("appearance:ui-density", "appearance", "ui-density"),
  row("appearance:base-font-size", "appearance", "base-font-size"),
  row("appearance:terminal-font-size", "appearance", "terminal-font-size"),
  row("appearance:terminal-font", "appearance", "terminal-font"),
  panel("appearance:font-smoothing", "appearance"),
  row("appearance:time-format", "appearance", "time-format"),
  row("notifications:activity-toasts", "notifications", "activity-toasts"),
  row("notifications:desktop-notifications", "notifications", "desktop-notifications"),
  row("remote:remote-access", "remote", "remote-access"),
  row("behavior:assistant-output", "behavior", "assistant-output"),
  row("behavior:diff-line-wrapping", "behavior", "diff-line-wrapping"),
  row("behavior:delete-confirmation", "behavior", "delete-confirmation"),
  row("behavior:archive-confirmation", "behavior", "archive-confirmation"),
  row("behavior:terminal-close-confirmation", "behavior", "terminal-close-confirmation"),
  panel("shortcuts:keyboard-shortcuts", "shortcuts"),
  panel("worktrees:managed-worktrees", "worktrees"),
  panel("archived:archived-threads", "archived"),
  row("models:git-writing-model", "models", "git-writing-model"),
  panel("models:configured-models", "models"),
  panel("local-models:runtimes", "local-models"),
  panel("local-models:recommended", "local-models"),
  panel("skills:skills", "skills"),
  panel("usage:usage", "usage"),
  row("advanced:keybindings", "advanced", "keybindings"),
  row("advanced:recovery-tools", "advanced", "recovery-tools"),
  row("advanced:version", "advanced", "version"),
  row("advanced:release-history", "advanced", "release-history"),
] as const;

export function settingsSearchEntryTarget(entry: SettingsSearchEntry): string | null {
  return entry.target;
}

function entryKey(entry: SettingsSearchEntry): string {
  return `search.entries.${entry.id.replace(":", ".")}`;
}

export type SettingsTranslate = (key: string) => string;

function defaultSettingsT(key: string): string {
  let value: unknown = englishCatalog.settings;
  for (const segment of key.split(".")) {
    if (value === null || typeof value !== "object") return key;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" ? value : key;
}

export function resolveSettingsSearchEntry(
  entry: SettingsSearchEntry,
  t: SettingsTranslate = defaultSettingsT,
): ResolvedSettingsSearchEntry {
  const key = entryKey(entry);
  return {
    ...entry,
    title: t(`${key}.title`),
    keywords: t(`${key}.keywords`),
  };
}

export function settingsSectionLabel(
  section: SettingsSectionId,
  t: SettingsTranslate = defaultSettingsT,
): string {
  const item = SETTINGS_NAV_ITEMS.find((candidate) => candidate.id === section);
  return item ? t(item.labelKey) : section;
}

export function rankSettingsSearchEntries(
  query: string,
  limit: number,
  t: SettingsTranslate = defaultSettingsT,
): readonly ResolvedSettingsSearchEntry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const entries = SETTINGS_SEARCH_ENTRIES.filter((entry) =>
    isSettingsSectionVisible(entry.section),
  ).map((entry) => resolveSettingsSearchEntry(entry, t));
  return rankProviderDiscoveryItems(entries, trimmed, (entry) => [
    { value: entry.title },
    { value: entry.keywords, weight: 200 },
    { value: settingsSectionLabel(entry.section, t), weight: 400 },
  ]).slice(0, limit);
}
