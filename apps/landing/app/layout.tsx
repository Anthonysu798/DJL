import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";

// IBM Plex across all three roles. Plex is the type of a company that shipped actual machines, which
// suits a product whose whole claim is that it runs on hardware you own — and the condensed cut reads
// like equipment labelling rather than another startup grotesque.
//
// Chinese stays on the system stack (see --cjk in globals.css). There is no Simplified Chinese family
// available through next/font/google, and self-hosting one costs megabytes for a script that every
// target OS already ships a good face for.
const plexCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-plex-condensed",
  display: "swap",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DJL - the agent that wakes on your machine",
  description:
    "DJL is a local-first, bilingual agent command center. Route every task between local and online runtimes, watch each tool run, and approve every change before it lands.",
};

export const viewport: Viewport = {
  themeColor: "#161412",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The font variables go on <html>, not <body>. globals.css declares --font-display and friends on
    // :root, and custom properties only inherit downwards — declared on <body> they were invisible to
    // :root, so every --font-* token resolved to the guaranteed-invalid value and the whole site fell
    // back to ui-sans-serif no matter which faces were loaded.
    <html
      lang="en"
      className={`${plexCondensed.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
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
