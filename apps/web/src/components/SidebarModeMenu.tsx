import { useTranslation } from "react-i18next";
import { ChevronDownIcon, AGENT_ROBOT_ICON_NAME } from "~/lib/icons";
import { CentralIcon } from "~/lib/central-icons";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import type { SidebarView } from "./Sidebar.logic";
import "./sidebar-mode-menu.css";

const options = {
  studio: { icon: AGENT_ROBOT_ICON_NAME, label: "work", description: "agentDescription" },
  threads: { icon: "code-brackets", label: "projects", description: "projectsDescription" },
  workspace: { icon: "console", label: "workspace", description: "workspaceDescription" },
} as const;

export function SidebarModeMenu({
  views,
  activeView,
  onSelectView,
}: {
  views: readonly SidebarView[];
  activeView: SidebarView;
  onSelectView: (view: SidebarView) => void;
}) {
  const { t } = useTranslation("shell");
  return (
    <Menu>
      <MenuTrigger className="sidebar-mode-trigger" aria-label={t("sidebar.modeMenu.label")}>
        <span>DJL</span>
        <ChevronDownIcon className="sidebar-mode-chevron" aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup surface="composer" align="start" sideOffset={8} className="sidebar-mode-menu">
        <MenuRadioGroup
          value={activeView}
          onValueChange={(value) => {
            if (views.includes(value as SidebarView)) onSelectView(value as SidebarView);
          }}
        >
          {views.map((view) => {
            const option = options[view];
            return (
              <MenuRadioItem
                key={view}
                closeOnClick
                value={view}
                className="sidebar-mode-option"
                aria-label={t(`sidebar.views.${option.label}`)}
              >
                <span className="sidebar-mode-icon">
                  <CentralIcon name={option.icon} className="sidebar-mode-glyph" />
                </span>
                <span className="sidebar-mode-copy">
                  <span className="sidebar-mode-title">{t(`sidebar.views.${option.label}`)}</span>
                  <span className="sidebar-mode-description">
                    {t(`sidebar.modeMenu.${option.description}`)}
                  </span>
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
