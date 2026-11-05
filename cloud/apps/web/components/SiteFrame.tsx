"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { CommerceDesktopBridge } from "@synara/contracts/cloud";

import { ThemeToggle } from "@/components/theme";
import { useLocale } from "@/lib/locale-context";

/** Full-screen areas draw their own chrome; account pages get a centered column. */
const FULL_SCREEN = /^\/(chat|share|shop)(\/|$)/;

export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { d } = useLocale();
  const verify = /^\/verify\/?$/.test(pathname);
  const [embeddedShop, setEmbeddedShop] = useState<boolean | null>(null);
  useEffect(() => {
    if (verify)
      setEmbeddedShop(
        (window as Window & { djlCommerce?: CommerceDesktopBridge }).djlCommerce?.kind ===
          "desktop",
      );
  }, [verify]);
  if (
    FULL_SCREEN.test(pathname) ||
    /^\/(sign-in|sign-up|forgot-password|reset-password|billing)(\/|$)/.test(pathname)
  )
    return <>{children}</>;
  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          {verify && embeddedShop === null ? (
            <span className="text-sm font-semibold tracking-tight">{d.appName}</span>
          ) : (
            <Link
              href={verify && embeddedShop ? "/shop" : "/chat"}
              className="text-sm font-semibold tracking-tight"
            >
              {d.appName}
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
    </>
  );
}
