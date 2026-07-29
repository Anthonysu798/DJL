// FILE: ProviderModelOptionGroupList.tsx
// Purpose: Renders grouped provider model radio items with optional collapsible sections.
// Layer: Chat composer presentation
// Depends on: menu radio primitives, collapsible UI, and provider model grouping helpers.

import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { StarFilledIcon, StarIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  resolveModelGroupDefaultOpen,
  shouldUseCollapsibleModelGroups,
  providerModelCostMultiplierLabel,
  type ProviderModelOption,
  type ProviderModelOptionGroup,
} from "../../providerModelOptions";
import type { ProviderKind } from "@synara/contracts";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { MenuGroup, MenuGroupLabel, MenuRadioItem } from "../ui/menu";
import {
  COMPOSER_PICKER_MODEL_GROUP_HEADER_CLASS_NAME,
  COMPOSER_PICKER_MODEL_ROW_LABEL_INDENT_CLASS_NAME,
  COMPOSER_PICKER_RADIUS_CLASS_NAME,
} from "./composerPickerStyles";

type FavoriteModelProvider = "cursor" | "kilo" | "opencode" | "pi";

type ProviderModelOptionGroupListProps = {
  groupedOptions: ReadonlyArray<ProviderModelOptionGroup>;
  provider: ProviderKind;
  activeModel: string;
  isSearching: boolean;
  favoriteProvider: FavoriteModelProvider | null;
  favoriteModelSlugSet: ReadonlySet<string> | undefined;
  onToggleFavorite: (provider: FavoriteModelProvider, slug: string) => void;
  onAfterSelection?: () => void;
};

function ProviderModelRadioItem(
  props: Readonly<{
    provider: ProviderKind;
    modelOption: ProviderModelOption;
    favoriteProvider: FavoriteModelProvider | null;
    isFavorite: boolean;
    onToggleFavorite: (provider: FavoriteModelProvider, slug: string) => void;
    onAfterSelection?: () => void;
  }>,
) {
  const {
    provider,
    modelOption,
    favoriteProvider,
    isFavorite,
    onToggleFavorite,
    onAfterSelection,
  } = props;
  const { t } = useTranslation("chat");
  const supportsFavorites = favoriteProvider !== null;
  const costMultiplierLabel =
    provider === "droid" ? providerModelCostMultiplierLabel(modelOption.description) : null;
  const preserveChildLayout = supportsFavorites || costMultiplierLabel !== null;
  // Marks a model too small to drive tool calls at the moment of choice. The setup page says the
  // same thing, but this dropdown is where users actually pick, so it has to be said here too.
  const chatOnlyBadge =
    modelOption.supportsToolCalls === false ? (
      <span className="ms-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 align-middle text-[9px] font-medium text-amber-700 dark:text-amber-400">
        {t("model.chatOnly")}
      </span>
    ) : null;

  return (
    <MenuRadioItem
      key={`${provider}:${modelOption.slug}`}
      value={modelOption.slug}
      preserveChildLayout={preserveChildLayout}
      className={costMultiplierLabel ? "grid-cols-[minmax(0,1fr)_auto]" : undefined}
      trailing={
        supportsFavorites ? (
          <button
            type="button"
            aria-label={
              isFavorite
                ? t("models.removeFavorite", { name: modelOption.name })
                : t("models.addFavorite", { name: modelOption.name })
            }
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
              COMPOSER_PICKER_RADIUS_CLASS_NAME,
              isFavorite && "text-amber-400 hover:text-amber-300",
            )}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite(favoriteProvider, modelOption.slug);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          >
            {isFavorite ? (
              <StarFilledIcon aria-hidden="true" className="size-3" />
            ) : (
              <StarIcon aria-hidden="true" className="size-3" />
            )}
          </button>
        ) : costMultiplierLabel && modelOption.description ? (
          <span
            title={modelOption.description}
            className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/65"
          >
            <span aria-hidden="true">{costMultiplierLabel}</span>
            <span className="sr-only">{modelOption.description}</span>
          </span>
        ) : null
      }
      onClick={() => {
        onAfterSelection?.();
      }}
    >
      {preserveChildLayout ? (
        <span
          className={cn(
            "block min-w-0 truncate",
            supportsFavorites && COMPOSER_PICKER_MODEL_ROW_LABEL_INDENT_CLASS_NAME,
          )}
        >
          {modelOption.name}
          {chatOnlyBadge}
        </span>
      ) : (
        <>
          {modelOption.name}
          {chatOnlyBadge}
        </>
      )}
    </MenuRadioItem>
  );
}

function CollapsibleModelGroup(
  props: Readonly<{
    group: ProviderModelOptionGroup;
    defaultOpen: boolean;
    children: React.ReactNode;
  }>,
) {
  const [open, setOpen] = useState(props.defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="px-0.5">
      <CollapsibleTrigger
        className={cn(COMPOSER_PICKER_MODEL_GROUP_HEADER_CLASS_NAME, open && "text-foreground/75")}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <DisclosureChevron open={open} className="col-start-1 size-3 shrink-0 opacity-50" />
        <span className="col-start-2 min-w-0 truncate normal-case tracking-normal">
          {props.group.label}
        </span>
        <span className="col-start-3 shrink-0 justify-self-end rounded-full bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] px-1.5 py-px text-[9px] font-normal tabular-nums normal-case tracking-normal text-muted-foreground/70">
          {props.group.options.length}
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel className="flex flex-col gap-px pb-0.5">{props.children}</CollapsiblePanel>
    </Collapsible>
  );
}

export const ProviderModelOptionGroupList = memo(function ProviderModelOptionGroupList(
  props: ProviderModelOptionGroupListProps,
) {
  const useCollapsibleGroups = shouldUseCollapsibleModelGroups(
    props.groupedOptions.length,
    props.isSearching,
  );

  return (
    <div className="flex flex-col gap-px">
      {props.groupedOptions.map((group) => {
        const groupItems = group.options.map((modelOption) => (
          <ProviderModelRadioItem
            key={`${props.provider}:${modelOption.slug}`}
            provider={props.provider}
            modelOption={modelOption}
            favoriteProvider={props.favoriteProvider}
            isFavorite={props.favoriteModelSlugSet?.has(modelOption.slug) ?? false}
            onToggleFavorite={props.onToggleFavorite}
            {...(props.onAfterSelection ? { onAfterSelection: props.onAfterSelection } : {})}
          />
        ));

        if (group.label === null) {
          return (
            <MenuGroup
              key={`${props.provider}:${group.key}`}
              className="flex flex-col gap-px px-0.5"
            >
              {groupItems}
            </MenuGroup>
          );
        }

        if (useCollapsibleGroups) {
          return (
            <CollapsibleModelGroup
              key={`${props.provider}:${group.key}`}
              group={group}
              defaultOpen={resolveModelGroupDefaultOpen({
                groupKey: group.key,
                options: group.options,
                activeModel: props.activeModel,
                groupCount: props.groupedOptions.length,
              })}
            >
              {groupItems}
            </CollapsibleModelGroup>
          );
        }

        return (
          <MenuGroup key={`${props.provider}:${group.key}`} className="flex flex-col gap-px px-0.5">
            <MenuGroupLabel>{group.label}</MenuGroupLabel>
            {groupItems}
          </MenuGroup>
        );
      })}
    </div>
  );
});
