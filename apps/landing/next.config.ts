import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const isProduction = process.env.NODE_ENV === "production";

// Sent with every response. The site may not be framed, runs script only from its own origin,
// and may embed one third-party frame: the Spline scene in app/hero.
const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js hydrates through inline scripts; its development tooling also evaluates code.
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  // The 3D scenes decode textures embedded in their models through blob: and data: URLs.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  `connect-src 'self' blob: data:${isProduction ? "" : " ws:"}`,
  "worker-src 'self' blob:",
  "frame-src https://my.spline.design",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
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
