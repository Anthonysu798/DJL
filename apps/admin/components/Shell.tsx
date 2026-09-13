"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { admin, getToken, setToken } from "@/lib/api";

const NAV = [
  ["/", "Overview"],
  ["/users", "Users"],
  ["/trials", "Trial queue"],
  ["/models", "Models"],
  ["/plans", "Plans"],
  ["/switches", "Kill switches"],
  ["/audit", "Audit log"],
  ["/settings", "Settings"],
  ["/admins", "Admins"],
] as const;

interface Me {
  admin: { id: string; email: string; role: string; mfaVerified: boolean };
}

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me["admin"] | null>(null);
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
  if (!me) return <p className="p-6 text-sm text-neutral-500">Loading…</p>;
  return (
    <div className="flex min-h-screen">
      <aside className="w-52 shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-800">
        <div className="mb-4 text-sm font-semibold">DJL Admin</div>
        <nav className="nav flex flex-col gap-1">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 text-xs text-neutral-500">
          {me.email}
          <br />
          {me.role}
        </div>
        <button
          className="btn-secondary mt-3 w-full"
          type="button"
          onClick={async () => {
            await admin("/auth/logout", { method: "POST", json: {} }).catch(() => undefined);
            setToken(null);
            router.replace("/login");
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
