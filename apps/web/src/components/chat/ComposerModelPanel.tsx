// FILE: ComposerModelPanel.tsx
// Purpose: The composer's model panel: provider tabs with a gliding underline, model search, a
//          model list with ⌘1–⌘9 shortcuts and stars, and the effort slider for the current model.
// Layer: Chat composer presentation
// Depends on: provider availability + model helpers from ProviderModelPicker, trait helpers from
//   TraitsPicker/composerTraits, and the EffortSlider.

import {
  type ModelSlug,
  type ProviderAgentDescriptor,
  type ProviderKind,
  type ProviderModelDescriptor,
  type ProviderModelOptions,
  type ServerProviderStatus,
  type ThreadId,
} from "@djl/contracts";
import { applyClaudePromptEffortPrefix, resolveSelectableModel } from "@djl/shared/model";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { isElectron } from "~/env";
import { PlusIcon, SearchIcon, StarFilledIcon, StarIcon, ZapIcon } from "~/lib/icons";
import { readLocalModelsBrowserCache } from "~/lib/localModelsBrowserCache";
import { useModelFavorites } from "~/lib/useModelFavorites";
import { cn } from "~/lib/utils";
import { formatShortcutLabel } from "~/keybindings";
import { ensureNativeApi } from "~/nativeApi";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  buildNextProviderOptions,
  buildProviderOptionPatch,
  groupProviderModelOptions,
  isChatOnlyModel,
  type ProviderModelOption,
} from "../../providerModelOptions";
import { compareProvidersByOrder } from "../../providerOrdering";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { EffortSlider } from "../ui/effort-slider";
import { Skeleton } from "../ui/skeleton";
import { getComposerTraitSelection } from "./composerTraits";
import { resolveEffortSlider } from "./effortLadder";
import {
  AVAILABLE_PROVIDER_OPTIONS,
  buildModelSearchText,
  filterProviderOptionsByVisibility,
  resolveLiveProviderAvailability,
} from "./ProviderModelPicker";
import {
  defaultAgentForProvider,
  getAgentOptions,
  getSelectedAgentValue,
  resolveEffortOptionId,
  ULTRATHINK_PROMPT_PREFIX,
} from "./TraitsPicker";

export type ComposerModelPanelProps = {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProviderStatus> | undefined;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  loadingModelProviders?: Partial<Record<ProviderKind, boolean>> | undefined;
  hiddenProviders?: ReadonlyArray<ProviderKind> | undefined;
  providerOrder?: ReadonlyArray<ProviderKind> | undefined;
  disabled?: boolean | undefined;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
  /** Closes the panel (after a model is picked, or when leaving for Settings). */
  onClose: () => void;
  threadId: ThreadId;
  runtimeModel?: ProviderModelDescriptor | undefined;
  runtimeAgents?: ReadonlyArray<ProviderAgentDescriptor> | null | undefined;
  modelOptions: ProviderModelOptions[ProviderKind] | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  /** Subscription accounts for a provider tab (Claude Code / Codex), shown under the search. */
  renderAccounts?: ((provider: ProviderKind) => ReactNode) | undefined;
};

type Tab = "favorites" | ProviderKind;
type Row = { provider: ProviderKind; option: ProviderModelOption };
type Section = { key: string; label: string | null; rows: Row[] };

const SHORTCUT_COUNT = 9;

