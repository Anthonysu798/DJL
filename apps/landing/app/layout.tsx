import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DJL - the agent that wakes on your machine",
  description:
    "DJL is a local-first, bilingual agent command center. Route every task between local and online runtimes, watch each tool run, and approve every change before it lands.",
};

export const viewport: Viewport = {
  themeColor: "#06070c",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Always open at the top (hero) on reload. Runs before hydration so it
            beats the browser's default scroll-position restoration. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "if('scrollRestoration' in history){history.scrollRestoration='manual';}",
          }}
        />
      </head>
      <body className={`${bricolage.variable} ${manrope.variable} ${jetbrains.variable}`}>
        {children}
      </body>
    </html>
  );
}
