/** Scope regression: actual HTTP, isolated PostgreSQL, Redis, and Better Auth cookies. */
import { createHash } from "node:crypto";
import { schema } from "@djl/db";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { Secret, TOTP, URI } from "otpauth";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient, WEB_ORIGIN, type CallInit } from "../testing/client.ts";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { createCommerceAuth, requireCommerceAuthTestEnv } from "./commerceAuth.ts";

const genericAuth = "/v1/auth";
const scopedAuth = "/v1/shop/auth";
const scopedAccount = "/v1/shop/account";
const genericCookie = "djl.session_token";
const scopedCookie = "djl_shop.session_token";
const httpsApi = "https://127.0.0.1:48787";
const httpsShop = "https://127.0.0.1:48731";
const loopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
const fixturePassword = "correct-horse-battery-staple";
const nextPassword = "only-synthetic-shop-lifecycle-password";
let api: ApiRuntime | undefined;
let connection: Awaited<ReturnType<typeof isolatedCommerceTestDatabase>> | undefined;
let withoutOptIn: { session: number; account: number } | undefined;

const loadTestEnv = () =>
  loadApiEnv({
    ...process.env,
    DJL_ENV: "test",
    DJL_MOCK_EXTERNALS: "true",
    SMS_ENABLED: "false",
    API_PUBLIC_URL: "http://localhost:8787",
    WEB_PUBLIC_URL: WEB_ORIGIN,
  });

beforeAll(async () => {
  vi.stubEnv("DJL_COMMERCE_MODE", "test");
  vi.stubEnv("DJL_COMMERCE_PAYMENT_PROVIDER", "simulation");
  for (const key of ["SENTRY_DSN", "OTEL_EXPORTER_OTLP_ENDPOINT", "STORAGE_S3_ENDPOINT"])
    vi.stubEnv(key, undefined);
  const env = loadTestEnv();
  const database = new URL(env.databaseUrl);
  const redis = new URL(env.redisUrl);
  if (
    !loopback(database) ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !loopback(redis) ||
    redis.protocol !== "redis:" ||
    process.env.COMMERCE_TEST_PGLITE === "true"
  )
    throw new Error("Commerce authentication regression requires loopback PostgreSQL and Redis.");

  // The exact synthetic signup password breach lookup is mocked, not the auth stack.
  const realFetch = globalThis.fetch;
  const breachPaths = new Set(
    [fixturePassword, nextPassword].map(
      (password) =>
        `/range/${createHash("sha1").update(password).digest("hex").slice(0, 5).toUpperCase()}`,
    ),
  );
  vi.stubGlobal(
    "fetch",
    Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (
          url.origin === "https://api.pwnedpasswords.com" &&
          breachPaths.has(url.pathname) &&
          (init?.method ?? "GET") === "GET"
        ) {
          return Promise.resolve(new Response("00000000000000000000000000000000000:0\r\n"));
        }
        if (!api || url.origin !== `http://127.0.0.1:${api.address.port}`)
          throw new Error("Unexpected non-fixture fetch");
        return realFetch(input, { ...init, redirect: "error" });
      },
      {
        preconnect: () => {
          throw new Error("Unexpected fixture preconnect");
        },
      },
    ) satisfies typeof fetch,
  );

  connection = await isolatedCommerceTestDatabase();
  database.pathname = `/${connection.sql.options.database}`;
  const options = {
    env: { ...env, databaseUrl: database.href },
    host: "127.0.0.1",
    port: 0,
  };
  // Same isolated DB, but never run both API listeners concurrently.
  const control = await startApi(options);
  api = control;
  try {
    const anonymous = TestClient.for(control);
    withoutOptIn = {
      session: (await anonymous.call(scopedAuth + "/get-session")).status,
      account: (await anonymous.call(scopedAccount)).status,
    };
  } finally {
    api = undefined;
    await control.close();
  }
  api = await startApi({ ...options, testCommerceAuth: true });
  if (!api.outbox) throw new Error("Commerce authentication regression requires the mock outbox.");
}, 40_000);

afterAll(async () => {
  try {
    await api?.close();
  } finally {
    try {
      await connection?.close();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  }
});

type FixtureBuyer = Awaited<ReturnType<TestClient["signUp"]>>;
const client = () => TestClient.for(api!);
const post = (jar: TestClient, path: string, json: object, init?: CallInit) =>
  jar.call(path, { ...init, method: "POST", json, csrf: false });
const login = (jar: TestClient, realm: string, buyer: FixtureBuyer, init?: CallInit) =>
  post(
    jar,
    realm + "/sign-in/email",
    { email: buyer.email, password: buyer.password, rememberMe: false },
    init,
  );

async function body<T>(response: Response, status = 200) {
  expect(response.status).toBe(status);
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Invalid authentication test response JSON.");
  }
}

