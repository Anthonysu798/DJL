import { describe, expect, it } from "vitest";
import { countsAsTrackingOpen, validatedTrackingTarget } from "./trackingLinks.ts";
describe("tracking link destination safety", () => {
  it("preserves an HTTPS target's campaign query and anchor without fetching it", () => {
    const url =
      "https://shop.example.com/products?utm_source=instagram&utm_medium=social&utm_campaign=launch&utm_content=photo%201&ref=summer#collection";
    expect(validatedTrackingTarget(url)).toBe(url);
    expect(validatedTrackingTarget("https://EXAMPLE.com:443")).toBe("https://example.com/");
  });
  it.each([
    "http://example.com/",
    "javascript:alert(1)",
    "//example.com/",
    "https://user:password@example.com/",
    "https://user@example.com/",
    "https://127.0.0.1/",
    "https://192.168.1.1/",
    "https://169.254.169.254/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://0x7f000001/",
    "https://2130706433/",
    "https://8.8.8.8/",
    "https://localhost/",
    "https://a.localhost/",
    "https://router.local/",
    "https://intranet.internal/",
    "https://printer.lan/",
    "https://private/",
    "https://example.com:8443/",
    " https://example.com/",
    "https://example.com/\n",
    "https://example.com/%0d%0aLocation:evil",
    "https://example.com/%250a",
    "https://example.com/%25250a",
    "https://example.com/?access_token=private",
    "https://example.com/?api-key=private",
    "https://example.com/?oauth_token=private",
    "https://example.com/#id_token=private",
    "https://example.com/?client_secret=private",
    "https://example.com/?code=private",
    "https://example.com/?session_id=private",
    "https://example.com/?X-Amz-Signature=private",
    "https://example.com/?auth%5Ftoken=private",
    "https://example.com/?redirect=https%3A%2F%2Fexample.com%2F%3Ftoken%3Dprivate",
    "https://example.com/sk-notARealKey1234567890",
  ])("rejects unsafe or credential-bearing destination %s", (url) => {
    expect(validatedTrackingTarget(url)).toBeNull();
  });
});
describe("tracking open semantics", () => {
  it("counts a normal GET but not HEAD or explicit prefetch/prerender hints", () => {
    expect(countsAsTrackingOpen("GET", {})).toBe(true);
    expect(countsAsTrackingOpen("HEAD", {})).toBe(false);
    for (const header of ["purpose", "sec-purpose", "x-purpose", "x-moz"])
      for (const hint of ["prefetch", "Prerender", "preview", "prefetch;prerender"])
        expect(countsAsTrackingOpen("GET", { [header]: hint })).toBe(false);
    expect(countsAsTrackingOpen("GET", { "user-agent": "unlabelled bot" })).toBe(true);
  });
});
