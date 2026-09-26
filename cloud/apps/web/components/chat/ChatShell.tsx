"use client";
import { PanelLeftOpen } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLocale } from "@/lib/locale-context";

import { SearchDialog } from "./SearchDialog";
import { Sidebar } from "./Sidebar";
import { Toaster } from "./toast";

const ShellCtx = createContext<{ openSidebar: () => void; sidebarHidden: boolean }>({
  openSidebar: () => {},
  sidebarHidden: false,
});
export const useShell = () => useContext(ShellCtx);

/** Sidebar + main area. On phones the sidebar is a drawer; on desktop it can be collapsed. */
export function ChatShell({ children }: { children: ReactNode }) {
  const { d } = useLocale();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const activeId = params?.id ? decodeURIComponent(params.id) : null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        router.push("/chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const shell = useMemo(
    () => ({
      openSidebar: () => {
        if (window.matchMedia("(min-width: 768px)").matches) setCollapsed(false);
        else setDrawerOpen(true);
      },
      sidebarHidden: collapsed,
    }),
    [collapsed],
  );

  return (
    <TooltipProvider delayDuration={400}>
      <ShellCtx.Provider value={shell}>
        <div className="flex h-dvh overflow-hidden bg-card">
          {!collapsed ? (
            <aside className="hidden w-[260px] shrink-0 border-r border-border md:block">
              <Sidebar
                activeId={activeId}
                onSearch={() => setSearchOpen(true)}
                onNavigate={() => {}}
                onCollapse={() => setCollapsed(true)}
              />
            </aside>
          ) : null}
          <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 md:hidden" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[min(300px,85vw)] border-r border-border shadow-xl outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left md:hidden">
                <DialogPrimitive.Title className="sr-only">
                  {d.chat.sidebarLabel}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  {d.chat.sidebarLabel}
                </DialogPrimitive.Description>
                <Sidebar
                  activeId={activeId}
                  onSearch={() => {
                    setDrawerOpen(false);
                    setSearchOpen(true);
                  }}
                  onNavigate={() => setDrawerOpen(false)}
                  onCollapse={() => setDrawerOpen(false)}
                />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        <Toaster />
      </ShellCtx.Provider>
    </TooltipProvider>
  );
}

/** The button that brings the sidebar back: always on phones, on desktop only when collapsed. */
export function SidebarButton() {
  const { d } = useLocale();
  const { openSidebar, sidebarHidden } = useShell();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={openSidebar}
      aria-label={d.chat.openSidebar}
      className={sidebarHidden ? "text-muted-foreground" : "text-muted-foreground md:hidden"}
    >
      <PanelLeftOpen />
    </Button>
  );
}