function credentialField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      /^(token|jwt|sessionToken|accessToken|refreshToken)$/i.test(key) || credentialField(nested),
  );
}

async function cleanBody<T>(response: Response, status = 200) {
  expect(response.headers.has("set-auth-token")).toBe(false);
  expect(response.headers.has("set-auth-jwt")).toBe(false);
  expect(response.headers.has("authorization")).toBe(false);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const json = await body<T>(response, status);
  // A failed assertion must not print the auth response or reveal credentials.
  expect(credentialField(json)).toBe(false);
  return json;
}

function cookie(jar: TestClient, name: string) {
  const value = jar.jar.get(name);
  if (!value) throw new Error("Expected private fixture cookie was missing.");
  return value;
}

function rawToken(signed: string) {
  const token = decodeURIComponent(signed).split(".")[0];
  if (!token || token === signed) throw new Error("Expected signed fixture session cookie.");
  return token;
}

function assertShopCookies(response: Response, expected: string) {
  const cookies = response.headers.getSetCookie();
  expect(cookies.length > 0).toBe(true);
  expect(cookies.some((part) => part.startsWith(expected + "="))).toBe(true);
  expect(
    cookies.every(
      (part) =>
        part.startsWith("djl_shop.") &&
        /;\s*HttpOnly(?:;|$)/i.test(part) &&
        !/;\s*Domain=/i.test(part),
    ),
  ).toBe(true);
}

const emptyWallet = {
  pendingCents: 0,
  availableCents: 0,
  frozenCents: 0,
  paidCents: 0,
  recoveryCents: 0,
};
type Identity = { user?: { id?: string; email?: string; emailVerified?: boolean } };
async function sameAccount(jar: TestClient, buyer: FixtureBuyer) {
  const response = await jar.call(scopedAccount);
  const profile = await cleanBody<Identity & { wallet: typeof emptyWallet }>(response);
  expect(profile.user?.id === buyer.userId && profile.user?.email === buyer.email).toBe(true);
  expect(profile.user?.emailVerified).toBe(true);
  expect(profile.wallet).toEqual(emptyWallet);
}

it("is absent by default and rejects unsupported opt-ins before any service access", async () => {
  expect(withoutOptIn).toEqual({ session: 404, account: 404 });
  const env = loadTestEnv();
  expect(requireCommerceAuthTestEnv(env)).toMatchObject({
    shopOrigin: WEB_ORIGIN,
    secureCookies: false,
  });
  const https = {
    ...env,
    apiPublicUrl: httpsApi,
    webPublicUrl: httpsShop,
    trustedOrigins: [...env.trustedOrigins, httpsShop],
  };
  expect(requireCommerceAuthTestEnv(https)).toMatchObject({
    apiOrigin: httpsApi,
    shopOrigin: httpsShop,
    secureCookies: true,
  });
  for (const invalid of [
    { ...https, apiPublicUrl: httpsApi.replace("https:", "http:") },
    { ...https, apiPublicUrl: httpsApi.replace("127.0.0.1", "localhost") },
    { ...https, apiPublicUrl: httpsApi.replace("127.0.0.1", "outside.invalid") },
    { ...https, webPublicUrl: httpsShop + "/" },
  ])
    expect(() => requireCommerceAuthTestEnv(invalid)).toThrow(/loopback/);
  for (const invalid of [
    { env: "local" as const },
    { env: "production" as const },
    { mockExternals: false },
  ]) {
    expect(() => requireCommerceAuthTestEnv({ ...env, ...invalid })).toThrow(/mocked test mode/);
  }
  for (const invalid of [
    { webPublicUrl: WEB_ORIGIN + "/" },
    { apiPublicUrl: "http://localhost:8787/" },
    { webPublicUrl: "http://not-loopback.invalid:3000" },
  ]) {
    expect(() => requireCommerceAuthTestEnv({ ...env, ...invalid })).toThrow(/canonical loopback/);
  }
  expect(() =>
    requireCommerceAuthTestEnv({
      ...env,
      trustedOrigins: env.trustedOrigins.filter((o) => o !== WEB_ORIGIN),
    }),
  ).toThrow(/trusted shop origin/);
  for (const invalid of [
    { databaseUrl: "postgres://test@not-loopback.invalid:5432/test" },
    { redisUrl: "redis://not-loopback.invalid:6379" },
  ]) {
    expect(() => requireCommerceAuthTestEnv({ ...env, ...invalid })).toThrow(
      /loopback PostgreSQL and Redis/,
    );
  }
  await expect(
    startApi({
      env: {
        ...env,
        webPublicUrl: WEB_ORIGIN + "/",
        databaseUrl: "postgres://test@127.0.0.1:1/test",
        redisUrl: "redis://127.0.0.1:1",
      },
      host: "127.0.0.1",
      port: 0,
      testCommerceAuth: true,
    }),
  ).rejects.toThrow(/canonical loopback/);
});

