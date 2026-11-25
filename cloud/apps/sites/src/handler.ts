/**
 * Serves `{name}.slcor.site`. Each request maps its host to a site and the
 * site's live deploy, then the path to a file in that deploy's manifest. Only
 * files in the manifest are ever read, from keys built here. HTML gets a small
 * "Built with DJL" badge with a report link. `/_djl/*` belongs to DJL and can
 * never be served from a deploy. The server never sets cookies.
 */
import { CLOUD_SITE_FILE_TYPES, CLOUD_SITE_NAME_PATTERN } from "@djl/contracts/cloud";

export interface LiveSite {
  readonly id: string;
  readonly status: "active" | "disabled";
  readonly deployId: string | null;
  /** path → size and SHA-256 */
  readonly files: ReadonlyMap<string, { readonly size: number; readonly sha256: string }>;
}

export interface SiteHandlerDeps {
  readonly domain: string;
  readonly lookup: (name: string) => Promise<LiveSite | null>;
  readonly read: (key: string, maxBytes: number) => Promise<Uint8Array | null>;
  readonly report: (input: {
    readonly name: string;
    readonly reason: string;
    readonly note: string;
    readonly ip: string | null;
  }) => Promise<"ok" | "limited" | "failed">;
  readonly onVisit?: (siteId: string) => void;
  /** Requests per client IP per minute. */
  readonly ipRequestsPerMinute?: number;
  /** Bytes one site may serve per UTC day before visitors see a notice. */
  readonly siteBytesPerDay?: number;
  readonly lookupTtlMs?: number;
  readonly now?: () => number;
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()",
  "cross-origin-opener-policy": "same-origin",
  "x-djl-site": "1",
};
const REPORT_REASONS = [
  "phishing",
  "malware",
  "spam",
  "illegal",
  "impersonation",
  "other",
] as const;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const BADGE = `<div style="all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:6px;align-items:center;font:500 12px/1 system-ui,-apple-system,sans-serif;"><a href="https://slcor.com/?ref=site" target="_blank" rel="noopener" style="all:initial;cursor:pointer;padding:7px 10px;border-radius:999px;background:rgba(17,17,17,.86);color:#fff;font:inherit;box-shadow:0 1px 2px rgba(0,0,0,.2),0 4px 12px rgba(0,0,0,.12);">Built with DJL</a><a href="/_djl/report" style="all:initial;cursor:pointer;padding:7px 9px;border-radius:999px;background:rgba(17,17,17,.6);color:#fff;font:inherit;">Report</a></div>`;

function page(title: string, body: string, status: number, extra: Record<string, string> = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;color:#111;font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:32rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#444;margin:.5rem 0}a{color:#111}label{display:block;margin:1rem 0 .25rem;font-weight:500}select,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.5rem;border:1px solid #ccc;border-radius:8px}button{margin-top:1rem;font:inherit;padding:.6rem 1rem;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      ...extra,
    },
  });
}

const notice = (title: string, text: string, status: number) =>
  page(
    title,
    `<h1>${escape(title)}</h1><p>${escape(text)}</p><p><a href="https://slcor.com">DJL</a></p>`,
    status,
  );

function injectBadge(html: string): string {
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? html + BADGE : html.slice(0, at) + BADGE + html.slice(at);
}

function cacheControl(path: string, isHtml: boolean) {
  if (isHtml) return "public, max-age=0, must-revalidate";
  if (path.startsWith("_next/static/") || path.startsWith("assets/"))
    return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

/** Window counter keyed by string; old windows are dropped as they pass. */
class Counter {
  private window = 0;
  private counts = new Map<string, number>();
  constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}
  add(key: string, amount: number): number {
    const current = Math.floor(this.now() / this.windowMs);
    if (current !== this.window) {
      this.window = current;
      this.counts = new Map();
    }
    const next = (this.counts.get(key) ?? 0) + amount;
    this.counts.set(key, next);
    return next;
  }
  get(key: string) {
    return this.counts.get(key) ?? 0;
  }
}

export function clientIp(request: Request, socketIp: string | null): string | null {
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    socketIp
  );
}

/** The manifest file a request path names, trying clean-URL forms, then 404.html. */
function resolve(site: LiveSite, pathname: string): { path: string; status: number } | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  const candidates =
    path === "" || path.endsWith("/")
      ? [`${path}index.html`]
      : [path, `${path}/index.html`, `${path}.html`];
  for (const candidate of candidates)
    if (site.files.has(candidate)) return { path: candidate, status: 200 };
  if (site.files.has("404.html")) return { path: "404.html", status: 404 };
  return null;
}

