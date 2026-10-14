// FILE: SidebarHeaderNavigationControls.tsx
// Purpose: Single source for the leading chrome cluster (sidebar toggle + route arrows).
// Layer: Shared web shell chrome
// Depends on: Sidebar state plus AppNavigationButtons

import { isElectron } from "~/env";
import { AppNavigationButtons } from "./AppNavigationButtons";
import { useTranslation } from "react-i18next";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { cn } from "~/lib/utils";

/** Shared sidebar toggle and route history controls. */
export function SidebarLeadingControls({ className }: { className?: string }) {
  const { t } = useTranslation("shell");

  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
      <SidebarTrigger
        className="size-7 shrink-0 text-muted-foreground/75 hover:text-foreground"
        aria-label={t("navigation.toggleSidebar")}
      />
      <AppNavigationButtons className="ms-0" />
    </div>
  );
}

/** Web headers show navigation when the sidebar is hidden.
 * Desktop navigation stays in its persistent titlebar. */
export function SidebarHeaderNavigationControls() {
  const { isMobile, open } = useSidebar();

  if (isElectron || (!isMobile && open)) {
    return null;
  }

  return <SidebarLeadingControls />;
}
