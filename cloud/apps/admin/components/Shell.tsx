"use client";
import {
  Bell,
  Activity,
  Menu,
  X,
  BadgePercent,
  Boxes,
  Gauge,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  UserRound,
  Users,
  Server,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { CommandPalette } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { admin, getToken, setToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "./LocaleProvider";
import { LanguageSelector } from "./LanguageSelector";
import type { MessageKey } from "@/lib/i18n";

export const NAV_MAIN = [
  { href: "/", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "nav.analytics", icon: Activity },
  { href: "/users", label: "nav.users", icon: Users },
  { href: "/trials", label: "nav.trials", icon: BadgePercent },
  { href: "/audit", label: "nav.audit", icon: ScrollText },
] as const;
export const NAV_PLATFORM = [
  { href: "/servers", label: "nav.servers", icon: Server },
  { href: "/models", label: "nav.models", icon: Sparkles },
  { href: "/plans", label: "nav.plans", icon: Boxes },
  { href: "/usage", label: "nav.usage", icon: Gauge },
  { href: "/switches", label: "nav.switches", icon: ShieldAlert },
  { href: "/settings", label: "nav.settings", icon: Settings },
  { href: "/team", label: "nav.team", icon: UserRound },
] as const;

interface Me {
  admin: { id: string; email: string; role: "admin" | "employee"; mfaVerified: boolean };
}
interface AuditRow {
  id: string;
  action: string;
  actorType: string;
  targetType: string;
  createdAt: string;
  reason: string | null;
}

function NavGroup({
  title,
  items,
  pathname,
}: {
  title: string;
  items: readonly { href: string; label: MessageKey; icon: typeof Users }[];
  pathname: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-2 px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      <nav className="flex flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "admin-nav-link flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                active
                  ? "border-border bg-accent font-medium text-foreground"
                  : "border-transparent text-foreground/80 hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              {t(label)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Notifications() {
  const { t, time } = useI18n();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open && !rows)
          admin<AuditRow[]>("/audit?limit=8")
            .then(setRows)
            .catch(() => setRows([]));
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-9 rounded-full"
          aria-label={t("activity.title")}
        >
          <Bell className="size-[18px]" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">{t("activity.title")}</div>
        <ul className="max-h-80 divide-y overflow-y-auto">
          {(rows ?? []).map((r) => (
            <li key={r.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.action}</span>
                <span className="text-xs text-muted-foreground">{time(r.createdAt)}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t("activity.target", { actor: r.actorType, target: r.targetType })}
                {r.reason ? ` · ${r.reason}` : ""}
              </div>
            </li>
          ))}
          {rows && rows.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("common.empty")}
            </li>
          ) : null}
          {!rows ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </li>
          ) : null}
        </ul>
        <Link
          href="/audit"
          className="block border-t px-4 py-2.5 text-center text-sm text-primary hover:underline"
        >
          {t("activity.audit")}
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/** Kept in the root layout so navigation and verified identity survive route changes. */
export function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/invite") return children;
  return <DashboardFrame>{children}</DashboardFrame>;
}

function DashboardFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me["admin"] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    let active = true;
    const onSessionChange = () => {
      if (!getToken()) {
        setMe(null);
        router.replace("/login");
      }
    };
    window.addEventListener("djl-admin-session-change", onSessionChange);
    if (!getToken()) router.replace("/login");
    else {
      admin<Me>("/me")
        .then((m) => {
          if (!active) return;
          if (!m.admin.mfaVerified) router.replace("/login?step=totp");
          else setMe(m.admin);
        })
        .catch(() => {
          if (active) router.replace("/login");
        });
    }
    return () => {
      active = false;
      window.removeEventListener("djl-admin-session-change", onSessionChange);
    };
  }, [router]);
  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const signOut = async () => {
    await admin("/auth/logout", { method: "POST", json: {} }).catch(() => undefined);
    setToken(null);
    router.replace("/login");
  };

  return (
    <div className="admin-frame flex min-h-screen">
      {navOpen ? (
        <button
          type="button"
          aria-label={t("shell.closeNavigation")}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside
        id="admin-navigation"
        aria-label={t("shell.adminNavigation")}
        className={cn(
          "admin-sidebar fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r bg-sidebar md:sticky md:top-0 md:h-screen md:translate-x-0",
          navOpen ? "visible translate-x-0" : "invisible -translate-x-full md:visible",
        )}
      >
        <div className="flex h-[76px] shrink-0 items-center justify-between border-b px-5">
          <Link href="/" className="flex items-center gap-3" aria-label={t("shell.dashboard")}>
            <Image
              src="/djl-logo.png"
              alt=""
              width={44}
              height={44}
              priority
              className="size-11 object-contain dark:brightness-125"
            />
            <span className="text-xl font-semibold tracking-tight">
              DJL
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t("role.admin")}
              </span>
            </span>
          </Link>
          <button
            type="button"
            aria-label={t("shell.closeNavigation")}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden"
            onClick={() => setNavOpen(false)}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-3 py-7">
          <NavGroup title={t("nav.navigation")} items={NAV_MAIN} pathname={pathname} />
          {me?.role === "admin" ? (
            <NavGroup title={t("nav.platform")} items={NAV_PLATFORM} pathname={pathname} />
          ) : null}
        </div>
        <button
          type="button"
          onClick={signOut}
          className="mx-3 mb-4 flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LogOut className="size-[18px]" strokeWidth={1.75} />
          {t("nav.logout")}
        </button>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="admin-toolbar flex h-[76px] items-center gap-3 border-b px-4 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t("shell.openNavigation")}
            aria-expanded={navOpen}
            aria-controls="admin-navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-10 min-w-0 flex-1 max-w-sm items-center gap-3 rounded-lg border bg-card px-4 text-left text-[15px] text-muted-foreground hover:bg-accent/40"
          >
            <Search className="size-[18px]" strokeWidth={1.75} />
            <span className="flex-1 truncate">{t("shell.search")}</span>
            <kbd className="hidden rounded-md border bg-background px-1.5 py-0.5 font-sans text-xs lg:inline">
              ⌘
            </kbd>
            <kbd className="hidden rounded-md border bg-background px-1.5 py-0.5 font-sans text-xs lg:inline">
              K
            </kbd>
          </button>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LanguageSelector className="[&>svg]:hidden sm:[&>svg]:block" />
            <ThemeToggle />
            <span className="h-6 w-px bg-border" />
            <Notifications />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={t("shell.account")} className="rounded-full">
                  <Avatar className="size-9 rounded-full">
                    <AvatarFallback className="rounded-full bg-secondary text-xs font-medium text-foreground">
                      {(me?.email ?? "?").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="truncate text-sm font-medium">{me?.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {me ? t(`role.${me.role}`) : ""}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {me?.role === "admin" ? (
                  <>
                    <DropdownMenuItem onSelect={() => router.push("/team")}>
                      {t("nav.team")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push("/settings")}>
                      {t("nav.settings")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem onSelect={signOut}>{t("nav.logout")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 px-4 pt-7 pb-10 lg:px-8">
          {me ? (
            children
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t("shell.loading")}
            </p>
          )}
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        isAdmin={me?.role === "admin"}
      />
    </div>
  );
}

/** Page content changes independently of the persistent navigation. */
export function Shell({
  children,
  title,
  subtitle,
  actions,
}: {
  children: ReactNode;
  title?: string | undefined;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <div className="admin-page">
      {title || actions ? (
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? <h1 className="text-2xl font-medium tracking-tight">{title}</h1> : null}
            {subtitle ? (
              <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}
