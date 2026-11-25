import type { ProviderKind } from "@djl/contracts";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CentralIcon } from "~/lib/central-icons";
import { ProviderIcon } from "./ProviderIcon";

type WorkspaceTab = { path: string; href: string; title: string; provider: ProviderKind | null };

// Set when the next navigation should take over the current tab instead of opening another,
// e.g. the new-chat Work / Code switch, which swaps one empty draft for another. It expires
// quickly so a switch that never navigates cannot hijack a later, unrelated navigation.
const REPLACE_TAB_WINDOW_MS = 2_000;
let replaceActiveTabUntil = 0;

/** The next route change (within a moment) reuses the active tab rather than adding one. */
export function replaceActiveDesktopTabOnNextNavigation(): void {
  replaceActiveTabUntil = Date.now() + REPLACE_TAB_WINDOW_MS;
}

/** Adds or refreshes the tab for `next`; `replacePath` is the tab it takes over, if any. */
export function nextWorkspaceTabs(
  current: readonly WorkspaceTab[],
  next: WorkspaceTab,
  replacePath: string | null,
): WorkspaceTab[] {
  if (current.some((tab) => tab.path === next.path)) {
    return current.map((tab) => (tab.path === next.path ? next : tab));
  }
  if (replacePath && current.some((tab) => tab.path === replacePath)) {
    return current.map((tab) => (tab.path === replacePath ? next : tab));
  }
  return [...current, next].slice(-8);
}

function TabIcon({ tab }: { tab: WorkspaceTab }) {
  if (tab.path === "/settings") return <CentralIcon name="settings-gear-1" className="size-4" />;
  // Keyed by provider so the chat icon swaps to the provider logo with a short settle.
  return (
    <span key={tab.provider ?? "chat"} className="djl-desktop-tab-icon">
      <ProviderIcon
        provider={tab.provider}
        className="size-4"
        fallback={<CentralIcon name="chat-bubble-7" className="size-4" />}
      />
    </span>
  );
}

export function DesktopWorkspaceTabs(props: {
  title: string;
  provider?: ProviderKind | null;
  onNewChat: () => void;
  newChatLabel: string;
}) {
  const { t } = useTranslation("common");
  const location = useLocation();
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const activePathRef = useRef<string | null>(null);
  useEffect(() => {
    // The home route redirects to a draft; keep it out of the tab history.
    if (location.pathname === "/") return;
    const previousPath = activePathRef.current;
    activePathRef.current = location.pathname;
    let replacePath: string | null = null;
    if (previousPath !== location.pathname && Date.now() <= replaceActiveTabUntil) {
      replaceActiveTabUntil = 0;
      replacePath = previousPath;
    }
    const next = {
      path: location.pathname,
      href: location.href,
      title: props.title,
      provider: props.provider ?? null,
    };
    setTabs((current) => nextWorkspaceTabs(current, next, replacePath));
  }, [location.pathname, location.href, props.title, props.provider]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabs, location.pathname]);

  const displayedTabs =
    tabs.length > 0
      ? tabs
      : [
          {
            path: location.pathname,
            href: location.href,
            title: props.title,
            provider: props.provider ?? null,
          },
        ];

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
              <TabIcon tab={tab} />
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