it("isolates browser cookies and bearer credentials in both directions, including relabel and logout", async () => {
  const general = client();
  const buyer = await general.signUp(api!, "commerce-auth-dual");
  const signedGeneral = cookie(general, genericCookie);
  const generalRaw = rawToken(signedGeneral);
  expect((await client().call("/v1/me", { bearer: generalRaw })).status).toBe(200);
  const generalJwt = (await body<{ token: string }>(await general.call(genericAuth + "/token")))
    .token;
  expect(typeof generalJwt === "string" && generalJwt.length > 0).toBe(true);

  const shop = client();
  const loginResponse = await login(shop, scopedAuth, buyer);
  expect(loginResponse.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  expect(loginResponse.headers.get("access-control-allow-credentials")).toBe("true");
  assertShopCookies(loginResponse, scopedCookie);
  const logged = await cleanBody<Identity>(loginResponse);
  expect(logged.user?.id === buyer.userId && logged.user?.emailVerified === true).toBe(true);
  const scopedSession = await cleanBody<Identity & { session?: { id: string } }>(
    await shop.call(scopedAuth + "/get-session"),
  );
  expect(scopedSession.user?.id === buyer.userId).toBe(true);
  expect(typeof scopedSession.session?.id === "string").toBe(true);
  await sameAccount(shop, buyer);

  expect((await general.call(scopedAccount)).status).toBe(401);
  expect((await cleanBody(await general.call(scopedAuth + "/get-session"))) === null).toBe(true);
  for (const bearer of [generalRaw, signedGeneral, generalJwt])
    expect((await client().call(scopedAccount, { bearer })).status).toBe(401);
  expect((await shop.call(scopedAccount, { headers: { authorization: "Invalid" } })).status).toBe(
    401,
  );
  expect((await shop.call(scopedAccount, { headers: { "x-org-id": buyer.orgId } })).status).toBe(
    401,
  );
  const spoofedShop = client();
  spoofedShop.jar.set(scopedCookie, signedGeneral);
  expect((await spoofedShop.call(scopedAccount)).status).toBe(401);

  const signedShop = cookie(shop, scopedCookie);
  const spoofedGeneral = client();
  spoofedGeneral.jar.set(genericCookie, signedShop);
  for (const path of ["/v1/me", "/v1/commerce/wallet", genericAuth + "/token"]) {
    expect((await shop.call(path)).status).toBe(401);
    expect((await spoofedGeneral.call(path)).status).toBe(401);
    expect((await client().call(path, { bearer: signedShop })).status).toBe(401);
    expect((await client().call(path, { bearer: rawToken(signedShop) })).status).toBe(401);
  }

  const replay = client();
  replay.jar.set(scopedCookie, signedShop);
  await sameAccount(replay, buyer);
  const logout = await post(shop, scopedAuth + "/sign-out", {});
  assertShopCookies(logout, scopedCookie);
  expect((await cleanBody<{ success: boolean }>(logout)).success).toBe(true);
  expect((await replay.call(scopedAccount)).status).toBe(401);
  expect((await cleanBody(await shop.call(scopedAuth + "/get-session"))) === null).toBe(true);
  expect((await general.call("/v1/me")).status).toBe(200);
  expect((await general.call("/v1/commerce/wallet")).status).toBe(200);
});

it("admits only the scoped method allowlist and requires the exact write origin", async () => {
  const general = client();
  const buyer = await general.signUp(api!, "commerce-auth-origin");
  const shop = client();
  const data = { email: buyer.email, password: buyer.password, rememberMe: false };
  const preflightHeaders = {
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type",
  };
  const preflight = await shop.call(scopedAuth + "/sign-in/email", {
    method: "OPTIONS",
    headers: preflightHeaders,
    csrf: false,
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
  expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
  const wrongPreflight = await shop.call(scopedAuth + "/sign-in/email", {
    method: "OPTIONS",
    headers: { ...preflightHeaders, origin: "http://localhost:9999" },
    csrf: false,
  });
  expect(wrongPreflight.headers.has("access-control-allow-origin")).toBe(false);
  const crossOrigin = await post(shop, scopedAuth + "/sign-in/email", data, {
    headers: { origin: "http://localhost:9999" },
  });
  expect((await cleanBody<{ error?: { code: string } }>(crossOrigin, 403)).error?.code).toBe(
    "commerce_origin",
  );
  expect(crossOrigin.headers.getSetCookie().length).toBe(0);
  expect(crossOrigin.headers.has("access-control-allow-origin")).toBe(false);
  const missingOrigin = await fetch(shop.base + scopedAuth + "/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  expect(missingOrigin.status).toBe(403);
  expect(missingOrigin.headers.getSetCookie().length).toBe(0);

  for (const path of [
    "/sign-up/email",
    "/request-password-reset",
    "/reset-password",
    "/two-factor/enable",
    "/two-factor/generate-backup-codes",
    "/sign-in/social",
    "/organization/set-active",
  ]) {
    expect((await post(shop, scopedAuth + path, {})).status).toBe(404);
  }
  for (const path of [
    "/token",
    "/jwks",
    "/list-sessions",
    "/sign-in/email",
    "/reset-password/example",
  ])
    expect((await shop.call(scopedAuth + path)).status).toBe(404);
  expect((await post(shop, scopedAuth + "/get-session", {})).status).toBe(404);
});

it("bounds actual auth write bytes and rejects malformed body/media without changing the session", async () => {
  const general = client();
  const buyer = await general.signUp(api!, "commerce-auth-bounded-body");
  const shop = await passwordShop(buyer);
  const signIn = scopedAuth + "/sign-in/email";
  const signOut = scopedAuth + "/sign-out";
  const data = JSON.stringify({ email: buyer.email, password: buyer.password });
  const bounded = data.padEnd(16 * 1024, " ");
  const overflow = bounded + " ";
  const json = { "content-type": "application/json" };
  const write = (path: string, body: BodyInit | null, headers: Record<string, string> = json) =>
    shop.call(path, { method: "POST", body, headers, csrf: false });

  const oversized = await write(signIn, overflow, {
    ...json,
    "content-length": String(overflow.length),
  });
  expect((await cleanBody<{ error?: { code: string } }>(oversized, 413)).error?.code).toBe(
    "payload_too_large",
  );
  expect(oversized.headers.has("set-cookie")).toBe(false);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(bounded.slice(0, 8192)));
      controller.enqueue(encoder.encode(bounded.slice(8192)));
      controller.enqueue(encoder.encode(" "));
      controller.close();
    },
  });
  const streamed: RequestInit & { duplex: "half" } = {
    method: "POST",
    body: stream,
    duplex: "half",
    headers: { ...json, origin: WEB_ORIGIN, "fly-client-ip": shop.ip },
  };
  expect((await fetch(shop.base + signIn, streamed)).status).toBe(413);
  expect((await write(signIn, bounded)).status).toBe(200);
  expect((await write(signIn, data, { "content-type": "text/plain" })).status).toBe(415);
  expect((await write(signIn, data, { ...json, "content-encoding": "gzip" })).status).toBe(415);
  expect((await write(signIn, new Uint8Array([0x7b, 0xc0, 0x7d]))).status).toBe(400);
  expect((await write(signOut, overflow)).status).toBe(413);
  expect((await write(signOut, "[]")).status).toBe(400);
  expect((await write(signOut, '{"ignored":true}')).status).toBe(400);
  expect((await write(signOut, "{}", { "content-type": "text/plain" })).status).toBe(415);
  expect((await write(scopedAuth + "/two-factor/send-otp", overflow)).status).toBe(413);
  expect((await write(scopedAuth + "/two-factor/send-otp", '{"ignored":true}')).status).toBe(400);
  await sameAccount(shop, buyer);
  expect((await write(signOut, null, {})).status).toBe(200);
  expect((await shop.call(scopedAccount)).status).toBe(401);
});

