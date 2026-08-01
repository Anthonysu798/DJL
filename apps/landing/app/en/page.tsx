import type { Metadata, Viewport } from "next";
import { Site } from "../Site";

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  alternates: {
    languages: { "zh-CN": "/", en: "/en" },
  },
};

export default function EnglishHome() {
  return <Site locale="en" />;
}
