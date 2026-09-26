/**
 * The only way agent code may fetch an arbitrary URL. SSRF rules:
 *   - https on port 443 only, no credentials in the URL;
 *   - the host is resolved once per hop and every answer must be public
 *     (no loopback, private, CGNAT, link-local, metadata, multicast, ULA /
 *     Fly 6PN, or v4-in-v6 forms of those);
 *   - the connection goes to that resolved address (pinned), so a second DNS
 *     answer cannot rebind the request to an internal host;
 *   - each redirect is re-validated the same way, at most three;
 *   - 2 MB and 10 s caps and a content-type allowlist.
 */
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";

export const SAFE_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
export const TEXT_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;

export type SafeFetchErrorCode =
  | "blocked_url"
  | "blocked_address"
  | "dns_failed"
  | "too_many_redirects"
  | "too_large"
  | "bad_content_type"
  | "http_error"
  | "timeout";

export class SafeFetchError extends Error {
  readonly _tag = "SafeFetchError";
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface TransportRequest {
  readonly url: URL;
  /** The validated address to connect to; the Host header and TLS name stay `url.hostname`. */
  readonly address: string;
  readonly signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface SafeFetchOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** Allowed media types (parameters ignored). Defaults to text formats. */
  readonly contentTypes?: readonly string[];
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  readonly transport?: Transport;
}

export interface SafeResponse {
  /** The final URL after redirects. */
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}

// ---- address rules ---------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function ipv6ToBigInt(ip: string): bigint {
  let text = ip;
  // Embedded dotted IPv4 tail (::ffff:10.0.0.1) becomes two hex groups.
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[1]!);
    text = `${text.slice(0, -dotted[1]!.length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"),
          ...tailGroups,
        ];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(Number.parseInt(g || "0", 16)), 0n);
}

const V4_BLOCKED: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

const V6_BLOCKED: readonly (readonly [string, number])[] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local, includes Fly 6PN fdaa::/16
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

function inV4(ip: number, [base, bits]: readonly [string, number]): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
}

function inV6(ip: bigint, [base, bits]: readonly [string, number]): boolean {
  const shift = BigInt(128 - bits);
  return ip >> shift === ipv6ToBigInt(base) >> shift;
}

/** True unless `ip` is a well-formed public unicast address. */
export function isBlockedAddress(ip: string): boolean {
  const address = ip.replace(/^\[|\]$/g, "").split("%")[0]!;
  const family = isIP(address);
  if (family === 4) {
    const n = ipv4ToInt(address);
    return V4_BLOCKED.some((range) => inV4(n, range));
  }
  if (family !== 6) return true;
  const n = ipv6ToBigInt(address.toLowerCase());
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4 address.
  if (n >> 32n === 0xffffn || n >> 32n === 0n) {
    if (n <= 1n) return true;
    return isBlockedAddress([24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 0xffn)).join("."));
  }
  return V6_BLOCKED.some((range) => inV6(n, range));
}

// ---- fetch -----------------------------------------------------------------

function checkUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("blocked_url", "Not a valid URL.");
  }
  if (url.protocol !== "https:")
    throw new SafeFetchError("blocked_url", "Only https URLs are allowed.");
  if (url.username || url.password)
    throw new SafeFetchError("blocked_url", "URLs with credentials are not allowed.");
  if (url.port && url.port !== "443")
    throw new SafeFetchError("blocked_url", "Only the default https port is allowed.");
  return url;
}

async function systemResolve(host: string): Promise<readonly string[]> {
  const answers = await lookup(host, { all: true, verbatim: true });
  return answers.map((a) => a.address);
}

/** One validated address for `url`'s host; every answer must be public. */
async function pinAddress(
  url: URL,
  resolve: (host: string) => Promise<readonly string[]>,
): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: readonly string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new SafeFetchError("dns_failed", "The host could not be resolved.");
    }
  }
  if (addresses.length === 0) throw new SafeFetchError("dns_failed", "The host has no address.");
  if (addresses.some(isBlockedAddress))
    throw new SafeFetchError("blocked_address", "That host is not reachable from here.");
  return addresses[0]!;
}

export async function safeFetch(
  raw: string | URL,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const resolve = options.resolve ?? systemResolve;
  const transport = options.transport ?? httpsTransport;
  const maxBytes = options.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  const allowed = options.contentTypes ?? TEXT_CONTENT_TYPES;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  try {
    let url = checkUrl(raw);
    for (let hop = 0; ; hop += 1) {
      const address = await pinAddress(url, resolve);
      const response = await transport({ url, address, signal });
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
        void response.body[Symbol.asyncIterator]().return?.(); // free the connection
        if (hop >= MAX_REDIRECTS)
          throw new SafeFetchError("too_many_redirects", "Too many redirects.");
        url = checkUrl(new URL(response.headers.location, url));
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        void response.body[Symbol.asyncIterator]().return?.();
        throw new SafeFetchError("http_error", `The server answered ${response.status}.`);
      }
      const contentType = (response.headers["content-type"] ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      if (!allowed.includes(contentType))
        throw new SafeFetchError(
          "bad_content_type",
          `Content type ${contentType || "(none)"} is not allowed.`,
        );
      if (Number(response.headers["content-length"] ?? "0") > maxBytes)
        throw new SafeFetchError("too_large", "The response is too large.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new SafeFetchError("too_large", "The response is too large.");
        chunks.push(chunk);
      }
      return {
        url: url.toString(),
        status: response.status,
        contentType,
        body: Buffer.concat(chunks),
      };
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (timeout.aborted) throw new SafeFetchError("timeout", "The request timed out.");
    throw new SafeFetchError("http_error", "The request failed.");
  }
}

/** node:https with DNS replaced by the pinned address; SNI and Host stay the URL's host name. */
const httpsTransport: Transport = ({ url, address, signal }) =>
  new Promise((resolve, reject) => {
    const family = isIP(address) as 4 | 6;
    const request = https.request(
      {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "user-agent": "DJL-Agent/1.0", accept: "text/html,text/plain,*/*;q=0.5" },
        signal,
        lookup: (_host, opts, callback) => {
          // Both callback shapes, whichever the runtime asks for.
          if ((opts as { all?: boolean }).all)
            (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [
              { address, family },
            ]);
          else callback(null, address, family);
        },
      },
      (response) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers))
          if (typeof value === "string") headers[key] = value;
        resolve({ status: response.statusCode ?? 0, headers, body: response });
      },
    );
    request.on("error", reject);
    request.end();
  });