const verifyTotp = "/two-factor/verify-totp";
async function enrollTotp(setup: TestClient, buyer: FixtureBuyer) {
  const enabled = await body<{ totpURI: string }>(
    await post(setup, genericAuth + "/two-factor/enable", {
      password: buyer.password,
      method: "totp",
    }),
  );
  let totp: ReturnType<typeof URI.parse>;
  try {
    totp = URI.parse(enabled.totpURI);
  } catch {
    throw new Error("Expected valid synthetic authenticator setup.");
  }
  if (!(totp instanceof TOTP)) throw new Error("Expected synthetic TOTP setup.");
  expect((await post(setup, genericAuth + verifyTotp, { code: totp.generate() })).status).toBe(200);
  return totp;
}

it("uses real Host-prefixed Secure cookies at the HTTPS auth SDK boundary, including MFA and logout", async () => {
  const generic = client();
  const buyer = await generic.signUp(api!, "commerce-auth-https-cookies");
  const totp = await enrollTotp(generic, buyer);
  const env = loadTestEnv();
  const database = new URL(env.databaseUrl);
  database.pathname = `/${connection!.sql.options.database}`;
  const redis = new Redis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    const service = createCommerceAuth({
      env: {
        ...env,
        databaseUrl: database.href,
        apiPublicUrl: httpsApi,
        webPublicUrl: httpsShop,
        trustedOrigins: [...env.trustedOrigins, httpsShop],
      },
      db: api!.db,
      redis,
      notifier: {
        sendTwoFactorOtp: async () => {
          throw new Error("Unexpected OTP delivery in TOTP test.");
        },
      },
    });
    expect(service.secureCookies).toBe(true);
    expect(service.shopOrigin).toBe(httpsShop);
    const sessionName = "__Host-djl_shop.session_token";
    const factorName = "__Host-djl_shop.two_factor";
    const allowedNames = new Set([
      sessionName,
      factorName,
      "__Host-djl_shop.dont_remember",
      "__Host-djl_shop.session_data",
    ]);
    const jar = new Map<string, string>();
    const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const request = (route: string, data: object, cookieHeader = header()) =>
      service.handle(
        new Request(httpsApi + scopedAuth + route, {
          method: "POST",
          headers: {
            origin: httpsShop,
            "content-type": "application/json",
            cookie: cookieHeader,
            "fly-client-ip": generic.ip,
          },
          body: JSON.stringify(data),
        }),
      );
    const absorb = (response: Response, expected: string, clearing = false) => {
      let found = false;
      for (const raw of response.headers.getSetCookie()) {
        const [pair, ...attributes] = raw.split(";");
        const split = pair!.indexOf("=");
        const name = pair!.slice(0, split);
        const value = pair!.slice(split + 1);
        const attrs = attributes.map((attribute) => attribute.trim().toLowerCase());
        expect(allowedNames.has(name)).toBe(true);
        expect(
          attrs.includes("secure") && attrs.includes("httponly") && attrs.includes("path=/"),
        ).toBe(true);
        expect(attrs.some((attribute) => attribute.startsWith("domain"))).toBe(false);
        const clear = attrs.includes("max-age=0");
        if (name === expected && clear === clearing) found = true;
        if (clear) jar.delete(name);
        else jar.set(name, value);
      }
      expect(found).toBe(true);
    };

    const challenge = await request("/sign-in/email", {
      email: buyer.email,
      password: buyer.password,
      rememberMe: false,
    });
    expect((await cleanBody<{ twoFactorRedirect: boolean }>(challenge)).twoFactorRedirect).toBe(
      true,
    );
    absorb(challenge, factorName);
    const factor = jar.get(factorName);
    if (!factor) throw new Error("Expected a synthetic secure challenge cookie.");
    const forged = await request(
      verifyTotp,
      { code: totp.generate() },
      `djl_shop.two_factor=${factor}`,
    );
    expect(forged.status).toBe(401);
    expect(forged.headers.has("set-cookie")).toBe(false);

    const verified = await request(verifyTotp, { code: totp.generate(), trustDevice: true });
    expect((await cleanBody<Identity>(verified)).user?.id === buyer.userId).toBe(true);
    absorb(verified, sessionName);
    const session = jar.get(sessionName);
    if (!session) throw new Error("Expected a synthetic secure session cookie.");
    const scopedBuyer = (value: string, origin = httpsShop) =>
      service.buyer(new Headers({ origin, cookie: value }));
    expect((await scopedBuyer(header()))?.id === buyer.userId).toBe(true);
    for (const alias of [scopedCookie, "__Secure-djl_shop.session_token", genericCookie]) {
      expect((await scopedBuyer(`${alias}=${session}`)) === null).toBe(true);
    }
    expect((await scopedBuyer(header(), httpsShop.replace("https:", "http:"))) === null).toBe(true);
    expect(
      (await scopedBuyer(`${sessionName}=${session}; ${sessionName}=${session}`)) === null,
    ).toBe(true);

    const logout = await request("/sign-out", {});
    expect((await cleanBody<{ success: boolean }>(logout)).success).toBe(true);
    absorb(logout, sessionName, true);
    expect((await scopedBuyer(`${sessionName}=${session}`)) === null).toBe(true);
    expect((await generic.call("/v1/me")).status).toBe(200);
  } finally {
    redis.disconnect();
  }
});

