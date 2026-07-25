import { ProviderInteractionMode, RuntimeMode } from "@synara/contracts";
import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EllipsisIcon, ListTodoIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  traitsMenuContent?: ReactNode;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onToggleRuntimeMode: () => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="chrome"
            className="shrink-0 px-2"
            aria-label={t("composer.moreControls")}
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="start">
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        <MenuGroup>
          <MenuGroupLabel>{t("composer.mode.label")}</MenuGroupLabel>
          <MenuRadioGroup
            value={props.interactionMode}
            onValueChange={(value) => {
              if (!value || value === props.interactionMode) return;
              props.onToggleInteractionMode();
            }}
          >
            <MenuRadioItem value="default">{t("composer.mode.build")}</MenuRadioItem>
            <MenuRadioItem value="plan">{t("composer.plan.label")}</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem onClick={props.onTogglePlanSidebar}>
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen
                ? t("composer.plan.hideSidebar", { name: t("composer.plan.label") })
                : t("composer.plan.showSidebar", { name: t("composer.plan.label") })}
            </MenuItem>
          </>
        ) : null}
      </ComposerPickerMenuPopup>
    </Menu>
  );
});
