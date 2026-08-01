// FILE: ProviderModelPicker.tsx
// Purpose: Renders the composer provider/model menu and supports controlled opening for shortcuts.
// Layer: Chat composer presentation
// Depends on: provider availability metadata, shared menu primitives, and picker trigger styling.

import { type ModelSlug, type ProviderKind, type ServerProviderStatus } from "@synara/contracts";
import { resolveSelectableModel } from "@synara/shared/model";
import * as Schema from "effect/Schema";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ProviderPickerKind, PROVIDER_OPTIONS } from "../../session-logic";
import { formatProviderModelOptionName } from "../../providerModelOptions";
import { compareProvidersByOrder } from "../../providerOrdering";
import {
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { cn } from "~/lib/utils";
import { PickerPanelShell } from "./PickerPanelShell";
import { PickerTriggerButton } from "./PickerTriggerButton";
import { ProviderModelOptionGroupList } from "./ProviderModelOptionGroupList";
import { ComposerPickerMenuPopup, ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";
import {
  COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME,
  COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME,
  COMPOSER_PICKER_MODEL_MENU_WIDTH_CLASS_NAME,
  COMPOSER_PICKER_MODEL_SUBMENU_HEIGHT_CLASS_NAME,
} from "./composerPickerStyles";
import { ShortcutKbd } from "../ui/shortcut-kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  groupProviderModelOptions,
  groupProviderModelOptionsWithFavorites,
  isChatOnlyModel,
  shouldUseCollapsibleModelGroups,
  type ProviderModelOption,
} from "../../providerModelOptions";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { isElectron } from "~/env";
import { readLocalModelsBrowserCache } from "~/lib/localModelsBrowserCache";
import { ensureNativeApi } from "~/nativeApi";
import {
  FAVORITE_MODEL_STORAGE_KEYS,
  supportsModelFavorites,
  type FavoriteModelProvider,
} from "../../lib/modelFavorites";
import { Skeleton } from "../ui/skeleton";
import { MODEL_GUIDE_TARGET } from "~/onboarding/firstRunTour";

function isAvailableProviderOption(option: (typeof PROVIDER_OPTIONS)[number]): option is {
  value: ProviderKind;
  label: string;
  available: true;
} {
  return option.available;
}

function resolveLiveProviderAvailability(provider: ServerProviderStatus | undefined): {
  disabled: boolean;
  labelKey: string | null;
} {
  if (!provider) {
    return {
      disabled: true,
      labelKey: "model.availability.checking",
    };
  }

  if (!provider.available) {
    return {
      disabled: true,
      labelKey:
        provider.authStatus === "unauthenticated"
          ? "model.availability.signIn"
          : "model.availability.unavailable",
    };
  }

  if (provider.authStatus === "unauthenticated") {
    return {
      disabled: true,
      labelKey: "model.availability.signIn",
    };
  }

  return {
    disabled: false,
    labelKey: null,
  };
}

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);
const UNAVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => !option.available);

// Removes user-hidden providers from a provider option list while always
// preserving any providers the caller marks as protected (the active and
// locked provider for the current thread). Without that carve-out, hiding the
// provider you're already using would erase the entry that lets you switch
// away from it.
function filterProviderOptionsByVisibility<T extends { value: ProviderKind }>(
  options: ReadonlyArray<T>,
  hiddenProviders: ReadonlySet<ProviderKind>,
  protectedProviders: ReadonlySet<ProviderKind>,
): ReadonlyArray<T> {
  if (hiddenProviders.size === 0) {
    return options;
  }
  return options.filter(
    (option) => protectedProviders.has(option.value) || !hiddenProviders.has(option.value),
  );
}

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" || provider === "gemini" || provider === "pi"
    ? "text-foreground"
    : fallbackClassName;
}

const SEARCHABLE_MODEL_PICKER_THRESHOLD = 15;
const FavoriteModelSlugs = Schema.Array(Schema.String);

