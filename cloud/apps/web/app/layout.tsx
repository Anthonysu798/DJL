import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { SiteFrame } from "@/components/SiteFrame";
import { THEME_BOOT_SCRIPT } from "@/components/theme";
import { detectLocale } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/locale-context";

import "./globals.css";

export const metadata: Metadata = {
  title: "DJL Cloud",
  description: "Chat, account, credits, and billing for DJL Cloud.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1c1f" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = detectLocale(
    (await headers()).get("accept-language"),
    (await cookies()).get("djl_locale")?.value ?? null,
  );
  return (
    <html lang={locale === "zh-Hans" ? "zh-Hans" : "en"} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <LocaleProvider locale={locale}>
          <SiteFrame>{children}</SiteFrame>
        </LocaleProvider>
      </body>
    </html>
  );
}
