// FILE: settingsNavigation.ts
// Purpose: Share the settings topic taxonomy between the main sidebar and the settings screen.
// Layer: Route/UI support
// Exports: section ids, nav items, and search normalization helper

export const SETTINGS_SECTION_IDS = [
  "general",
  "profile",
  "appearance",
  "notifications",
  "remote",
  "behavior",
  "shortcuts",
  "worktrees",
  "archived",
  "models",
  "local-models",
  "providers",
  "skills",
  "usage",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "app" | "synara";
type SettingsNavCatalogItemId =
  | Exclude<SettingsSectionId, "local-models" | "providers">
  | "localModels";
type SettingsNavItemTranslationKey =
  `navigation.items.${SettingsNavCatalogItemId}.${"label" | "description" | "eyebrow"}`;

/**
 * Deep-link scroll targets inside a settings panel. Each id is shared by the element that owns
 * it (its `id` + scroll ref), the panel effect that scrolls it into view, and any caller that
 * navigates to it via `?target=…`. Centralizing them keeps the anchor and its links from
 * silently drifting apart.
 */
export const SETTINGS_TARGETS = {
  modelProviders: "model-providers",
  providerUpdates: "provider-updates",
  providerInstalls: "provider-installs",
  environmentPanel: "environment-panel",
} as const;

export type SettingsTargetId = (typeof SETTINGS_TARGETS)[keyof typeof SETTINGS_TARGETS];

export type SettingsNavItem = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  labelKey: SettingsNavItemTranslationKey;
  descriptionKey: SettingsNavItemTranslationKey;
  /** Basename of a SVG under `/central-icons-reversed`. */
  icon: string;
  eyebrowKey: SettingsNavItemTranslationKey;
  desktopOnly?: boolean;
};

export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  id: SettingsNavGroupId;
  labelKey: "navigation.groups.app" | "navigation.groups.djl";
}> = [
  { id: "app", labelKey: "navigation.groups.app" },
  { id: "synara", labelKey: "navigation.groups.djl" },
] as const;

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    group: "app",
    labelKey: "navigation.items.general.label",
    descriptionKey: "navigation.items.general.description",
    icon: "settings-gear-1",
    eyebrowKey: "navigation.items.general.eyebrow",
  },
  {
    id: "profile",
    group: "app",
    labelKey: "navigation.items.profile.label",
    descriptionKey: "navigation.items.profile.description",
    icon: "user",
    eyebrowKey: "navigation.items.profile.eyebrow",
  },
  {
    id: "appearance",
    group: "app",
    labelKey: "navigation.items.appearance.label",
    descriptionKey: "navigation.items.appearance.description",
    icon: "color-palette",
    eyebrowKey: "navigation.items.appearance.eyebrow",
  },
  {
    id: "notifications",
    group: "app",
    labelKey: "navigation.items.notifications.label",
    descriptionKey: "navigation.items.notifications.description",
    icon: "bell",
    eyebrowKey: "navigation.items.notifications.eyebrow",
  },
  {
    id: "remote",
    group: "app",
    labelKey: "navigation.items.remote.label",
    descriptionKey: "navigation.items.remote.description",
    icon: "phone-haptic",
    eyebrowKey: "navigation.items.remote.eyebrow",
    desktopOnly: true,
  },
  {
    id: "behavior",
    group: "app",
    labelKey: "navigation.items.behavior.label",
    descriptionKey: "navigation.items.behavior.description",
    icon: "settings-slider-hor",
    eyebrowKey: "navigation.items.behavior.eyebrow",
  },
  {
    id: "shortcuts",
    group: "app",
    labelKey: "navigation.items.shortcuts.label",
    descriptionKey: "navigation.items.shortcuts.description",
    icon: "shortcut",
    eyebrowKey: "navigation.items.shortcuts.eyebrow",
  },
  {
    id: "worktrees",
    group: "app",
    labelKey: "navigation.items.worktrees.label",
    descriptionKey: "navigation.items.worktrees.description",
    icon: "branch-simple",
    eyebrowKey: "navigation.items.worktrees.eyebrow",
  },
  {
    id: "archived",
    group: "app",
    labelKey: "navigation.items.archived.label",
    descriptionKey: "navigation.items.archived.description",
    icon: "archive",
    eyebrowKey: "navigation.items.archived.eyebrow",
  },
  {
    id: "models",
    group: "synara",
    labelKey: "navigation.items.models.label",
    descriptionKey: "navigation.items.models.description",
    icon: "brain",
    eyebrowKey: "navigation.items.models.eyebrow",
  },
  {
    id: "local-models",
    group: "synara",
    labelKey: "navigation.items.localModels.label",
    descriptionKey: "navigation.items.localModels.description",
    icon: "chip",
    eyebrowKey: "navigation.items.localModels.eyebrow",
    desktopOnly: true,
  },
  {
    id: "skills",
    group: "synara",
    labelKey: "navigation.items.skills.label",
    descriptionKey: "navigation.items.skills.description",
    icon: "building-blocks",
    eyebrowKey: "navigation.items.skills.eyebrow",
  },
  {
    id: "usage",
    group: "synara",
    labelKey: "navigation.items.usage.label",
    descriptionKey: "navigation.items.usage.description",
    icon: "gauge",
    eyebrowKey: "navigation.items.usage.eyebrow",
  },
  {
    id: "advanced",
    group: "synara",
    labelKey: "navigation.items.advanced.label",
    descriptionKey: "navigation.items.advanced.description",
    icon: "toolbox",
    eyebrowKey: "navigation.items.advanced.eyebrow",
  },
] as const;

// Keep unfinished settings out of the product until their backing service is
// ready. The section id and panel remain for an intentional future re-enable,
// but neither settings navigation, search, nor an old deep link exposes it.
const HIDDEN_SETTINGS_SECTION_IDS = new Set<SettingsSectionId>(["remote"]);

export function isSettingsSectionVisible(section: SettingsSectionId): boolean {
  return !HIDDEN_SETTINGS_SECTION_IDS.has(section);
}

/**
 * Stable DOM id for a settings row. Callers pass a semantic id that never depends on
 * translated display copy. Existing English-slug ids are intentionally retained so saved
 * deep links continue to work.
 */
export function settingRowAnchorId(settingId: string): string {
  const slug = settingId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `setting-${slug}`;
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  if (typeof value !== "string") {
    return "general";
  }
  if (value === "providers") return "models";
  const section = SETTINGS_SECTION_IDS.find((candidate) => candidate === value);
  return section && isSettingsSectionVisible(section) ? section : "general";
}
