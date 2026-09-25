"use client";
import {
  Bell,
  BadgePercent,
  Boxes,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
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

export const NAV_MAIN = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/trials", label: "Trial queue", icon: BadgePercent },
  { href: "/audit", label: "Audit log", icon: ScrollText },
] as const;
export const NAV_PLATFORM = [
  { href: "/models", label: "Models", icon: Sparkles },
  { href: "/plans", label: "Plans", icon: Boxes },
  { href: "/switches", label: "Kill switches", icon: ShieldAlert },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/team", label: "Team", icon: UserRound },
] as const;

interface Me {
  admin: { id: string; email: string; role: "admin" | "employee"; mfaVerified: boolean };
}
const ROLE_LABEL = { admin: "Admin", employee: "Employee" } as const;
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
  items: readonly { href: string; label: string; icon: typeof Users }[];
  pathname: string;
}) {
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
                "flex items-center gap-3 rounded-lg border px-3 py-2 text-[15px] transition-colors",
                active
                  ? "border-primary/40 bg-primary/[0.06] font-medium text-primary"
                  : "border-transparent text-foreground/80 hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Notifications() {
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
          className="size-10 rounded-xl"
          aria-label="Recent activity"
        >
          <Bell className="size-[18px]" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">Recent activity</div>
        <ul className="max-h-80 divide-y overflow-y-auto">
          {(rows ?? []).map((r) => (
            <li key={r.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.action}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {r.actorType} on {r.targetType}
                {r.reason ? ` · ${r.reason}` : ""}
              </div>
            </li>
          ))}
          {rows && rows.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>
          ) : null}
          {!rows ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</li>
          ) : null}
        </ul>
        <Link
          href="/audit"
          className="block border-t px-4 py-2.5 text-center text-sm text-primary hover:underline"
        >
          Open audit log
        </Link>
      </PopoverContent>
    </Popover>
  );
}

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
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me["admin"] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    admin<Me>("/me")
      .then((m) => {
        if (!m.admin.mfaVerified) router.replace("/login?step=totp");
        else setMe(m.admin);
      })
      .catch(() => router.replace("/login"));
  }, [router]);
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
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar px-4 py-6 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary">
            <span className="size-3.5 rounded-full border-[3px] border-primary-foreground" />
          </span>
          <span className="text-xl font-semibold tracking-tight">DJL</span>
        </Link>
        <div className="space-y-7">
          <NavGroup title="Navigation" items={NAV_MAIN} pathname={pathname} />
          {me?.role === "admin" ? (
            <NavGroup title="Platform" items={NAV_PLATFORM} pathname={pathname} />
          ) : null}
        </div>
        <button
          type="button"
          onClick={signOut}
          className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] text-foreground/80 hover:bg-accent"
        >
          <LogOut className="size-[18px]" strokeWidth={1.75} />
          Log out
        </button>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-3 px-8 pt-6 pb-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-11 w-full max-w-md items-center gap-3 rounded-xl border bg-card px-4 text-left text-[15px] text-muted-foreground hover:bg-accent/40"
          >
            <Search className="size-[18px]" strokeWidth={1.75} />
            <span className="flex-1">Search anything</span>
            <kbd className="rounded-md border bg-background px-1.5 py-0.5 font-sans text-xs">⌘</kbd>
            <kbd className="rounded-md border bg-background px-1.5 py-0.5 font-sans text-xs">K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-4">
            {actions}
            <ThemeToggle />
            <span className="h-6 w-px bg-border" />
            <Notifications />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Account" className="rounded-xl">
                  <Avatar className="size-10 rounded-xl">
                    <AvatarFallback className="rounded-xl bg-primary/10 text-sm font-medium text-primary">
                      {(me?.email ?? "?").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="truncate text-sm font-medium">{me?.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {me ? ROLE_LABEL[me.role] : ""}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {me?.role === "admin" ? (
                  <>
                    <DropdownMenuItem onSelect={() => router.push("/team")}>Team</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push("/settings")}>
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem onSelect={signOut}>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="px-8 pt-4 pb-10">
          {title ? (
            <div className="mb-5">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
          ) : null}
          {me ? children : <p className="text-sm text-muted-foreground">Loading…</p>}
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
