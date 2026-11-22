import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import type { AgentProductSource } from "@djl/contracts";

/** Only public unicast addresses may be contacted, including after a redirect. */
export function assertPublicAddress(address: string): void {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number) as [number, number, number, number];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
      throw new Error("Product URLs must use a public internet address.");
    return;
  }
  if (family === 6) {
    const [first = 0, second = 0] = address
      .toLowerCase()
      .split(":")
      .map((part) => parseInt(part || "0", 16));
    if (
      first >= 0x2000 &&
      first <= 0x3fff &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
      first !== 0x2002 &&
      first !== 0x3ffe &&
      first !== 0x3fff
    )
      return;
  }
  throw new Error("Product URLs must use a public internet address.");
}
export function validateProductUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443")
  )
    throw new Error("Use a public HTTP(S) URL without credentials and with a standard port.");
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    (!host.includes(".") && !isIP(host)) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)
  )
    throw new Error("Local product URLs are not allowed.");
  if (isIP(host)) assertPublicAddress(host);
  url.hash = "";
  return url;
}
/** Resolve once, validate every answer, then pin the validated address on the actual socket. */
export async function fetchPublicResource(raw: string, maxBytes = 2 * 1024 * 1024) {
  const deadline = Date.now() + 15_000;
  let url = validateProductUrl(raw);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Product request timed out.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await Promise.race([
          lookup(host, { all: true, verbatim: true }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Product DNS lookup timed out.")), remaining);
          }),
        ]).finally(() => clearTimeout(timer));
    if (!addresses.length) throw new Error("Product hostname has no public address.");
    addresses.forEach((entry) => assertPublicAddress(entry.address));
    const pinned = addresses[0]!;
    const response = await new Promise<{
      status: number;
      location: string | undefined;
      contentType: string;
      bytes: Buffer;
    }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).request(
        url,
        {
          method: "GET",
          agent: false,
          headers: {
            Accept: "text/html,application/xhtml+xml,image/*;q=0.8",
            "User-Agent": "DJL-ProductSource/1.0",
            "Accept-Encoding": "identity",
          },
          lookup: (_hostname, options, callback) => {
            if (typeof options === "object" && options.all)
              callback(null, [{ address: pinned.address, family: pinned.family }]);
            else callback(null, pinned.address, pinned.family);
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let length = 0;
          res.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > maxBytes) {
              res.destroy(new Error("Product response is too large."));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              location: res.headers.location,
              contentType: res.headers["content-type"] ?? "",
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      const timeout = setTimeout(
        () => request.destroy(new Error("Product request timed out.")),
        Math.max(1, deadline - Date.now()),
      );
      request.on("close", () => clearTimeout(timeout));
      request.on("error", reject);
      request.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirects === 4)
        throw new Error("Product URL redirects too many times.");
      url = validateProductUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300)
      throw new Error(`Product URL returned HTTP ${response.status}.`);
    return { ...response, sourceUrl: url.href };
  }
  throw new Error("Product URL redirects too many times.");
}
function decodeText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
      const basic: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&nbsp;": " ",
      };
      if (basic[entity.toLowerCase()]) return basic[entity.toLowerCase()]!;
      const code = entity.startsWith("&#x")
        ? parseInt(entity.slice(3), 16)
        : parseInt(entity.slice(2), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}
export function extractProductFacts(
  html: string,
  sourceUrl: string,
): Omit<AgentProductSource, "id"> {
  const metadata = new Map<string, string>();
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const attr of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
      attrs.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? "");
    const key = attrs.get("property") ?? attrs.get("name");
    if (key && attrs.get("content"))
      metadata.set(key.toLowerCase(), decodeText(attrs.get("content")!));
  }
  let product: Record<string, unknown> = {};
  function findProduct(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(findProduct);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (
      record["@type"] === "Product" ||
      (Array.isArray(record["@type"]) && record["@type"].includes("Product"))
    ) {
      if (!Object.keys(product).length) product = record;
    }
    if (record["@graph"]) findProduct(record["@graph"]);
  }
  for (const script of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    try {
      findProduct(JSON.parse(script[1]!));
    } catch {
      /* Invalid source metadata is not evidence. */
    }
  }
  const text = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? decodeText(String(value)) : undefined;
  const offer = (Array.isArray(product.offers) ? product.offers[0] : product.offers) as
    | Record<string, unknown>
    | undefined;
  const brand =
    product.brand && typeof product.brand === "object"
      ? (product.brand as Record<string, unknown>).name
      : product.brand;
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const imageValue =
    typeof image === "object" && image ? (image as Record<string, unknown>).url : image;
  const result: Omit<AgentProductSource, "id"> = {
    sourceUrl,
    title:
      text(product.name) ??
      metadata.get("og:title") ??
      decodeText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    description:
      text(product.description) ??
      metadata.get("og:description") ??
      metadata.get("description") ??
      "",
    retrievedAt: new Date().toISOString(),
    trust: "untrusted-source",
    facts: [],
  };
  const brandText = text(brand),
    priceText = text(offer?.price),
    currencyText = text(offer?.priceCurrency);
  if (brandText) result.brand = brandText;
  if (priceText) result.price = priceText;
  if (currencyText) result.currency = currencyText;
  const imageUrl = text(imageValue) ?? metadata.get("og:image");
  if (imageUrl) {
    try {
      result.imageUrl = validateProductUrl(new URL(imageUrl, sourceUrl).href).href;
    } catch {
      /* Unsafe image URLs are not imported. */
    }
  }
  for (const field of ["title", "description", "brand", "price", "currency", "imageUrl"] as const)
    if (result[field]) result.facts.push({ field, value: result[field]!, sourceUrl });
  return result;
}
