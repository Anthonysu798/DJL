"use client";
import { Home, Search, Settings, SquarePen, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  Suspense,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLocale } from "@/lib/locale-context";

import { SearchDialog } from "./SearchDialog";
import { SettingsNav } from "./SettingsView";
import { AccountMenu, ArchivedDialog, Sidebar } from "./Sidebar";
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
  const settings = usePathname() === "/chat/settings";
  const [archivedOpen, setArchivedOpen] = useState(false);
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
          <nav
            aria-label={d.workspace.navigation}
            className="cloud-rail hidden w-[58px] shrink-0 flex-col items-center border-r border-border py-3 md:flex"
          >
            <Link
              href="/chat"
              aria-label={d.workspace.home}
              className={`flex size-10 items-center justify-center rounded-xl transition-colors hover:bg-accent ${!settings ? "bg-accent" : ""}`}
            >
              <Home className="size-5" />
            </Link>
            <Link
              href="/chat"
              aria-label={d.chat.newChat}
              className="mt-5 flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <SquarePen className="size-5" />
            </Link>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={d.chat.searchChats}
              className="mt-3 flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Search className="size-5" />
            </button>
            <Link
              href="/chat/settings"
              aria-label={d.workspace.settings}
              className={`mt-3 flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${settings ? "bg-accent text-foreground" : ""}`}
            >
              <Settings className="size-5" />
            </Link>
            <div className="mt-auto w-full px-1">
              <AccountMenu compact onArchived={() => setArchivedOpen(true)} />
            </div>
          </nav>
          {!collapsed || settings ? (
            <aside className="hidden w-[264px] shrink-0 border-r border-border md:block">
              {settings ? (
                <Suspense>
                  <SettingsNav onNavigate={() => setDrawerOpen(false)} />
                </Suspense>
              ) : (
                <Sidebar
                  activeId={activeId}
                  onSearch={() => setSearchOpen(true)}
                  onNavigate={() => {}}
                  onCollapse={() => setCollapsed(true)}
                />
              )}
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
                {settings ? (
                  <Suspense>
                    <SettingsNav onNavigate={() => setDrawerOpen(false)} />
                  </Suspense>
                ) : (
                  <Sidebar
                    activeId={activeId}
                    onSearch={() => {
                      setDrawerOpen(false);
                      setSearchOpen(true);
                    }}
                    onNavigate={() => setDrawerOpen(false)}
                    onCollapse={() => setDrawerOpen(false)}
                  />
                )}
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <div className="flex min-w-0 flex-1 flex-col">
            {settings ? (
              <div className="flex h-14 items-center px-3 md:hidden">
                <SidebarButton />
              </div>
            ) : null}
            {children}
          </div>
        </div>
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        <ArchivedDialog
          open={archivedOpen}
          onOpenChange={setArchivedOpen}
          onNavigate={() => setArchivedOpen(false)}
        />
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
