/** Isolated buyer session pilot. No production cutover or generic auth fallback. */
import { AsyncLocalStorage } from "node:async_hooks";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { schema, type DjlDatabase } from "@djl/db";
import { and, eq, sql } from "drizzle-orm";
import type { Redis } from "ioredis";

import type { ApiEnv } from "../config/env.ts";
import { createRedisThrottle } from "../security/throttle.ts";
import type { AuthNotifier } from "./auth.ts";
import { hashPassword, verifyPassword } from "./password.ts";

const basePath = "/v1/shop/auth";
const cookiePrefix = "djl_shop";
const maxWriteBytes = 16 * 1024;
const cookieKinds = [
  "session_token",
  "two_factor",
  "dont_remember",
  "session_data",
  "trust_device",
  "account_data",
] as const;
const factorRoutes = new Set([
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);
const authErrors = new Set([
  "INVALID_EMAIL_OR_PASSWORD",
  "EMAIL_NOT_VERIFIED",
  "INVALID_CODE",
  "INVALID_BACKUP_CODE",
  "INVALID_TWO_FACTOR_COOKIE",
  "OTP_HAS_EXPIRED",
  "TOTP_NOT_ENABLED",
  "BACKUP_CODES_NOT_ENABLED",
  "ACCOUNT_TEMPORARILY_LOCKED",
  "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
  "COMMERCE_BUYER_UNAVAILABLE",
]);

export type CommerceBuyer = {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: true;
  readonly sessionId: string;
};
type BuyerIdentity = Omit<CommerceBuyer, "sessionId">;
type AuthSnapshot = { readonly userId: string; readonly generation: number };
type AuthAttempt = { snapshot: AuthSnapshot | null };
const generationField = { type: "number", required: false, input: false, returned: false } as const;

// Better Auth 1.7.x writes the signed challenge and a separate attempt counter.
const challengeIdentifier = /^2fa-[A-Za-z0-9_-]{20}$/;

function invalidChallenge() {
  return new APIError("UNAUTHORIZED", {
    code: "INVALID_TWO_FACTOR_COOKIE",
    message: "Commerce challenge is not valid.",
  });
}

function unavailableBuyer() {
  return new APIError("FORBIDDEN", {
    code: "COMMERCE_BUYER_UNAVAILABLE",
    message: "Buyer is not eligible.",
  });
}

function testOrigin(value: string) {
  const url = URL.parse(value);
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    value !== url.origin
  )
    throw new Error("Commerce authentication pilot requires canonical loopback origins.");
  return url;
}

export function requireCommerceAuthTestEnv(env: ApiEnv) {
  if (env.env !== "test" || !env.mockExternals)
    throw new Error("Commerce authentication pilot requires mocked test mode.");
  const api = testOrigin(env.apiPublicUrl);
  const shop = testOrigin(env.webPublicUrl);
  const secureCookies = api.protocol === "https:";
  if (api.protocol !== shop.protocol || (secureCookies && api.hostname !== shop.hostname))
    throw new Error("Commerce authentication pilot requires matched loopback origins.");
  const apiOrigin = api.origin;
  const shopOrigin = shop.origin;
  if (!env.trustedOrigins.includes(shopOrigin))
    throw new Error("Commerce authentication pilot requires a trusted shop origin.");
  const database = URL.parse(env.databaseUrl);
  const redis = URL.parse(env.redisUrl);
  if (
    !database ||
    !redis ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    redis.protocol !== "redis:" ||
    [database, redis].some(
      (url) => !["localhost", "127.0.0.1"].includes(url.hostname) || url.search || url.hash,
    )
  )
    throw new Error("Commerce authentication pilot requires loopback PostgreSQL and Redis.");
  return { apiOrigin, shopOrigin, secureCookies };
}

function shopHeaders(input: Headers, requestCookies: ReadonlySet<string>) {
  if (input.has("authorization") || input.has("x-org-id")) return null;
  const headers = new Headers(input);
  const cookies = new Map<string, string>();
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const pair = part.trim();
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    if (!requestCookies.has(name)) continue;
    if (separator !== name.length || cookies.has(name)) return null;
    cookies.set(name, pair.slice(separator + 1));
  }
  headers.delete("cookie");
  if (cookies.size)
    headers.set("cookie", [...cookies].map(([name, value]) => name + "=" + value).join("; "));
  return { headers, cookies };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function reply(body: unknown, status = 200, headers = new Headers()) {
  headers.set("cache-control", "no-store");
  return Response.json(body, { status, headers });
}
function refusal(status: number, code: string) {
  return reply({ error: { code, message: "Commerce authentication could not complete." } }, status);
}

