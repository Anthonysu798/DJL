import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { detectLocale } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/locale-context";

import "./globals.css";

export const metadata: Metadata = {
  title: "DJL Cloud",
  description: "Account, credits, and billing for DJL Cloud.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = detectLocale(
    (await headers()).get("accept-language"),
    (await cookies()).get("djl_locale")?.value ?? null,
  );
  return (
    <html lang={locale === "zh-Hans" ? "zh-Hans" : "en"}>
      <body>
        <LocaleProvider locale={locale}>
          <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
        </LocaleProvider>
      </body>
    </html>
  );
}