export function makeSiteHandler(deps: SiteHandlerDeps) {
  const now = deps.now ?? Date.now;
  const ttl = deps.lookupTtlMs ?? 30_000;
  const perIp = new Counter(60_000, now);
  const perSite = new Counter(86_400_000, now);
  const cache = new Map<string, { at: number; site: LiveSite | null }>();
  const suffix = `.${deps.domain}`;

  async function lookup(name: string) {
    const hit = cache.get(name);
    if (hit && now() - hit.at < ttl) return hit.site;
    const site = await deps.lookup(name);
    if (cache.size > 10_000) cache.clear();
    cache.set(name, { at: now(), site });
    return site;
  }

  async function reportRoute(request: Request, name: string, ip: string | null) {
    if (request.method === "GET")
      return page(
        "Report this site",
        `<h1>Report ${escape(name)}${escape(suffix)}</h1><p>Tell DJL if this site is a scam, steals passwords, spreads malware, or breaks the law. Reports are reviewed by people.</p><form method="post"><label for="reason">What is wrong?</label><select id="reason" name="reason">${REPORT_REASONS.map((r) => `<option value="${r}">${r[0]!.toUpperCase()}${r.slice(1)}</option>`).join("")}</select><label for="note">Details (optional)</label><textarea id="note" name="note" rows="4" maxlength="2000"></textarea><button type="submit">Send report</button></form>`,
        200,
      );
    if (request.method !== "POST")
      return notice("Not allowed", "This page only accepts reports.", 405);
    const length = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(length) || length > 8192)
      return notice("Report too long", "Shorten the details and try again.", 413);
    const form = new URLSearchParams((await request.text()).slice(0, 8192));
    const reason = form.get("reason") ?? "";
    if (!(REPORT_REASONS as readonly string[]).includes(reason))
      return notice("Choose a reason", "Go back and choose what is wrong with the site.", 400);
    const result = await deps.report({
      name,
      reason,
      note: (form.get("note") ?? "").slice(0, 2000),
      ip,
    });
    if (result === "limited") return notice("Too many reports", "Try again later.", 429);
    if (result === "failed")
      return notice("Report not sent", "Something went wrong. Try again later.", 502);
    return notice("Thanks for the report", "DJL will review this site.", 200);
  }

  return async function handle(
    request: Request,
    socketIp: string | null = null,
  ): Promise<Response> {
    const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
    const name = host.endsWith(suffix) ? host.slice(0, -suffix.length) : "";
    if (!CLOUD_SITE_NAME_PATTERN.test(name))
      return notice("No site here", "There is no site at this address.", 404);

    const ip = clientIp(request, socketIp);
    if (perIp.add(ip ?? "unknown", 1) > (deps.ipRequestsPerMinute ?? 600))
      return notice("Slow down", "Too many requests. Try again in a minute.", 429);

    const url = new URL(request.url);
    const site = await lookup(name);
    if (!site) return notice("No site here", "There is no site at this address.", 404);
    if (url.pathname === "/_djl/report" || url.pathname === "/_djl/report/")
      return reportRoute(request, name, ip);
    if (url.pathname.toLowerCase().startsWith("/_djl/"))
      return notice("Not found", "This page does not exist.", 404);
    if (request.method !== "GET" && request.method !== "HEAD")
      return notice("Not allowed", "This site only serves pages.", 405);
    if (site.status === "disabled")
      return notice(
        "Site unavailable",
        "This site was taken down for breaking DJL's hosting rules.",
        451,
      );
    if (!site.deployId) return notice("Nothing here yet", "This site has not been published.", 404);
    if (perSite.get(site.id) > (deps.siteBytesPerDay ?? 10 * 1024 ** 3))
      return notice(
        "Site resting",
        "This site has had a lot of visitors today. Try again tomorrow.",
        503,
      );

    const target = resolve(site, url.pathname);
    if (!target) return notice("Page not found", "This page does not exist.", 404);
    const file = site.files.get(target.path)!;
    const extension = target.path.slice(target.path.lastIndexOf(".") + 1).toLowerCase();
    const isHtml = extension === "html" || extension === "htm";
    const etag = `"${file.sha256.slice(0, 32)}${isHtml ? "-b1" : ""}"`;
    const headers: Record<string, string> = {
      ...SECURITY_HEADERS,
      "content-type": CLOUD_SITE_FILE_TYPES[extension] ?? "application/octet-stream",
      "cache-control": cacheControl(target.path, isHtml),
      etag,
    };
    if (target.status === 200 && request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });

    const bytes = await deps.read(`sites/${site.id}/${site.deployId}/${target.path}`, file.size);
    if (!bytes) return notice("Page not found", "This page does not exist.", 404);
    const body = isHtml
      ? new TextEncoder().encode(injectBadge(new TextDecoder().decode(bytes)))
      : bytes;
    perSite.add(site.id, body.byteLength);
    deps.onVisit?.(site.id);
    headers["content-length"] = String(body.byteLength);
    return new Response(request.method === "HEAD" ? null : (body as Uint8Array<ArrayBuffer>), {
      status: target.status,
      headers,
    });
  };
}