// Keeps persisted favorite slugs compact and stable while preserving the user's order.
function toggleFavoriteModelSlug(current: ReadonlyArray<string>, slug: string): string[] {
  const normalizedCurrent = Array.from(new Set(current.filter((entry) => entry.trim().length > 0)));
  return normalizedCurrent.includes(slug)
    ? normalizedCurrent.filter((entry) => entry !== slug)
    : [...normalizedCurrent, slug];
}

function stripParameterizedModelSuffix(model: string): string {
  return model.trim().replace(/\[[^\]]*\]$/u, "");
}

function resolveSelectedModelLabel(input: {
  provider: ProviderKind;
  model: string;
  options: ReadonlyArray<ProviderModelOption>;
}): string {
  const exact = input.options.find((option) => option.slug === input.model);
  if (exact) {
    return exact.name;
  }
  if (input.provider === "cursor") {
    const baseModel = stripParameterizedModelSuffix(input.model);
    const baseMatch = input.options.find(
      (option) => stripParameterizedModelSuffix(option.slug) === baseModel,
    );
    if (baseMatch) {
      return baseMatch.name;
    }
  }
  return formatProviderModelOptionName({
    provider: input.provider,
    slug: input.model,
  });
}

function buildModelSearchText(option: ProviderModelOption): string {
  return [
    option.name,
    option.slug,
    option.description,
    option.upstreamProviderName,
    option.upstreamProviderId,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

type ProviderModelMenuItemsProps = {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProviderStatus>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  loadingModelProviders?: Partial<Record<ProviderKind, boolean>>;
  hiddenProviders?: ReadonlyArray<ProviderKind>;
  providerOrder?: ReadonlyArray<ProviderKind>;
  disabled?: boolean;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
  // Invoked after a model selection commits so callers can close ancestor
  // menus and refocus the composer.
  onAfterSelection?: () => void;
};

// Renders only the popup body of the provider/model picker. Designed to be
// dropped into any MenuPopup or MenuSubPopup so the same selection logic can
// be reused by the standalone picker and the combined composer trait picker.
export const ProviderModelMenuItems = memo(function ProviderModelMenuItems(
  props: ProviderModelMenuItemsProps,
) {
  const { t } = useTranslation(["chat", "common"]);
  const { onAfterSelection } = props;
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [kiloFavoriteModelSlugs, setKiloFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.kilo,
    [],
    FavoriteModelSlugs,
  );
  const [cursorFavoriteModelSlugs, setCursorFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.cursor,
    [],
    FavoriteModelSlugs,
  );
  const [openCodeFavoriteModelSlugs, setOpenCodeFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.opencode,
    [],
    FavoriteModelSlugs,
  );
  const [piFavoriteModelSlugs, setPiFavoriteModelSlugs] = useLocalStorage(
    FAVORITE_MODEL_STORAGE_KEYS.pi,
    [],
    FavoriteModelSlugs,
  );
  const deferredModelSearchQuery = useDeferredValue(modelSearchQuery);
  const activeProvider = props.lockedProvider ?? props.provider;

  // The composer is the only place a first-time user looks for a local model, so offer setup here
  // when none are installed. Read at render rather than memoized: LocalModelSetupCoordinator keeps
  // this cache current app-wide, and a memo would keep offering setup after the first install. A
  // missing or stale-schema entry reads as "none installed", which is the right prompt to show.
  const showLocalModelSetupEntry =
    isElectron && (readLocalModelsBrowserCache()?.data.installedModels.length ?? 0) === 0;
  const hiddenProviders = props.hiddenProviders;
  const providerOrder = props.providerOrder;
  const hiddenProviderSet = useMemo(
    () => new Set<ProviderKind>(hiddenProviders ?? []),
    [hiddenProviders],
  );
  const protectedProviderSet = useMemo(() => {
    const set = new Set<ProviderKind>([props.provider]);
    if (props.lockedProvider !== null) {
      set.add(props.lockedProvider);
    }
    return set;
  }, [props.provider, props.lockedProvider]);
  const visibleAvailableProviderOptions = useMemo(
    () =>
      filterProviderOptionsByVisibility(
        [...AVAILABLE_PROVIDER_OPTIONS].sort((left, right) =>
          compareProvidersByOrder(providerOrder ?? [], left.value, right.value),
        ),
        hiddenProviderSet,
        protectedProviderSet,
      ),
    [hiddenProviderSet, protectedProviderSet, providerOrder],
  );
  const visibleUnavailableProviderOptions = useMemo(
    () =>
      filterProviderOptionsByVisibility(
        [...UNAVAILABLE_PROVIDER_OPTIONS].sort((left, right) =>
          compareProvidersByOrder(providerOrder ?? [], left.value, right.value),
        ),
        hiddenProviderSet,
        protectedProviderSet,
      ),
    [hiddenProviderSet, protectedProviderSet, providerOrder],
  );
  const kiloFavoriteModelSlugSet = useMemo(
    () => new Set(kiloFavoriteModelSlugs),
    [kiloFavoriteModelSlugs],
  );
  const openCodeFavoriteModelSlugSet = useMemo(
    () => new Set(openCodeFavoriteModelSlugs),
    [openCodeFavoriteModelSlugs],
  );
  const cursorFavoriteModelSlugSet = useMemo(
    () => new Set(cursorFavoriteModelSlugs),
    [cursorFavoriteModelSlugs],
  );
  const piFavoriteModelSlugSet = useMemo(
    () => new Set(piFavoriteModelSlugs),
    [piFavoriteModelSlugs],
  );
  const favoriteModelSlugSets = useMemo(
    () => ({
      cursor: cursorFavoriteModelSlugSet,
      kilo: kiloFavoriteModelSlugSet,
      opencode: openCodeFavoriteModelSlugSet,
      pi: piFavoriteModelSlugSet,
    }),
    [
      cursorFavoriteModelSlugSet,
      kiloFavoriteModelSlugSet,
      openCodeFavoriteModelSlugSet,
      piFavoriteModelSlugSet,
    ],
  );
  const commitModelChange = (provider: ProviderKind, value: string) => {
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider],
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    onAfterSelection?.();
  };

  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    // A model measured as unable to drive tool calls stays selectable, because chatting with a
    // small model is legitimate and a silently disabled row explains nothing. Confirming once
    // makes the limitation impossible to wander into without noticing.
    const option = props.modelOptionsByProvider[provider]?.find(
      (candidate) => candidate.slug === value,
    );
    if (option && isChatOnlyModel(option) && isElectron) {
      void (async () => {
        const confirmed = await ensureNativeApi()
          .dialogs.confirm(t("model.chatOnlyConfirm", { ns: "chat", name: option.name }))
          .catch(() => false);
        if (confirmed) commitModelChange(provider, value);
      })();
      return;
    }
    commitModelChange(provider, value);
  };
  const toggleFavoriteModel = useCallback(
    (provider: FavoriteModelProvider, slug: string) => {
      const setFavoriteModelSlugs =
        provider === "cursor"
          ? setCursorFavoriteModelSlugs
          : provider === "kilo"
            ? setKiloFavoriteModelSlugs
            : provider === "pi"
              ? setPiFavoriteModelSlugs
              : setOpenCodeFavoriteModelSlugs;
      setFavoriteModelSlugs((current) => toggleFavoriteModelSlug(current, slug));
    },
    [
      setCursorFavoriteModelSlugs,
      setKiloFavoriteModelSlugs,
      setOpenCodeFavoriteModelSlugs,
      setPiFavoriteModelSlugs,
    ],
  );

  const renderModelRadioGroup = (provider: ProviderKind) => {
    if (props.loadingModelProviders?.[provider]) {
      return (
        <div className="space-y-2 px-2 py-2" aria-label={t("model.loading", { ns: "chat" })}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className={cn("h-3.5 rounded-full", index % 3 === 0 ? "w-24" : "w-32")} />
            </div>
          ))}
        </div>
      );
    }

    const measuredCapabilityTierBySlug = new Map<string, "chat-only" | "assisted" | "agentic">(
      (readLocalModelsBrowserCache()?.data.installedModels ?? []).flatMap((installedModel) =>
        installedModel.capabilityProfile
          ? [
              [
                `${installedModel.runtime}/${installedModel.modelId}`,
                installedModel.capabilityProfile.tier,
              ] as const,
            ]
          : [],
      ),
    );
    const providerOptions =
      provider === "opencode"
        ? props.modelOptionsByProvider[provider].map((option) => {
            const capabilityTier = measuredCapabilityTierBySlug.get(option.slug);
            return capabilityTier ? { ...option, capabilityTier } : option;
          })
        : props.modelOptionsByProvider[provider];
    const shouldShowSearch =
      (provider === "kilo" ||
        provider === "opencode" ||
        provider === "cursor" ||
        provider === "pi") &&
      providerOptions.length >= SEARCHABLE_MODEL_PICKER_THRESHOLD;
    const normalizedModelSearchQuery = deferredModelSearchQuery.trim().toLowerCase();
    const filteredOptions =
      shouldShowSearch && normalizedModelSearchQuery.length > 0
        ? providerOptions.filter((option) =>
            buildModelSearchText(option).includes(normalizedModelSearchQuery),
          )
        : providerOptions;
    const favoriteProvider = supportsModelFavorites(provider) ? provider : null;
    const favoriteModelSlugSet =
      favoriteProvider !== null ? favoriteModelSlugSets[favoriteProvider] : undefined;
    const groupedOptions =
      favoriteModelSlugSet !== undefined
        ? groupProviderModelOptionsWithFavorites({
            options: filteredOptions,
            favoriteSlugs: favoriteModelSlugSet,
          })
        : groupProviderModelOptions(filteredOptions);

    const content =
      groupedOptions.length > 0 ? (
        <>
          <MenuRadioGroup
            value={activeProvider === provider ? props.model : ""}
            onValueChange={(value) => handleModelChange(provider, value)}
          >
            <ProviderModelOptionGroupList
              groupedOptions={groupedOptions}
              provider={provider}
              activeModel={props.model}
              isSearching={normalizedModelSearchQuery.length > 0}
              favoriteProvider={favoriteProvider}
              favoriteModelSlugSet={favoriteModelSlugSet}
              onToggleFavorite={toggleFavoriteModel}
              {...(onAfterSelection ? { onAfterSelection } : {})}
            />
          </MenuRadioGroup>
          {showLocalModelSetupEntry && provider === "opencode" ? (
            <MenuItem
              onClick={() => {
                window.location.assign("/settings?section=local-models");
              }}
            >
              <span>{t("model.setUpLocalAi", { ns: "chat" })}</span>
            </MenuItem>
          ) : null}
        </>
      ) : (
        <div className="px-2 py-2 text-muted-foreground text-sm">
          {provider === "pi" && normalizedModelSearchQuery.length === 0
            ? t("model.noPiModels", { ns: "chat" })
            : t("model.noMatches", { ns: "chat" })}
        </div>
      );

    if (!shouldShowSearch) {
      const needsScrollContainer =
        filteredOptions.length >= SEARCHABLE_MODEL_PICKER_THRESHOLD ||
        shouldUseCollapsibleModelGroups(groupedOptions.length, false);
      if (needsScrollContainer) {
        return (
          <div
            className={cn(
              "overflow-y-auto overscroll-contain py-0.5",
              COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME,
              COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME,
            )}
          >
            {content}
          </div>
        );
      }
      return content;
    }

    return (
      <PickerPanelShell
        searchPlaceholder={t("model.search", { ns: "chat" })}
        query={modelSearchQuery}
        onQueryChange={setModelSearchQuery}
        stopSearchKeyPropagation
        autoFocusSearch
        widthClassName="w-full"
        bleedParentPadding
        listMaxHeightClassName={COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME}
      >
        {content}
      </PickerPanelShell>
    );
  };

  if (props.lockedProvider !== null) {
    return <>{renderModelRadioGroup(props.lockedProvider)}</>;
  }

  if (
    visibleAvailableProviderOptions.length === 1 &&
    visibleAvailableProviderOptions[0]?.value === "opencode"
  ) {
    if (
      !props.loadingModelProviders?.opencode &&
      props.modelOptionsByProvider.opencode.length === 0
    ) {
      return (
        <MenuItem
          onClick={() => {
            window.location.assign("/settings?section=models");
          }}
        >
          <span>{t("model.configure", { ns: "chat" })}</span>
          <span className="ms-auto text-[11px] text-muted-foreground">
            {t("actions.settings", { ns: "common" })}
          </span>
        </MenuItem>
      );
    }
    return <>{renderModelRadioGroup("opencode")}</>;
  }

  return (
    <>
      {visibleAvailableProviderOptions.map((option) => {
        const OptionIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[option.value];
        const liveProvider = props.providers?.find((entry) => entry.provider === option.value);
        const availability = resolveLiveProviderAvailability(liveProvider);
        if (availability.disabled) {
          return (
            <MenuItem key={option.value} disabled>
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 opacity-80",
                  providerIconClassName(option.value, "text-muted-foreground/85"),
                )}
              />
              <span>{option.label}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80">
                {availability.labelKey ? t(availability.labelKey, { ns: "chat" }) : null}
              </span>
            </MenuItem>
          );
        }
        return (
          <MenuSub key={option.value}>
            <MenuSubTrigger>
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0",
                  providerIconClassName(option.value, "text-muted-foreground/85"),
                )}
              />
              {option.label}
            </MenuSubTrigger>
            <ComposerPickerMenuSubPopup
              fixedWidth
              className={cn(
                COMPOSER_PICKER_MODEL_MENU_WIDTH_CLASS_NAME,
                COMPOSER_PICKER_MODEL_SUBMENU_HEIGHT_CLASS_NAME,
              )}
            >
              {renderModelRadioGroup(option.value)}
            </ComposerPickerMenuSubPopup>
          </MenuSub>
        );
      })}
      {visibleUnavailableProviderOptions.length > 0 && <MenuSeparator />}
      {visibleUnavailableProviderOptions.map((option) => {
        const OptionIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[option.value];
        return (
          <MenuItem key={option.value} disabled>
            <OptionIcon
              aria-hidden="true"
              className="size-3 shrink-0 text-muted-foreground/85 opacity-80"
            />
            <span>{option.label}</span>
            <span className="ms-auto text-[11px] text-muted-foreground/80">
              {t("model.availability.comingSoon", { ns: "chat" })}
            </span>
          </MenuItem>
        );
      })}
    </>
  );
});

