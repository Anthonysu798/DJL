import type { Metadata } from "next";
import type { ReactNode } from "react";

import { THEME_BOOT_SCRIPT } from "@/components/ThemeToggle";

import "./globals.css";

export const metadata: Metadata = { title: "DJL Admin", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
