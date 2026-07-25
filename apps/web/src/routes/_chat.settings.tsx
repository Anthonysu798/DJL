// FILE: _chat.settings.tsx
// Purpose: Render the dedicated settings experience with its own section sidebar and grouped panels.
// Layer: Route screen
// Exports: Settings route component for `/settings`

import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProviderStatus,
  type ThreadId,
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  APP_LOCALE_PREFERENCES,
  type AppLocalePreference,
} from "@synara/contracts";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getModelOptions, normalizeModelSlug } from "@synara/shared/model";
import type { TFunction } from "i18next";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatLocaleRelativeTime } from "../i18n/intl";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  type AppSettings,
  DEFAULT_UI_DENSITY,
  type UiDensity,
  MAX_CHAT_FONT_SIZE_PX,
  MAX_TERMINAL_FONT_SIZE_PX,
  getCustomModelsForProvider,
  getGitTextGenerationModelOptions,
  MAX_CUSTOM_MODEL_LENGTH,
  MIN_CHAT_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  MODEL_PROVIDER_SETTINGS,
  normalizeChatFontSizePx,
  normalizeTerminalFontFamily,
  normalizeTerminalFontSizePx,
  patchCustomModels,
  TERMINAL_FONT_FAMILY_SUGGESTIONS,
  useAppSettings,
} from "../appSettings";
import { APP_VERSION } from "../branding";
import { useDesktopTopBarTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import { useProviderModelCatalog } from "../hooks/useProviderModelCatalog";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../components/ui/autocomplete";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import {
  SettingResetButton,
  SettingsSegmentedControl,
  SettingsSelectControl,
} from "../components/settings/SettingControls";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";
import { ThemePackEditor } from "../components/ThemePackEditor";
import { DebouncedSettingTextInput } from "../components/settings/DebouncedSettingTextInput";
import {
  SettingsCard,
  SettingsListRow,
  SettingsRow,
  SettingsSection,
  SettingsSelectPopup,
} from "../components/settings/SettingsPanelPrimitives";
import { ProviderUsageSettingsPanel } from "../components/settings/ProviderUsageSettingsPanel";
import { ProfileSettingsPanel } from "../components/settings/ProfileSettingsPanel";
import { RemoteSettingsPanel } from "../components/settings/RemoteSettingsPanel";
import { KeyboardShortcutsSettingsPanel } from "../components/settings/KeyboardShortcutsSettingsPanel";
import { SkillsSettingsPanel } from "../components/settings/SkillsSettingsPanel";
import { OpenCodeModelsSettingsPanel } from "../components/settings/OpenCodeModelsSettingsPanel";
import { LocalModelsSettingsPanel } from "../components/settings/LocalModelsSettingsPanel";
import {
  CHAT_CONTENT_CARD_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import {
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "../components/chat/chatHeaderControls";
import { SidebarHeaderNavigationControls } from "../components/SidebarHeaderNavigationControls";
import { RouteInsetSurface } from "../components/RouteInsetSurface";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { isUiDensity } from "../lib/appDensity";
import { CentralIcon } from "../lib/central-icons";
import { gitRemoveWorktreeMutationOptions } from "../lib/gitReactQuery";
import {
  deleteArchivedThreadFromClient,
  deleteArchivedThreadsFromClient,
} from "../lib/archivedThreadDelete";
import {
  ArchiveIcon,
  ChevronDownIcon,
  DeviceLaptopIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MoonIcon,
  PlusIcon,
  RotateCcwIcon,
  SunIcon,
  XIcon,
} from "../lib/icons";
import {
  serverConfigQueryOptions,
  serverQueryKeys,
  serverSettingsQueryOptions,
  serverWorktreesQueryOptions,
} from "../lib/serverReactQuery";
import { cn, isMacPlatform } from "../lib/utils";
import { unarchiveThreadFromClient } from "../lib/threadArchive";
import { resolveProviderDiscoveryCwd } from "../lib/providerDiscovery";
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import {
  buildNotificationSettingsSupportText,
  readBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
} from "../notifications/taskCompletion";
import {
  normalizeSettingsSection,
  SETTINGS_NAV_ITEMS,
  SETTINGS_TARGETS,
} from "../settingsNavigation";
import {
  SETTINGS_CARD_ROW_CLASS_NAME,
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
  SETTINGS_EMPTY_STATE_CLASS_NAME,
  SETTINGS_INSET_LIST_CLASS_NAME,
  SETTINGS_PAGE_BACKGROUND_CLASS_NAME,
  SETTINGS_PANEL_SECTION_CLASS_NAME,
  SETTINGS_RADIUS_CLASS_NAME,
  SETTINGS_SECTION_LABEL_CLASS_NAME,
} from "../settingsPanelStyles";
import { useStore } from "../store";
import ReleaseHistoryDialog from "../components/ReleaseHistoryDialog";
import { createAllThreadsMessagelessSelector, createThreadShellsSelector } from "../storeSelectors";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";
import { sameProviderOrder } from "../providerOrdering";
import { changeRendererLocale } from "../i18n";
import { APP_LANGUAGE_NATIVE_LABELS, selectableLanguageOptions } from "../i18n/appLocaleOptions";
import {
  getVisibleProviderUpdateStatuses,
  shouldShowProviderUpdateStatus,
} from "../providerUpdates";

// ── Settings taxonomy ──────────────────────────────────────────────────────

const UI_DENSITY_OPTION_VALUES = [
  {
    value: "compact",
    labelKey: "appearance.density.options.compact",
  },
  {
    value: "comfortable",
    labelKey: "appearance.density.options.comfortable",
  },
  {
    value: "spacious",
    labelKey: "appearance.density.options.spacious",
  },
] as const satisfies ReadonlyArray<{
  value: UiDensity;
  labelKey: string;
}>;

const THEME_OPTIONS = [
  {
    value: "light",
    labelKey: "appearance.theme.options.light",
    icon: <SunIcon />,
  },
  {
    value: "dark",
    labelKey: "appearance.theme.options.dark",
    icon: <MoonIcon />,
  },
  {
    value: "system",
    labelKey: "appearance.theme.options.system",
    icon: <DeviceLaptopIcon />,
  },
] as const;

const SIDEBAR_PROJECT_SORT_ORDER_KEYS = {
  updated_at: "route.general.sortOptions.recentlyActive",
  created_at: "route.general.sortOptions.recentlyAdded",
  manual: "route.general.sortOptions.manual",
} as const;

const SIDEBAR_THREAD_SORT_ORDER_KEYS = {
  updated_at: "route.general.sortOptions.recentlyActive",
  created_at: "route.general.sortOptions.newestFirst",
} as const;

type InstallBinarySettingsKey =
  | "claudeBinaryPath"
  | "codexBinaryPath"
  | "cursorBinaryPath"
  | "geminiBinaryPath"
  | "grokBinaryPath"
  | "droidBinaryPath"
  | "kiloBinaryPath"
  | "openCodeBinaryPath"
  | "piBinaryPath";
type InstallProviderSettings = {
  provider: ProviderKind;
  title: string;
  docs: ReadonlyArray<{
    labelKey: "install" | "update" | "config" | "headless" | "quickstart";
    href: string;
  }>;
  binaryPathKey: InstallBinarySettingsKey;
  binaryCommand: string;
  homePathKey?: "codexHomePath";
  homePlaceholder?: string;
  apiEndpointKey?: "cursorApiEndpoint";
  apiEndpointPlaceholder?: string;
  serverUrlKey?: "kiloServerUrl" | "openCodeServerUrl";
  serverUrlPlaceholder?: string;
  serverPasswordKey?: "kiloServerPassword" | "openCodeServerPassword";
  serverPasswordPlaceholder?: string;
  experimentalWebSocketsKey?: "openCodeExperimentalWebSockets";
  agentDirKey?: "piAgentDir";
  agentDirPlaceholder?: string;
};

const PROVIDER_VISIBILITY_OPTIONS: ReadonlyArray<{ provider: ProviderKind; title: string }> = [
  { provider: "codex", title: PROVIDER_DISPLAY_NAMES.codex },
  { provider: "claudeAgent", title: PROVIDER_DISPLAY_NAMES.claudeAgent },
  { provider: "cursor", title: PROVIDER_DISPLAY_NAMES.cursor },
  { provider: "gemini", title: PROVIDER_DISPLAY_NAMES.gemini },
  { provider: "grok", title: PROVIDER_DISPLAY_NAMES.grok },
  { provider: "droid", title: PROVIDER_DISPLAY_NAMES.droid },
  { provider: "kilo", title: PROVIDER_DISPLAY_NAMES.kilo },
  { provider: "opencode", title: PROVIDER_DISPLAY_NAMES.opencode },
  { provider: "pi", title: PROVIDER_DISPLAY_NAMES.pi },
];

// Pure helper kept at module scope so the toggle handler stays trivial and the
// dedupe logic is shared between the toggle and the schema normalizer.
function setProviderHidden(
  current: ReadonlyArray<ProviderKind>,
  provider: ProviderKind,
  hidden: boolean,
): ProviderKind[] {
  const withoutTarget = current.filter((entry) => entry !== provider);
  return hidden ? [...withoutTarget, provider] : withoutTarget;
}

function SortableProviderVisibilityRow(props: {
  option: { provider: ProviderKind; title: string };
  isHidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.option.provider });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        `flex items-center justify-between gap-3 ${SETTINGS_RADIUS_CLASS_NAME} border border-[color:var(--color-border)] bg-transparent px-3 py-2.5`,
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={cn(
            "inline-flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground active:cursor-grabbing",
            SETTINGS_RADIUS_CLASS_NAME,
          )}
          aria-label={t("route.providerVisibility.reorderAriaLabel", {
            provider: props.option.title,
          })}
          {...attributes}
          {...listeners}
        >
          <CentralIcon name="dot-grid-2x3" className="size-4" />
        </button>
        <span className="min-w-0 text-sm text-foreground">{props.option.title}</span>
      </div>
      <Switch
        checked={!props.isHidden}
        onCheckedChange={(checked) => props.onHiddenChange(!Boolean(checked))}
        aria-label={t("route.providerVisibility.showAriaLabel", {
          provider: props.option.title,
        })}
      />
    </div>
  );
}

const INSTALL_PROVIDER_SETTINGS: readonly InstallProviderSettings[] = [
  {
    provider: "codex",
    title: "Codex",
    docs: [
      { labelKey: "install", href: "https://help.openai.com/en/articles/11096431" },
      { labelKey: "update", href: "https://help.openai.com/en/articles/11096431" },
      { labelKey: "config", href: "https://github.com/openai/codex/blob/main/docs/config.md" },
    ],
    binaryPathKey: "codexBinaryPath",
    binaryCommand: "codex",
    homePathKey: "codexHomePath",
    homePlaceholder: "CODEX_HOME",
  },
  {
    provider: "claudeAgent",
    title: "Claude",
    docs: [
      { labelKey: "install", href: "https://code.claude.com/docs/en/installation" },
      {
        labelKey: "update",
        href: "https://code.claude.com/docs/en/installation#update-claude-code",
      },
      { labelKey: "config", href: "https://code.claude.com/docs/en/settings" },
    ],
    binaryPathKey: "claudeBinaryPath",
    binaryCommand: "claude",
  },
  {
    provider: "cursor",
    title: "Cursor",
    docs: [
      { labelKey: "install", href: "https://docs.cursor.com/en/cli/installation" },
      { labelKey: "update", href: "https://docs.cursor.com/en/cli/installation#updates" },
      { labelKey: "config", href: "https://docs.cursor.com/en/cli/overview" },
    ],
    binaryPathKey: "cursorBinaryPath",
    binaryCommand: "cursor-agent",
    apiEndpointKey: "cursorApiEndpoint",
    apiEndpointPlaceholder: "https://api2.cursor.sh",
  },
  {
    provider: "gemini",
    title: "Gemini",
    docs: [
      { labelKey: "install", href: "https://google-gemini.github.io/gemini-cli/docs/get-started/" },
      { labelKey: "update", href: "https://github.com/google-gemini/gemini-cli" },
      {
        labelKey: "config",
        href: "https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html",
      },
    ],
    binaryPathKey: "geminiBinaryPath",
    binaryCommand: "gemini",
  },
  {
    provider: "grok",
    title: "Grok",
    docs: [
      { labelKey: "install", href: "https://docs.x.ai/build/overview" },
      { labelKey: "headless", href: "https://docs.x.ai/build/cli/headless-scripting" },
      { labelKey: "config", href: "https://docs.x.ai/build/overview" },
    ],
    binaryPathKey: "grokBinaryPath",
    binaryCommand: "grok",
  },
  {
    provider: "droid",
    title: "Droid",
    docs: [
      {
        labelKey: "quickstart",
        href: "https://docs.factory.ai/cli/getting-started/quickstart.md",
      },
    ],
    binaryPathKey: "droidBinaryPath",
    binaryCommand: "droid",
  },
  {
    provider: "kilo",
    title: "Kilo",
    docs: [
      { labelKey: "install", href: "https://kilo.ai/docs/cli" },
      { labelKey: "update", href: "https://kilo.ai/docs/cli" },
      { labelKey: "config", href: "https://kilo.ai/docs/cli#configuration" },
    ],
    binaryPathKey: "kiloBinaryPath",
    binaryCommand: "kilo",
    serverUrlKey: "kiloServerUrl",
    serverUrlPlaceholder: "http://127.0.0.1:4096",
    serverPasswordKey: "kiloServerPassword",
  },
  {
    provider: "opencode",
    title: "DJL",
    docs: [
      { labelKey: "install", href: "https://opencode.ai/docs/" },
      { labelKey: "update", href: "https://opencode.ai/docs/cli/" },
      { labelKey: "config", href: "https://opencode.ai/docs/config/" },
    ],
    binaryPathKey: "openCodeBinaryPath",
    binaryCommand: "opencode",
    serverUrlKey: "openCodeServerUrl",
    serverUrlPlaceholder: "http://127.0.0.1:4096",
    serverPasswordKey: "openCodeServerPassword",
    experimentalWebSocketsKey: "openCodeExperimentalWebSockets",
  },
  {
    provider: "pi",
    title: "Pi",
    docs: [
      { labelKey: "install", href: "https://pi.dev/docs/latest" },
      { labelKey: "update", href: "https://pi.dev/docs/latest/settings" },
      { labelKey: "config", href: "https://pi.dev/docs/latest/settings" },
    ],
    binaryPathKey: "piBinaryPath",
    binaryCommand: "pi",
    agentDirKey: "piAgentDir",
  },
];