it("uses the same enrolled TOTP but never accepts a challenge issued by the other realm", async () => {
  const setup = client();
  const buyer = await setup.signUp(api!, "commerce-auth-totp");
  const totp = await enrollTotp(setup, buyer);
  const verify = verifyTotp;

  const generalPending = client();
  expect(
    (await body<{ twoFactorRedirect?: boolean }>(await login(generalPending, genericAuth, buyer)))
      .twoFactorRedirect,
  ).toBe(true);
  const scopedPending = client();
  const challenge = await login(scopedPending, scopedAuth, buyer);
  assertShopCookies(challenge, "djl_shop.two_factor");
  const challengeBody = await cleanBody<{ twoFactorRedirect: boolean; twoFactorMethods: string[] }>(
    challenge,
  );
  expect(challengeBody.twoFactorRedirect).toBe(true);
  expect(challengeBody.twoFactorMethods).toEqual(["totp", "otp"]);
  expect((await scopedPending.call(scopedAccount)).status).toBe(401);
  expect((await scopedPending.call(genericAuth + "/token")).status).toBe(401);
  expect((await cleanBody(await scopedPending.call(scopedAuth + "/get-session"))) === null).toBe(
    true,
  );

  const forgedShop = client();
  forgedShop.jar.set("djl_shop.two_factor", cookie(generalPending, "djl.two_factor"));
  expect((await post(forgedShop, scopedAuth + verify, { code: totp.generate() })).status).toBe(401);
  const forgedGeneral = client();
  forgedGeneral.jar.set("djl.two_factor", cookie(scopedPending, "djl_shop.two_factor"));
  expect((await post(forgedGeneral, genericAuth + verify, { code: totp.generate() })).status).toBe(
    401,
  );

  const verified = await post(scopedPending, scopedAuth + verify, {
    code: totp.generate(),
    trustDevice: true,
  });
  assertShopCookies(verified, scopedCookie);
  expect(verified.headers.getSetCookie().some((c) => c.startsWith("djl_shop.trust_device="))).toBe(
    false,
  );
  expect((await cleanBody<Identity>(verified)).user?.id === buyer.userId).toBe(true);
  await sameAccount(scopedPending, buyer);
  expect((await scopedPending.call(genericAuth + "/token")).status).toBe(401);
  // Rejected cross-realm attempts did not consume the rightful challenge.
  expect((await post(generalPending, genericAuth + verify, { code: totp.generate() })).status).toBe(
    200,
  );
  expect((await generalPending.call("/v1/me")).status).toBe(200);
});

