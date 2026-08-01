import type { Metadata, Viewport } from "next";
import { Site } from "./Site";

// The redesigned landing surface is paper-white; /guide and /changelog keep the
// dark themeColor from the root layout.
export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  alternates: {
    languages: { "zh-CN": "/", en: "/en" },
  },
};

// Chinese is the default locale and lives at the bare paths; English is at /en.
export default function Home() {
  return <Site locale="zh" />;
}
