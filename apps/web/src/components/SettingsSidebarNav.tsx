// FILE: SettingsSidebarNav.tsx
// Purpose: Settings section sidebar navigation with central icons and reference-style pill rows.
//          Doubles as a settings search surface: typing swaps the section list for ranked
//          row matches (same behavior as the editor file search), each jumping to its section.
// Layer: UI component
// Exports: SettingsSidebarNav

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { CentralIcon } from "~/lib/central-icons";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { SETTINGS_TOUR_REPLAY_EVENT } from "~/onboarding/firstRunTour";
import { SearchInput } from "./ui/search-input";
import { SidebarLeadingIcon } from "./SidebarLeadingIcon";
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_ITEMS,
  isSettingsSectionVisible,
  type SettingsSectionId,
} from "../settingsNavigation";
import {
  rankSettingsSearchEntries,
  settingsSearchEntryTarget,
  settingsSectionLabel,
  type ResolvedSettingsSearchEntry,
} from "../settingsSearchIndex";
import {
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
  SIDEBAR_THREAD_ROW_BASE_CLASS_NAME,
} from "../sidebarRowStyles";
import {
  SETTINGS_SIDEBAR_ICON_CLASS_NAME,
  SETTINGS_SIDEBAR_ITEM_CLASS_NAME,
  SETTINGS_SIDEBAR_ITEM_LABEL_CLASS_NAME,
  SETTINGS_SIDEBAR_LIST_GAP_CLASS_NAME,
  SETTINGS_SIDEBAR_ROW_FILL_ACTIVE_CLASS_NAME,
  SETTINGS_SIDEBAR_ROW_FILL_HOVER_CLASS_NAME,
  SETTINGS_SIDEBAR_SECTION_CLASS_NAME,
  SETTINGS_SIDEBAR_SECTION_LABEL_CLASS_NAME,
} from "../settingsSidebarNavStyles";

// Cap the result list so a broad query stays a quick scan rather than a wall of rows.
const SETTINGS_SEARCH_RESULTS_LIMIT = 12;

const SETTINGS_SECTION_ICON_BY_ID = new Map<SettingsSectionId, string>(
  SETTINGS_NAV_ITEMS.map((item) => [item.id, item.icon]),
);

function SettingsSearchResultRow(props: {
  entry: ResolvedSettingsSearchEntry;
  onSelect: (entry: ResolvedSettingsSearchEntry) => void;
  sectionLabel: string;
}) {
  const { entry, onSelect } = props;
  const icon = SETTINGS_SECTION_ICON_BY_ID.get(entry.section) ?? "settings-gear-1";
  // Mirrors the project header + nested thread layout: the section reuses the nav row
  // (muted icon + label) and the matched setting sits below as an indented thread-style row.
  return (
    <li>
      <button
        type="button"
        className={cn(SETTINGS_SIDEBAR_ITEM_CLASS_NAME, SETTINGS_SIDEBAR_ROW_FILL_HOVER_CLASS_NAME)}
        onClick={() => onSelect(entry)}
      >
        <SidebarLeadingIcon size="sm" tone="text-inherit">
          <CentralIcon name={icon} className={SETTINGS_SIDEBAR_ICON_CLASS_NAME} />
        </SidebarLeadingIcon>
        <span className={SETTINGS_SIDEBAR_ITEM_LABEL_CLASS_NAME}>{props.sectionLabel}</span>
      </button>
      <button
        type="button"
        className={cn(
          SIDEBAR_THREAD_ROW_BASE_CLASS_NAME,
          SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
          SIDEBAR_ROW_HOVER_CLASS_NAME,
          "flex items-center",
        )}
        onClick={() => onSelect(entry)}
      >
        <span className="min-w-0 truncate">{entry.title}</span>
      </button>
    </li>
  );
}