async function passwordShop(buyer: FixtureBuyer) {
  const shop = client();
  expect((await cleanBody<Identity>(await login(shop, scopedAuth, buyer))).user?.id).toBe(
    buyer.userId,
  );
  return shop;
}

async function pendingShop(buyer: FixtureBuyer) {
  const pending = client();
  const response = await login(pending, scopedAuth, buyer);
  assertShopCookies(response, "djl_shop.two_factor");
  expect((await cleanBody<{ twoFactorRedirect: boolean }>(response)).twoFactorRedirect).toBe(true);
  return pending;
}

async function factorShop(buyer: FixtureBuyer, totp: TOTP) {
  const shop = await pendingShop(buyer);
  const verified = await post(shop, scopedAuth + verifyTotp, { code: totp.generate() });
  expect((await cleanBody<Identity>(verified)).user?.id).toBe(buyer.userId);
  await sameAccount(shop, buyer);
  return shop;
}

async function lifecycleRejections(shop: TestClient, pending: TestClient, totp: TOTP) {
  const staleAccount = await shop.call(scopedAccount);
  const staleOtp = await post(pending, scopedAuth + "/two-factor/send-otp", {});
  const staleChallenge = await post(pending, scopedAuth + verifyTotp, { code: totp.generate() });
  const staleSession = await cleanBody(await shop.call(scopedAuth + "/get-session"));
  expect({
    staleAccount: staleAccount.status,
    staleSessionIsAnonymous: staleSession === null,
    staleOtp: staleOtp.status,
    staleChallenge: staleChallenge.status,
    staleChallengeHasCookies: staleChallenge.headers.has("set-cookie"),
  }).toEqual({
    staleAccount: 401,
    staleSessionIsAnonymous: true,
    staleOtp: 401,
    staleChallenge: 401,
    staleChallengeHasCookies: false,
  });
}

