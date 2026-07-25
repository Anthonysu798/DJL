// FILE: RightDockPaneMenuItems.tsx
// Purpose: Renders canonical right-dock pane choices for header and dock menus.
// Layer: Chat right-dock UI primitive

import { CheckIcon } from "~/lib/icons";
import { useTranslation } from "react-i18next";
import type { RightDockPaneKind } from "~/rightDockStore.logic";
import { MenuItem } from "../ui/menu";
import { getRightDockPaneMeta } from "./rightDockPaneMeta";

export interface RightDockPaneMenuItem {
  kind: RightDockPaneKind;
  active?: boolean;
  disabled?: boolean;
  detail?: string;
}

export function RightDockPaneMenuItems(props: {
  items: readonly RightDockPaneMenuItem[];
  onSelect: (kind: RightDockPaneKind) => void;
}) {
  const { t } = useTranslation("chat");
  return props.items.map((item) => {
    const { Icon, labelKey } = getRightDockPaneMeta(item.kind);
    return (
      <MenuItem
        key={item.kind}
        data-active={item.active ? "true" : undefined}
        disabled={item.disabled}
        onClick={() => props.onSelect(item.kind)}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
        {item.detail ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">{item.detail}</span>
        ) : item.active ? (
          <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </MenuItem>
    );
  });
}
