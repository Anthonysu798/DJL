/** Buyer step-up over the real HTTP, Better Auth, Postgres and Redis path. */
import { createHash } from "node:crypto";
import { TOTP, URI } from "otpauth";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient, WEB_ORIGIN } from "../testing/client.ts";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";

const auth = "/v1/auth";
const post = (client: TestClient, path: string, json: object) =>
  client.call(auth + path, { method: "POST", json });
const local = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
type Buyer = Awaited<ReturnType<TestClient["signUp"]>>;
let connection: Awaited<ReturnType<typeof isolatedCommerceTestDatabase>> | undefined;
let api: ApiRuntime | undefined;

beforeAll(async () => {
  vi.stubEnv("DJL_COMMERCE_MODE", "test");
  vi.stubEnv("DJL_COMMERCE_PAYMENT_PROVIDER", "simulation");
  for (const key of ["SENTRY_DSN", "OTEL_EXPORTER_OTLP_ENDPOINT", "STORAGE_S3_ENDPOINT"])
    vi.stubEnv(key, undefined);
  const env = loadApiEnv({
    ...process.env,
    DJL_ENV: "test",
    DJL_MOCK_EXTERNALS: "true",
    SMS_ENABLED: "false",
    API_PUBLIC_URL: "http://localhost:8787",
    WEB_PUBLIC_URL: WEB_ORIGIN,
  });
  const database = new URL(env.databaseUrl);
  const redis = new URL(env.redisUrl);
  if (
    !local(database) ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !local(redis) ||
    redis.protocol !== "redis:" ||
    process.env.COMMERCE_TEST_PGLITE === "true"
  )
    throw new Error("Buyer MFA regression requires loopback PostgreSQL and Redis.");

  const realFetch = globalThis.fetch;
  // TestClient.signUp uses a fixed, synthetic fixture password. Keep the real
  // Better Auth breach hook, but answer only its exact fixture lookup locally.
  const prefix = createHash("sha1")
    .update("correct-horse-battery-staple")
    .digest("hex")
    .slice(0, 5)
    .toUpperCase();
  vi.stubGlobal(
    "fetch",
    Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (
          url.origin === "https://api.pwnedpasswords.com" &&
          url.pathname === `/range/${prefix}` &&
          (init?.method ?? "GET") === "GET"
        )
          return Promise.resolve(new Response("00000000000000000000000000000000000:0\r\n"));
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
  api = await startApi({ env: { ...env, databaseUrl: database.href }, host: "127.0.0.1", port: 0 });
  if (!api.outbox) throw new Error("Buyer MFA regression requires the mock outbox.");
});

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

async function enrollTotp() {
  const client = TestClient.for(api!);
  const buyer = await client.signUp(api!, "buyer-totp");
  const response = await post(client, "/two-factor/enable", {
    password: buyer.password,
    method: "totp",
  });
  expect(response.status).toBe(200);
  const setup = (await response.json()) as {
    method: string;
    totpURI: string;
    backupCodes: string[];
  };
  expect(setup.method).toBe("totp");
  // Don't print the URI, codes, session response body, cookies or headers if a regression fails.
  let totp: ReturnType<typeof URI.parse>;
  try {
    totp = URI.parse(setup.totpURI);
  } catch {
    throw new Error("Enrollment did not return a valid synthetic TOTP URI.");
  }
  if (!(totp instanceof TOTP)) throw new Error("Expected TOTP enrollment.");
  expect((await post(client, "/two-factor/verify-totp", { code: totp.generate() })).status).toBe(
    200,
  );
  return { buyer, totp, backupCodes: setup.backupCodes };
}

async function expectNoSession(client: TestClient) {
  const session = await client.call(auth + "/get-session");
  expect(session.status).toBe(200);
  expect((await session.json()) === null).toBe(true);
  expect(session.headers.has("set-auth-jwt")).toBe(false);
  expect((await client.call(auth + "/token")).status).toBe(401);
  expect((await client.call("/v1/commerce/wallet")).status).toBe(401);
}

async function challenge(buyer: Buyer, methods: string[]) {
  const client = TestClient.for(api!);
  const login = await post(client, "/sign-in/email", {
    email: buyer.email,
    password: buyer.password,
    rememberMe: false,
  });
  expect(login.status).toBe(200);
  const body = (await login.json()) as {
    twoFactorRedirect?: boolean;
    twoFactorMethods?: string[];
    token?: unknown;
  };
  expect(body.twoFactorRedirect).toBe(true);
  expect(body.twoFactorMethods?.length).toBe(methods.length);
  expect(methods.every((method) => body.twoFactorMethods?.includes(method))).toBe(true);
  expect(body.token == null).toBe(true);
  expect(login.headers.has("set-auth-token")).toBe(false);
  await expectNoSession(client);
  return client;
}

async function expectSignedIn(client: TestClient, result: Response, buyer: Buyer) {
  expect(result.status).toBe(200);
  const verified = (await result.json()) as { token?: unknown; user?: { id: string } };
  expect(typeof verified.token === "string" && verified.token.length > 0).toBe(true);
  expect(verified.user?.id === buyer.userId).toBe(true);
  const me = await client.call("/v1/me");
  expect(me.status).toBe(200);
  expect(((await me.json()) as { user?: { id: string } }).user?.id === buyer.userId).toBe(true);
  expect((await client.call("/v1/commerce/wallet")).status).toBe(200);
}

async function expectRefused(response: Response, code: string) {
  expect(response.status).toBe(401);
  expect(((await response.json()) as { code?: string }).code === code).toBe(true);
  expect(response.headers.has("set-auth-token")).toBe(false);
}

it("requires the enrolled authenticator, refuses a wrong code and consumes the challenge", async () => {
  const { buyer, totp } = await enrollTotp();
  const client = await challenge(buyer, ["totp", "otp"]);
  const pendingReplay = TestClient.for(api!);
  for (const [key, value] of client.jar) pendingReplay.jar.set(key, value);

  const now = Date.now();
  const nearby = new Set(
    [-2, -1, 0, 1, 2].map((step) => totp.generate({ timestamp: now + step * totp.period * 1000 })),
  );
  const wrong = Array.from({ length: 10 }, (_, i) => String(i).repeat(6)).find(
    (c) => !nearby.has(c),
  )!;
  await expectRefused(
    await post(client, "/two-factor/verify-totp", { code: wrong }),
    "INVALID_CODE",
  );
  await expectNoSession(client);

  await expectSignedIn(
    client,
    await post(client, "/two-factor/verify-totp", { code: totp.generate() }),
    buyer,
  );
  await expectRefused(
    await post(pendingReplay, "/two-factor/verify-totp", { code: totp.generate() }),
    "INVALID_TWO_FACTOR_COOKIE",
  );
  await expectNoSession(pendingReplay);
});

it("sends only a mock email factor and still requires its correct code", async () => {
  const setup = TestClient.for(api!);
  const buyer = await setup.signUp(api!, "buyer-email-mfa");
  const enabled = await post(setup, "/two-factor/enable", {
    password: buyer.password,
    method: "otp",
  });
  expect(enabled.status).toBe(200);
  expect(((await enabled.json()) as { method?: string }).method).toBe("otp");
  const client = await challenge(buyer, ["otp"]);
  const outbox = api!.outbox!;
  const sentBefore = outbox.emails.length;
  const sent = await post(client, "/two-factor/send-otp", {});
  expect(sent.status).toBe(200);
  expect(((await sent.json()) as { status?: boolean }).status).toBe(true);
  const messages = outbox.emails
    .slice(sentBefore)
    .filter((mail) => mail.to === buyer.email && mail.tag === "otp");
  expect(messages.length).toBe(1);
  expect(outbox.sms.length).toBe(0);
  const code = messages[0]?.subject.match(/^(\d{6})/)?.[1];
  if (!code) throw new Error("Synthetic second-factor message did not include a code.");
  await expectNoSession(client);
  await expectRefused(
    await post(client, "/two-factor/verify-otp", { code: code === "000000" ? "111111" : "000000" }),
    "INVALID_CODE",
  );
  await expectNoSession(client);
  await expectSignedIn(client, await post(client, "/two-factor/verify-otp", { code }), buyer);
});

it("consumes a backup code once and refuses its reuse in a fresh password challenge", async () => {
  const { buyer, backupCodes } = await enrollTotp();
  const [first, second] = backupCodes;
  if (!first || !second || first === second)
    throw new Error("Expected two distinct synthetic backup codes.");

  const client = await challenge(buyer, ["totp", "otp"]);
  await expectSignedIn(
    client,
    await post(client, "/two-factor/verify-backup-code", { code: first }),
    buyer,
  );

  const next = await challenge(buyer, ["totp", "otp"]);
  await expectRefused(
    await post(next, "/two-factor/verify-backup-code", { code: first }),
    "INVALID_BACKUP_CODE",
  );
  await expectNoSession(next);
  await expectSignedIn(
    next,
    await post(next, "/two-factor/verify-backup-code", { code: second }),
    buyer,
  );
});