it("keeps scoped sessions valid when an ordinary Cloud session signs out", async () => {
  const general = client();
  const buyer = await general.signUp(api!, "shop-lifecycle-signout");
  const shop = await passwordShop(buyer);
  expect((await post(general, genericAuth + "/sign-out", {})).status).toBe(200);
  expect((await general.call("/v1/me")).status).toBe(401);
  await sameAccount(shop, buyer);
});

it.each(["change", "reset"] as const)(
  "invalidates scoped sessions and pending MFA after shared password %s",
  async (action) => {
    const general = client();
    const buyer = await general.signUp(api!, `shop-lifecycle-${action}`);
    const totp = await enrollTotp(general, buyer);
    const shop = await factorShop(buyer, totp);
    const pending = await pendingShop(buyer);
    if (action === "change") {
      const passwordChange = (currentPassword: string) =>
        post(general, genericAuth + "/change-password", {
          currentPassword,
          newPassword: nextPassword,
        });
      expect((await passwordChange("incorrect-synthetic-password")).status).toBeGreaterThanOrEqual(
        400,
      );
      await sameAccount(shop, buyer);
      expect((await passwordChange(buyer.password)).status).toBe(200);
    } else {
      const recovery = client();
      expect(
        (
          await post(recovery, genericAuth + "/email-otp/request-password-reset", {
            email: buyer.email,
          })
        ).status,
      ).toBe(200);
      const otp = api!
        .outbox!.emails.findLast((m) => m.to === buyer.email && m.tag === "otp")
        ?.subject.match(/^\d{6}/)?.[0];
      if (!otp) throw new Error("Expected private synthetic reset OTP.");
      expect(
        (
          await post(recovery, genericAuth + "/email-otp/reset-password", {
            email: buyer.email,
            otp,
            password: nextPassword,
          })
        ).status,
      ).toBe(200);
    }
    expect((await login(client(), scopedAuth, buyer)).status).toBe(401);
    await factorShop({ ...buyer, password: nextPassword }, totp);
    await lifecycleRejections(shop, pending, totp);
  },
);

it.each(["revoke-sessions", "revoke-other-sessions"] as const)(
  "invalidates scoped sessions and pending MFA on Cloud %s",
  async (route) => {
    const general = client();
    const buyer = await general.signUp(api!, `shop-lifecycle-${route}`);
    const totp = await enrollTotp(general, buyer);
    const shop = await factorShop(buyer, totp);
    const pending = await pendingShop(buyer);
    expect((await post(general, genericAuth + "/" + route, {})).status).toBe(200);
    expect((await general.call("/v1/me")).status).toBe(route === "revoke-sessions" ? 401 : 200);
    await factorShop(buyer, totp);
    await lifecycleRejections(shop, pending, totp);
  },
);

async function djlAdminBearer() {
  const admin = client();
  const email = `shop-lifecycle-admin-${crypto.randomUUID()}@test.invalid`;
  const password = "synthetic-administrator-lifecycle-password";
  await api!.adminAuth.create({ email, name: "Lifecycle QA", role: "admin", password });
  const base = "/admin/v1";
  const credentials = await body<{ token: string }>(
    await post(admin, base + "/auth/login", { email, password }),
  );
  const bearer = { bearer: credentials.token };
  const enrollment = await body<{ secret: string }>(
    await post(admin, base + "/auth/totp/enroll", {}, bearer),
  );
  const authenticator = new TOTP({ secret: Secret.fromBase32(enrollment.secret) });
  expect(
    (await post(admin, base + "/auth/totp/confirm", { code: authenticator.generate() }, bearer))
      .status,
  ).toBe(200);
  const mfa = await body<{ token: string }>(
    await post(admin, base + "/auth/login", {
      email,
      password,
      totp: authenticator.generate(),
    }),
  );
  return { admin, bearer: mfa.token };
}