export function ComposerModelPanel(props: ComposerModelPanelProps) {
  const { t } = useTranslation(["chat", "common", "settings"]);
  const navigate = useNavigate();
  const { favorites, isFavorite, toggleFavorite } = useModelFavorites();
  const activeProvider = props.lockedProvider ?? props.provider;
  const [tab, setTab] = useState<Tab>(activeProvider);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query).trim().toLowerCase();

  // Tabs: the visible providers, or only the locked one once a chat has started.
  const providerTabs = useMemo(() => {
    const hidden = new Set<ProviderKind>(props.hiddenProviders ?? []);
    const protectedProviders = new Set<ProviderKind>([props.provider]);
    if (props.lockedProvider) protectedProviders.add(props.lockedProvider);
    const visible = filterProviderOptionsByVisibility(
      AVAILABLE_PROVIDER_OPTIONS.toSorted((left, right) =>
        compareProvidersByOrder(props.providerOrder ?? [], left.value, right.value),
      ),
      hidden,
      protectedProviders,
    );
    return props.lockedProvider
      ? visible.filter((option) => option.value === props.lockedProvider)
      : visible;
  }, [props.hiddenProviders, props.lockedProvider, props.provider, props.providerOrder]);

  const availability = useCallback(
    (provider: ProviderKind) =>
      resolveLiveProviderAvailability(
        props.providers?.find((entry) => entry.provider === provider),
      ),
    [props.providers],
  );
  const labelOf = useCallback(
    (provider: ProviderKind) =>
      providerTabs.find((option) => option.value === provider)?.label ?? provider,
    [providerTabs],
  );

  // Local models carry a measured tool-use tier; show it the way the old picker did.
  const optionsFor = useCallback(
    (provider: ProviderKind): ReadonlyArray<ProviderModelOption> => {
      const options = props.modelOptionsByProvider[provider] ?? [];
      if (provider !== "opencode") return options;
      const tiers = new Map(
        (readLocalModelsBrowserCache()?.data.installedModels ?? []).flatMap((installed) =>
          installed.capabilityProfile
            ? [[`${installed.runtime}/${installed.modelId}`, installed.capabilityProfile.tier]]
            : [],
        ),
      );
      const withTiers: ProviderModelOption[] = [];
      for (const option of options) {
        const capabilityTier = tiers.get(option.slug);
        withTiers.push(capabilityTier ? Object.assign({}, option, { capabilityTier }) : option);
      }
      return withTiers;
    },
    [props.modelOptionsByProvider],
  );

  const usableProviders = useMemo(
    () =>
      providerTabs
        .map((option) => option.value)
        .filter((provider) => !availability(provider).disabled),
    [availability, providerTabs],
  );

  const sections = useMemo<Section[]>(() => {
    if (deferredQuery) {
      return usableProviders.flatMap((provider) => {
        const rows = optionsFor(provider)
          .filter((option) => buildModelSearchText(option).includes(deferredQuery))
          .map((option) => ({ provider, option }));
        return rows.length > 0 ? [{ key: provider, label: labelOf(provider), rows }] : [];
      });
    }
    if (tab === "favorites") {
      return usableProviders.flatMap((provider) => {
        const options = optionsFor(provider);
        const rows = favorites
          .filter((favorite) => favorite.provider === provider)
          .flatMap((favorite) => {
            const option = options.find((candidate) => candidate.slug === favorite.slug);
            return option ? [{ provider, option }] : [];
          });
        return rows.length > 0 ? [{ key: provider, label: labelOf(provider), rows }] : [];
      });
    }
    if (availability(tab).disabled || props.loadingModelProviders?.[tab]) return [];
    return groupProviderModelOptions([...optionsFor(tab)]).map((group) => ({
      key: group.key,
      label: group.label,
      rows: group.options.map((option) => ({ provider: tab, option })),
    }));
  }, [
    availability,
    deferredQuery,
    favorites,
    labelOf,
    optionsFor,
    props.loadingModelProviders,
    tab,
    usableProviders,
  ]);
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);

  const isSelected = useCallback(
    (row: Row) => row.provider === activeProvider && row.option.slug === props.model,
    [activeProvider, props.model],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const selected = rows.findIndex(isSelected);
    setActiveIndex(selected >= 0 ? selected : 0);
  }, [isSelected, rows]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-row-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const commitModel = useCallback(
    (row: Row) => {
      const resolved = resolveSelectableModel(
        row.provider,
        row.option.slug,
        props.modelOptionsByProvider[row.provider],
      );
      if (!resolved) return;
      props.onProviderModelChange(row.provider, resolved);
      props.onClose();
    },
    [props],
  );
  const selectRow = useCallback(
    (row: Row | undefined) => {
      if (!row || props.disabled) return;
      // A model too small for tools stays selectable, but only after saying so once.
      if (isChatOnlyModel(row.option) && isElectron) {
        void ensureNativeApi()
          .dialogs.confirm(t("model.chatOnlyConfirm", { name: row.option.name }))
          .catch(() => false)
          .then((confirmed) => {
            if (confirmed) commitModel(row);
          });
        return;
      }
      commitModel(row);
    },
    [commitModel, props.disabled, t],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      selectRow(rows[Number(event.key) - 1]);
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('[role="slider"]')) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + step + rows.length) % rows.length);
    } else if (event.key === "Enter" && target.tagName === "INPUT") {
      event.preventDefault();
      selectRow(rows[activeIndex]);
    }
  };

  const openSettings = (section: "accounts" | "models" | "local-models") => {
    props.onClose();
    void navigate({ to: "/settings", search: { section } });
  };

  const tabStatus = tab !== "favorites" && !deferredQuery ? availability(tab) : null;
  const showLocalSetup =
    tab === "opencode" &&
    !deferredQuery &&
    isElectron &&
    (readLocalModelsBrowserCache()?.data.installedModels.length ?? 0) === 0;

  return (
    <div
      data-slot="composer-model-panel"
      className="flex w-full flex-col tracking-[-0.006em] antialiased"
      onKeyDown={handleKeyDown}
    >
      <ProviderTabs
        tabs={providerTabs}
        active={deferredQuery ? null : tab}
        lockedProvider={props.lockedProvider}
        favoritesLabel={t("models.favourites")}
        addLabel={t("modelPanel.addProvider")}
        onSelect={(next) => {
          setTab(next);
          setQuery("");
        }}
        onAdd={() => openSettings("accounts")}
      />

      <label className="flex h-9 items-center gap-2 border-b border-[color:var(--color-border)] px-3">
        <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- typing to search is the panel's first action
          autoFocus
          type="search"
          // A global rule gives inputs the code font; search uses the panel's UI font.
          style={{ fontFamily: "inherit" }}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("modelPanel.searchPlaceholder")}
          aria-label={t("modelPanel.searchPlaceholder")}
          className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>

      {!deferredQuery && tab !== "favorites" ? props.renderAccounts?.(tab) : null}

      <div
        ref={listRef}
        key={deferredQuery ? "search" : tab}
        role="listbox"
        aria-label={t("model.change")}
        className="composer-model-panel-list max-h-[15.5rem] min-h-20 overflow-y-auto overscroll-contain p-1"
      >
        {tab !== "favorites" && !deferredQuery && props.loadingModelProviders?.[tab] ? (
          <div className="space-y-1 p-1" aria-label={t("model.loading")}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex h-[30px] items-center gap-2 px-2">
                <Skeleton className={cn("h-3.5 rounded-full", index % 3 === 0 ? "w-24" : "w-36")} />
                <Skeleton className="ms-auto h-5 w-8 rounded-md" />
              </div>
            ))}
          </div>
        ) : tabStatus?.disabled ? (
          <PanelNotice
            text={t(
              tabStatus.labelKey === "model.availability.signIn"
                ? "modelPanel.signInTo"
                : tabStatus.labelKey === "model.availability.checking"
                  ? "modelPanel.checking"
                  : "modelPanel.unavailable",
              { provider: labelOf(tab as ProviderKind) },
            )}
            {...(tabStatus.labelKey === "model.availability.signIn"
              ? {
                  action: t("settings:aiAccounts.signIn"),
                  onAction: () => openSettings("accounts"),
                }
              : {})}
          />
        ) : rows.length === 0 ? (
          <PanelNotice
            text={
              deferredQuery
                ? t("model.noMatches")
                : tab === "favorites"
                  ? t("modelPanel.noFavourites")
                  : t("model.configure")
            }
            {...(!deferredQuery && tab === "opencode"
              ? {
                  action: t("actions.settings", { ns: "common" }),
                  onAction: () => openSettings("models"),
                }
              : {})}
          />
        ) : (
          sections.map((section) => (
            <div key={section.key} role="group" aria-label={section.label ?? undefined}>
              {section.label && (sections.length > 1 || deferredQuery || tab === "favorites") ? (
                <div className="px-2 pt-1.5 pb-0.5 text-[10.5px] font-medium text-muted-foreground">
                  {section.label}
                </div>
              ) : null}
              {section.rows.map((row) => {
                const index = rows.indexOf(row);
                const favorite = isFavorite(row.provider, row.option.slug);
                return (
                  <div
                    key={`${row.provider}:${row.option.slug}`}
                    role="option"
                    aria-selected={isSelected(row)}
                    data-row-index={index}
                    data-active={index === activeIndex ? "" : undefined}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => selectRow(row)}
                    className={cn(
                      "group/row flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md ps-2 pe-0.5 text-[12.5px] text-foreground/80 transition-colors duration-100",
                      "data-[active]:bg-foreground/[0.05] data-[active]:text-foreground aria-selected:bg-foreground/[0.08] aria-selected:font-medium aria-selected:text-foreground",
                      props.disabled && "pointer-events-none opacity-60",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{row.option.name}</span>
                    {isChatOnlyModel(row.option) ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {t("model.chatOnly")}
                      </span>
                    ) : null}
                    {index < SHORTCUT_COUNT ? (
                      <kbd className="inline-flex h-4 shrink-0 items-center px-0.5 font-sans text-[10.5px] font-normal tabular-nums text-muted-foreground/70">
                        {formatShortcutLabel({
                          key: String(index + 1),
                          modKey: true,
                          metaKey: false,
                          ctrlKey: false,
                          altKey: false,
                          shiftKey: false,
                        })}
                      </kbd>
                    ) : null}
                    <button
                      type="button"
                      aria-pressed={favorite}
                      aria-label={t(favorite ? "models.removeFavorite" : "models.addFavorite", {
                        name: row.option.name,
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFavorite(row.provider, row.option.slug);
                      }}
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-md transition-[color,opacity,transform] duration-150 hover:text-foreground active:scale-90 motion-reduce:transition-none",
                        // Stars stay out of the way until you point at a row (or it is starred).
                        favorite
                          ? "text-amber-400"
                          : "text-muted-foreground/60 opacity-0 group-hover/row:opacity-100 group-data-[active]/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                      )}
                    >
                      {favorite ? (
                        <StarFilledIcon aria-hidden="true" className="size-3.5" />
                      ) : (
                        <StarIcon aria-hidden="true" className="size-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
        {showLocalSetup ? (
          <button
            type="button"
            onClick={() => openSettings("local-models")}
            className="mt-1 flex h-[30px] w-full items-center rounded-md px-2 text-start text-[12.5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            {t("model.setUpLocalAi")}
          </button>
        ) : null}
      </div>

      <ModelTraitsFooter {...props} />
    </div>
  );
}

function PanelNotice(props: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-7 text-center">
      <p className="text-[13px] leading-relaxed text-muted-foreground">{props.text}</p>
      {props.action && props.onAction ? (
        <button
          type="button"
          onClick={props.onAction}
          className="rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-foreground/[0.06]"
        >
          {props.action}
        </button>
      ) : null}
    </div>
  );
}

/* Provider tabs -------------------------------------------------------------------------------------- */

function ProviderTabs(props: {
  tabs: ReadonlyArray<{ value: ProviderKind; label: string }>;
  active: Tab | null;
  lockedProvider: ProviderKind | null;
  favoritesLabel: string;
  addLabel: string;
  onSelect: (tab: Tab) => void;
  onAdd: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // The underline glides to the active tab; it hides while searching across providers.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const button = props.active
      ? row?.querySelector<HTMLElement>(`[data-tab="${props.active}"]`)
      : null;
    setIndicator(button ? { left: button.offsetLeft + 8, width: button.offsetWidth - 16 } : null);
  }, [props.active, props.tabs]);

  const tab = (value: Tab, label: string, icon: React.ReactNode) => (
    <button
      key={value}
      type="button"
      role="tab"
      data-tab={value}
      aria-selected={props.active === value}
      aria-label={label}
      title={label}
      onClick={() => props.onSelect(value)}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md transition-[background-color,opacity] duration-150",
        "hover:bg-foreground/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--color-text-accent)]",
        props.active === value ? "opacity-100" : "opacity-60 hover:opacity-100",
      )}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-10 items-center border-b border-[color:var(--color-border)] px-1">
      <div
        ref={rowRef}
        role="tablist"
        className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {tab(
          "favorites",
          props.favoritesLabel,
          <StarFilledIcon aria-hidden="true" className="size-[15px] text-muted-foreground" />,
        )}
        {props.tabs.map((option) => {
          const Icon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[option.value];
          return tab(option.value, option.label, <Icon aria-hidden="true" className="size-4" />);
        })}
        {indicator ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 h-[2px] rounded-full bg-[var(--color-text-accent)] transition-[transform,width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
            style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
          />
        ) : null}
      </div>
      {props.lockedProvider ? null : (
        <button
          type="button"
          aria-label={props.addLabel}
          title={props.addLabel}
          onClick={props.onAdd}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <PlusIcon aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

/* Effort and other model options -------------------------------------------------------------------- */

function ModelTraitsFooter(props: ComposerModelPanelProps) {
  const { t } = useTranslation("chat");
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const traits = getComposerTraitSelection(
    props.provider,
    props.model,
    props.prompt,
    props.modelOptions,
    props.runtimeModel,
  );
  const agentOptions = getAgentOptions(props.provider, props.runtimeAgents);
  const defaultAgent = defaultAgentForProvider(props.provider);
  const selectedAgent = getSelectedAgentValue(props.provider, props.modelOptions);
  const supportsFastMode = traits.fastModeDescriptor !== null || traits.caps.supportsFastMode;

  const commit = (patch: Record<string, unknown>) =>
    setProviderModelOptions(
      props.threadId,
      props.provider,
      buildNextProviderOptions(props.provider, props.modelOptions, patch),
      { model: props.model, persistSticky: true },
    );

  const handleEffort = (value: string) => {
    if (traits.ultrathinkPromptControlled) return;
    // Ultrathink is a word at the start of the prompt, not a setting.
    if (traits.promptInjectedValues.includes(value)) {
      props.onPromptChange(
        props.prompt.trim().length === 0
          ? ULTRATHINK_PROMPT_PREFIX
          : applyClaudePromptEffortPrefix(props.prompt, "ultrathink"),
      );
      return;
    }
    commit(
      buildProviderOptionPatch(
        props.provider,
        resolveEffortOptionId(props.provider, traits.primarySelectDescriptor?.id),
        value,
      ),
    );
  };

  // Every model's strongest stop gets the Ultracode treatment (see resolveEffortSlider).
  const { levels, value: effortValue, topLevel } = resolveEffortSlider(traits);
  const segmented = [
    traits.thinkingEnabled !== null
      ? {
          key: "thinking",
          label: t("traits.thinking"),
          value: traits.thinkingEnabled ? "on" : "off",
          options: [
            { value: "on", label: t("traits.on") },
            { value: "off", label: t("traits.off") },
          ],
          onChange: (value: string) => commit({ thinking: value === "on" }),
        }
      : null,
    traits.contextWindowOptions.length > 1
      ? {
          key: "context",
          label: traits.contextWindowDescriptor?.label ?? t("context.title"),
          value: traits.contextWindow ?? "",
          options: traits.contextWindowOptions.map((option) => ({
            value: option.value,
            label: option.label,
          })),
          onChange: (value: string) =>
            commit({ [traits.contextWindowDescriptor?.id ?? "contextWindow"]: value }),
        }
      : null,
    agentOptions.length > 0 && defaultAgent
      ? {
          key: "agent",
          label: t(props.provider === "kilo" ? "traits.mode" : "traits.agent"),
          value: selectedAgent ?? defaultAgent,
          options: agentOptions.map((agent) => ({
            value: agent.name,
            label: agent.displayName ?? agent.name,
          })),
          onChange: (value: string) =>
            commit({ agent: value === defaultAgent ? undefined : value }),
        }
      : null,
  ].filter((entry) => entry !== null);

  if (levels.length === 0 && segmented.length === 0 && !supportsFastMode) return null;

  const fastToggle = supportsFastMode ? (
    <button
      type="button"
      aria-pressed={traits.fastModeEnabled}
      aria-label={t("modelPanel.fastMode")}
      title={t("modelPanel.fastMode")}
      onClick={() => commit({ fastMode: !traits.fastModeEnabled })}
      className={cn(
        "grid size-[22px] place-items-center rounded-md transition-colors hover:bg-foreground/8",
        traits.fastModeEnabled ? "text-amber-400" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <ZapIcon aria-hidden="true" className="size-3.5" />
    </button>
  ) : null;

  return (
    <div className="border-t border-[color:var(--color-border)] py-0.5">
      {levels.length > 1 ? (
        <EffortSlider
          key={`${props.provider}:${props.model}`}
          variant="bare"
          className="block w-full"
          levels={levels}
          value={effortValue}
          onValueChange={handleEffort}
          recommended={traits.defaultEffort ?? levels[0]!.id}
          {...(topLevel ? { ultraLevel: topLevel } : {})}
          disabled={props.disabled === true || traits.ultrathinkPromptControlled}
          headerAction={fastToggle}
          strings={{
            effort: t("traits.effort"),
            faster: t("modelPanel.faster"),
            smarter: t("modelPanel.smarter"),
            recommended: t("modelPanel.recommended"),
            help: t("modelPanel.aboutEffort"),
            note: traits.ultrathinkPromptControlled
              ? t("traits.removeUltrathink")
              : topLevel === "ultracode"
                ? t("modelPanel.effortNote")
                : t("modelPanel.effortNoteBasic"),
          }}
        />
      ) : fastToggle ? (
        <div className="flex items-center justify-between px-3 py-1.5 text-[12.5px] text-muted-foreground">
          {t("traits.speed")}
          {fastToggle}
        </div>
      ) : null}
      {segmented.map((control) => (
        <div key={control.key} className="flex items-center gap-3 px-3 py-1.5">
          <span className="shrink-0 text-[11.5px] text-muted-foreground">{control.label}</span>
          <div
            role="radiogroup"
            aria-label={control.label}
            className="ms-auto flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5"
          >
            {control.options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={control.value === option.value}
                onClick={() => control.onChange(option.value)}
                className="h-6 shrink-0 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-xs"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
