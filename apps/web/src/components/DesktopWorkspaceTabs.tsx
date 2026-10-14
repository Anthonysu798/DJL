import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CentralIcon } from "~/lib/central-icons";

type WorkspaceTab = { path: string; href: string; title: string };

export function DesktopWorkspaceTabs(props: {
  title: string;
  onNewChat: () => void;
  newChatLabel: string;
}) {
  const { t } = useTranslation("common");
  const location = useLocation();
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  useEffect(() => {
    // The home route redirects to a draft; keep it out of the tab history.
    if (location.pathname === "/") return;
    setTabs((current) => {
      const next = { path: location.pathname, href: location.href, title: props.title };
      return current.some((tab) => tab.path === next.path)
        ? current.map((tab) => (tab.path === next.path ? next : tab))
        : [...current, next].slice(-8);
    });
  }, [location.pathname, location.href, props.title]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabs, location.pathname]);

  const displayedTabs =
    tabs.length > 0 ? tabs : [{ path: location.pathname, href: location.href, title: props.title }];

  const closeTab = (tab: WorkspaceTab) => {
    const remaining = tabs.filter((entry) => entry.path !== tab.path);
    setTabs(remaining);
    if (tab.path === location.pathname) {
      const previous = remaining.at(-1);
      if (previous) window.location.hash = previous.href;
      else props.onNewChat();
    }
  };

  return (
    <div className="djl-desktop-tabs no-drag" data-settings={location.pathname === "/settings"}>
      <div className="djl-desktop-tab-list">
        {displayedTabs.map((tab) => (
          <div
            key={tab.path}
            ref={tab.path === location.pathname ? activeTabRef : undefined}
            className="djl-desktop-tab"
            data-active={tab.path === location.pathname}
          >
            <a
              href={`#${tab.href}`}
              aria-current={tab.path === location.pathname ? "page" : undefined}
            >
              <CentralIcon
                name={tab.path === "/settings" ? "settings-gear-1" : "chat-bubble-7"}
                className="size-4"
              />
              <span className="truncate">{tab.title}</span>
            </a>
            <button
              type="button"
              className="djl-desktop-tab-close"
              aria-label={`${t("actions.close")}: ${tab.title}`}
              onClick={() => closeTab(tab)}
            >
              <CentralIcon name="cross-small" className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="djl-desktop-tab-add"
        aria-label={props.newChatLabel}
        onClick={props.onNewChat}
      >
        <CentralIcon name="plus-medium" className="size-4" />
      </button>
    </div>
  );
}
