// FILE: ComposerModelEffortPicker.tsx
// Purpose: Combined composer picker for model + effort/reasoning + speed in a single trigger.
// Layer: Chat composer presentation
// Depends on: provider/model menu items, traits menu content, shared menu primitives,
//   composer trait selection helpers, and the composer draft store for fast-mode persistence.

import {
  type ModelSlug,
  type ProviderAgentDescriptor,
  type ProviderKind,
  type ProviderModelDescriptor,
  type ProviderModelOptions,
  type ServerProviderStatus,
  type ThreadId,
} from "@djl/contracts";
import { memo, useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ChevronDownIcon, FastModeIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { type ProviderModelOption } from "../../providerModelOptions";
import { Button } from "../ui/button";
import { ShortcutKbd } from "../ui/shortcut-kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME,
  COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME,
  COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
} from "./composerPickerStyles";
import { ComposerModelPanel } from "./ComposerModelPanel";
import { getComposerTraitSelection } from "./composerTraits";
import { resolveProviderModelLabel } from "./ProviderModelPicker";
import { MODEL_GUIDE_TARGET } from "~/onboarding/firstRunTour";

type ComposerModelEffortPickerProps = {
  // Model picker data.
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProviderStatus>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  loadingModelProviders?: Partial<Record<ProviderKind, boolean>>;
  hiddenProviders?: ReadonlyArray<ProviderKind>;
  providerOrder?: ReadonlyArray<ProviderKind>;
  compact?: boolean;
  // Narrow-composer degradation: drop the model name and/or the effort/status
  // label; both remain available to assistive tech.
  hideModelLabel?: boolean;
  hideStatusLabel?: boolean;
  disabled?: boolean;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
  onSelectionCommitted?: () => void;

  // Traits/effort/speed data.
  threadId: ThreadId;
  runtimeModel?: ProviderModelDescriptor | undefined;
  runtimeModels?: ReadonlyArray<ProviderModelDescriptor> | null | undefined;
  runtimeAgents?: ReadonlyArray<ProviderAgentDescriptor> | null | undefined;
  modelOptions: ProviderModelOptions[ProviderKind] | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  /** Subscription accounts for a provider tab, shown in the panel under the search. */
  renderAccounts?: (provider: ProviderKind) => ReactNode;

  // Shared menu control.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  shortcutLabel?: string | null;
};

// Renders a single composer trigger that combines model selection, reasoning
// effort, and the optional speed/fast-mode toggle. The primary menu hosts the
// reasoning radio group; model and speed are reachable via sub-menus so the
// composer footer stays compact.
export const ComposerModelEffortPicker = memo(function ComposerModelEffortPicker(
  props: ComposerModelEffortPickerProps,
) {
  const { t } = useTranslation("chat");
  const { onOpenChange, open } = props;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isMenuOpen = open ?? uncontrolledOpen;

  const setMenuOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );

  const modelLabel = resolveProviderModelLabel({
    provider: props.provider,
    lockedProvider: props.lockedProvider,
    model: props.model,
    modelOptionsByProvider: props.modelOptionsByProvider,
  });

  const traitSelection = getComposerTraitSelection(
    props.provider,
    props.model,
    props.prompt,
    props.modelOptions,
    props.runtimeModel,
  );

  const {
    caps,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    fastModeDescriptor,
    ultrathinkPromptControlled,
  } = traitSelection;

  const supportsFastModeControl = fastModeDescriptor !== null || caps.supportsFastMode;
  const effortLabel = effort
    ? (effortLevels.find((level) => level.value === effort)?.label ?? effort)
    : null;
  const triggerStatusLabel = ultrathinkPromptControlled
    ? t("traits.ultrathink")
    : effortLabel
      ? effortLabel
      : thinkingEnabled !== null
        ? t("traits.thinkingState", {
            state: t(thinkingEnabled ? "traits.on" : "traits.off"),
          })
        : null;
  const showsFastBadge = supportsFastModeControl && fastModeEnabled;

  // Picking a model closes the panel and returns focus to the composer.
  const handleClose = useCallback(() => {
    setMenuOpen(false);
    props.onSelectionCommitted?.();
  }, [props, setMenuOpen]);

  const hiddenTriggerTitle = [
    props.hideModelLabel ? modelLabel : null,
    props.hideStatusLabel ? triggerStatusLabel : null,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");

  const triggerButton = (
    <Button
      data-onboarding-current-model={modelLabel}
      data-onboarding-target={MODEL_GUIDE_TARGET}
      size="sm"
      variant="chrome"
      disabled={props.disabled ?? false}
      className={cn(
        "min-w-0 shrink-0 justify-start gap-1.5 whitespace-nowrap px-2 sm:px-2.5 [&_svg]:mx-0",
        COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
      )}
      aria-label={t("model.changeReasoning")}
      {...(hiddenTriggerTitle.length > 0 ? { title: hiddenTriggerTitle } : {})}
    />
  );

  const triggerContent = (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {props.hideModelLabel ? (
        <span className="sr-only">{modelLabel}</span>
      ) : (
        <span className="min-w-0 truncate text-[var(--color-text-foreground)]">{modelLabel}</span>
      )}
      {showsFastBadge ? (
        <FastModeIcon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME)}
        />
      ) : null}
      {triggerStatusLabel ? (
        props.hideStatusLabel ? (
          <span className="sr-only">{triggerStatusLabel}</span>
        ) : (
          <span className={cn("shrink-0", COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME)}>
            {triggerStatusLabel}
          </span>
        )
      ) : null}
      <ChevronDownIcon aria-hidden="true" className="ms-0.5 size-3 shrink-0 opacity-60" />
    </span>
  );

  const popup = (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side="top" align="end" sideOffset={8} className="z-50">
        <PopoverPrimitive.Popup
          className={cn(
            APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME,
            "w-[min(17.5rem,calc(100vw-1.5rem))] overflow-hidden outline-none",
            "origin-(--transform-origin) transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[.98] data-ending-style:opacity-0 data-starting-style:scale-[.97] data-starting-style:opacity-0 motion-reduce:transition-none",
          )}
        >
          <ComposerModelPanel
            provider={props.provider}
            model={props.model}
            lockedProvider={props.lockedProvider}
            providers={props.providers}
            modelOptionsByProvider={props.modelOptionsByProvider}
            loadingModelProviders={props.loadingModelProviders}
            hiddenProviders={props.hiddenProviders}
            providerOrder={props.providerOrder}
            disabled={props.disabled}
            onProviderModelChange={props.onProviderModelChange}
            onClose={handleClose}
            threadId={props.threadId}
            runtimeModel={props.runtimeModel}
            runtimeAgents={props.runtimeAgents}
            modelOptions={props.modelOptions}
            prompt={props.prompt}
            onPromptChange={props.onPromptChange}
            renderAccounts={props.renderAccounts}
          />
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );

  return (
    <PopoverPrimitive.Root
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
          <TooltipTrigger render={<PopoverPrimitive.Trigger render={triggerButton} />}>
            {triggerContent}
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
        <PopoverPrimitive.Trigger render={triggerButton}>{triggerContent}</PopoverPrimitive.Trigger>
      )}
      {popup}
    </PopoverPrimitive.Root>
  );
});
