import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const shopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../apps/web/public/shop");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function createShopPreviewServer() {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end("Invalid path");
      return;
    }
    if (pathname === "/" || pathname === "/shop" || pathname === "/shop/") {
      response.writeHead(302, { Location: "/shop/index.html" }).end();
      return;
    }
    if (!pathname.startsWith("/shop/") || pathname.includes("\\") || pathname.includes("\0")) {
      response.writeHead(404).end("Not found");
      return;
    }
    const file = resolve(shopRoot, pathname.slice("/shop/".length));
    const withinRoot = relative(shopRoot, file);
    const type = contentTypes[extname(file)];
    if (
      isAbsolute(withinRoot) ||
      withinRoot === ".." ||
      withinRoot.startsWith(`..${sep}`) ||
      !type
    ) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": type, "Content-Length": body.length });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] ?? 5890);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer from 1 to 65535.");
  }
  const server = createShopPreviewServer();
  server.on("error", (error) => {
    console.error(`Cannot start shop preview: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`DJL shop prototype: http://127.0.0.1:${port}/shop/index.html`);
    console.log("Demo only. No real payments, AI inference, or commissions.");
  });
}
