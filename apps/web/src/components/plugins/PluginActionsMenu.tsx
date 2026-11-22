// FILE: PluginActionsMenu.tsx
// Purpose: The "…" menu on an added plugin: the plugin it acts on at the top, then its actions,
//          with Uninstall set apart at the bottom. Same look as the avatar menu.

import type { PluginCatalogEntry } from "@synara/contracts";
import { useTranslation } from "react-i18next";

import { EllipsisIcon, InfoIcon, Trash2 } from "~/lib/icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { PluginGlyph } from "./PluginGlyph";

export function PluginActionsMenu(props: {
  plugin: PluginCatalogEntry;
  /** Omitted where the details are already on screen. */
  onViewDetails?: () => void;
  /** Omitted for built-in plugins, which cannot be removed. */
  onUninstall?: () => void;
}) {
  const { t } = useTranslation("shell");
  const { plugin } = props;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("pluginLibrary.moreActions", { name: plugin.displayName })}
          />
        }
      >
        <EllipsisIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup surface="liquid" align="end" className="djl-plugin-actions-menu">
        <div className="flex items-center gap-2.5 px-2 py-2" data-slot="plugin-actions-header">
          <PluginGlyph plugin={plugin} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {plugin.displayName}
            </div>
            <div className="truncate text-[13px] text-foreground/65">
              {t("pluginLibrary.byDeveloper", { developer: plugin.developer })}
            </div>
          </div>
        </div>
        {props.onViewDetails ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={props.onViewDetails}>
              <InfoIcon className="size-4" />
              {t("pluginLibrary.viewDetails")}
            </MenuItem>
          </>
        ) : null}
        {props.onUninstall ? (
          <>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={props.onUninstall}>
              <Trash2 className="size-4" />
              {t("pluginLibrary.uninstall")}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