it("does not revive old scoped sessions or pending MFA after an administrator lifts a ban", async () => {
  const general = client();
  const buyer = await general.signUp(api!, "shop-lifecycle-ban");
  const totp = await enrollTotp(general, buyer);
  const shop = await factorShop(buyer, totp);
  const pending = await pendingShop(buyer);
  const { admin, bearer } = await djlAdminBearer();
  const suspend = (suspended: boolean) =>
    post(
      admin,
      `/admin/v1/users/${buyer.userId}/suspend`,
      {
        suspend: suspended,
        reason: "Isolated lifecycle regression",
      },
      { bearer },
    );
  expect((await suspend(true)).status).toBe(200);
  expect((await shop.call(scopedAccount)).status).toBe(401);
  expect((await suspend(false)).status).toBe(200);
  await factorShop(buyer, totp);
  await lifecycleRejections(shop, pending, totp);
});

it("invalidates scoped sessions and pending MFA on a DJL administrator's global revoke", async () => {
  const general = client();
  const buyer = await general.signUp(api!, "shop-lifecycle-admin-revoke");
  const totp = await enrollTotp(general, buyer);
  const shop = await factorShop(buyer, totp);
  const pending = await pendingShop(buyer);
  const { admin, bearer } = await djlAdminBearer();
  expect(
    (await post(admin, `/admin/v1/users/${buyer.userId}/sessions/revoke`, {}, { bearer })).status,
  ).toBe(200);
  expect((await general.call("/v1/me")).status).toBe(401);
  await factorShop(buyer, totp);
  await lifecycleRejections(shop, pending, totp);
});

it("limits native Cloud administrator global revoke to the authorized target", async () => {
  const general = client();
  const buyer = await general.signUp(api!, "shop-lifecycle-native-target");
  const totp = await enrollTotp(general, buyer);
  const shop = await factorShop(buyer, totp);
  const pending = await pendingShop(buyer);
  const path = genericAuth + "/admin/revoke-user-sessions";
  expect((await post(general, path, { userId: buyer.userId })).status).toBe(403);
  await sameAccount(shop, buyer);

  const native = client();
  const actor = await native.signUp(api!, "shop-lifecycle-native-admin");
  const nativeShop = await passwordShop(actor);
  // Separate legacy Better Auth role, seeded only in the isolated test database.
  await api!.db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, actor.userId));
  expect((await post(general, genericAuth + "/sign-out", {})).status).toBe(200);
  expect((await post(native, path, { userId: buyer.userId })).status).toBe(200);
  await sameAccount(nativeShop, actor);
  await factorShop(buyer, totp);
  await lifecycleRejections(shop, pending, totp);
});

it("does not publish a usable session when revoke-all commits before a blocked Shop insert", async () => {
  const general = client();
  const buyer = await general.signUp(api!, "shop-lifecycle-race");
  const shop = client();
  const sql = connection!.sql;
  const [current] = await sql<{ name: string }[]>`SELECT current_database() AS name`;
  if (
    !current ||
    current.name !== sql.options.database ||
    !/^djl_commerce_suite_[0-9a-f]{32}$/.test(current.name)
  )
    throw new Error("The lock test requires the owned isolated commerce database.");

  const awaitInsert = await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '3s'`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = '15s'`;
    // SHARE lets readers proceed and blocks exactly the RowExclusive write lock.
    await tx`LOCK TABLE commerce_auth_session IN SHARE MODE`;
    const response = login(shop, scopedAuth, buyer, { signal: AbortSignal.timeout(15_000) });
    void response.catch(() => undefined); // rollback still releases the lock if the assertions fail
    await vi.waitFor(
      async () => {
        const [waiter] = await sql<{ blocked: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND relation = 'commerce_auth_session'::regclass
            AND mode = 'RowExclusiveLock' AND NOT granted
        ) AS blocked`;
        expect(waiter?.blocked).toBe(true);
      },
      { timeout: 5_000, interval: 25 },
    );
    expect(
      (
        await post(
          general,
          genericAuth + "/revoke-sessions",
          {},
          {
            signal: AbortSignal.timeout(5_000),
          },
        )
      ).status,
    ).toBe(200);
    return () => response;
  }); // commit or rollback releases the lock before we await the request

  const old = await awaitInsert();
  expect(old.status).toBe(401);
  expect(old.headers.has("set-cookie")).toBe(false);
  expect((await shop.call(scopedAccount)).status).toBe(401);
  await sameAccount(await passwordShop(buyer), buyer);
}, 25_000);