async function writeBody(
  request: Request,
  emptyAllowed: boolean,
): Promise<Record<string, unknown> | Response> {
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) return refusal(400, "bad_request");
  if (length !== null && Number(length) > maxWriteBytes) return refusal(413, "payload_too_large");
  const encoding = request.headers.get("content-encoding");
  const media = request.headers.get("content-type");
  if (
    (encoding !== null && encoding.toLowerCase() !== "identity") ||
    (media !== null &&
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(media))
  )
    return refusal(415, "unsupported_media_type");

  const reader = request.body?.getReader();
  const bytes = new Uint8Array(maxWriteBytes);
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value.byteLength > maxWriteBytes - size) {
          // Bun cancels the HTTP socket if its Request body reader is canceled.
          // Stop reading here and let the HTTP transport finish sending the 413.
          return refusal(413, "payload_too_large");
        }
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
    } catch {
      return refusal(400, "bad_request");
    } finally {
      reader.releaseLock();
    }
  }
  if (!size) return emptyAllowed ? {} : refusal(400, "bad_request");
  if (media === null) return refusal(415, "unsupported_media_type");
  try {
    const body = record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))),
    );
    return body && (!emptyAllowed || Object.keys(body).length === 0)
      ? body
      : refusal(400, "bad_request");
  } catch {
    return refusal(400, "bad_request");
  }
}

function cookieAttributes(parts: string[]) {
  const attributes = new Map<string, string | null>();
  for (const part of parts) {
    const [key, ...value] = part.trim().split("=");
    const name = key?.trim().toLowerCase();
    if (!name || attributes.has(name)) return null;
    attributes.set(name, value.length ? value.join("=").trim() : null);
  }
  return attributes;
}

