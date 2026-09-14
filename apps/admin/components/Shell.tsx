"use client";
import {
  Activity,
  BadgePercent,
  Boxes,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  ScrollText,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, getToken, setToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const MAIN = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/trials", label: "Trial queue", icon: BadgePercent },
  { href: "/audit", label: "Audit log", icon: ScrollText },
] as const;
const PLATFORM = [
  { href: "/models", label: "Models", icon: Sparkles },
  { href: "/plans", label: "Plans", icon: Boxes },
  { href: "/switches", label: "Kill switches", icon: ShieldAlert },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admins", label: "Admins", icon: ShieldCheck },
] as const;

interface Me {
  admin: { id: string; email: string; role: string; mfaVerified: boolean };
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
      <div className="mb-2 px-3 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground/70 uppercase">
        {title}
      </div>
      <nav className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active
                  ? "glass-strong text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
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
  const [q, setQ] = useState("");
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

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-8 border-r border-white/[0.06] bg-black/20 p-5 backdrop-blur-xl md:flex">
        <Link href="/" className="flex items-center gap-3 px-1">
          <span className="grid size-9 place-items-center rounded-xl bg-primary/90 shadow-[0_0_30px_-4px_var(--color-primary)]">
            <Activity className="size-5 text-white" />
          </span>
          <span className="text-lg font-semibold tracking-tight">DJL Admin</span>
        </Link>
        <NavGroup title="Main menu" items={MAIN} pathname={pathname} />
        <NavGroup title="Platform" items={PLATFORM} pathname={pathname} />
        <div className="mt-auto flex items-center gap-3 rounded-xl border border-white/[0.06] p-3">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-sm font-semibold text-white">
            {(me?.email ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{me?.email ?? "…"}</div>
            <div className="text-xs text-muted-foreground">{me?.role ?? ""}</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            onClick={async () => {
              await admin("/auth/logout", { method: "POST", json: {} }).catch(() => undefined);
              setToken(null);
              router.replace("/login");
            }}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-4 px-6 py-4 backdrop-blur-xl">
          <form
            className="pill flex w-full max-w-md items-center gap-2 pr-1.5 pl-4"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/users?q=${encodeURIComponent(q)}`);
            }}
          >
            <Search className="size-4 text-muted-foreground" />
            <Input
              aria-label="Search users"
              placeholder="Search users by email, name, or id…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <Button type="submit" size="sm" className="rounded-full">
              Search
            </Button>
          </form>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        <main className="px-6 pb-10">
          {title ? (
            <div className="mb-6">
              <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
          ) : null}
          {me ? children : <p className="text-sm text-muted-foreground">Loading…</p>}
        </main>
      </div>
    </div>
  );
}
