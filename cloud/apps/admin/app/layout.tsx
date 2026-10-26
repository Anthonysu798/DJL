import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminLayout } from "@/components/Shell";
import { THEME_BOOT_SCRIPT } from "@/components/ThemeToggle";
import { LocaleProvider } from "@/components/LocaleProvider";
import { LOCALE_BOOT_SCRIPT } from "@/lib/i18n/locale";

import "./globals.css";

export const metadata: Metadata = { title: "DJL Admin", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCALE_BOOT_SCRIPT }} />
      </head>
      <body>
        <LocaleProvider>
          <AdminLayout>{children}</AdminLayout>
        </LocaleProvider>
      </body>
    </html>
  );
}