// ── Settings UI primitives ────────────────────────────────────────────────

// Shared settings controls live in ~/components/settings/SettingControls.

function ProviderDocsLinks({ docs }: { docs: InstallProviderSettings["docs"] }) {
  const { t } = useTranslation("settings");
  return (
    <div className={cn(SETTINGS_INSET_LIST_CLASS_NAME, "px-3 py-2.5")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium text-foreground">
          {t("route.providers.tools.cliDocs")}
        </span>
        <div className="flex flex-wrap gap-2">
          {docs.map((doc) => (
            <a
              key={`${doc.labelKey}:${doc.href}`}
              href={doc.href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 border border-[color:var(--color-border)] bg-transparent px-2.5 text-xs text-muted-foreground transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground",
                SETTINGS_RADIUS_CLASS_NAME,
              )}
            >
              <span>{t(`route.providers.tools.docs.${doc.labelKey}`)}</span>
              <ExternalLinkIcon className="size-3" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function normalizeManagedWorktreePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function formatProviderVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function providerUpdateStatusLabel(
  provider: ServerProviderStatus,
  t: TFunction<"settings">,
): string | null {
  const state = provider.updateState?.status;
  if (state === "queued") {
    return t("route.providers.updates.status.queued");
  }
  if (state === "running") {
    return t("route.providers.updates.status.updating");
  }
  if (state === "succeeded") {
    return t("route.providers.updates.status.updated");
  }
  if (state === "failed") {
    return t("route.providers.updates.status.failed");
  }
  if (state === "unchanged") {
    return t("route.providers.updates.status.stillOutdated");
  }
  const advisory = provider.versionAdvisory;
  if (advisory?.status === "behind_latest" && advisory.latestVersion) {
    const currentVersion = formatProviderVersion(advisory.currentVersion);
    const latestVersion = formatProviderVersion(advisory.latestVersion);
    return currentVersion
      ? t("route.providers.updates.status.versionTransition", {
          current: currentVersion,
          latest: latestVersion,
        })
      : t("route.providers.updates.status.latest", { version: latestVersion });
  }
  const currentVersion = formatProviderVersion(provider.version);
  return currentVersion
    ? t("route.providers.updates.status.current", { version: currentVersion })
    : null;
}

function providerUpdateFailureMessage(provider: ServerProviderStatus | undefined): string | null {
  const state = provider?.updateState;
  if (!state || (state.status !== "failed" && state.status !== "unchanged")) {
    return null;
  }
  return state.output?.trim() || state.message?.trim() || null;
}

export type CustomModelValidationError =
  | { kind: "required" }
  | { kind: "builtIn" }
  | { kind: "tooLong"; count: number }
  | { kind: "duplicate" };

export function localizeCustomModelValidationError(
  error: CustomModelValidationError,
  t: TFunction,
): string {
  switch (error.kind) {
    case "required":
      return t("route.models.customModels.errors.required", { ns: "settings" });
    case "builtIn":
      return t("route.models.customModels.errors.builtIn", { ns: "settings" });
    case "tooLong":
      return t("route.models.customModels.errors.tooLong", {
        ns: "settings",
        count: error.count,
      });
    case "duplicate":
      return t("route.models.customModels.errors.duplicate", { ns: "settings" });
  }
}

export function formatSettingsRouteDiagnostic(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

type OpenKeybindingsError = { kind: "noEditors" } | { kind: "diagnostic"; value: unknown };

function formatArchivedRelativeTime(iso: string, locale: string): string {
  const elapsedMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return formatLocaleRelativeTime(0, "minute", locale, { numeric: "auto" });
  if (minutes < 60)
    return formatLocaleRelativeTime(-minutes, "minute", locale, { numeric: "auto" });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatLocaleRelativeTime(-hours, "hour", locale, { numeric: "auto" });
  return formatLocaleRelativeTime(-Math.floor(hours / 24), "day", locale, { numeric: "auto" });
}

// Keys of AppSettings whose value is a plain boolean — the only ones that can be
// driven by the shared on/off toggle row below.
type BooleanSettingKey = {
  [Key in keyof AppSettings]-?: AppSettings[Key] extends boolean ? Key : never;
}[keyof AppSettings];

// ── Route screen ───────────────────────────────────────────────────────────

// Scroll a deep-linked settings section into view when it becomes the active `?target=…`.
// `retriggerKey` lets a panel re-attempt after late-loading data mounts the target element.
function useSettingsTargetScroll(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  retriggerKey?: unknown,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, ref, retriggerKey]);
}

function SettingsRouteView() {
  const { t, i18n } = useTranslation("settings");
  const resolvedLocale = i18n.resolvedLanguage || i18n.language || "en";
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSection = normalizeSettingsSection(routeSearch.section);
  const settingsTarget = typeof routeSearch.target === "string" ? routeSearch.target : null;
  const activeSectionItem = SETTINGS_NAV_ITEMS.find((item) => item.id === activeSection)!;
  const desktopBuildInfo =
    typeof window === "undefined" ? null : (window.desktopBridge?.getBuildInfo?.() ?? null);
  const displayedBuildVersion = desktopBuildInfo?.version || APP_VERSION;
  const displayedBuildProvenance = desktopBuildInfo?.commit
    ? `${displayedBuildVersion} · ${desktopBuildInfo.commit}`
    : displayedBuildVersion;

  const { isDefaultActiveTheme, resetAllThemes, resolvedTheme, theme, setTheme } = useTheme();
  const { settings, defaults, updateSettings, resetSettings } = useAppSettings();
  const themeOptions = THEME_OPTIONS.map((option) => ({
    ...option,
    label: t(option.labelKey),
  }));
  const densityOptions = UI_DENSITY_OPTION_VALUES.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));
  const timestampFormatLabels = {
    locale: t("appearance.timeFormat.options.system"),
    "12-hour": t("appearance.timeFormat.options.12hour"),
    "24-hour": t("appearance.timeFormat.options.24hour"),
  } as const;
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const serverWorktreesQuery = useQuery(serverWorktreesQueryOptions());
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const removeDeletedThreadFromClientState = useStore(
    (store) => store.removeDeletedThreadFromClientState,
  );
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  // Shell-level subscription on purpose: the full-thread selector invalidates on every
  // streaming message/activity tick, which would re-render this whole route while a
  // turn is running. Settings only needs thread metadata (and message emptiness below).
  const threadShells = useStore(useMemo(() => createThreadShellsSelector(), []));
  const allThreadsMessageless = useStore(useMemo(() => createAllThreadsMessagelessSelector(), []));
  const projects = useStore((store) => store.projects);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const archivedThreads = useMemo(
    () => threadShells.filter((thread) => thread.archivedAt != null),
    [threadShells],
  );
  const shouldOfferRecoveryTools = useMemo(() => {
    if (!threadsHydrated || projects.length === 0) {
      return false;
    }
    return threadShells.length === 0 || allThreadsMessageless;
  }, [allThreadsMessageless, projects.length, threadShells.length, threadsHydrated]);

  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [isRepairingLocalState, setIsRepairingLocalState] = useState(false);
  const [showRecoveryTools, setShowRecoveryTools] = useState(false);
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<OpenKeybindingsError | null>(
    null,
  );
  const providerUpdatesRef = useRef<HTMLDivElement | null>(null);
  const providerInstallsRef = useRef<HTMLDivElement | null>(null);
  const environmentPanelRef = useRef<HTMLDivElement | null>(null);
  const [openInstallProviders, setOpenInstallProviders] = useState<Record<ProviderKind, boolean>>({
    codex: Boolean(settings.codexBinaryPath || settings.codexHomePath),
    claudeAgent: Boolean(settings.claudeBinaryPath),
    cursor: Boolean(settings.cursorBinaryPath || settings.cursorApiEndpoint),
    gemini: Boolean(settings.geminiBinaryPath),
    grok: Boolean(settings.grokBinaryPath),
    droid: Boolean(settings.droidBinaryPath),
    kilo: Boolean(settings.kiloBinaryPath || settings.kiloServerUrl || settings.kiloServerPassword),
    opencode: Boolean(
      settings.openCodeBinaryPath ||
      settings.openCodeExperimentalWebSockets ||
      settings.openCodeServerUrl ||
      settings.openCodeServerPassword,
    ),
    pi: Boolean(settings.piBinaryPath || settings.piAgentDir),
  });
  const [updatingProviders, setUpdatingProviders] = useState<ReadonlySet<ProviderKind>>(
    () => new Set(),
  );
  const [selectedCustomModelProvider, setSelectedCustomModelProvider] =
    useState<ProviderKind>("codex");
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    claudeAgent: "",
    cursor: "",
    gemini: "",
    grok: "",
    droid: "",
    kilo: "",
    opencode: "",
    pi: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, CustomModelValidationError | null>>
  >({});
  const [showAllCustomModels, setShowAllCustomModels] = useState(false);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(
    readBrowserNotificationPermissionState(),
  );
  const shouldShowFontSmoothing = isMacPlatform(
    typeof navigator === "undefined" ? "" : navigator.platform,
  );
  const visibleTerminalFontFamilySuggestions = useMemo(() => {
    const query = settings.terminalFontFamily.trim().toLowerCase();
    if (!query) return TERMINAL_FONT_FAMILY_SUGGESTIONS;
    return TERMINAL_FONT_FAMILY_SUGGESTIONS.filter((suggestion) =>
      suggestion.toLowerCase().includes(query),
    );
  }, [settings.terminalFontFamily]);

  const hiddenProviderSet = useMemo(
    () => new Set<ProviderKind>(settings.hiddenProviders),
    [settings.hiddenProviders],
  );
  const hiddenProviderCount = hiddenProviderSet.size;
  const providerVisibilityOptionsByProvider = useMemo(
    () => new Map(PROVIDER_VISIBILITY_OPTIONS.map((option) => [option.provider, option])),
    [],
  );
  const orderedProviderVisibilityOptions = useMemo(
    () =>
      settings.providerOrder.flatMap((provider) => {
        const option = providerVisibilityOptionsByProvider.get(provider);
        return option ? [option] : [];
      }),
    [providerVisibilityOptionsByProvider, settings.providerOrder],
  );
  const providerVisibilitySensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  );
  const isProviderOrderDirty = !sameProviderOrder(settings.providerOrder, defaults.providerOrder);
  const codexBinaryPath = settings.codexBinaryPath;
  const codexHomePath = settings.codexHomePath;
  const claudeBinaryPath = settings.claudeBinaryPath;
  const cursorBinaryPath = settings.cursorBinaryPath;
  const cursorApiEndpoint = settings.cursorApiEndpoint;
  const geminiBinaryPath = settings.geminiBinaryPath;
  const grokBinaryPath = settings.grokBinaryPath;
  const droidBinaryPath = settings.droidBinaryPath;
  const kiloBinaryPath = settings.kiloBinaryPath;
  const kiloServerUrl = settings.kiloServerUrl;
  const kiloServerPassword = settings.kiloServerPassword;
  const openCodeBinaryPath = settings.openCodeBinaryPath;
  const openCodeExperimentalWebSockets = settings.openCodeExperimentalWebSockets;
  const openCodeServerUrl = settings.openCodeServerUrl;
  const openCodeServerPassword = settings.openCodeServerPassword;
  const piBinaryPath = settings.piBinaryPath;
  const piAgentDir = settings.piAgentDir;
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const availableEditors = serverConfigQuery.data?.availableEditors;
  const providerStatusByProvider = useMemo(
    () =>
      new Map((serverConfigQuery.data?.providers ?? []).map((status) => [status.provider, status])),
    [serverConfigQuery.data?.providers],
  );
  const providerUpdateServerSettings = useMemo(
    () =>
      serverSettingsQuery.data
        ? {
            ...serverSettingsQuery.data,
            enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
          }
        : null,
    [serverSettingsQuery.data, settings.enableProviderUpdateChecks],
  );
  const outdatedProviderStatuses = useMemo(
    () =>
      getVisibleProviderUpdateStatuses({
        providers: serverConfigQuery.data?.providers ?? [],
        hiddenProviders: settings.hiddenProviders,
        serverSettings: providerUpdateServerSettings,
      }),
    [providerUpdateServerSettings, serverConfigQuery.data?.providers, settings.hiddenProviders],
  );
  const outdatedProviderCount = outdatedProviderStatuses.length;
  useSettingsTargetScroll(
    activeSection === "providers" && settingsTarget === SETTINGS_TARGETS.providerUpdates,
    providerUpdatesRef,
    serverConfigQuery.data?.providers,
  );

  // Deep-link target for the chat Environment panel's gear button (see EnvironmentPanel).
  useSettingsTargetScroll(
    activeSection === "general" && settingsTarget === SETTINGS_TARGETS.environmentPanel,
    environmentPanelRef,
  );

  // Sidebar search deep-links to an individual row via its `settingRowAnchorId`. The active
  // panel renders synchronously with this section change, so scroll once the row has mounted.
  useEffect(() => {
    if (!settingsTarget || !settingsTarget.startsWith("setting-")) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(settingsTarget)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, settingsTarget]);
  const managedWorktrees = serverWorktreesQuery.data?.worktrees;
  const worktreesByWorkspaceRoot = useMemo(() => {
    type WorktreeGroup = {
      workspaceRoot: string;
      worktrees: Array<{
        path: string;
        linkedThreads: typeof threadShells;
      }>;
    };
    // Map keeps grouping O(worktrees) instead of the previous O(worktrees²) `groups.find`,
    // while `groups` preserves the original first-seen workspace-root order.
    const groups: WorktreeGroup[] = [];
    const groupByRoot = new Map<string, WorktreeGroup>();
    for (const worktree of managedWorktrees ?? []) {
      const linkedThreads = threadShells.filter((thread) => {
        const candidatePaths = [
          normalizeManagedWorktreePath(thread.worktreePath),
          normalizeManagedWorktreePath(thread.associatedWorktreePath),
        ];
        return candidatePaths.includes(worktree.path);
      });
      const nextWorktree = { path: worktree.path, linkedThreads };
      const existingGroup = groupByRoot.get(worktree.workspaceRoot);
      if (existingGroup) {
        existingGroup.worktrees.push(nextWorktree);
      } else {
        const group: WorktreeGroup = {
          workspaceRoot: worktree.workspaceRoot,
          worktrees: [nextWorktree],
        };
        groups.push(group);
        groupByRoot.set(worktree.workspaceRoot, group);
      }
    }
    return groups;
  }, [managedWorktrees, threadShells]);

  // Builds provider model-option arrays; only the Models panel reads it. Memoize on the
  // narrow inputs the helper actually uses (destructured so exhaustive-deps stays exact) so
  // typing in any other settings field — every keystroke re-renders this monolithic route —
  // doesn't rebuild these lists.
  const {
    customCodexModels,
    customKiloModels,
    customOpenCodeModels,
    textGenerationModel,
    textGenerationProvider,
  } = settings;
  const currentGitTextGenerationProvider = textGenerationProvider ?? "codex";
  const currentGitTextGenerationModel = textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
  const gitWritingModelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [currentGitTextGenerationProvider]: currentGitTextGenerationModel }),
    [currentGitTextGenerationModel, currentGitTextGenerationProvider],
  );
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const { modelOptionsByProvider: gitWritingCatalogOptionsByProvider } = useProviderModelCatalog({
    selectedProvider: currentGitTextGenerationProvider,
    discoveryEnabled: activeSection === "models",
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider: gitWritingModelHintByProvider,
  });
  const gitTextGenerationModelOptions = useMemo(
    () =>
      getGitTextGenerationModelOptions(
        {
          customCodexModels,
          customKiloModels,
          customOpenCodeModels,
          textGenerationModel,
          textGenerationProvider,
        },
        {
          codex: gitWritingCatalogOptionsByProvider.codex,
          kilo: gitWritingCatalogOptionsByProvider.kilo,
          opencode: gitWritingCatalogOptionsByProvider.opencode,
        },
      ),
    [
      customCodexModels,
      customKiloModels,
      customOpenCodeModels,
      gitWritingCatalogOptionsByProvider.codex,
      gitWritingCatalogOptionsByProvider.kilo,
      gitWritingCatalogOptionsByProvider.opencode,
      textGenerationModel,
      textGenerationProvider,
    ],
  );
  const currentGitTextGenerationValue = `${currentGitTextGenerationProvider}:${currentGitTextGenerationModel}`;
  const defaultGitTextGenerationProvider = defaults.textGenerationProvider ?? "codex";
  const defaultGitTextGenerationModel =
    defaults.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
  const isGitTextGenerationModelDirty =
    currentGitTextGenerationProvider !== defaultGitTextGenerationProvider ||
    currentGitTextGenerationModel !== defaultGitTextGenerationModel;
  const selectedGitTextGenerationModelLabel =
    gitTextGenerationModelOptions.find(
      (option) =>
        option.provider === currentGitTextGenerationProvider &&
        option.slug === currentGitTextGenerationModel,
    )?.name ?? currentGitTextGenerationModel;
  const selectedCustomModelProviderSettings = MODEL_PROVIDER_SETTINGS.find(
    (providerSettings) => providerSettings.provider === selectedCustomModelProvider,
  )!;
  const selectedCustomModelInput = customModelInputByProvider[selectedCustomModelProvider];
  const selectedCustomModelError = customModelErrorByProvider[selectedCustomModelProvider] ?? null;
  const totalCustomModels =
    settings.customCodexModels.length +
    settings.customClaudeModels.length +
    settings.customCursorModels.length +
    settings.customGeminiModels.length +
    settings.customGrokModels.length +
    settings.customDroidModels.length +
    settings.customKiloModels.length +
    settings.customOpenCodeModels.length +
    settings.customPiModels.length;
  const savedCustomModelRows = useMemo(
    () =>
      MODEL_PROVIDER_SETTINGS.flatMap((providerSettings) =>
        getCustomModelsForProvider(settings, providerSettings.provider).map((slug) => ({
          key: `${providerSettings.provider}:${slug}`,
          provider: providerSettings.provider,
          providerTitle: providerSettings.title,
          slug,
        })),
      ),
    [settings],
  );
  const visibleCustomModelRows = showAllCustomModels
    ? savedCustomModelRows
    : savedCustomModelRows.slice(0, 5);
  const isInstallSettingsDirty =
    settings.claudeBinaryPath !== defaults.claudeBinaryPath ||
    settings.cursorBinaryPath !== defaults.cursorBinaryPath ||
    settings.cursorApiEndpoint !== defaults.cursorApiEndpoint ||
    settings.geminiBinaryPath !== defaults.geminiBinaryPath ||
    settings.grokBinaryPath !== defaults.grokBinaryPath ||
    settings.droidBinaryPath !== defaults.droidBinaryPath ||
    settings.kiloBinaryPath !== defaults.kiloBinaryPath ||
    settings.kiloServerUrl !== defaults.kiloServerUrl ||
    settings.kiloServerPassword !== defaults.kiloServerPassword ||
    settings.codexBinaryPath !== defaults.codexBinaryPath ||
    settings.codexHomePath !== defaults.codexHomePath ||
    settings.openCodeBinaryPath !== defaults.openCodeBinaryPath ||
    settings.openCodeExperimentalWebSockets !== defaults.openCodeExperimentalWebSockets ||
    settings.openCodeServerUrl !== defaults.openCodeServerUrl ||
    settings.openCodeServerPassword !== defaults.openCodeServerPassword ||
    settings.piBinaryPath !== defaults.piBinaryPath ||
    settings.piAgentDir !== defaults.piAgentDir;
  const changedSettingLabels = [
    ...(settings.language !== defaults.language ? [t("appearance.language.title")] : []),
    ...(theme !== "system" ? [t("appearance.theme.title")] : []),
    ...(!isDefaultActiveTheme
      ? [
          t("route.changedSettings.themePack", {
            theme: t(
              resolvedTheme === "dark"
                ? "appearance.theme.options.dark"
                : "appearance.theme.options.light",
            ),
          }),
        ]
      : []),
    ...(settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode
      ? [t("search.entries.general.new-threads.title")]
      : []),
    ...(settings.sidebarProjectSortOrder !== defaults.sidebarProjectSortOrder
      ? [t("search.entries.general.project-order.title")]
      : []),
    ...(settings.sidebarThreadSortOrder !== defaults.sidebarThreadSortOrder
      ? [t("search.entries.general.thread-order.title")]
      : []),
    ...(settings.showChatsSection !== defaults.showChatsSection
      ? [t("route.changedSettings.chatsSection")]
      : []),
    ...(settings.showStudioSection !== defaults.showStudioSection
      ? [t("route.changedSettings.workSection")]
      : []),
    ...(settings.showWorkspaceSection !== defaults.showWorkspaceSection
      ? [t("route.changedSettings.workspaceSection")]
      : []),
    ...(settings.uiDensity !== defaults.uiDensity ? [t("appearance.density.title")] : []),
    ...(settings.chatFontSizePx !== defaults.chatFontSizePx
      ? [t("appearance.baseFontSize.title")]
      : []),
    ...(settings.terminalFontSizePx !== defaults.terminalFontSizePx
      ? [t("appearance.terminalFontSize.title")]
      : []),
    ...(settings.terminalFontFamily !== defaults.terminalFontFamily
      ? [t("appearance.terminalFont.title")]
      : []),
    ...(shouldShowFontSmoothing &&
    settings.enableNativeFontSmoothing !== defaults.enableNativeFontSmoothing
      ? [t("appearance.fontSmoothing.title")]
      : []),
    ...(settings.timestampFormat !== defaults.timestampFormat
      ? [t("appearance.timeFormat.title")]
      : []),
    ...(settings.enableTaskCompletionToasts !== defaults.enableTaskCompletionToasts
      ? [t("notifications.activity.title")]
      : []),
    ...(settings.enableSystemTaskCompletionNotifications !==
    defaults.enableSystemTaskCompletionNotifications
      ? [t("notifications.desktop.title")]
      : []),
    ...(settings.enableAssistantStreaming !== defaults.enableAssistantStreaming
      ? [t("search.entries.behavior.assistant-output.title")]
      : []),
    ...(settings.enableProviderUpdateChecks !== defaults.enableProviderUpdateChecks
      ? [t("route.changedSettings.providerUpdateChecks")]
      : []),
    ...(settings.diffWordWrap !== defaults.diffWordWrap
      ? [t("search.entries.behavior.diff-line-wrapping.title")]
      : []),
    ...(settings.confirmThreadDelete !== defaults.confirmThreadDelete
      ? [t("search.entries.behavior.delete-confirmation.title")]
      : []),
    ...(settings.confirmThreadArchive !== defaults.confirmThreadArchive
      ? [t("search.entries.behavior.archive-confirmation.title")]
      : []),
    ...(settings.confirmTerminalTabClose !== defaults.confirmTerminalTabClose
      ? [t("search.entries.behavior.terminal-close-confirmation.title")]
      : []),
    ...(isGitTextGenerationModelDirty ? [t("search.entries.models.git-writing-model.title")] : []),
    ...(settings.customCodexModels.length > 0 ||
    settings.customClaudeModels.length > 0 ||
    settings.customCursorModels.length > 0 ||
    settings.customGeminiModels.length > 0 ||
    settings.customGrokModels.length > 0 ||
    settings.customDroidModels.length > 0 ||
    settings.customKiloModels.length > 0 ||
    settings.customOpenCodeModels.length > 0 ||
    settings.customPiModels.length > 0
      ? [t("route.models.customModels.title")]
      : []),
    ...(isInstallSettingsDirty ? [t("route.changedSettings.providerInstalls")] : []),
    ...(hiddenProviderCount > 0 ? [t("route.changedSettings.providerVisibility")] : []),
    ...(isProviderOrderDirty ? [t("route.changedSettings.providerOrder")] : []),
  ];

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenKeybindingsError({ kind: "noEditors" });
      setIsOpeningKeybindings(false);
      return;
    }
    void api.shell
      .openInEditor(keybindingsConfigPath, editor)
      .catch((error) => {
        setOpenKeybindingsError({ kind: "diagnostic", value: error });
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [availableEditors, keybindingsConfigPath]);

  useEffect(() => {
    setBrowserNotificationPermission(readBrowserNotificationPermissionState());
  }, []);

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = getCustomModelsForProvider(settings, provider);
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: { kind: "required" },
        }));
        return;
      }
      if (getModelOptions(provider).some((option) => option.slug === normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: { kind: "builtIn" },
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: { kind: "tooLong", count: MAX_CUSTOM_MODEL_LENGTH },
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: { kind: "duplicate" },
        }));
        return;
      }

      updateSettings(patchCustomModels(provider, [...customModels, normalized]));
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [customModelInputByProvider, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  const handleProviderOrderDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }
      const fromIndex = settings.providerOrder.indexOf(active.id as ProviderKind);
      const toIndex = settings.providerOrder.indexOf(over.id as ProviderKind);
      if (fromIndex < 0 || toIndex < 0) {
        return;
      }
      updateSettings({
        providerOrder: arrayMove([...settings.providerOrder], fromIndex, toIndex),
      });
    },
    [settings.providerOrder, updateSettings],
  );

  const runProviderUpdate = useCallback(
    async (provider: ProviderKind) => {
      if (updatingProviders.has(provider)) {
        return;
      }
      setUpdatingProviders((current) => new Set(current).add(provider));
      try {
        const result = await ensureNativeApi().server.updateProvider({ provider });
        const refreshedProvider = result.providers.find((status) => status.provider === provider);
        const failureMessage = providerUpdateFailureMessage(refreshedProvider);
        if (
          refreshedProvider?.updateState?.status === "failed" ||
          refreshedProvider?.updateState?.status === "unchanged"
        ) {
          const manualCommand = refreshedProvider?.versionAdvisory?.updateCommand?.trim();
          toastManager.add({
            type: "error",
            title: t("route.errors.providerUpdate.title", {
              provider: PROVIDER_DISPLAY_NAMES[provider],
            }),
            description: [
              t("route.errors.providerUpdate.summary"),
              ...(manualCommand ? [t("route.errors.providerUpdate.recovery")] : []),
              ...(failureMessage ? [failureMessage] : []),
            ].join("\n\n"),
            ...(manualCommand ? { data: { copyText: manualCommand } } : {}),
          });
          return;
        }
        toastManager.add({
          type: "success",
          title: t("route.providers.updates.finishedTitle", {
            provider: PROVIDER_DISPLAY_NAMES[provider],
          }),
          description: t("route.providers.updates.finishedDescription"),
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: t("route.errors.providerUpdate.title", {
            provider: PROVIDER_DISPLAY_NAMES[provider],
          }),
          description: [
            t("route.errors.providerUpdate.summary"),
            formatSettingsRouteDiagnostic(error, t("route.errors.keybindings.unknownDetail")),
          ].join("\n\n"),
        });
      } finally {
        await queryClient
          .invalidateQueries({ queryKey: serverQueryKeys.config() })
          .catch(() => undefined);
        setUpdatingProviders((current) => {
          const next = new Set(current);
          next.delete(provider);
          return next;
        });
      }
    },
    [queryClient, t, updatingProviders],
  );

  async function restoreDefaults() {
    if (changedSettingLabels.length === 0) return;

    const api = readNativeApi();
    const formattedSettings = new Intl.ListFormat(resolvedLocale, {
      style: "long",
      type: "conjunction",
    }).format(changedSettingLabels);
    const confirmed = await (api ?? ensureNativeApi()).dialogs.confirm(
      [
        t("route.confirmations.restoreDefaults.title"),
        t("route.confirmations.restoreDefaults.description", { settings: formattedSettings }),
      ].join("\n"),
    );
    if (!confirmed) return;

    setTheme("system");
    resetAllThemes();
    resetSettings();
    await changeRendererLocale(defaults.language);
    setOpenInstallProviders({
      codex: false,
      claudeAgent: false,
      cursor: false,
      gemini: false,
      grok: false,
      droid: false,
      kilo: false,
      opencode: false,
      pi: false,
    });
    setSelectedCustomModelProvider("codex");
    setCustomModelInputByProvider({
      codex: "",
      claudeAgent: "",
      cursor: "",
      gemini: "",
      grok: "",
      droid: "",
      kilo: "",
      opencode: "",
      pi: "",
    });
    setCustomModelErrorByProvider({});
    setShowAllCustomModels(false);
    setShowRecoveryTools(false);
    setOpenKeybindingsError(null);
  }

  async function setSystemNotificationsEnabled(nextEnabled: boolean) {
    if (!nextEnabled) {
      updateSettings({ enableSystemTaskCompletionNotifications: false });
      return;
    }

    if (isElectron) {
      updateSettings({ enableSystemTaskCompletionNotifications: true });
      return;
    }

    const permission = await requestBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);

    if (permission === "granted") {
      updateSettings({ enableSystemTaskCompletionNotifications: true });
      return;
    }

    updateSettings({ enableSystemTaskCompletionNotifications: false });
    toastManager.add({
      type: permission === "denied" ? "warning" : "error",
      title: t("notifications.desktop.unavailableTitle"),
      description: buildNotificationSettingsSupportText(permission, t),
    });
  }

  async function sendTestNotification() {
    const title = t("notifications.desktop.testNotificationTitle");
    const body = t("notifications.desktop.testNotificationBody");

    if (window.desktopBridge) {
      const shown = await window.desktopBridge.notifications.show({ title, body, silent: false });
      toastManager.add({
        type: shown ? "success" : "warning",
        title: shown
          ? t("notifications.desktop.testSentTitle")
          : t("notifications.desktop.unavailableShortTitle"),
        description: shown
          ? t("notifications.desktop.testSentDesktopDescription")
          : t("notifications.desktop.unsupportedDeviceDescription"),
      });
      return;
    }

    const permission = await requestBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);
    if (permission !== "granted") {
      toastManager.add({
        type: permission === "denied" ? "warning" : "error",
        title: t("notifications.desktop.unavailableTitle"),
        description: buildNotificationSettingsSupportText(permission, t),
      });
      return;
    }

    const notification = new Notification(title, { body, tag: "synara:test-notification" });
    notification.addEventListener("click", () => {
      window.focus();
    });
    toastManager.add({
      type: "success",
      title: t("notifications.desktop.testSentTitle"),
      description: t("notifications.desktop.testSentBrowserDescription"),
    });
  }

  // Rebuild the local project indexes after an older install leaves them out of sync.
  const repairLocalState = useCallback(async () => {
    if (isRepairingLocalState) {
      return;
    }

    const api = readNativeApi() ?? ensureNativeApi();
    const confirmed = await api.dialogs.confirm(
      [
        t("route.confirmations.repairState.title"),
        t("route.confirmations.repairState.rebuildDescription"),
        t("route.confirmations.repairState.safetyDescription"),
      ].join("\n"),
    );
    if (!confirmed) {
      return;
    }

    setIsRepairingLocalState(true);
    try {
      const snapshot = await api.orchestration.repairState();
      syncServerReadModel(snapshot);
      toastManager.add({
        type: "success",
        title: t("route.advanced.recovery.successTitle"),
        description: t("route.advanced.recovery.successDescription"),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("route.errors.repairState.title"),
        description: [
          t("route.errors.repairState.summary"),
          formatSettingsRouteDiagnostic(error, t("route.errors.keybindings.unknownDetail")),
        ].join("\n\n"),
      });
    } finally {
      setIsRepairingLocalState(false);
    }
  }, [isRepairingLocalState, syncServerReadModel, t]);

  const deleteManagedWorktree = useCallback(
    async (input: { workspaceRoot: string; worktreePath: string }) => {
      const api = readNativeApi() ?? ensureNativeApi();
      const displayName = formatWorktreePathForDisplay(input.worktreePath);
      let snapshot;
      try {
        snapshot = await api.orchestration.getShellSnapshot();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: t("route.errors.worktreeVerification.title"),
          description: [
            t("route.errors.worktreeVerification.recovery"),
            formatSettingsRouteDiagnostic(error, t("route.errors.keybindings.unknownDetail")),
          ].join("\n\n"),
        });
        return;
      }

      const linkedThreadsFromSnapshot = snapshot.threads.filter((thread) => {
        const candidatePaths = [
          normalizeManagedWorktreePath(thread.worktreePath),
          normalizeManagedWorktreePath(thread.associatedWorktreePath ?? null),
        ];
        return candidatePaths.includes(input.worktreePath);
      });
      const linkedArchivedThreadIds = linkedThreadsFromSnapshot
        .filter((thread) => (thread.archivedAt ?? null) !== null)
        .map((thread) => thread.id);
      const linkedActiveThreadCount = linkedThreadsFromSnapshot.filter(
        (thread) => (thread.archivedAt ?? null) === null,
      ).length;
      const linkedConversationCount = linkedActiveThreadCount + linkedArchivedThreadIds.length;
      const confirmed = await api.dialogs.confirm(
        linkedConversationCount > 0
          ? [
              t("route.confirmations.deleteWorktree.title", { name: displayName }),
              "",
              t("route.confirmations.deleteWorktree.linkedSummary", {
                activeCount: linkedActiveThreadCount,
                archivedCount: linkedArchivedThreadIds.length,
                count: linkedConversationCount,
              }),
              linkedArchivedThreadIds.length > 0
                ? t("route.confirmations.deleteWorktree.archivedImpact")
                : t("route.confirmations.deleteWorktree.activeImpact"),
              "",
              t("route.confirmations.deleteWorktree.question"),
            ].join("\n")
          : [
              t("route.confirmations.deleteWorktree.title", { name: displayName }),
              t("route.confirmations.deleteWorktree.unlinkedDescription"),
            ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      try {
        await deleteArchivedThreadsFromClient({
          api: api.orchestration,
          threadIds: linkedArchivedThreadIds,
          removeDeletedThreadFromClientState,
        });

        await removeWorktreeMutation.mutateAsync({
          cwd: input.workspaceRoot,
          path: input.worktreePath,
          force: true,
        });
        await queryClient.invalidateQueries({
          queryKey: serverQueryKeys.worktrees(),
        });
        toastManager.add({
          type: "success",
          title: t("route.worktrees.deletedTitle"),
          description:
            linkedArchivedThreadIds.length > 0
              ? t("route.worktrees.removedWithArchived", {
                  name: displayName,
                  count: linkedArchivedThreadIds.length,
                })
              : t("route.worktrees.removed", { name: displayName }),
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: t("route.errors.deleteWorktree.title"),
          description: [
            t("route.errors.deleteWorktree.summary"),
            formatSettingsRouteDiagnostic(error, t("route.errors.keybindings.unknownDetail")),
          ].join("\n\n"),
        });
      }
    },
    [queryClient, removeDeletedThreadFromClientState, removeWorktreeMutation, t],
  );

  const unarchiveThread = useCallback(
    async (threadId: ThreadId) => {
      const api = readNativeApi();
      if (!api) return;
      try {
        await unarchiveThreadFromClient(api.orchestration, threadId);
        toastManager.add({
          type: "success",
          title: t("route.archived.restoredTitle"),
          description: t("route.archived.restoredDescription"),
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: t("route.errors.restoreThread.title"),
          description: [
            t("route.errors.restoreThread.summary"),
            formatSettingsRouteDiagnostic(error, t("route.errors.keybindings.unknownDetail")),
          ].join("\n\n"),
        });
      }
    },
    [t],
  );

  const deleteArchivedThread = useCallback(
    async (threadId: ThreadId, threadTitle: string) => {
      const api = readNativeApi();
      if (!api) return;

      const confirmed = await api.dialogs.confirm(
        [
          t("route.confirmations.deleteArchivedThread.title", { title: threadTitle }),
          "",
          t("route.confirmations.deleteArchivedThread.description"),
        ].join("\n"),
      );
      if (!confirmed) return;

      try {
        await deleteArchivedThreadFromClient({
          api: api.orchestration,
          threadId,
          removeDeletedThreadFromClientState,
        });
        toastManager.add({
          type: "success",
          title: t("route.archived.deletedTitle"),
          description: t("route.archived.deletedDescription"),
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: t("route.errors.deleteThread.title"),
          description: [
            t("route.errors.deleteThread.summary"),
            formatSettingsRouteDiagnostic(error, t("route.errors.keybindings.unknownDetail")),
          ].join("\n\n"),
        });
      }
    },
    [removeDeletedThreadFromClientState, t],
  );

  const handleArchivedThreadContextMenu = useCallback(
    async (threadId: ThreadId, threadTitle: string, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;

      const clicked = await api.contextMenu.show(
        [
          { id: "restore", label: t("route.archived.actions.restore") },
          { id: "delete", label: t("route.archived.actions.delete"), destructive: true },
        ],
        position,
      );

      if (clicked === "restore") {
        await unarchiveThread(threadId);
        return;
      }

      if (clicked === "delete") {
        await deleteArchivedThread(threadId, threadTitle);
      }
    },
    [deleteArchivedThread, t, unarchiveThread],
  );

  // Shared on/off settings row: a labelled Switch bound to a boolean AppSettings
  // key, with the standard "reset to default" affordance shown only when changed.
  // Rows with bespoke controls (e.g. the desktop-notifications Test button) keep
  // their own markup instead of using this helper.
  const renderBooleanSettingRow = (config: {
    settingKey: BooleanSettingKey;
    settingId?: string;
    title: string;
    description: string;
    resetLabel: string;
    ariaLabel: string;
  }) => {
    const { settingKey, settingId, title, description, resetLabel, ariaLabel } = config;
    const isChanged = settings[settingKey] !== defaults[settingKey];
    return (
      <SettingsRow
        {...(settingId === undefined ? {} : { settingId })}
        title={title}
        description={description}
        resetAction={
          isChanged ? (
            <SettingResetButton
              label={resetLabel}
              onClick={() =>
                updateSettings({ [settingKey]: defaults[settingKey] } as Partial<AppSettings>)
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings[settingKey]}
            onCheckedChange={(checked) =>
              updateSettings({ [settingKey]: Boolean(checked) } as Partial<AppSettings>)
            }
            aria-label={ariaLabel}
          />
        }
      />
    );
  };

  const renderGeneralPanel = () => (
    <div className="space-y-6">
      <SettingsSection title={t("route.general.sections.coreDefaults")}>
        <SettingsRow
          settingId="new-threads"
          title={t("search.entries.general.new-threads.title")}
          description={t("route.general.newThreads.description")}
          resetAction={
            settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
              <SettingResetButton
                label={t("search.entries.general.new-threads.title")}
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: defaults.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value !== "local" && value !== "worktree") return;
                updateSettings({
                  defaultThreadEnvMode: value,
                });
              }}
              ariaLabel={t("search.entries.general.new-threads.title")}
              valueContent={t(
                settings.defaultThreadEnvMode === "worktree"
                  ? "route.general.threadModes.worktree"
                  : "route.general.threadModes.local",
              )}
            >
              <SelectItem hideIndicator value="local">
                {t("route.general.threadModes.local")}
              </SelectItem>
              <SelectItem hideIndicator value="worktree">
                {t("route.general.threadModes.worktree")}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("route.general.sections.sidebarOrganization")}>
        <SettingsRow
          settingId="project-order"
          title={t("search.entries.general.project-order.title")}
          description={t("route.general.projectOrder.description")}
          resetAction={
            settings.sidebarProjectSortOrder !== defaults.sidebarProjectSortOrder ? (
              <SettingResetButton
                label={t("search.entries.general.project-order.title")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: defaults.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "created_at" && value !== "manual") {
                  return;
                }
                updateSettings({ sidebarProjectSortOrder: value });
              }}
              ariaLabel={t("search.entries.general.project-order.title")}
              valueContent={t(SIDEBAR_PROJECT_SORT_ORDER_KEYS[settings.sidebarProjectSortOrder])}
            >
              <SelectItem hideIndicator value="updated_at">
                {t(SIDEBAR_PROJECT_SORT_ORDER_KEYS.updated_at)}
              </SelectItem>
              <SelectItem hideIndicator value="created_at">
                {t(SIDEBAR_PROJECT_SORT_ORDER_KEYS.created_at)}
              </SelectItem>
              <SelectItem hideIndicator value="manual">
                {t(SIDEBAR_PROJECT_SORT_ORDER_KEYS.manual)}
              </SelectItem>
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          settingId="thread-order"
          title={t("search.entries.general.thread-order.title")}
          description={t("route.general.threadOrder.description")}
          resetAction={
            settings.sidebarThreadSortOrder !== defaults.sidebarThreadSortOrder ? (
              <SettingResetButton
                label={t("search.entries.general.thread-order.title")}
                onClick={() =>
                  updateSettings({
                    sidebarThreadSortOrder: defaults.sidebarThreadSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sidebarThreadSortOrder}
              onValueChange={(value) => {
                if (value !== "updated_at" && value !== "created_at") {
                  return;
                }
                updateSettings({ sidebarThreadSortOrder: value });
              }}
              ariaLabel={t("search.entries.general.thread-order.title")}
              valueContent={t(SIDEBAR_THREAD_SORT_ORDER_KEYS[settings.sidebarThreadSortOrder])}
            >
              <SelectItem hideIndicator value="updated_at">
                {t(SIDEBAR_THREAD_SORT_ORDER_KEYS.updated_at)}
              </SelectItem>
              <SelectItem hideIndicator value="created_at">
                {t(SIDEBAR_THREAD_SORT_ORDER_KEYS.created_at)}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("route.general.sections.sidebarSections")}>
        {renderBooleanSettingRow({
          settingId: "chats",
          settingKey: "showChatsSection",
          title: t("search.entries.general.chats-section.title"),
          description: t("route.general.sidebar.chats.description"),
          resetLabel: t("search.entries.general.chats-section.title"),
          ariaLabel: t("route.general.sidebar.showAriaLabel", {
            section: t("search.entries.general.chats-section.title"),
          }),
        })}

        {renderBooleanSettingRow({
          settingId: "studio",
          settingKey: "showStudioSection",
          title: t("search.entries.general.studio-section.title"),
          description: t("route.general.sidebar.work.description"),
          resetLabel: t("search.entries.general.studio-section.title"),
          ariaLabel: t("route.general.sidebar.showAriaLabel", {
            section: t("search.entries.general.studio-section.title"),
          }),
        })}

        {renderBooleanSettingRow({
          settingId: "workspace",
          settingKey: "showWorkspaceSection",
          title: t("search.entries.general.workspace-section.title"),
          description: t("route.general.sidebar.workspace.description"),
          resetLabel: t("search.entries.general.workspace-section.title"),
          ariaLabel: t("route.general.sidebar.showAriaLabel", {
            section: t("search.entries.general.workspace-section.title"),
          }),
        })}
      </SettingsSection>

      <div ref={environmentPanelRef} id={SETTINGS_TARGETS.environmentPanel}>
        <SettingsSection title={t("route.general.sections.environmentPanel")}>
          {renderBooleanSettingRow({
            settingId: "open-by-default",
            settingKey: "environmentPanelDefaultOpen",
            title: t("search.entries.general.environment-default-open.title"),
            description: t("route.general.environment.defaultOpen.description"),
            resetLabel: t("search.entries.general.environment-default-open.title"),
            ariaLabel: t("route.general.environment.defaultOpen.ariaLabel"),
          })}

          {renderBooleanSettingRow({
            settingId: "usage",
            settingKey: "showEnvironmentUsage",
            title: t("search.entries.general.environment-usage.title"),
            description: t("route.general.environment.usage.description"),
            resetLabel: t("search.entries.general.environment-usage.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("search.entries.general.environment-usage.title"),
            }),
          })}

          {renderBooleanSettingRow({
            settingId: "repository",
            settingKey: "showEnvironmentRepository",
            title: t("search.entries.general.environment-repository.title"),
            description: t("route.general.environment.repository.description"),
            resetLabel: t("search.entries.general.environment-repository.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("search.entries.general.environment-repository.title"),
            }),
          })}

          {renderBooleanSettingRow({
            settingId: "pull-request",
            settingKey: "showEnvironmentPullRequest",
            title: t("search.entries.general.environment-pull-request.title"),
            description: t("route.general.environment.pullRequest.description"),
            resetLabel: t("search.entries.general.environment-pull-request.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("search.entries.general.environment-pull-request.title"),
            }),
          })}

          {renderBooleanSettingRow({
            settingId: "editor",
            settingKey: "showEnvironmentEditor",
            title: t("search.entries.general.environment-editor.title"),
            description: t("route.general.environment.editor.description"),
            resetLabel: t("search.entries.general.environment-editor.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("search.entries.general.environment-editor.title"),
            }),
          })}

          {renderBooleanSettingRow({
            settingId: "recap",
            settingKey: "showEnvironmentRecap",
            title: t("search.entries.general.environment-recap.title"),
            description: t("route.general.environment.recap.description"),
            resetLabel: t("search.entries.general.environment-recap.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("search.entries.general.environment-recap.title"),
            }),
          })}

          {renderBooleanSettingRow({
            settingId: "pinned-messages",
            settingKey: "showEnvironmentPinned",
            title: t("search.entries.general.environment-pinned.title"),
            description: t("route.general.environment.pinned.description"),
            resetLabel: t("search.entries.general.environment-pinned.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("search.entries.general.environment-pinned.title"),
            }),
          })}

          {renderBooleanSettingRow({
            settingId: "text-markers",
            settingKey: "showEnvironmentMarkers",
            title: t("search.entries.general.environment-markers.title"),
            description: t("route.general.environment.markers.description"),
            resetLabel: t("search.entries.general.environment-markers.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("search.entries.general.environment-markers.title"),
            }),
          })}

          {renderBooleanSettingRow({
            settingId: "project-instructions",
            settingKey: "showEnvironmentInstructions",
            title: t("route.general.environment.instructions.title"),
            description: t("route.general.environment.instructions.description"),
            resetLabel: t("route.general.environment.instructions.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("route.general.environment.instructions.title"),
            }),
          })}

          {renderBooleanSettingRow({
            settingId: "notepad",
            settingKey: "showEnvironmentNotepad",
            title: t("search.entries.general.environment-notepad.title"),
            description: t("route.general.environment.notepad.description"),
            resetLabel: t("search.entries.general.environment-notepad.title"),
            ariaLabel: t("route.general.environment.showAriaLabel", {
              section: t("search.entries.general.environment-notepad.title"),
            }),
          })}
        </SettingsSection>
      </div>
    </div>
  );

  const renderAppearancePanel = () => (
    <div className="space-y-6">
      <SettingsSection title={t("appearance.languageRegion.title")}>
        <SettingsRow
          settingId="app-language"
          title={t("appearance.language.title")}
          description={t("appearance.language.description")}
          resetAction={
            settings.language !== defaults.language ? (
              <SettingResetButton
                label={t("appearance.language.resetLabel")}
                onClick={() => {
                  updateSettings({ language: defaults.language });
                  void changeRendererLocale(defaults.language);
                }}
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.language}
              onValueChange={(value) => {
                if (!APP_LOCALE_PREFERENCES.includes(value as AppLocalePreference)) return;
                const language = value as AppLocalePreference;
                updateSettings({ language });
                void changeRendererLocale(language);
              }}
              ariaLabel={t("appearance.language.ariaLabel")}
              triggerClassName="w-full sm:w-52"
              valueContent={
                settings.language === "system"
                  ? t("appearance.language.options.system")
                  : APP_LANGUAGE_NATIVE_LABELS[settings.language]
              }
            >
              <SelectItem hideIndicator value="system">
                {t("appearance.language.options.system")}
              </SelectItem>
              {selectableLanguageOptions({
                production: import.meta.env.PROD,
                preference: settings.language,
              })
                .filter((option) => option.value !== "system")
                .map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.nativeLabel}
                  </SelectItem>
                ))}
            </SettingsSelectControl>
          }
        />

        <SettingsRow
          settingId="time-format"
          title={t("appearance.timeFormat.title")}
          description={t("appearance.timeFormat.description")}
          resetAction={
            settings.timestampFormat !== defaults.timestampFormat ? (
              <SettingResetButton
                label={t("appearance.timeFormat.resetLabel")}
                onClick={() =>
                  updateSettings({
                    timestampFormat: defaults.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value !== "locale" && value !== "12-hour" && value !== "24-hour") return;
                updateSettings({ timestampFormat: value });
              }}
              ariaLabel={t("appearance.timeFormat.ariaLabel")}
              triggerClassName="w-full sm:w-40"
              valueContent={timestampFormatLabels[settings.timestampFormat]}
            >
              <SelectItem hideIndicator value="locale">
                {timestampFormatLabels.locale}
              </SelectItem>
              <SelectItem hideIndicator value="12-hour">
                {timestampFormatLabels["12-hour"]}
              </SelectItem>
              <SelectItem hideIndicator value="24-hour">
                {timestampFormatLabels["24-hour"]}
              </SelectItem>
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <section className={SETTINGS_PANEL_SECTION_CLASS_NAME}>
        <h2 className={SETTINGS_SECTION_LABEL_CLASS_NAME}>
          {t("appearance.themeTypography.title")}
        </h2>
        <SettingsCard>
          <SettingsRow
            settingId="theme"
            title={t("appearance.theme.title")}
            description={t("appearance.theme.description")}
            resetAction={
              theme !== "system" ? (
                <SettingResetButton
                  label={t("appearance.theme.resetLabel")}
                  onClick={() => setTheme("system")}
                />
              ) : null
            }
            control={
              <SettingsSegmentedControl
                value={theme}
                onValueChange={(value) => {
                  if (value !== "system" && value !== "light" && value !== "dark") return;
                  setTheme(value);
                }}
                ariaLabel={t("appearance.theme.ariaLabel")}
                options={themeOptions}
              />
            }
          />
        </SettingsCard>

        <div className="space-y-3">
          {(resolvedTheme === "dark"
            ? (["dark", "light"] as const)
            : (["light", "dark"] as const)
          ).map((variant) => (
            <ThemePackEditor
              key={variant}
              variant={variant}
              isActive={resolvedTheme === variant}
              mode={theme}
            />
          ))}
        </div>

        <SettingsCard>
          <SettingsRow
            settingId="ui-density"
            title={t("appearance.density.title")}
            description={t("appearance.density.description")}
            resetAction={
              settings.uiDensity !== defaults.uiDensity ? (
                <SettingResetButton
                  label={t("appearance.density.resetLabel")}
                  onClick={() =>
                    updateSettings({
                      uiDensity: DEFAULT_UI_DENSITY,
                    })
                  }
                />
              ) : null
            }
            control={
              <SettingsSegmentedControl
                value={settings.uiDensity}
                onValueChange={(value) => {
                  if (!isUiDensity(value)) {
                    return;
                  }
                  updateSettings({ uiDensity: value });
                }}
                ariaLabel={t("appearance.density.ariaLabel")}
                options={densityOptions}
              />
            }
          />

          <SettingsRow
            settingId="base-font-size"
            title={t("appearance.baseFontSize.title")}
            description={t("appearance.baseFontSize.description")}
            resetAction={
              settings.chatFontSizePx !== defaults.chatFontSizePx ? (
                <SettingResetButton
                  label={t("appearance.baseFontSize.resetLabel")}
                  onClick={() =>
                    updateSettings({
                      chatFontSizePx: defaults.chatFontSizePx,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                <Input
                  type="number"
                  size="sm"
                  min={MIN_CHAT_FONT_SIZE_PX}
                  max={MAX_CHAT_FONT_SIZE_PX}
                  step={1}
                  inputMode="numeric"
                  variant="soft"
                  className="w-full text-right sm:w-20"
                  value={String(settings.chatFontSizePx)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (nextValue.length === 0) return;
                    updateSettings({
                      chatFontSizePx: normalizeChatFontSizePx(Number(nextValue)),
                    });
                  }}
                  aria-label={t("appearance.baseFontSize.ariaLabel")}
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            }
          />

          <SettingsRow
            settingId="terminal-font-size"
            title={t("appearance.terminalFontSize.title")}
            description={t("appearance.terminalFontSize.description")}
            resetAction={
              settings.terminalFontSizePx !== defaults.terminalFontSizePx ? (
                <SettingResetButton
                  label={t("appearance.terminalFontSize.resetLabel")}
                  onClick={() =>
                    updateSettings({
                      terminalFontSizePx: defaults.terminalFontSizePx,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                <Input
                  type="number"
                  size="sm"
                  min={MIN_TERMINAL_FONT_SIZE_PX}
                  max={MAX_TERMINAL_FONT_SIZE_PX}
                  step={1}
                  inputMode="numeric"
                  variant="soft"
                  className="w-full text-right sm:w-20"
                  value={String(settings.terminalFontSizePx)}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    if (nextValue.length === 0) return;
                    updateSettings({
                      terminalFontSizePx: normalizeTerminalFontSizePx(Number(nextValue)),
                    });
                  }}
                  aria-label={t("appearance.terminalFontSize.ariaLabel")}
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            }
          />

          <SettingsRow
            settingId="terminal-font"
            title={t("appearance.terminalFont.title")}
            description={t("appearance.terminalFont.description")}
            resetAction={
              settings.terminalFontFamily !== defaults.terminalFontFamily ? (
                <SettingResetButton
                  label={t("appearance.terminalFont.resetLabel")}
                  onClick={() =>
                    updateSettings({
                      terminalFontFamily: defaults.terminalFontFamily,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center justify-end sm:w-auto">
                <Autocomplete
                  items={visibleTerminalFontFamilySuggestions}
                  mode="none"
                  openOnInputClick
                  value={settings.terminalFontFamily}
                  onValueChange={(value) => {
                    updateSettings({
                      terminalFontFamily: normalizeTerminalFontFamily(value),
                    });
                  }}
                >
                  <AutocompleteInput
                    size="sm"
                    variant="soft"
                    showTrigger
                    showClear={settings.terminalFontFamily.length > 0}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t("appearance.terminalFont.placeholder")}
                    className="w-full sm:w-56"
                    aria-label={t("appearance.terminalFont.ariaLabel")}
                  />
                  <AutocompletePopup className="w-56 min-w-56 font-system-ui">
                    <AutocompleteList>
                      {visibleTerminalFontFamilySuggestions.map((suggestion, index) => (
                        <AutocompleteItem
                          key={suggestion}
                          index={index}
                          value={suggestion}
                          className="font-normal text-[var(--color-text-foreground)]"
                          onClick={() => {
                            updateSettings({
                              terminalFontFamily: normalizeTerminalFontFamily(suggestion),
                            });
                          }}
                        >
                          {suggestion}
                        </AutocompleteItem>
                      ))}
                      <AutocompleteEmpty>{t("appearance.terminalFont.empty")}</AutocompleteEmpty>
                    </AutocompleteList>
                  </AutocompletePopup>
                </Autocomplete>
              </div>
            }
          />

          {shouldShowFontSmoothing
            ? renderBooleanSettingRow({
                settingKey: "enableNativeFontSmoothing",
                title: t("appearance.fontSmoothing.title"),
                description: t("appearance.fontSmoothing.description"),
                resetLabel: t("appearance.fontSmoothing.resetLabel"),
                ariaLabel: t("appearance.fontSmoothing.ariaLabel"),
              })
            : null}
        </SettingsCard>
      </section>
    </div>
  );

  const renderNotificationsPanel = () => (
    <div className="space-y-6">
      <SettingsSection title={t("notifications.activity.sectionTitle")}>
        {renderBooleanSettingRow({
          settingId: "activity-toasts",
          settingKey: "enableTaskCompletionToasts",
          title: t("notifications.activity.title"),
          description: t("notifications.activity.description"),
          resetLabel: t("notifications.activity.resetLabel"),
          ariaLabel: t("notifications.activity.ariaLabel"),
        })}

        <SettingsRow
          settingId="desktop-notifications"
          title={t("notifications.desktop.title")}
          description={t("notifications.desktop.description")}
          status={buildNotificationSettingsSupportText(browserNotificationPermission, t)}
          resetAction={
            settings.enableSystemTaskCompletionNotifications !==
            defaults.enableSystemTaskCompletionNotifications ? (
              <SettingResetButton
                label={t("notifications.desktop.resetLabel")}
                onClick={() =>
                  updateSettings({
                    enableSystemTaskCompletionNotifications:
                      defaults.enableSystemTaskCompletionNotifications,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
              <Button size="xs" variant="outline" onClick={() => void sendTestNotification()}>
                {t("notifications.desktop.test")}
              </Button>
              <Switch
                checked={settings.enableSystemTaskCompletionNotifications}
                onCheckedChange={(checked) => {
                  void setSystemNotificationsEnabled(Boolean(checked));
                }}
                aria-label={t("notifications.desktop.ariaLabel")}
              />
            </div>
          }
        />
      </SettingsSection>
    </div>
  );

  const renderBehaviorPanel = () => (
    <div className="space-y-6">
      <SettingsSection title={t("route.behavior.sections.runtime")}>
        {renderBooleanSettingRow({
          settingId: "assistant-output",
          settingKey: "enableAssistantStreaming",
          title: t("search.entries.behavior.assistant-output.title"),
          description: t("route.behavior.assistantOutput.description"),
          resetLabel: t("search.entries.behavior.assistant-output.title"),
          ariaLabel: t("route.behavior.toggleAriaLabel", {
            setting: t("search.entries.behavior.assistant-output.title"),
          }),
        })}

        {renderBooleanSettingRow({
          settingId: "diff-line-wrapping",
          settingKey: "diffWordWrap",
          title: t("search.entries.behavior.diff-line-wrapping.title"),
          description: t("route.behavior.diffWrapping.description"),
          resetLabel: t("search.entries.behavior.diff-line-wrapping.title"),
          ariaLabel: t("route.behavior.toggleAriaLabel", {
            setting: t("search.entries.behavior.diff-line-wrapping.title"),
          }),
        })}
      </SettingsSection>

      <SettingsSection title={t("route.behavior.sections.confirmations")}>
        {renderBooleanSettingRow({
          settingId: "delete-confirmation",
          settingKey: "confirmThreadDelete",
          title: t("search.entries.behavior.delete-confirmation.title"),
          description: t("route.behavior.deleteConfirmation.description"),
          resetLabel: t("search.entries.behavior.delete-confirmation.title"),
          ariaLabel: t("route.behavior.toggleAriaLabel", {
            setting: t("search.entries.behavior.delete-confirmation.title"),
          }),
        })}

        {renderBooleanSettingRow({
          settingId: "archive-confirmation",
          settingKey: "confirmThreadArchive",
          title: t("search.entries.behavior.archive-confirmation.title"),
          description: t("route.behavior.archiveConfirmation.description"),
          resetLabel: t("search.entries.behavior.archive-confirmation.title"),
          ariaLabel: t("route.behavior.toggleAriaLabel", {
            setting: t("search.entries.behavior.archive-confirmation.title"),
          }),
        })}

        {renderBooleanSettingRow({
          settingId: "terminal-close-confirmation",
          settingKey: "confirmTerminalTabClose",
          title: t("search.entries.behavior.terminal-close-confirmation.title"),
          description: t("route.behavior.terminalCloseConfirmation.description"),
          resetLabel: t("search.entries.behavior.terminal-close-confirmation.title"),
          ariaLabel: t("route.behavior.toggleAriaLabel", {
            setting: t("search.entries.behavior.terminal-close-confirmation.title"),
          }),
        })}
      </SettingsSection>
    </div>
  );

  const renderWorktreesPanel = () => {
    if (serverWorktreesQuery.isLoading) {
      return (
        <div
          className={cn(SETTINGS_EMPTY_STATE_CLASS_NAME, "px-4 py-6 text-sm text-muted-foreground")}
        >
          {t("route.worktrees.loading")}
        </div>
      );
    }
    if (serverWorktreesQuery.isError) {
      return (
        <div
          className={cn(
            SETTINGS_EMPTY_STATE_CLASS_NAME,
            "border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive",
          )}
        >
          <p>{t("route.errors.loadWorktrees.summary")}</p>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">
            {formatSettingsRouteDiagnostic(
              serverWorktreesQuery.error,
              t("route.errors.keybindings.unknownDetail"),
            )}
          </pre>
        </div>
      );
    }
    if (worktreesByWorkspaceRoot.length === 0) {
      return (
        <div
          className={cn(SETTINGS_EMPTY_STATE_CLASS_NAME, "px-4 py-6 text-sm text-muted-foreground")}
        >
          {t("route.worktrees.empty")}
        </div>
      );
    }

    // Each workspace root is a standard settings card; worktree rows reuse the
    // same row chrome/typography as every other settings list (separators come
    // from the card's `divide-y`), with their richer body kept top-aligned.
    return (
      <div className="space-y-6">
        {worktreesByWorkspaceRoot.map((group) => (
          <SettingsSection key={group.workspaceRoot} title={group.workspaceRoot}>
            {group.worktrees.map((worktree) => {
              const deleteDisabled = removeWorktreeMutation.isPending;
              return (
                <div
                  key={worktree.path}
                  className={SETTINGS_CARD_ROW_CLASS_NAME}
                  data-slot="settings-row"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="space-y-0.5">
                        <div className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>
                          {t("route.worktrees.worktree")}
                        </div>
                        <div
                          className={cn(
                            SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
                            "truncate font-mono",
                          )}
                        >
                          {worktree.path}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-muted-foreground">
                          {t("route.worktrees.conversations")}
                        </div>
                        {worktree.linkedThreads.length > 0 ? (
                          <div className="space-y-1">
                            {worktree.linkedThreads.map((thread) => (
                              <div
                                key={thread.id}
                                className={cn(
                                  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
                                  "text-foreground",
                                )}
                              >
                                {thread.title}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
                            {t("route.worktrees.noLinkedConversations")}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex w-full shrink-0 flex-col items-end gap-2 sm:w-auto">
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={deleteDisabled}
                        onClick={() =>
                          void deleteManagedWorktree({
                            workspaceRoot: group.workspaceRoot,
                            worktreePath: worktree.path,
                          })
                        }
                      >
                        {t("route.worktrees.delete")}
                      </Button>
                      {worktree.linkedThreads.length > 0 ? (
                        <p
                          className={cn(
                            SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
                            "max-w-40 text-right",
                          )}
                        >
                          {t("route.worktrees.deleteConfirmationHint")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </SettingsSection>
        ))}
      </div>
    );
  };

  const renderArchivedPanel = () => {
    const archivedGroups = [
      ...projects.map((project) => ({
        project,
        threads: archivedThreads
          .filter((thread) => thread.projectId === project.id)
          .toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.updatedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.updatedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
      })),
      ...(() => {
        const knownProjectIds = new Set(projects.map((project) => project.id));
        const orphanedThreads = archivedThreads
          .filter((thread) => !knownProjectIds.has(thread.projectId))
          .toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.updatedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.updatedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          });
        return orphanedThreads.length > 0
          ? [
              {
                project: null,
                threads: orphanedThreads,
              },
            ]
          : [];
      })(),
    ].filter((group) => group.threads.length > 0);

    if (archivedGroups.length === 0) {
      return (
        <div className={cn(SETTINGS_EMPTY_STATE_CLASS_NAME, "px-5 py-10 text-center")}>
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground">
            <ArchiveIcon className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">
            {t("route.archived.emptyTitle")}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t("route.archived.emptyDescription")}
          </div>
        </div>
      );
    }

    // Each project group is a standard settings card (label + bordered list); the
    // thread rows reuse the same row/typography tokens as every other settings row,
    // and the card's own `divide-y` draws the separators.
    return (
      <div className="space-y-6">
        {archivedGroups.map(({ project, threads: projectThreads }) => (
          <SettingsSection
            key={project?.id ?? "unknown-project"}
            title={project?.name ?? t("route.archived.unknownProject")}
          >
            {projectThreads.map((thread) => (
              <SettingsListRow
                key={thread.id}
                title={thread.title}
                description={t("route.archived.archivedAt", {
                  time: formatArchivedRelativeTime(
                    thread.archivedAt ?? thread.createdAt,
                    resolvedLocale,
                  ),
                })}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void handleArchivedThreadContextMenu(thread.id, thread.title, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                actions={
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void unarchiveThread(thread.id)}
                    >
                      {t("route.archived.actions.restore")}
                    </Button>
                    <Button
                      size="xs"
                      variant="destructive"
                      onClick={() => void deleteArchivedThread(thread.id, thread.title)}
                    >
                      {t("route.archived.actions.delete")}
                    </Button>
                  </>
                }
              />
            ))}
          </SettingsSection>
        ))}
      </div>
    );
  };

  const renderModelsPanel = () => (
    <div className="space-y-6">
      <SettingsSection title={t("route.models.sections.generationDefaults")}>
        <SettingsRow
          settingId="git-writing-model"
          title={t("search.entries.models.git-writing-model.title")}
          description={t("route.models.gitWriting.description")}
          resetAction={
            isGitTextGenerationModelDirty ? (
              <SettingResetButton
                label={t("route.models.gitWriting.resetLabel")}
                onClick={() =>
                  updateSettings({
                    textGenerationProvider: defaults.textGenerationProvider,
                    textGenerationModel: defaults.textGenerationModel,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={currentGitTextGenerationValue}
              onValueChange={(value) => {
                if (!value) return;
                const separatorIndex = value.indexOf(":");
                const provider = value.slice(0, separatorIndex) as ProviderKind;
                const model = value.slice(separatorIndex + 1);
                if (!provider || !model) return;
                updateSettings({
                  textGenerationProvider: provider,
                  textGenerationModel: model,
                });
              }}
              ariaLabel={t("route.models.gitWriting.ariaLabel")}
              triggerClassName="w-full sm:w-52"
              valueContent={selectedGitTextGenerationModelLabel}
            >
              {gitTextGenerationModelOptions.map((option) => (
                <SelectItem
                  hideIndicator
                  key={`${option.provider}:${option.slug}`}
                  value={`${option.provider}:${option.slug}`}
                >
                  {PROVIDER_DISPLAY_NAMES[option.provider]} / {option.name}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("route.models.customModels.title")}>
        <SettingsRow
          title={t("route.models.customModels.savedTitle")}
          description={t("route.models.customModels.description")}
          resetAction={
            totalCustomModels > 0 ? (
              <SettingResetButton
                label={t("route.models.customModels.resetLabel")}
                onClick={() => {
                  updateSettings({
                    customCodexModels: defaults.customCodexModels,
                    customClaudeModels: defaults.customClaudeModels,
                    customCursorModels: defaults.customCursorModels,
                    customGeminiModels: defaults.customGeminiModels,
                    customGrokModels: defaults.customGrokModels,
                    customDroidModels: defaults.customDroidModels,
                    customKiloModels: defaults.customKiloModels,
                    customOpenCodeModels: defaults.customOpenCodeModels,
                    customPiModels: defaults.customPiModels,
                  });
                  setCustomModelErrorByProvider({});
                  setShowAllCustomModels(false);
                }}
              />
            ) : null
          }
        >
          <div className={cn("mt-4 pt-4", SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME)}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={selectedCustomModelProvider}
                onValueChange={(value) => {
                  if (
                    value !== "codex" &&
                    value !== "claudeAgent" &&
                    value !== "cursor" &&
                    value !== "gemini" &&
                    value !== "grok" &&
                    value !== "droid" &&
                    value !== "kilo" &&
                    value !== "opencode" &&
                    value !== "pi"
                  ) {
                    return;
                  }
                  setSelectedCustomModelProvider(value);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={t("route.models.customModels.providerAriaLabel")}
                >
                  <SelectValue>{selectedCustomModelProviderSettings.title}</SelectValue>
                </SelectTrigger>
                <SettingsSelectPopup align="start">
                  {MODEL_PROVIDER_SETTINGS.map((providerSettings) => (
                    <SelectItem
                      hideIndicator
                      key={providerSettings.provider}
                      value={providerSettings.provider}
                    >
                      {providerSettings.title}
                    </SelectItem>
                  ))}
                </SettingsSelectPopup>
              </Select>
              <Input
                id="custom-model-slug"
                size="sm"
                variant="soft"
                value={selectedCustomModelInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomModelInputByProvider((existing) => ({
                    ...existing,
                    [selectedCustomModelProvider]: value,
                  }));
                  if (selectedCustomModelError) {
                    setCustomModelErrorByProvider((existing) => ({
                      ...existing,
                      [selectedCustomModelProvider]: null,
                    }));
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addCustomModel(selectedCustomModelProvider);
                }}
                placeholder={selectedCustomModelProviderSettings.example}
                spellCheck={false}
              />
              <Button
                className="shrink-0"
                variant="outline"
                onClick={() => addCustomModel(selectedCustomModelProvider)}
              >
                <PlusIcon className="size-3.5" />
                {t("route.models.customModels.add")}
              </Button>
            </div>

            {selectedCustomModelError ? (
              <p className="mt-2 text-xs text-destructive">
                {localizeCustomModelValidationError(selectedCustomModelError, t)}
              </p>
            ) : null}

            {totalCustomModels > 0 ? (
              <div className={cn("mt-3", SETTINGS_INSET_LIST_CLASS_NAME)}>
                {visibleCustomModelRows.map((row) => (
                  <div
                    key={row.key}
                    className="group grid grid-cols-[minmax(5rem,6rem)_minmax(0,1fr)_auto] items-center gap-3 border-t border-[color:var(--color-border)] px-4 py-2 first:border-t-0"
                  >
                    <span className="truncate text-xs text-muted-foreground">
                      {row.providerTitle}
                    </span>
                    <code className="min-w-0 truncate text-sm text-foreground">{row.slug}</code>
                    <button
                      type="button"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
                      aria-label={t("route.models.customModels.removeAriaLabel", {
                        model: row.slug,
                      })}
                      onClick={() => removeCustomModel(row.provider, row.slug)}
                    >
                      <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                ))}

                {savedCustomModelRows.length > 5 ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowAllCustomModels((value) => !value)}
                  >
                    {showAllCustomModels
                      ? t("route.models.customModels.showLess")
                      : t("route.models.customModels.showMore", {
                          count: savedCustomModelRows.length - 5,
                        })}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );

  const renderProvidersPanel = () => (
    <div className="space-y-6">
      {renderProviderUpdatesSection()}
      <SettingsSection title={t("route.providers.picker.sectionTitle")}>
        <SettingsRow
          title={t("route.providers.picker.title")}
          description={t("route.providers.picker.description")}
          status={
            hiddenProviderCount > 0
              ? t("route.providers.picker.hiddenCount", { count: hiddenProviderCount })
              : isProviderOrderDirty
                ? t("route.providers.picker.customOrder")
                : t("route.providers.picker.allVisible")
          }
          resetAction={
            hiddenProviderCount > 0 || isProviderOrderDirty ? (
              <SettingResetButton
                label={t("route.providers.picker.resetLabel")}
                onClick={() =>
                  updateSettings({
                    hiddenProviders: defaults.hiddenProviders,
                    providerOrder: defaults.providerOrder,
                  })
                }
              />
            ) : null
          }
        >
          <DndContext
            sensors={providerVisibilitySensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleProviderOrderDragEnd}
          >
            <SortableContext
              items={orderedProviderVisibilityOptions.map((option) => option.provider)}
              strategy={verticalListSortingStrategy}
            >
              <div className="mt-4 space-y-2">
                {orderedProviderVisibilityOptions.map((option) => (
                  <SortableProviderVisibilityRow
                    key={option.provider}
                    option={option}
                    isHidden={hiddenProviderSet.has(option.provider)}
                    onHiddenChange={(hidden) =>
                      updateSettings({
                        hiddenProviders: setProviderHidden(
                          settings.hiddenProviders,
                          option.provider,
                          hidden,
                        ),
                      })
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </SettingsRow>
      </SettingsSection>
      {renderProviderInstallsSection()}
    </div>
  );

  const renderProviderUpdatesSection = () => (
    <div ref={providerUpdatesRef} id={SETTINGS_TARGETS.providerUpdates}>
      <SettingsSection title={t("route.providers.updates.sectionTitle")}>
        {renderBooleanSettingRow({
          settingKey: "enableProviderUpdateChecks",
          title: t("route.providers.updates.automaticTitle"),
          description: t("route.providers.updates.automaticDescription"),
          resetLabel: t("route.providers.updates.automaticResetLabel"),
          ariaLabel: t("route.providers.updates.automaticAriaLabel"),
        })}

        <SettingsRow
          title={t("route.providers.updates.title")}
          description={t("route.providers.updates.description")}
          status={
            !settings.enableProviderUpdateChecks
              ? t("route.providers.updates.checksOff")
              : outdatedProviderCount > 0
                ? t("route.providers.updates.availableCount", { count: outdatedProviderCount })
                : t("route.providers.updates.none")
          }
        >
          {settings.enableProviderUpdateChecks && outdatedProviderStatuses.length > 0 ? (
            <div
              className={cn(
                "mt-4",
                SETTINGS_INSET_LIST_CLASS_NAME,
                "divide-y divide-[color:var(--color-border)]",
              )}
            >
              {outdatedProviderStatuses.map((providerStatus) => {
                const updateAdvisory = providerStatus.versionAdvisory;
                const updateState = providerStatus.updateState?.status;
                const isProviderUpdateActive =
                  updateState === "queued" ||
                  updateState === "running" ||
                  updatingProviders.has(providerStatus.provider);
                const canUpdateProvider =
                  updateAdvisory?.canUpdate === true && !isProviderUpdateActive;
                const updateLabel = providerUpdateStatusLabel(providerStatus, t);

                return (
                  <SettingsListRow
                    key={providerStatus.provider}
                    title={PROVIDER_DISPLAY_NAMES[providerStatus.provider]}
                    description={updateLabel || undefined}
                    actions={
                      updateAdvisory?.canUpdate ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={!canUpdateProvider}
                          title={
                            updateAdvisory.updateCommand
                              ? t("route.providers.updates.runCommand", {
                                  command: updateAdvisory.updateCommand,
                                })
                              : undefined
                          }
                          onClick={() => void runProviderUpdate(providerStatus.provider)}
                        >
                          {isProviderUpdateActive ? (
                            <Loader2Icon className="size-3.5 animate-spin" />
                          ) : (
                            <DownloadIcon className="size-3.5" />
                          )}
                          {isProviderUpdateActive
                            ? t("route.providers.updates.updating")
                            : t("route.providers.updates.update")}
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {t("route.providers.updates.manual")}
                        </span>
                      )
                    }
                  />
                );
              })}
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>
    </div>
  );

  const renderProviderInstallsSection = () => (
    <div ref={providerInstallsRef} id={SETTINGS_TARGETS.providerInstalls}>
      <SettingsSection title={t("route.providers.tools.sectionTitle")}>
        <SettingsRow
          title={t("route.providers.tools.title")}
          description={t("route.providers.tools.description")}
          status={
            !settings.enableProviderUpdateChecks
              ? t("route.providers.updates.checksOff")
              : outdatedProviderCount > 0
                ? t("route.providers.updates.availableCount", { count: outdatedProviderCount })
                : t("route.providers.updates.none")
          }
          resetAction={
            isInstallSettingsDirty ? (
              <SettingResetButton
                label={t("route.providers.tools.resetLabel")}
                onClick={() => {
                  updateSettings({
                    claudeBinaryPath: defaults.claudeBinaryPath,
                    codexBinaryPath: defaults.codexBinaryPath,
                    codexHomePath: defaults.codexHomePath,
                    cursorBinaryPath: defaults.cursorBinaryPath,
                    cursorApiEndpoint: defaults.cursorApiEndpoint,
                    geminiBinaryPath: defaults.geminiBinaryPath,
                    grokBinaryPath: defaults.grokBinaryPath,
                    droidBinaryPath: defaults.droidBinaryPath,
                    kiloBinaryPath: defaults.kiloBinaryPath,
                    kiloServerUrl: defaults.kiloServerUrl,
                    kiloServerPassword: defaults.kiloServerPassword,
                    openCodeBinaryPath: defaults.openCodeBinaryPath,
                    openCodeExperimentalWebSockets: defaults.openCodeExperimentalWebSockets,
                    openCodeServerUrl: defaults.openCodeServerUrl,
                    openCodeServerPassword: defaults.openCodeServerPassword,
                    piAgentDir: defaults.piAgentDir,
                    piBinaryPath: defaults.piBinaryPath,
                  });
                  setOpenInstallProviders({
                    codex: false,
                    claudeAgent: false,
                    cursor: false,
                    gemini: false,
                    grok: false,
                    droid: false,
                    kilo: false,
                    opencode: false,
                    pi: false,
                  });
                }}
              />
            ) : null
          }
        >
          <div className="mt-4">
            <div className={SETTINGS_INSET_LIST_CLASS_NAME}>
              {INSTALL_PROVIDER_SETTINGS.map((providerSettings) => {
                const isOpen = openInstallProviders[providerSettings.provider];
                const isDirty =
                  providerSettings.provider === "codex"
                    ? settings.codexBinaryPath !== defaults.codexBinaryPath ||
                      settings.codexHomePath !== defaults.codexHomePath
                    : providerSettings.provider === "claudeAgent"
                      ? settings.claudeBinaryPath !== defaults.claudeBinaryPath
                      : providerSettings.provider === "cursor"
                        ? settings.cursorBinaryPath !== defaults.cursorBinaryPath ||
                          settings.cursorApiEndpoint !== defaults.cursorApiEndpoint
                        : providerSettings.provider === "gemini"
                          ? settings.geminiBinaryPath !== defaults.geminiBinaryPath
                          : providerSettings.provider === "grok"
                            ? settings.grokBinaryPath !== defaults.grokBinaryPath
                            : providerSettings.provider === "droid"
                              ? settings.droidBinaryPath !== defaults.droidBinaryPath
                              : providerSettings.provider === "kilo"
                                ? settings.kiloBinaryPath !== defaults.kiloBinaryPath ||
                                  settings.kiloServerUrl !== defaults.kiloServerUrl ||
                                  settings.kiloServerPassword !== defaults.kiloServerPassword
                                : providerSettings.provider === "pi"
                                  ? settings.piBinaryPath !== defaults.piBinaryPath ||
                                    settings.piAgentDir !== defaults.piAgentDir
                                  : settings.openCodeBinaryPath !== defaults.openCodeBinaryPath ||
                                    settings.openCodeExperimentalWebSockets !==
                                      defaults.openCodeExperimentalWebSockets ||
                                    settings.openCodeServerUrl !== defaults.openCodeServerUrl ||
                                    settings.openCodeServerPassword !==
                                      defaults.openCodeServerPassword;
                const binaryPathValue =
                  providerSettings.binaryPathKey === "claudeBinaryPath"
                    ? claudeBinaryPath
                    : providerSettings.binaryPathKey === "cursorBinaryPath"
                      ? cursorBinaryPath
                      : providerSettings.binaryPathKey === "geminiBinaryPath"
                        ? geminiBinaryPath
                        : providerSettings.binaryPathKey === "grokBinaryPath"
                          ? grokBinaryPath
                          : providerSettings.binaryPathKey === "droidBinaryPath"
                            ? droidBinaryPath
                            : providerSettings.binaryPathKey === "kiloBinaryPath"
                              ? kiloBinaryPath
                              : providerSettings.binaryPathKey === "openCodeBinaryPath"
                                ? openCodeBinaryPath
                                : providerSettings.binaryPathKey === "piBinaryPath"
                                  ? piBinaryPath
                                  : codexBinaryPath;
                const providerStatus = providerStatusByProvider.get(providerSettings.provider);
                const showProviderUpdateStatus = providerStatus
                  ? shouldShowProviderUpdateStatus({
                      provider: providerStatus,
                      hiddenProviderSet,
                      serverSettings: providerUpdateServerSettings,
                    })
                  : false;
                const providerUpdateSuppressed =
                  providerStatus?.versionAdvisory?.status === "behind_latest" &&
                  !showProviderUpdateStatus;
                const currentProviderVersion = formatProviderVersion(providerStatus?.version);
                const providerUpdateLabel = providerStatus
                  ? !settings.enableProviderUpdateChecks
                    ? currentProviderVersion
                      ? t("route.providers.updates.status.current", {
                          version: currentProviderVersion,
                        })
                      : null
                    : providerUpdateSuppressed
                      ? null
                      : providerUpdateStatusLabel(providerStatus, t)
                  : null;
                const updateAdvisory = providerStatus?.versionAdvisory;
                const providerUpdateState = providerStatus?.updateState?.status;
                const isProviderUpdateActive =
                  providerUpdateState === "queued" ||
                  providerUpdateState === "running" ||
                  updatingProviders.has(providerSettings.provider);
                const canUpdateProvider =
                  showProviderUpdateStatus &&
                  updateAdvisory?.status === "behind_latest" &&
                  updateAdvisory.canUpdate &&
                  !isProviderUpdateActive;
                const shouldShowProviderUpdateButton =
                  showProviderUpdateStatus &&
                  updateAdvisory?.status === "behind_latest" &&
                  updateAdvisory.canUpdate;

                return (
                  <Collapsible
                    key={providerSettings.provider}
                    open={isOpen}
                    onOpenChange={(open) =>
                      setOpenInstallProviders((existing) => ({
                        ...existing,
                        [providerSettings.provider]: open,
                      }))
                    }
                  >
                    <div className="border-t border-border/70 first:border-t-0">
                      <div className="flex min-h-11 items-center gap-2 px-3 py-2">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() =>
                            setOpenInstallProviders((existing) => ({
                              ...existing,
                              [providerSettings.provider]: !existing[providerSettings.provider],
                            }))
                          }
                        >
                          <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                            {providerSettings.title}
                          </span>
                          {isDirty ? (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {t("route.providers.tools.custom")}
                            </span>
                          ) : null}
                          {providerUpdateLabel ? (
                            <span
                              className={cn(
                                "shrink-0 text-[11px]",
                                updateAdvisory?.status === "behind_latest"
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {providerUpdateLabel}
                            </span>
                          ) : null}
                          <ChevronDownIcon
                            className={cn(
                              "size-4 shrink-0 text-muted-foreground transition-transform",
                              isOpen && "rotate-180",
                            )}
                          />
                        </button>
                        {shouldShowProviderUpdateButton ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={!canUpdateProvider}
                            title={
                              updateAdvisory.updateCommand
                                ? t("route.providers.updates.runCommand", {
                                    command: updateAdvisory.updateCommand,
                                  })
                                : undefined
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              void runProviderUpdate(providerSettings.provider);
                            }}
                          >
                            {isProviderUpdateActive ? (
                              <Loader2Icon className="size-3.5 animate-spin" />
                            ) : (
                              <DownloadIcon className="size-3.5" />
                            )}
                            {isProviderUpdateActive
                              ? t("route.providers.updates.updating")
                              : t("route.providers.updates.update")}
                          </Button>
                        ) : null}
                      </div>

                      <CollapsibleContent>
                        <div className="border-t border-border/70 bg-muted/20 px-3 py-3">
                          <div className="space-y-3">
                            <ProviderDocsLinks docs={providerSettings.docs} />
                            {showProviderUpdateStatus &&
                            updateAdvisory?.status === "behind_latest" ? (
                              <div className="text-xs text-muted-foreground">
                                {updateAdvisory.canUpdate && updateAdvisory.updateCommand ? (
                                  <>
                                    <span>{t("route.providers.tools.commandLabel")} </span>
                                    <code className="font-mono">
                                      {updateAdvisory.updateCommand}
                                    </code>
                                  </>
                                ) : (
                                  t("route.providers.tools.noSafeUpdateCommand")
                                )}
                              </div>
                            ) : null}

                            <label
                              htmlFor={`provider-install-${providerSettings.binaryPathKey}`}
                              className="block"
                            >
                              <span className="block text-xs font-medium text-foreground">
                                {t("route.providers.tools.binaryPathLabel", {
                                  provider: providerSettings.title,
                                })}
                              </span>
                              <DebouncedSettingTextInput
                                id={`provider-install-${providerSettings.binaryPathKey}`}
                                size="sm"
                                variant="soft"
                                className="mt-1"
                                value={binaryPathValue}
                                onCommit={(nextValue) =>
                                  updateSettings(
                                    providerSettings.binaryPathKey === "claudeBinaryPath"
                                      ? { claudeBinaryPath: nextValue }
                                      : providerSettings.binaryPathKey === "cursorBinaryPath"
                                        ? { cursorBinaryPath: nextValue }
                                        : providerSettings.binaryPathKey === "geminiBinaryPath"
                                          ? { geminiBinaryPath: nextValue }
                                          : providerSettings.binaryPathKey === "grokBinaryPath"
                                            ? { grokBinaryPath: nextValue }
                                            : providerSettings.binaryPathKey === "droidBinaryPath"
                                              ? { droidBinaryPath: nextValue }
                                              : providerSettings.binaryPathKey === "kiloBinaryPath"
                                                ? { kiloBinaryPath: nextValue }
                                                : providerSettings.binaryPathKey ===
                                                    "openCodeBinaryPath"
                                                  ? { openCodeBinaryPath: nextValue }
                                                  : providerSettings.binaryPathKey ===
                                                      "piBinaryPath"
                                                    ? { piBinaryPath: nextValue }
                                                    : { codexBinaryPath: nextValue },
                                  )
                                }
                                placeholder={t("route.providers.tools.binaryPathPlaceholder", {
                                  provider: providerSettings.title,
                                })}
                                spellCheck={false}
                              />
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {t(
                                  providerSettings.provider === "cursor"
                                    ? "route.providers.tools.cursorBinaryDescription"
                                    : "route.providers.tools.binaryDescription",
                                  { command: providerSettings.binaryCommand },
                                )}
                              </span>
                            </label>

                            {providerSettings.homePathKey ? (
                              <label
                                htmlFor={`provider-install-${providerSettings.homePathKey}`}
                                className="block"
                              >
                                <span className="block text-xs font-medium text-foreground">
                                  {t("route.providers.tools.pathLabel", { name: "CODEX_HOME" })}
                                </span>
                                <DebouncedSettingTextInput
                                  id={`provider-install-${providerSettings.homePathKey}`}
                                  size="sm"
                                  variant="soft"
                                  className="mt-1"
                                  value={codexHomePath}
                                  onCommit={(nextValue) =>
                                    updateSettings({
                                      codexHomePath: nextValue,
                                    })
                                  }
                                  placeholder={providerSettings.homePlaceholder}
                                  spellCheck={false}
                                />
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {t("route.providers.tools.codexHomeDescription")}
                                </span>
                              </label>
                            ) : null}

                            {providerSettings.agentDirKey ? (
                              <label
                                htmlFor={`provider-install-${providerSettings.agentDirKey}`}
                                className="block"
                              >
                                <span className="block text-xs font-medium text-foreground">
                                  {t("route.providers.tools.piAgentDirectoryLabel")}
                                </span>
                                <DebouncedSettingTextInput
                                  id={`provider-install-${providerSettings.agentDirKey}`}
                                  size="sm"
                                  variant="soft"
                                  className="mt-1"
                                  value={piAgentDir}
                                  onCommit={(nextValue) =>
                                    updateSettings({
                                      piAgentDir: nextValue,
                                    })
                                  }
                                  placeholder={t(
                                    "route.providers.tools.piAgentDirectoryPlaceholder",
                                  )}
                                  spellCheck={false}
                                />
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {t("route.providers.tools.piAgentDirectoryDescription")}
                                </span>
                              </label>
                            ) : null}

                            {providerSettings.apiEndpointKey ? (
                              <label
                                htmlFor={`provider-install-${providerSettings.apiEndpointKey}`}
                                className="block"
                              >
                                <span className="block text-xs font-medium text-foreground">
                                  {t("route.providers.tools.cursorApiEndpointLabel")}
                                </span>
                                <DebouncedSettingTextInput
                                  id={`provider-install-${providerSettings.apiEndpointKey}`}
                                  size="sm"
                                  variant="soft"
                                  className="mt-1"
                                  value={cursorApiEndpoint}
                                  onCommit={(nextValue) =>
                                    updateSettings({
                                      cursorApiEndpoint: nextValue,
                                    })
                                  }
                                  placeholder={providerSettings.apiEndpointPlaceholder}
                                  spellCheck={false}
                                />
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {t("route.providers.tools.cursorApiEndpointDescription")}
                                </span>
                              </label>
                            ) : null}

                            {providerSettings.serverUrlKey ? (
                              <label
                                htmlFor={`provider-install-${providerSettings.serverUrlKey}`}
                                className="block"
                              >
                                <span className="block text-xs font-medium text-foreground">
                                  {t("route.providers.tools.serverUrlLabel", {
                                    provider: providerSettings.title,
                                  })}
                                </span>
                                <DebouncedSettingTextInput
                                  id={`provider-install-${providerSettings.serverUrlKey}`}
                                  size="sm"
                                  variant="soft"
                                  className="mt-1"
                                  value={
                                    providerSettings.serverUrlKey === "kiloServerUrl"
                                      ? kiloServerUrl
                                      : openCodeServerUrl
                                  }
                                  onCommit={(nextValue) =>
                                    updateSettings(
                                      providerSettings.serverUrlKey === "kiloServerUrl"
                                        ? { kiloServerUrl: nextValue }
                                        : { openCodeServerUrl: nextValue },
                                    )
                                  }
                                  placeholder={providerSettings.serverUrlPlaceholder}
                                  spellCheck={false}
                                />
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {t("route.providers.tools.serverUrlDescription", {
                                    provider: providerSettings.title,
                                  })}
                                </span>
                              </label>
                            ) : null}

                            {providerSettings.serverPasswordKey ? (
                              <label
                                htmlFor={`provider-install-${providerSettings.serverPasswordKey}`}
                                className="block"
                              >
                                <span className="block text-xs font-medium text-foreground">
                                  {t("route.providers.tools.serverPasswordLabel", {
                                    provider: providerSettings.title,
                                  })}
                                </span>
                                <DebouncedSettingTextInput
                                  id={`provider-install-${providerSettings.serverPasswordKey}`}
                                  size="sm"
                                  variant="soft"
                                  className="mt-1"
                                  value={
                                    providerSettings.serverPasswordKey === "kiloServerPassword"
                                      ? kiloServerPassword
                                      : openCodeServerPassword
                                  }
                                  onCommit={(nextValue) =>
                                    updateSettings(
                                      providerSettings.serverPasswordKey === "kiloServerPassword"
                                        ? { kiloServerPassword: nextValue }
                                        : { openCodeServerPassword: nextValue },
                                    )
                                  }
                                  placeholder={t(
                                    "route.providers.tools.serverPasswordPlaceholder",
                                    {
                                      provider: providerSettings.title,
                                    },
                                  )}
                                  spellCheck={false}
                                />
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {t("route.providers.tools.serverPasswordDescription", {
                                    provider: providerSettings.title,
                                  })}
                                </span>
                              </label>
                            ) : null}

                            {providerSettings.experimentalWebSocketsKey ? (
                              <label
                                htmlFor={`provider-install-${providerSettings.experimentalWebSocketsKey}`}
                                className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-background/60 px-3 py-2"
                              >
                                <span className="min-w-0">
                                  <span className="block text-xs font-medium text-foreground">
                                    {t("route.providers.tools.webSocketsLabel")}
                                  </span>
                                  <span className="mt-1 block text-xs text-muted-foreground">
                                    {t("route.providers.tools.webSocketsDescription")}
                                  </span>
                                </span>
                                <Switch
                                  id={`provider-install-${providerSettings.experimentalWebSocketsKey}`}
                                  checked={openCodeExperimentalWebSockets}
                                  onCheckedChange={(checked) =>
                                    updateSettings({
                                      openCodeExperimentalWebSockets: Boolean(checked),
                                    })
                                  }
                                />
                              </label>
                            ) : null}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );

  const renderAdvancedPanel = () => (
    <div className="space-y-6">
      <SettingsSection title={t("route.advanced.sections.developerTools")}>
        <SettingsRow
          settingId="keybindings"
          title={t("search.entries.advanced.keybindings.title")}
          description={t("route.advanced.keybindings.description")}
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {keybindingsConfigPath ?? t("route.advanced.keybindings.resolvingPath")}
              </span>
              {openKeybindingsError ? (
                <span className="mt-1 block text-destructive">
                  <span className="block">{t("route.errors.keybindings.summary")}</span>
                  <span className="mt-1 block font-mono text-[11px]">
                    {openKeybindingsError.kind === "noEditors"
                      ? t("route.errors.keybindings.noEditors")
                      : formatSettingsRouteDiagnostic(
                          openKeybindingsError.value,
                          t("route.errors.keybindings.unknownDetail"),
                        )}
                  </span>
                </span>
              ) : (
                <span className="mt-1 block">{t("route.advanced.keybindings.editorHint")}</span>
              )}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!keybindingsConfigPath || isOpeningKeybindings}
              onClick={openKeybindingsFile}
            >
              {isOpeningKeybindings
                ? t("route.advanced.keybindings.opening")
                : t("route.advanced.keybindings.openFile")}
            </Button>
          }
        />

        <SettingsRow
          settingId="recovery-tools"
          title={t("search.entries.advanced.recovery-tools.title")}
          description={t("route.advanced.recovery.description")}
          status={
            shouldOfferRecoveryTools
              ? t("route.advanced.recovery.relevantStatus")
              : t("route.advanced.recovery.hiddenStatus")
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!shouldOfferRecoveryTools || isRepairingLocalState}
              onClick={() => void repairLocalState()}
            >
              {isRepairingLocalState
                ? t("route.advanced.recovery.repairing")
                : t("route.advanced.recovery.repair")}
            </Button>
          }
        >
          {shouldOfferRecoveryTools ? (
            <div className="mt-3 border-t border-border/70 pt-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setShowRecoveryTools((current) => !current)}
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {t("route.advanced.recovery.whatThisDoes")}
                </span>
                <ChevronDownIcon
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    showRecoveryTools && "rotate-180",
                  )}
                />
              </button>
              {showRecoveryTools ? (
                <div
                  className={cn(
                    "mt-3 px-3 py-3 text-xs text-muted-foreground",
                    SETTINGS_INSET_LIST_CLASS_NAME,
                  )}
                >
                  {t("route.advanced.recovery.expandedDescription")}
                </div>
              ) : null}
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("route.advanced.sections.about")}>
        <SettingsRow
          settingId="version"
          title={t("search.entries.advanced.version.title")}
          description={t("route.advanced.version.description")}
          control={
            <code className="text-xs font-medium text-muted-foreground">
              {displayedBuildProvenance}
            </code>
          }
        />
        <SettingsRow
          settingId="release-history"
          title={t("search.entries.advanced.release-history.title")}
          description={t("route.advanced.releaseHistory.description")}
          control={
            <Button size="sm" variant="outline" onClick={() => setReleaseHistoryOpen(true)}>
              {t("route.advanced.releaseHistory.view")}
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );

  const renderActivePanel = () => {
    switch (activeSection) {
      case "general":
        return renderGeneralPanel();
      case "appearance":
        return renderAppearancePanel();
      case "notifications":
        return renderNotificationsPanel();
      case "remote":
        return <RemoteSettingsPanel />;
      case "behavior":
        return renderBehaviorPanel();
      case "shortcuts":
        return <KeyboardShortcutsSettingsPanel />;
      case "worktrees":
        return renderWorktreesPanel();
      case "archived":
        return renderArchivedPanel();
      case "models":
        return <OpenCodeModelsSettingsPanel cwd={providerModelDiscoveryCwd} />;
      case "local-models":
        return <LocalModelsSettingsPanel />;
      case "providers":
        return <OpenCodeModelsSettingsPanel cwd={providerModelDiscoveryCwd} />;
      case "profile":
        return <ProfileSettingsPanel />;
      case "skills":
        return <SkillsSettingsPanel />;
      case "usage":
        return <ProviderUsageSettingsPanel />;
      case "advanced":
        return renderAdvancedPanel();
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
        SETTINGS_PAGE_BACKGROUND_CLASS_NAME,
        CHAT_CONTENT_CARD_CLASS_NAME,
      )}
    >
      <RouteInsetSurface surfaceClassName={SETTINGS_PAGE_BACKGROUND_CLASS_NAME}>
        {/* Companion sidebar trigger so settings is reachable-and-exitable even when the
          sidebar is collapsed (web/mobile have no global Back arrow). Pinned to the
          card's top-left — at the same header height + traffic-light gutter as the
          chat/workspace headers — so the collapsed-state toggle sits by the traffic
          lights instead of floating in the centered settings body. It renders nothing
          while the sidebar is open (SidebarHeaderNavigationControls returns null), so it
          adds no navigation chrome in the common (open) state and never shifts the centered
          content (hence absolute, not a layout-occupying header row). The strip stays a
          drag-region so the Windows frameless window can be moved by its top edge; the
          caption buttons themselves are a separate fixed cluster (see root route). */}
        <div
          className={cn(
            "drag-region absolute inset-x-0 top-0 z-10 flex items-center",
            CHAT_SURFACE_HEADER_PADDING_X_CLASS,
            CHAT_SURFACE_HEADER_HEIGHT_CLASS,
            desktopTopBarTrafficLightGutterClassName,
          )}
        >
          <div className="pointer-events-auto">
            <SidebarHeaderNavigationControls />
          </div>
        </div>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            {activeSection === "profile" ? (
              // Profile is a self-contained dashboard: it owns its own header (avatar,
              // name, share) so it skips the section title bar, and gets a slightly wider
              // pane than the form sections to fit the heatmap + two-column layout.
              <div className="mx-auto w-full max-w-3xl px-6 py-8">{renderActivePanel()}</div>
            ) : (
              <div className="mx-auto w-full max-w-2xl px-6 py-8">
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-xl font-medium tracking-tight text-foreground">
                      {t(activeSectionItem.labelKey)}
                    </h1>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {t(activeSectionItem.descriptionKey)}
                    </p>
                  </div>
                  {activeSection !== "remote" ? (
                    <Button
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      disabled={changedSettingLabels.length === 0}
                      onClick={() => void restoreDefaults()}
                    >
                      <RotateCcwIcon className="size-3.5" />
                      {t("actions.restoreDefaults")}
                    </Button>
                  ) : null}
                </div>

                {renderActivePanel()}
              </div>
            )}
          </div>
        </div>
        {/* Mounted at the route level (outside the scrollable panel) so the
          dialog portal can overlay the entire settings view without being
          clipped by the content wrapper's overflow. */}
        <ReleaseHistoryDialog
          open={releaseHistoryOpen}
          onOpenChange={setReleaseHistoryOpen}
          defaultExpandedVersion={APP_VERSION}
        />
      </RouteInsetSurface>
    </div>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
