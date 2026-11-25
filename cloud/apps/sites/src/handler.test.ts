import { describe, expect, it, vi } from "vitest";

import { BADGE, makeSiteHandler, type LiveSite } from "./handler.ts";

const text = (s: string) => new TextEncoder().encode(s);

const FILES: Record<string, Uint8Array> = {
  "index.html": text("<html><body><h1>Bakery</h1></body></html>"),
  "about.html": text("<h1>About</h1>"),
  "menu/index.html": text("<h1>Menu</h1>"),
  "404.html": text("<h1>Lost?</h1>"),
  "css/site.css": text("h1{color:red}"),
  "_next/static/app.js": text("console.log(1)"),
};

function site(overrides: Partial<LiveSite> = {}): LiveSite {
  return {
    id: "site-1",
    status: "active",
    deployId: "deploy-1",
    files: new Map(
      Object.entries(FILES).map(([path, bytes]) => [
        path,
        { size: bytes.byteLength, sha256: `${path}-hash`.padEnd(64, "0") },
      ]),
    ),
    ...overrides,
  };
}

function setup(options: { site?: LiveSite | null; now?: () => number } = {}) {
  const reads: string[] = [];
  const report = vi.fn(async () => "ok" as const);
  const onVisit = vi.fn();
  const lookup = vi.fn(async (name: string) =>
    name === "bakery" ? (options.site === undefined ? site() : options.site) : null,
  );
  const handle = makeSiteHandler({
    domain: "slcor.site",
    lookup,
    read: async (key) => {
      reads.push(key);
      return FILES[key.split("/").slice(3).join("/")] ?? null;
    },
    report,
    onVisit,
    ipRequestsPerMinute: 5,
    ...(options.now ? { now: options.now } : {}),
  });
  const get = (path: string, init: RequestInit & { host?: string } = {}) =>
    handle(
      new Request(`http://internal${path}`, {
        ...init,
        headers: {
          host: init.host ?? "bakery.slcor.site",
          ...(init.headers as Record<string, string>),
        },
      }),
      "203.0.113.9",
    );
  return { get, reads, report, onVisit, lookup };
}

describe("site server", () => {
  it("serves index.html with the badge, security headers and no cookies", async () => {
    const { get, reads, onVisit } = setup();
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toBe(`<html><body><h1>Bakery</h1>${BADGE}</body></html>`);
    expect(reads).toEqual(["sites/site-1/deploy-1/index.html"]);
    expect(onVisit).toHaveBeenCalledWith("site-1");
  });

  it("resolves clean URLs the way static exports lay them out", async () => {
    const { get } = setup();
    expect(await (await get("/about")).text()).toContain("About");
    expect(await (await get("/menu")).text()).toContain("Menu");
    expect(await (await get("/menu/")).text()).toContain("Menu");
    const missing = await get("/nope");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Lost?");
  });

  it("serves assets with their type and long caching for hashed build output", async () => {
    const { get } = setup();
    const css = await get("/css/site.css");
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await css.text()).toBe("h1{color:red}");
    expect((await get("/_next/static/app.js")).headers.get("cache-control")).toContain("immutable");
  });

  it("answers a matching ETag with 304", async () => {
    const { get } = setup();
    const first = await get("/css/site.css");
    const etag = first.headers.get("etag")!;
    expect((await get("/css/site.css", { headers: { "if-none-match": etag } })).status).toBe(304);
  });

  it("never reads paths outside the manifest", async () => {
    const { get, reads } = setup();
    for (const path of [
      "/../secret",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/index.html%00.css",
      "/%E0%A4%A",
    ])
      expect((await get(path)).status).toBeGreaterThanOrEqual(400);
    expect(reads.every((k) => k.startsWith("sites/site-1/deploy-1/"))).toBe(true);
  });

  it("does not serve hosts outside the sites domain or unknown sites", async () => {
    const { get, lookup } = setup();
    expect((await get("/", { host: "slcor.site" })).status).toBe(404);
    expect((await get("/", { host: "a.b.slcor.site" })).status).toBe(404);
    expect((await get("/", { host: "bakery.slcor.site.evil.com" })).status).toBe(404);
    expect((await get("/", { host: "nobody.slcor.site" })).status).toBe(404);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("shows a notice instead of a taken-down or unpublished site", async () => {
    const down = setup({ site: site({ status: "disabled" }) });
    const response = await down.get("/");
    expect(response.status).toBe(451);
    expect(down.reads).toEqual([]);
    expect((await setup({ site: site({ deployId: null }) }).get("/")).status).toBe(404);
  });

  it("keeps /_djl/ for DJL and takes visitor reports there", async () => {
    const { get, report } = setup();
    const form = await get("/_djl/report");
    expect(form.status).toBe(200);
    expect(await form.text()).toContain("Report bakery.slcor.site");
    expect(form.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await get("/_djl/other")).status).toBe(404);
    const sent = await get("/_djl/report", {
      method: "POST",
      body: "reason=phishing&note=fake+bank",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(sent.status).toBe(200);
    expect(report).toHaveBeenCalledWith({
      name: "bakery",
      reason: "phishing",
      note: "fake bank",
      ip: "203.0.113.9",
    });
    const bad = await get("/_djl/report", { method: "POST", body: "reason=whatever" });
    expect(bad.status).toBe(400);
  });

  it("refuses writes and limits requests per IP", async () => {
    const { get } = setup();
    expect((await get("/", { method: "POST", body: "x" })).status).toBe(405);
    for (let i = 0; i < 4; i++) await get("/css/site.css");
    expect((await get("/css/site.css")).status).toBe(429);
  });

  it("caches lookups so takedowns apply within the cache window", async () => {
    let t = 0;
    const { get, lookup } = setup({ now: () => t });
    await get("/css/site.css");
    await get("/css/site.css");
    expect(lookup).toHaveBeenCalledTimes(1);
    t = 31_000;
    await get("/css/site.css");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
