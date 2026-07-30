import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// One family for everything, 64px display down to 12px eyebrow — no serif, no mono display face.
// NotionInter is a proprietary tuning of Inter, so Inter is the direct substitute; the tightness comes
// from the explicit negative tracking in globals.css, since Inter at default tracking reads looser.
//
// Chinese stays on the system stack (see --cjk in globals.css). No family in next/font/google offers a
// chinese-simplified subset, and self-hosting one costs megabytes for a script every target OS already
// ships a good face for.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DJL - the agent that wakes on your machine",
  description:
    "DJL is a local-first, bilingual agent command center. Route every task between local and online runtimes, watch each tool run, and approve every change before it lands.",
};

export const viewport: Viewport = {
  themeColor: "#213183",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The font variables go on <html>, not <body>. globals.css declares --font-display and friends on
    // :root, and custom properties only inherit downwards — declared on <body> they were invisible to
    // :root, so every --font-* token resolved to the guaranteed-invalid value and the whole site fell
    // back to ui-sans-serif no matter which faces were loaded.
    <html lang="en" className={inter.variable}>
      <head>
        {/* Always open at the top (hero) on reload. Runs before hydration so it
            beats the browser's default scroll-position restoration. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "if('scrollRestoration' in history){history.scrollRestoration='manual';}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
