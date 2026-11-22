// FILE: siteFaviconCache.test.ts
// Purpose: Verifies hostname normalization + parsing for the favicon cache, which
//          underpins domain-level dedup (every URL on a site shares one cache key).
// Layer: Server utility tests

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSiteFaviconCache,
  normalizeFaviconHost,
  resolveFavicon,
  tryParseHost,
} from "./siteFaviconCache";

describe("normalizeFaviconHost", () => {
  it("lower-cases the host", () => {
    expect(normalizeFaviconHost("GitHub.COM")).toBe("github.com");
  });

  it("strips a leading www.", () => {
    expect(normalizeFaviconHost("www.example.com")).toBe("example.com");
  });

  it("keeps non-www subdomains intact", () => {
    expect(normalizeFaviconHost("docs.example.com")).toBe("docs.example.com");
  });
});

describe("tryParseHost", () => {
  it("extracts the host from a full URL", () => {
    expect(tryParseHost("https://x.com/thegenioo/status/2062795593567666188")).toBe("x.com");
  });

  it("accepts a bare domain without a scheme", () => {
    expect(tryParseHost("example.com")).toBe("example.com");
  });

  it("normalizes www and casing", () => {
    expect(tryParseHost("https://WWW.Linear.app/issue/SYN-72")).toBe("linear.app");
  });

  it("returns null for unparseable input", () => {
    expect(tryParseHost("not a url!!!")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(tryParseHost("   ")).toBeNull();
  });
});

const png = () =>
  new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });

describe("resolveFavicon", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSiteFaviconCache();
  });

  it("tries again soon after a lookup that could not reach any source", async () => {
    const fetch = vi.fn<() => Promise<Response>>(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetch);
    const failed = await resolveFavicon("linear.app");
    expect(failed.bytes).toBeNull();
    // A moment offline must not hide a site's icon for the next hour.
    expect(failed.expiresAtMs - Date.now()).toBeLessThanOrEqual(15_000);

    vi.useFakeTimers({ now: Date.now() + 16_000 });
    try {
      fetch.mockImplementation(async () => png());
      expect((await resolveFavicon("linear.app")).bytes).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("remembers for an hour that a site really has no icon", async () => {
    const fetch = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const missing = await resolveFavicon("no-icon.example.com");
    expect(missing.bytes).toBeNull();
    expect(missing.expiresAtMs - Date.now()).toBeGreaterThan(59 * 60_000);
    await resolveFavicon("no-icon.example.com");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
