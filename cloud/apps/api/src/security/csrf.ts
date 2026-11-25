/**
 * CSRF defense for cookie-authenticated mutations on DJL's own routes.
 *
 * A mutating `/v1/*` Better Auth cookie request or `/admin/v1/commerce/*` admin
 * cookie request with no `Authorization` header must (1) come from a trusted Origin
 * and (2) repeat the `djl_csrf` cookie in the `x-csrf-token` header (double submit). The web app
 * reads the token from GET /v1/csrf. Bearer clients (desktop, iOS, admin) are
 * exempt because a browser never attaches their credential on its own.
 * Better Auth's `/v1/auth/*` endpoints run their own origin check.
 *
 * Every mutating `/admin/v1/*` request that carries the admin cookie must come from
 * the admin origin itself: no other DJL origin, however trusted, may act as an admin.
 * Sign-in and invite acceptance are exempt: they prove themselves in the body and
 * never read the cookie.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { CLOUD_CSRF_COOKIE, CLOUD_CSRF_HEADER } from "@djl/contracts/cloud";

export const CSRF_COOKIE = CLOUD_CSRF_COOKIE;
export const CSRF_HEADER = CLOUD_CSRF_HEADER;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?djl\.session_token=/;
const ADMIN_COOKIE = /(?:^|;\s*)djl_admin=/;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const ADMIN_PUBLIC_PATHS = new Set([
  "/admin/v1/auth/login",
  "/admin/v1/auth/invite/inspect",
  "/admin/v1/auth/invite/accept",
]);

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

/** The caller's current token when it is well formed, else a fresh one. */
export function csrfTokenFor(cookieHeader: string | undefined): string {
  const existing = readCookie(cookieHeader, CSRF_COOKIE);
  return existing && TOKEN_SHAPE.test(existing) ? existing : randomBytes(32).toString("base64url");
}

export function csrfCookie(token: string, secure: boolean): string {
  return `${CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export interface CsrfRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

/** Returns the refusal code, or null when the request may proceed. */
export function csrfRefusal(
  request: CsrfRequest,
  trustedOrigins: ReadonlySet<string>,
  adminOrigin?: string,
): "csrf_origin" | "csrf_token" | null {
  if (SAFE_METHODS.has(request.method)) return null;
  // The isolated commerce callback authenticates the bounded raw body with its own Stripe signature.
  if (request.method === "POST" && request.path === "/v1/commerce/webhooks/stripe-test")
    return null;
  if (ADMIN_PUBLIC_PATHS.has(request.path)) return null;
  const admin = request.path.startsWith("/admin/v1/");
  if (!admin && (!request.path.startsWith("/v1/") || request.path.startsWith("/v1/auth/")))
    return null;
  if (request.headers["authorization"]) return null;
  const cookies = request.headers["cookie"];
  if (!cookies || !(admin ? ADMIN_COOKIE : SESSION_COOKIE).test(cookies)) return null;

  const origin = request.headers["origin"];
  if (!origin || !(admin ? origin === adminOrigin : trustedOrigins.has(origin)))
    return "csrf_origin";
  if (admin && !request.path.startsWith("/admin/v1/commerce/")) return null;
  const expected = readCookie(cookies, CSRF_COOKIE);
  const presented = request.headers[CSRF_HEADER];
  if (!expected || !presented || !TOKEN_SHAPE.test(expected)) return "csrf_token";
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b) ? null : "csrf_token";
}