export function createCommerceAuth(input: {
  readonly env: ApiEnv;
  readonly db: DjlDatabase;
  readonly redis: Redis;
  readonly notifier: Pick<AuthNotifier, "sendTwoFactorOtp">;
}) {
  const { env, db, redis, notifier } = input;
  const { apiOrigin, shopOrigin, secureCookies } = requireCommerceAuthTestEnv(env);
  const cookieName = (kind: (typeof cookieKinds)[number]) =>
    `${secureCookies ? "__Host-" : ""}${cookiePrefix}.${kind}`;
  const sessionCookie = cookieName("session_token");
  const challengeCookie = cookieName("two_factor");
  const requestCookies = new Set([sessionCookie, challengeCookie, cookieName("dont_remember")]);
  // Cached credentials and trusted-device login are disabled. Only the stock
  // session_data cleanup cookie is forwarded alongside the three request kinds.
  const sessionDataCookie = cookieName("session_data");
  const responseCookies = new Set([...requestCookies, sessionDataCookie]);
  const attemptContext = new AsyncLocalStorage<AuthAttempt>();
  const {
    user,
    commerceAuthSession: sessionTable,
    commerceAuthVerification: verification,
  } = schema;
  const active = and(eq(user.emailVerified, true), sql`${user.banned} IS NOT TRUE`);

  function authReply(
    body: unknown,
    upstream: Response,
    expected?: { readonly name: string; readonly clear?: boolean },
  ) {
    const headers = new Headers();
    const names = new Set<string>();
    let expectedFound = !expected;
    for (const cookie of upstream.headers.getSetCookie()) {
      const [pair, ...parts] = cookie.split(";");
      const separator = pair?.indexOf("=") ?? -1;
      if (separator < 1 || !pair) continue;
      const name = pair.slice(0, separator);
      if (!responseCookies.has(name)) continue;
      const attributes = cookieAttributes(parts);
      const value = pair.slice(separator + 1);
      const clear = !value && attributes?.get("max-age") === "0";
      if (
        names.has(name) ||
        !attributes ||
        attributes.get("path") !== "/" ||
        attributes.has("domain") ||
        attributes.get("httponly") !== null ||
        (secureCookies ? attributes.get("secure") !== null : attributes.has("secure")) ||
        (name === sessionDataCookie && !clear)
      )
        return refusal(503, "commerce_auth_failed");
      names.add(name);
      if (
        expected?.name === name &&
        (expected.clear ? clear : value && attributes.get("max-age") !== "0")
      )
        expectedFound = true;
      headers.append("set-cookie", cookie);
    }
    return expectedFound ? reply(body, 200, headers) : refusal(503, "commerce_auth_failed");
  }

  async function activeUser(snapshot: AuthSnapshot): Promise<BuyerIdentity | null> {
    const match = await db.query.user.findFirst({
      columns: { id: true, email: true },
      where: and(
        active,
        eq(user.id, snapshot.userId),
        eq(user.commerceAuthGeneration, snapshot.generation),
      ),
    });
    return match ? { ...match, emailVerified: true } : null;
  }

  const auth = betterAuth({
    appName: "DJL Shop TEST",
    baseURL: apiOrigin,
    basePath,
    // Shared encrypted TOTP/backup credentials need the same crypto; raw
    // sessions and temporary challenges are looked up in separate tables.
    secret: env.betterAuthSecret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    trustedOrigins: [shopOrigin],
    logger: { disabled: true },
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: {
      modelName: "commerceAuthSession",
      expiresIn: 8 * 60 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      additionalFields: { authGeneration: generationField },
    },
    verification: {
      modelName: "commerceAuthVerification",
      additionalFields: { authGeneration: generationField },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customStorage: createRedisThrottle(redis, "auth:rl"),
      customRules: { "/sign-in/email": { window: 60, max: 10 } },
    },
    advanced: {
      // Better Auth prepends __Secure- even to explicit names when this is true.
      // Suppress that naming rule; the HTTPS pilot still sets real Secure attrs.
      useSecureCookies: false,
      cookiePrefix,
      ...(secureCookies
        ? {
            defaultCookieAttributes: { secure: true, path: "/", httpOnly: true },
            cookies: Object.fromEntries(
              cookieKinds.map((kind) => [kind, { name: cookieName(kind) }]),
            ),
          }
        : {}),
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["fly-client-ip", "cf-connecting-ip", "x-forwarded-for"] },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const attempt = attemptContext.getStore();
        if (ctx.path === "/sign-in/email") {
          // Run behind the auth router's rate limiter, before password validation.
          const email = record(ctx.body)?.email;
          if (!attempt || typeof email !== "string") return;
          const existing = await db.query.user.findFirst({
            columns: { id: true, commerceAuthGeneration: true },
            where: eq(user.email, email.toLowerCase()),
          });
          if (existing)
            attempt.snapshot = { userId: existing.id, generation: existing.commerceAuthGeneration };
          return;
        }
        if (!ctx.path || !factorRoutes.has(ctx.path)) return;
        const identifier = await ctx.getSignedCookie(challengeCookie, ctx.context.secret);
        if (!attempt || !identifier || !challengeIdentifier.test(identifier))
          throw invalidChallenge();
        const [snapshot] = await db
          .select({ userId: user.id, generation: user.commerceAuthGeneration })
          .from(verification)
          .innerJoin(user, eq(verification.value, sql`${user.id}::text`))
          .where(
            and(
              active,
              eq(verification.identifier, identifier),
              eq(verification.authGeneration, user.commerceAuthGeneration),
            ),
          )
          .limit(1);
        if (!snapshot) throw invalidChallenge();
        attempt.snapshot = snapshot;
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (candidate) => {
            const snapshot = attemptContext.getStore()?.snapshot;
            if (!snapshot || snapshot.userId !== candidate.userId || !(await activeUser(snapshot)))
              throw unavailableBuyer();
            // Use the generation at authorization start, never the latest one.
            // A concurrent invalidation still wins if it commits after this check.
            return { data: { authGeneration: snapshot.generation } };
          },
        },
      },
      verification: {
        create: {
          before: async (candidate) => {
            if (!challengeIdentifier.test(candidate.identifier)) return;
            const snapshot = attemptContext.getStore()?.snapshot;
            if (!snapshot || snapshot.userId !== candidate.value) throw invalidChallenge();
            return { data: { authGeneration: snapshot.generation } };
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: "DJL Cloud",
        otpOptions: {
          sendOTP: async ({ user, otp }) => notifier.sendTwoFactorOtp({ email: user.email, otp }),
        },
      }),
    ],
  });

  async function buyer(input: Headers): Promise<CommerceBuyer | null> {
    const scoped = shopHeaders(input, requestCookies);
    const origin = input.get("origin");
    if (!scoped?.cookies.get(sessionCookie) || (origin !== null && origin !== shopOrigin))
      return null;
    const session = await auth.api.getSession({ headers: scoped.headers });
    if (!session) return null;
    const [match] = await db
      .select({ id: user.id, email: user.email })
      .from(sessionTable)
      .innerJoin(user, eq(sessionTable.userId, user.id))
      .where(
        and(
          active,
          eq(sessionTable.id, session.session.id),
          eq(sessionTable.userId, session.user.id),
          eq(sessionTable.authGeneration, user.commerceAuthGeneration),
        ),
      )
      .limit(1);
    return match ? { ...match, emailVerified: true, sessionId: session.session.id } : null;
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname.startsWith(basePath + "/")
      ? url.pathname.slice(basePath.length)
      : "";
    const isRead = request.method === "GET" && route === "/get-session";
    const isWrite =
      request.method === "POST" &&
      (route === "/sign-in/email" || route === "/sign-out" || factorRoutes.has(route));
    if (!isRead && !isWrite) return refusal(404, "not_found");

    const scoped = shopHeaders(request.headers, requestCookies);
    if (!scoped) return refusal(401, "commerce_credentials_required");
    const origin = request.headers.get("origin");
    if ((isWrite || origin !== null) && origin !== shopOrigin)
      return refusal(403, "commerce_origin");

    if (isRead) {
      const current = await buyer(scoped.headers);
      if (!current) return reply(null);
      const { sessionId, ...user } = current;
      return reply({ user, session: { id: sessionId } });
    }

    const emptyAllowed = route === "/sign-out" || route === "/two-factor/send-otp";
    const body = await writeBody(request, emptyAllowed);
    if (body instanceof Response) return body;

    if (
      factorRoutes.has(route) &&
      (!scoped.cookies.get(challengeCookie) || scoped.cookies.get(sessionCookie))
    )
      return refusal(401, "INVALID_TWO_FACTOR_COOKIE");

    let payload: Record<string, unknown> = {};
    const attempt: AuthAttempt = { snapshot: null };
    if (!emptyAllowed) {
      if (route === "/sign-in/email") {
        if (
          typeof body.email !== "string" ||
          typeof body.password !== "string" ||
          ("rememberMe" in body && typeof body.rememberMe !== "boolean")
        )
          return refusal(400, "bad_request");
        payload = { email: body.email, password: body.password };
        if (typeof body.rememberMe === "boolean") payload.rememberMe = body.rememberMe;
      } else {
        if (typeof body.code !== "string") return refusal(400, "bad_request");
        payload = { code: body.code }; // no trusted device or disabled-session overrides
      }
    }
    scoped.headers.delete("content-length");
    scoped.headers.delete("content-encoding");
    scoped.headers.delete("transfer-encoding");
    scoped.headers.set("content-type", "application/json");
    const upstream = await attemptContext.run(attempt, () =>
      auth.handler(
        new Request(new URL(basePath + route, apiOrigin), {
          method: "POST",
          headers: scoped.headers,
          body: JSON.stringify(payload),
        }),
      ),
    );
    const result = record(await upstream.json().catch(() => null));
    if (!upstream.ok) {
      const code = result?.code;
      const known = typeof code === "string" && authErrors.has(code);
      const status = [400, 401, 403, 429].includes(upstream.status) ? upstream.status : 503;
      return refusal(status, known ? code : "commerce_auth_failed");
    }
    if (route === "/sign-out") {
      // Stock sign-out may report success after a storage error; confirm the
      // presented session was actually removed before reporting success.
      if (await auth.api.getSession({ headers: scoped.headers }))
        return refusal(503, "commerce_auth_failed");
      return authReply({ success: true }, upstream, { name: sessionCookie, clear: true });
    }
    const current = attempt.snapshot ? await activeUser(attempt.snapshot) : null;
    if (!current)
      return refusal(
        401,
        route === "/sign-in/email" ? "INVALID_EMAIL_OR_PASSWORD" : "INVALID_TWO_FACTOR_COOKIE",
      );
    if (route === "/two-factor/send-otp")
      return result?.status === true
        ? authReply({ status: true }, upstream)
        : refusal(503, "commerce_auth_failed");
    if (route === "/sign-in/email" && result?.twoFactorRedirect === true) {
      const methods: unknown = result.twoFactorMethods;
      const recognized = Array.isArray(methods)
        ? methods.filter((method) => method === "totp" || method === "otp")
        : [];
      return recognized.length
        ? authReply({ twoFactorRedirect: true, twoFactorMethods: recognized }, upstream, {
            name: challengeCookie,
          })
        : refusal(503, "commerce_auth_failed");
    }

    return record(result?.user)?.id === current.id
      ? authReply({ user: current }, upstream, { name: sessionCookie })
      : refusal(503, "commerce_auth_failed");
  }

  return { handle, buyer, secureCookies, shopOrigin };
}
