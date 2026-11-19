import { afterEach, expect, it, vi } from "vitest";
import { GET, HEAD } from "./route";
const slug = "a".repeat(22);
const context = () => ({ params: Promise.resolve({ slug }) });
const target = "https://example.com/offer?utm_source=instagram&utm_campaign=synthetic";
afterEach(() => vi.unstubAllGlobals());
it("redirects only to the fixed API target without fetching it or forwarding auth, cookies, or query overrides", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 302, headers: { location: target } }));
  vi.stubGlobal("fetch", fetcher);
  const request = new Request(`https://app.example.com/l/${slug}?url=https://evil.example.com/`, {
    headers: {
      cookie: "synthetic=not-forwarded",
      authorization: "Bearer synthetic-not-forwarded",
      purpose: "prefetch",
      "user-agent": "not-forwarded",
    },
  });
  const response = await GET(request, context());
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(target);
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toMatch(new RegExp(`/v1/social/tracking-links/${slug}/open$`));
  const init = fetcher.mock.calls[0]![1];
  expect(init).toMatchObject({
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  expect([...init.headers.entries()]).toEqual([["purpose", "prefetch"]]);
});
it("forwards HEAD as HEAD so preview probes do not increment opens", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 302, headers: { location: target } }));
  vi.stubGlobal("fetch", fetcher);
  const response = await HEAD(
    new Request(`https://app.example.com/l/${slug}`, { method: "HEAD" }),
    context(),
  );
  expect(response.status).toBe(302);
  expect(fetcher.mock.calls[0]![1].method).toBe("HEAD");
  expect(await response.text()).toBe("");
});
it.each([
  "javascript:alert(1)",
  "https://127.0.0.1/",
  "https://example.com/?access_token=synthetic",
])("does not forward an unsafe upstream Location %s", async (location) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } })),
  );
  const response = await GET(new Request(`https://app.example.com/l/${slug}`), context());
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
});
it("preserves unavailable and throttled states without caching or disclosing API response bodies", async () => {
  for (const status of [404, 429]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not forwarded", { status })));
    const response = await GET(new Request(`https://app.example.com/l/${slug}`), context());
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
});
it("refuses invalid slugs without making API requests", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const response = await GET(new Request("https://app.example.com/l/malformed"), {
    params: Promise.resolve({ slug: "malformed" }),
  });
  expect(response.status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});
