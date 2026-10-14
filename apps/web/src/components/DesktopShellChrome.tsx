import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CentralIcon } from "~/lib/central-icons";
import { DesktopWorkspaceTabs } from "./DesktopWorkspaceTabs";
import { SidebarLeadingControls } from "./SidebarHeaderNavigationControls";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export type DesktopRailItem = {
  label: string;
  icon: string;
  active?: boolean;
  onboardingTarget?: string;
  onClick: () => void;
};

export function DesktopShellChrome(props: {
  title: string;
  items: DesktopRailItem[];
  onNewChat: () => void;
  newChatLabel: string;
  account: ReactNode;
  update: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTarget(document.getElementById("djl-desktop-chrome"));
  }, []);
  // Frosted sidebars establish a fixed-position containing block. Keep the
  // window chrome beside the sidebar so theme changes cannot move it.
  if (!target) return null;
  return createPortal(
    <>
      <div className="djl-desktop-topbar drag-region">
        <div className="djl-desktop-window-navigation no-drag">
          <SidebarLeadingControls />
        </div>
        <DesktopWorkspaceTabs
          title={props.title}
          onNewChat={props.onNewChat}
          newChatLabel={props.newChatLabel}
        />
        <div id="djl-desktop-toolbar" className="djl-desktop-toolbar no-drag" />
      </div>
      <nav className="djl-desktop-rail no-drag" aria-label="DJL">
        <div className="flex flex-col items-center gap-2">
          {props.items.map((item) => (
            <Tooltip key={item.label}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="djl-desktop-rail-button"
                    aria-label={item.label}
                    aria-current={item.active ? "page" : undefined}
                    data-onboarding-target={item.onboardingTarget}
                    onClick={item.onClick}
                  />
                }
              >
                <CentralIcon
                  name={item.icon}
                  variant={item.icon === "home" && item.active ? "fill" : "reversed"}
                  className="size-5"
                />
              </TooltipTrigger>
              <TooltipPopup side="right">{item.label}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-3 pb-2">
          {props.update}
          {props.account}
        </div>
      </nav>
    </>,
    target,
  );
}
