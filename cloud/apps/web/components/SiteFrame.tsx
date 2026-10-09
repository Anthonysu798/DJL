"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme";
import { useLocale } from "@/lib/locale-context";

/** Full-screen areas (chat, public shares) draw their own chrome; account pages get a centered column. */
const FULL_SCREEN = /^\/(chat|share)(\/|$)/;

export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { d } = useLocale();
  if (FULL_SCREEN.test(pathname)) return <>{children}</>;
  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link href="/chat" className="text-sm font-semibold tracking-tight">
            {d.appName}
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
    </>
  );
}
