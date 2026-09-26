import { describe, expect, it } from "vitest";

import { isBlockedAddress, safeFetch, type Transport, type TransportRequest } from "./safeFetch.ts";

const PUBLIC_IP = "93.184.216.34";

function body(text: string | Uint8Array): AsyncIterable<Uint8Array> {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  return (async function* () {
    yield bytes;
  })();
}

/** A transport that records what it was asked to connect to and answers from a table. */
function fakeTransport(
  answer: (req: TransportRequest) => {
    status?: number;
    headers?: Record<string, string>;
    body?: string | Uint8Array | AsyncIterable<Uint8Array>;
  },
) {
  const calls: TransportRequest[] = [];
  const transport: Transport = async (req) => {
    calls.push(req);
    const a = answer(req);
    return {
      status: a.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...a.headers },
      body:
        a.body === undefined
          ? body("<p>ok</p>")
          : typeof a.body === "string" || a.body instanceof Uint8Array
            ? body(a.body)
            : a.body,
    };
  };
  return { transport, calls };
}

/** A server that never answers; only the abort ends the request. */
const neverAnswers: Transport = (req) =>
  new Promise((_resolve, reject) =>
    req.signal.addEventListener("abort", () => reject(req.signal.reason)),
  );

const resolveTo =
  (table: Record<string, readonly string[]>) =>
  async (host: string): Promise<readonly string[]> =>
    table[host] ?? [];

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fdaa:0:1::3", // Fly 6PN
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe", // 169.254.169.254 mapped, hex form
    "64:ff9b::a9fe:a9fe", // NAT64 to the metadata IP
    "ff02::1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each([PUBLIC_IP, "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe("safeFetch", () => {
  it("fetches an https page through the resolved, pinned address", async () => {
    const { transport, calls } = fakeTransport(() => ({ body: "<p>hello</p>" }));
    const res = await safeFetch("https://example.com/a?b=1", {
      resolve: resolveTo({ "example.com": [PUBLIC_IP] }),
      transport,
    });
    expect(res).toMatchObject({ status: 200, url: "https://example.com/a?b=1" });
    expect(new TextDecoder().decode(res.body)).toBe("<p>hello</p>");
    expect(calls[0]!.address).toBe(PUBLIC_IP);
    expect(calls[0]!.url.hostname).toBe("example.com");
  });

  it.each([
    "http://example.com/",
    "ftp://example.com/",
    "https://user:pw@example.com/",
    "https://example.com:8443/",
    "file:///etc/passwd",
  ])("refuses %s before resolving anything", async (url) => {
    const { transport, calls } = fakeTransport(() => ({}));
    await expect(
      safeFetch(url, { resolve: resolveTo({ "example.com": [PUBLIC_IP] }), transport }),
    ).rejects.toMatchObject({ code: "blocked_url" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["the metadata IP", "169.254.169.254"],
    ["a private range", "10.0.0.8"],
    ["loopback", "127.0.0.1"],
    ["Fly 6PN", "fdaa::2"],
  ])("refuses a host that resolves to %s", async (_label, ip) => {
    const { transport, calls } = fakeTransport(() => ({}));
    await expect(
      safeFetch("https://internal.example/", {
        resolve: resolveTo({ "internal.example": [ip] }),
        transport,
      }),
    ).rejects.toMatchObject({ code: "blocked_address" });
    expect(calls).toHaveLength(0);
  });

  it("refuses when any resolved address is private (mixed answers)", async () => {
    const { transport } = fakeTransport(() => ({}));
    await expect(
      safeFetch("https://mixed.example/", {
        resolve: resolveTo({ "mixed.example": [PUBLIC_IP, "192.168.0.10"] }),
        transport,
      }),
    ).rejects.toMatchObject({ code: "blocked_address" });
  });

  it("refuses IP-literal URLs in blocked ranges", async () => {
    const { transport } = fakeTransport(() => ({}));
    await expect(
      safeFetch("https://169.254.169.254/latest/meta-data", { transport }),
    ).rejects.toMatchObject({ code: "blocked_address" });
    await expect(safeFetch("https://[::1]/", { transport })).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("resolves once per hop and connects to that address (no DNS rebinding window)", async () => {
    let lookups = 0;
    // A rebinding resolver: public on the first answer, metadata IP on every later one.
    const resolve = async () => (lookups++ === 0 ? [PUBLIC_IP] : ["169.254.169.254"]);
    const { transport, calls } = fakeTransport(() => ({ body: "fine" }));
    const res = await safeFetch("https://rebind.example/", { resolve, transport });
    expect(res.status).toBe(200);
    expect(lookups).toBe(1);
    expect(calls.map((c) => c.address)).toEqual([PUBLIC_IP]);
  });

  it("re-validates every redirect and refuses one that lands on a private address", async () => {
    const { transport, calls } = fakeTransport((req) =>
      req.url.hostname === "public.example"
        ? { status: 302, headers: { location: "https://evil.example/latest/meta-data" } }
        : {},
    );
    await expect(
      safeFetch("https://public.example/", {
        resolve: resolveTo({ "public.example": [PUBLIC_IP], "evil.example": ["169.254.169.254"] }),
        transport,
      }),
    ).rejects.toMatchObject({ code: "blocked_address" });
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect to plain http", async () => {
    const { transport } = fakeTransport(() => ({
      status: 301,
      headers: { location: "http://example.com/" },
    }));
    await expect(
      safeFetch("https://example.com/", {
        resolve: resolveTo({ "example.com": [PUBLIC_IP] }),
        transport,
      }),
    ).rejects.toMatchObject({ code: "blocked_url" });
  });

  it("follows at most three redirects", async () => {
    let n = 0;
    const { transport } = fakeTransport(() => ({
      status: 302,
      headers: { location: `/hop-${++n}` },
    }));
    await expect(
      safeFetch("https://example.com/", {
        resolve: resolveTo({ "example.com": [PUBLIC_IP] }),
        transport,
      }),
    ).rejects.toMatchObject({ code: "too_many_redirects" });
    expect(n).toBe(4);
  });

  it("stops reading past the size cap", async () => {
    const big = (async function* () {
      for (let i = 0; i < 10; i += 1) yield new Uint8Array(512 * 1024);
    })();
    const { transport } = fakeTransport(() => ({ body: big }));
    await expect(
      safeFetch("https://example.com/", {
        resolve: resolveTo({ "example.com": [PUBLIC_IP] }),
        transport,
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuses a declared content-length over the cap without reading", async () => {
    const { transport } = fakeTransport(() => ({
      headers: { "content-length": String(3 * 1024 * 1024) },
    }));
    await expect(
      safeFetch("https://example.com/", {
        resolve: resolveTo({ "example.com": [PUBLIC_IP] }),
        transport,
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuses content types outside the allowlist", async () => {
    const { transport } = fakeTransport(() => ({
      headers: { "content-type": "application/octet-stream" },
    }));
    await expect(
      safeFetch("https://example.com/", {
        resolve: resolveTo({ "example.com": [PUBLIC_IP] }),
        transport,
      }),
    ).rejects.toMatchObject({ code: "bad_content_type" });
    const images = await safeFetch("https://example.com/", {
      resolve: resolveTo({ "example.com": [PUBLIC_IP] }),
      transport: fakeTransport(() => ({ headers: { "content-type": "image/png" } })).transport,
      contentTypes: ["image/png"],
    });
    expect(images.contentType).toBe("image/png");
  });

  it("times out a slow server", async () => {
    await expect(
      safeFetch("https://example.com/", {
        resolve: resolveTo({ "example.com": [PUBLIC_IP] }),
        transport: neverAnswers,
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
