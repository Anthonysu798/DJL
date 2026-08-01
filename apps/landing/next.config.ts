import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: projectRoot,
  },
  // English moved from ?lang=en to the /en path prefix. These keep every old
  // link working; without a lang=en query the bare paths serve Chinese.
  async redirects() {
    const wasEnglish = [{ type: "query" as const, key: "lang", value: "en" }];
    return [
      { source: "/", has: wasEnglish, destination: "/en", permanent: true },
      { source: "/docs", has: wasEnglish, destination: "/en/docs", permanent: true },
      { source: "/changelog", has: wasEnglish, destination: "/en/changelog", permanent: true },
    ];
  },
};

export default nextConfig;
