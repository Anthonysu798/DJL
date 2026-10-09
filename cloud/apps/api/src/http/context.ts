/**
 * Per-request context: trace id and client facts. Set by the middleware,
 * read by handlers and the audit log. Never carries secrets.
 */
import { ServiceMap } from "effect";

export interface RequestContextShape {
  readonly traceId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly region: string;
  readonly startedAt: number;
}

export class RequestContext extends ServiceMap.Service<RequestContext, RequestContextShape>()(
  "djl/api/http/RequestContext",
) {}

export function newTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Client IP from Fly/Cloudflare headers, falling back to the socket address. */
export function clientIp(
  headers: Record<string, string | undefined>,
  remoteAddress: string | null,
): string | null {
  const fly = headers["fly-client-ip"];
  if (fly) return fly.trim();
  const cf = headers["cf-connecting-ip"];
  if (cf) return cf.trim();
  const xff = headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return remoteAddress;
}
