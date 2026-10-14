// FILE: settingsPanelStyles.ts
// Purpose: Shared layout tokens for the settings content panel (page bg, bordered cards, rows).
// Layer: Settings UI styling
// Exports: border, surface, card, row, and inset list class names

/** Shared corner radius for settings cards and dropdown panels. */
export const SETTINGS_RADIUS_CLASS_NAME = "rounded-[18px]";

/** Select triggers, segmented chips, inputs, and menu options (one step above app defaults). */
export const SETTINGS_CONTROL_RADIUS_CLASS_NAME = "!rounded-lg";

/** Same border token as Button `outline` / `chrome-outline` variants. */
export const SETTINGS_CONTROL_BORDER_CLASS_NAME = "border border-[color:var(--color-border)]";

/** Main settings page shares the chat surface behind its filled groups. */
export const SETTINGS_PAGE_BACKGROUND_CLASS_NAME = "app-settings-surface";

/** Section heading above a grouped settings card. */
export const SETTINGS_SECTION_LABEL_CLASS_NAME = `px-0 py-1 text-sm font-medium text-foreground`;

/** Vertical rhythm between stacked settings groups in the content panel. */
export const SETTINGS_PANEL_SECTION_CLASS_NAME = "flex flex-col gap-4 not-first:mt-12";

/** Grouped settings card with a quiet raised fill and a thin border. */
export const SETTINGS_CARD_CLASS_NAME = [
  "overflow-hidden bg-[var(--app-settings-card,var(--card))]",
  SETTINGS_CONTROL_BORDER_CLASS_NAME,
  SETTINGS_RADIUS_CLASS_NAME,
].join(" ");

/** Row padding inside a settings card. */
export const SETTINGS_CARD_ROW_CLASS_NAME =
  "px-5 py-[calc(var(--app-density-settings-row-padding-y,0.625rem)+0.375rem)]";

/** Row title — same UI font/size as the description; weight and color differ. */
export const SETTINGS_CARD_ROW_TITLE_CLASS_NAME =
  "text-[length:var(--djl-settings-font-size,var(--app-font-size-ui,12px))] font-medium text-foreground";

/** Row description — standard app UI typography. */
export const SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME =
  "text-[length:var(--djl-settings-font-size,var(--app-font-size-ui,12px))] text-muted-foreground";

/** Divider between stacked rows inside one card. */
export const SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME = "border-t border-[color:var(--color-border)]";

/** Nested list/table inside a row (provider installs, updates, etc.). */
export const SETTINGS_INSET_LIST_CLASS_NAME = SETTINGS_CARD_CLASS_NAME;

/** Empty / placeholder blocks. */
export const SETTINGS_EMPTY_STATE_CLASS_NAME = [
  "bg-transparent",
  SETTINGS_CONTROL_BORDER_CLASS_NAME,
  SETTINGS_RADIUS_CLASS_NAME,
  "border-dashed",
].join(" ");
