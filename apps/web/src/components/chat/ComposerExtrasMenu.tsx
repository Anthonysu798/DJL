// FILE: ComposerExtrasMenu.tsx
// Purpose: Hosts the composer `+` menu for attachments and quick composer mode toggles.
// Layer: Chat composer presentation
// Depends on: shared menu primitives, icon buttons, and caller-owned composer state callbacks.

import { type ProviderInteractionMode } from "@synara/contracts";
import { memo, useId, useRef, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { GoTasklist } from "react-icons/go";

import { PluginIcon, ListChecksIcon, PaperclipIcon, PlusIcon } from "~/lib/icons";
import { COMPOSER_ATTACHMENT_ACCEPT } from "../../lib/composerSend";
import { ComposerPickerMenuPopup, ComposerPickerMenuSubPopup } from "./ComposerPickerMenuPopup";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";

export const ComposerExtrasMenu = memo(function ComposerExtrasMenu(props: {
  interactionMode: ProviderInteractionMode;
  supportsFastMode: boolean;
  fastModeEnabled: boolean;
  onAddAttachments: (files: File[]) => void;
  onToggleFastMode: () => void;
  onSetPlanMode: (enabled: boolean) => void;
  onBrowsePlugins?: () => void;
  onBrowseSkills?: () => void;
}) {
  const { t } = useTranslation("chat");
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset the hidden input so selecting the same file twice still emits a change event.
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      props.onAddAttachments(files);
    }
    event.target.value = "";
  };

  return (
    <>
      <input
        id={inputId}
        ref={fileInputRef}
        data-testid="composer-photo-input"
        type="file"
        accept={COMPOSER_ATTACHMENT_ACCEPT}
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="chrome"
              className="shrink-0 rounded-md"
              aria-label={t("composer.extras")}
            />
          }
        >
          <PlusIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="start">
          <MenuItem
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <PaperclipIcon className="size-4 shrink-0" />
            {t("composer.addFiles")}
          </MenuItem>

          <MenuSeparator />
          {props.onBrowsePlugins ? (
            <MenuItem onClick={props.onBrowsePlugins}>
              <PluginIcon className="size-4" />
              {t("composer.pluginsAndMcp")}
              <span className="ml-auto text-muted-foreground">@</span>
            </MenuItem>
          ) : null}
          {props.onBrowseSkills ? (
            <MenuItem onClick={props.onBrowseSkills}>
              <ListChecksIcon className="size-4" />
              {t("composer.skills")}
              <span className="ml-auto text-muted-foreground">$</span>
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuCheckboxItem
            checked={props.interactionMode === "plan"}
            variant="switch"
            onCheckedChange={(checked) => {
              props.onSetPlanMode(checked === true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <GoTasklist className="size-4 shrink-0" />
              {t("composer.mode.plan")}
            </span>
          </MenuCheckboxItem>

          {props.supportsFastMode ? (
            <>
              <MenuSeparator />
              <MenuSub>
                <MenuSubTrigger>{t("traits.fast")}</MenuSubTrigger>
                <ComposerPickerMenuSubPopup>
                  <MenuRadioGroup
                    value={props.fastModeEnabled ? "fast" : "normal"}
                    onValueChange={(value) => {
                      const shouldEnableFast = value === "fast";
                      if (shouldEnableFast === props.fastModeEnabled) return;
                      props.onToggleFastMode();
                    }}
                  >
                    <MenuRadioItem value="normal">{t("traits.default")}</MenuRadioItem>
                    <MenuRadioItem value="fast">{t("traits.fast")}</MenuRadioItem>
                  </MenuRadioGroup>
                </ComposerPickerMenuSubPopup>
              </MenuSub>
            </>
          ) : null}
        </ComposerPickerMenuPopup>
      </Menu>
    </>
  );
});