export function SettingsSidebarNav(props: {
  activeSection: SettingsSectionId;
  onBack: () => void;
  onSelectSection: (section: SettingsSectionId, options?: { target?: string }) => void;
}) {
  const { onSelectSection } = props;
  const { t, i18n } = useTranslation("settings");
  const translateSettings = useCallback((key: string) => t(key as never), [t]);
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  useEffect(() => {
    const clearSearchForTour = () => setQuery("");
    window.addEventListener(SETTINGS_TOUR_REPLAY_EVENT, clearSearchForTour);
    return () => window.removeEventListener(SETTINGS_TOUR_REPLAY_EVENT, clearSearchForTour);
  }, []);

  const results = useMemo(
    () =>
      rankSettingsSearchEntries(
        trimmedQuery,
        SETTINGS_SEARCH_RESULTS_LIMIT,
        translateSettings,
      ).filter(
        (entry) =>
          isSettingsSectionVisible(entry.section) &&
          (isElectron || entry.section !== "local-models"),
      ),
    [i18n.resolvedLanguage, translateSettings, trimmedQuery],
  );

  const handleSelectResult = useCallback(
    (entry: ResolvedSettingsSearchEntry) => {
      const target = settingsSearchEntryTarget(entry);
      onSelectSection(entry.section, target ? { target } : undefined);
      setQuery("");
    },
    [onSelectSection],
  );

  const handleSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const topMatch = results[0];
        if (topMatch) {
          handleSelectResult(topMatch);
        }
        return;
      }
      if (event.key === "Escape" && query.length > 0) {
        event.stopPropagation();
        setQuery("");
      }
    },
    [handleSelectResult, query.length, results],
  );

  return (
    <div className="px-1.5 py-1.5">
      <div className="mb-3">
        <button
          type="button"
          className={cn(
            SETTINGS_SIDEBAR_ITEM_CLASS_NAME,
            SETTINGS_SIDEBAR_ROW_FILL_HOVER_CLASS_NAME,
          )}
          onClick={props.onBack}
        >
          <SidebarLeadingIcon size="sm" tone="text-inherit">
            <CentralIcon name="arrow-left" className={SETTINGS_SIDEBAR_ICON_CLASS_NAME} />
          </SidebarLeadingIcon>
          <span className={SETTINGS_SIDEBAR_ITEM_LABEL_CLASS_NAME}>{t("search.back")}</span>
        </button>
      </div>

      <div className="mb-3 px-1" data-onboarding-target="settings-search">
        <SearchInput
          value={query}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder={t("search.placeholder")}
          aria-label={t("search.ariaLabel")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
      </div>

      {isSearching ? (
        results.length === 0 ? (
          <p className={SETTINGS_SIDEBAR_SECTION_LABEL_CLASS_NAME}>{t("search.empty")}</p>
        ) : (
          <ul
            aria-label={t("search.resultsAriaLabel")}
            className={cn("flex flex-col", SETTINGS_SIDEBAR_LIST_GAP_CLASS_NAME)}
          >
            {results.map((entry) => (
              <SettingsSearchResultRow
                key={entry.id}
                entry={entry}
                sectionLabel={settingsSectionLabel(entry.section, translateSettings)}
                onSelect={handleSelectResult}
              />
            ))}
          </ul>
        )
      ) : (
        <nav aria-label={t("navigation.sectionsAriaLabel")} className="flex flex-col">
          {SETTINGS_NAV_GROUPS.map((group) => {
            const items = SETTINGS_NAV_ITEMS.filter(
              (item) =>
                item.group === group.id &&
                isSettingsSectionVisible(item.id) &&
                (!item.desktopOnly || isElectron),
            );
            if (items.length === 0) {
              return null;
            }

            return (
              <section
                key={group.id}
                aria-labelledby={`settings-nav-${group.id}`}
                className={SETTINGS_SIDEBAR_SECTION_CLASS_NAME}
              >
                <h2
                  id={`settings-nav-${group.id}`}
                  className={SETTINGS_SIDEBAR_SECTION_LABEL_CLASS_NAME}
                >
                  {t(group.labelKey)}
                </h2>
                <ul className={cn("flex flex-col", SETTINGS_SIDEBAR_LIST_GAP_CLASS_NAME)}>
                  {items.map((item) => {
                    const isActive = item.id === props.activeSection;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-current={isActive ? "page" : undefined}
                          data-onboarding-target={`settings-section-${item.id}`}
                          className={cn(
                            SETTINGS_SIDEBAR_ITEM_CLASS_NAME,
                            isActive
                              ? SETTINGS_SIDEBAR_ROW_FILL_ACTIVE_CLASS_NAME
                              : SETTINGS_SIDEBAR_ROW_FILL_HOVER_CLASS_NAME,
                          )}
                          onClick={() => props.onSelectSection(item.id)}
                        >
                          <SidebarLeadingIcon size="sm" tone="text-inherit">
                            <CentralIcon
                              name={item.icon}
                              className={SETTINGS_SIDEBAR_ICON_CLASS_NAME}
                            />
                          </SidebarLeadingIcon>
                          <span className={SETTINGS_SIDEBAR_ITEM_LABEL_CLASS_NAME}>
                            {t(item.labelKey)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </nav>
      )}
    </div>
  );
}