// Resolves the human-readable label for the currently selected model.
export function resolveProviderModelLabel(input: {
  provider: ProviderKind;
  lockedProvider: ProviderKind | null;
  model: ModelSlug;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
}): string {
  const activeProvider = input.lockedProvider ?? input.provider;
  return resolveSelectedModelLabel({
    provider: activeProvider,
    model: input.model,
    options: input.modelOptionsByProvider[activeProvider],
  });
}

type ProviderModelPickerProps = {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProviderStatus>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  loadingModelProviders?: Partial<Record<ProviderKind, boolean>>;
  hiddenProviders?: ReadonlyArray<ProviderKind>;
  providerOrder?: ReadonlyArray<ProviderKind>;
  compact?: boolean;
  // Label-hidden trigger for narrow composers; the model name moves to title/sr-only.
  hideLabel?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectionCommitted?: () => void;
  shortcutLabel?: string | null;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
};

export const ProviderModelPicker = memo(function ProviderModelPicker(
  props: ProviderModelPickerProps,
) {
  const { t } = useTranslation("chat");
  const { onOpenChange, onSelectionCommitted, open } = props;
  const [uncontrolledMenuOpen, setUncontrolledMenuOpen] = useState(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const isMenuOpen = open ?? uncontrolledMenuOpen;
  const activeProvider = props.lockedProvider ?? props.provider;
  const activeProviderModels = props.modelOptionsByProvider[activeProvider] ?? [];
  const selectedModelLabel =
    activeProviderModels.length === 0
      ? t("model.configure")
      : resolveProviderModelLabel({
          provider: props.provider,
          lockedProvider: props.lockedProvider,
          model: props.model,
          modelOptionsByProvider: props.modelOptionsByProvider,
        });

  const setMenuOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) {
        setUncontrolledMenuOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );
  const scheduleSelectionCommitted = useCallback(() => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
    }
    // Base UI restores focus to the trigger while closing; refocus callers after that tick.
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = null;
      onSelectionCommitted?.();
    }, 0);
  }, [onSelectionCommitted]);
  useEffect(
    () => () => {
      if (selectionCommitTimerRef.current !== null) {
        window.clearTimeout(selectionCommitTimerRef.current);
      }
    },
    [],
  );

  const handleAfterSelection = useCallback(() => {
    setMenuOpen(false);
    scheduleSelectionCommitted();
  }, [scheduleSelectionCommitted, setMenuOpen]);

  const triggerButton = (
    <PickerTriggerButton
      data-onboarding-current-model={selectedModelLabel}
      data-onboarding-target={MODEL_GUIDE_TARGET}
      disabled={props.disabled ?? false}
      compact={props.compact ?? false}
      hideLabel={props.hideLabel ?? false}
      label={selectedModelLabel}
    />
  );

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(nextOpen) => {
        if (props.disabled) {
          setMenuOpen(false);
          return;
        }
        setMenuOpen(nextOpen);
      }}
    >
      {props.shortcutLabel ? (
        <Tooltip>
          <TooltipTrigger render={<MenuTrigger render={triggerButton} />}>
            <span className="sr-only">{selectedModelLabel}</span>
          </TooltipTrigger>
          {!isMenuOpen ? (
            <TooltipPopup side="top" sideOffset={6} variant="picker">
              <span className="inline-flex items-center gap-2 px-1 py-0.5">
                <span>{t("model.change")}</span>
                <ShortcutKbd
                  shortcutLabel={props.shortcutLabel}
                  className="h-4 min-w-4 px-1 text-[length:var(--app-font-size-ui-2xs,9px)] text-muted-foreground"
                />
              </span>
            </TooltipPopup>
          ) : null}
        </Tooltip>
      ) : (
        <MenuTrigger render={triggerButton}>
          <span className="sr-only">{selectedModelLabel}</span>
        </MenuTrigger>
      )}
      <ComposerPickerMenuPopup
        align="start"
        fixedWidth={props.lockedProvider !== null}
        className={
          props.lockedProvider !== null ? COMPOSER_PICKER_MODEL_MENU_WIDTH_CLASS_NAME : undefined
        }
      >
        <ProviderModelMenuItems
          provider={props.provider}
          model={props.model}
          lockedProvider={props.lockedProvider}
          {...(props.providers ? { providers: props.providers } : {})}
          modelOptionsByProvider={props.modelOptionsByProvider}
          {...(props.loadingModelProviders
            ? { loadingModelProviders: props.loadingModelProviders }
            : {})}
          {...(props.hiddenProviders ? { hiddenProviders: props.hiddenProviders } : {})}
          {...(props.providerOrder ? { providerOrder: props.providerOrder } : {})}
          {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
          onProviderModelChange={props.onProviderModelChange}
          onAfterSelection={handleAfterSelection}
        />
      </ComposerPickerMenuPopup>
    </Menu>
  );
});
