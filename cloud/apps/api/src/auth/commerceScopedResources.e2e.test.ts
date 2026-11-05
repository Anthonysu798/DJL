/** Actual HTTP regression for the opt-in shop resource and session-bound CSRF boundary. */
import { schema } from "@djl/db";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient, WEB_ORIGIN } from "../testing/client.ts";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { createPersonalOrganization } from "./auth.ts";
import { requireCommerceAuthTestEnv } from "./commerceAuth.ts";
import { hashPassword } from "./password.ts";

const shopCsrf = "/v1/shop/csrf";
const shopFavorites = "/v1/shop/commerce/favorites";
const cloudFavorites = "/v1/commerce/favorites";
const password = "synthetic-scoped-commerce-csrf-password";
const tokenHeader = (value: string) => ({ "x-csrf-token": value });

async function requireRefusal(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe(code);
}

it("binds scoped favorites CSRF and writes to the exact session even with a different Cloud cookie", async () => {
  vi.stubEnv("DJL_COMMERCE_MODE", "test");
  vi.stubEnv("DJL_COMMERCE_PAYMENT_PROVIDER", "simulation");
  for (const key of ["SENTRY_DSN", "OTEL_EXPORTER_OTLP_ENDPOINT", "STORAGE_S3_ENDPOINT"])
    vi.stubEnv(key, undefined);

  let connection: Awaited<ReturnType<typeof isolatedCommerceTestDatabase>> | undefined;
  let api: ApiRuntime | undefined;
  try {
    const env = loadApiEnv({
      ...process.env,
      DJL_ENV: "test",
      DJL_MOCK_EXTERNALS: "true",
      SMS_ENABLED: "false",
      API_PUBLIC_URL: "http://localhost:8787",
      WEB_PUBLIC_URL: WEB_ORIGIN,
      ADMIN_PUBLIC_URL: "http://localhost:3001",
    });
    requireCommerceAuthTestEnv(env);
    if (process.env.COMMERCE_TEST_PGLITE === "true")
      throw new Error("Scoped HTTP resources require native loopback PostgreSQL.");

    // Seed only synthetic shared identities below; no signup or external services.
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      Object.assign(
        (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (!api || url.origin !== `http://127.0.0.1:${api.address.port}`)
            throw new Error("Unexpected non-fixture fetch.");
          return realFetch(input, { ...init, redirect: "error" });
        },
        {
          preconnect: () => {
            throw new Error("Unexpected fixture preconnect.");
          },
        },
      ) satisfies typeof fetch,
    );

    connection = await isolatedCommerceTestDatabase();
    const database = new URL(env.databaseUrl);
    database.pathname = `/${connection.sql.options.database}`;
    const options = {
      env: { ...env, databaseUrl: database.href },
      host: "127.0.0.1",
      port: 0,
    };
    api = await startApi(options);
    const disabled = TestClient.for(api);
    expect((await disabled.call(shopCsrf)).status).toBe(404);
    expect((await disabled.call(shopFavorites)).status).toBe(404);
    await api.close();
    api = undefined;

    api = await startApi({ ...options, testCommerceAuth: true });
    const db = api.db;
    const passwordHash = await hashPassword(password);
    const seedBuyer = async () => {
      const email = `shop-csrf-${crypto.randomUUID()}@test.invalid`;
      const [user] = await db
        .insert(schema.user)
        .values({
          name: "Synthetic scoped buyer",
          email,
          emailVerified: true,
        })
        .returning({ id: schema.user.id });
      if (!user) throw new Error("Missing synthetic buyer.");
      await db.insert(schema.account).values({
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
        updatedAt: new Date(),
      });
      await createPersonalOrganization(db, user.id, "Synthetic scoped buyer");
      return { id: user.id, email };
    };
    const a = await seedBuyer();
    const b = await seedBuyer();
    const [supplier] = await db
      .insert(schema.commerceSuppliers)
      .values({
        name: "Synthetic supplier",
        returnAddress: "Toronto, Ontario, Canada",
      })
      .returning({ id: schema.commerceSuppliers.id });
    if (!supplier) throw new Error("Missing synthetic supplier.");
    const [product] = await db
      .insert(schema.commerceProducts)
      .values({
        supplierId: supplier.id,
        sku: crypto.randomUUID(),
        name: "Synthetic tote",
        description: "Synthetic favorite fixture",
        category: "Bags",
        imageUrl: "/shop/media/test-tote.png",
        priceCents: 4000,
        costCents: 2000,
        commissionBps: 1000,
        returnDays: 30,
        stock: 3,
        status: "published",
      })
      .returning({ id: schema.commerceProducts.id });
    if (!product) throw new Error("Missing synthetic product.");

    const newClient = () => TestClient.for(api!);
    const login = async (jar: TestClient, email: string, scope = false) => {
      const realm = scope ? "/v1/shop/auth" : "/v1/auth";
      expect(
        (
          await jar.call(realm + "/sign-in/email", {
            method: "POST",
            json: { email, password },
            csrf: false,
          })
        ).status,
      ).toBe(200);
    };
    const aShop = newClient();
    const aOtherSession = newClient();
    const bCloud = newClient();
    await login(aShop, a.email, true);
    await login(aOtherSession, a.email, true);
    await login(bCloud, b.email);
    expect(aShop.jar.has("djl_shop.session_token") && bCloud.jar.has("djl.session_token")).toBe(
      true,
    );
    expect((await bCloud.call("/v1/me")).status).toBe(200);
    await requireRefusal(await bCloud.call(shopCsrf), 401, "unauthorized");
    await requireRefusal(await bCloud.call(shopFavorites), 401, "unauthorized");
    await requireRefusal(await aShop.call("/v1/me"), 401, "unauthorized");
    await requireRefusal(await aShop.call(cloudFavorites), 401, "unauthorized");

    const mixed = newClient();
    for (const [name, value] of [...aShop.jar, ...bCloud.jar]) mixed.jar.set(name, value);
    const wrongOrigin = { origin: "http://localhost:3001" }; // another trusted Cloud origin
    await requireRefusal(
      await newClient().call(shopCsrf, { headers: wrongOrigin }),
      403,
      "csrf_origin",
    );
    await requireRefusal(await mixed.call(shopCsrf, { headers: wrongOrigin }), 403, "csrf_origin");

    const issue = async (jar: TestClient, path = shopCsrf) => {
      const response = await jar.call(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const { token } = (await response.json()) as { token: string };
      expect(typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
      return token;
    };
    const valid = await issue(mixed);
    const other = await issue(aOtherSession);
    const generic = await issue(mixed, "/v1/csrf");
    expect(valid !== other && valid !== generic).toBe(true);
    const mutation = (
      jar: TestClient,
      headers: Record<string, string> = {},
      expectedUserId = a.id,
      path = shopFavorites,
    ) =>
      jar.call(`${path}/${product.id}`, {
        method: "POST",
        json: { saved: true, expectedUserId },
        headers,
        csrf: false,
      });
    await requireRefusal(await mutation(mixed), 403, "csrf_token");
    for (const invalid of ["A".repeat(43), other, generic])
      await requireRefusal(await mutation(mixed, tokenHeader(invalid)), 403, "csrf_token");
    await requireRefusal(
      await mutation(mixed, { ...tokenHeader(valid), ...wrongOrigin }),
      403,
      "csrf_origin",
    );
    await requireRefusal(
      await mutation(mixed, tokenHeader(valid), b.id),
      401,
      "commerce_account_changed",
    );
    await requireRefusal(
      await mutation(aShop, tokenHeader(valid), a.id, cloudFavorites),
      401,
      "unauthorized",
    );

    const favoritesRows = () =>
      db
        .select({ userId: schema.commerceFavorites.userId })
        .from(schema.commerceFavorites)
        .where(eq(schema.commerceFavorites.productId, product.id));
    expect(await favoritesRows()).toHaveLength(0);
    const save = await mutation(mixed, tokenHeader(valid));
    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({ userId: a.id, productId: product.id, saved: true });
    expect(await favoritesRows()).toEqual([{ userId: a.id }]);
    const aFavorites = await mixed.call(shopFavorites);
    expect(aFavorites.status).toBe(200);
    expect(await aFavorites.json()).toMatchObject({ userId: a.id, productIds: [product.id] });
    const bFavorites = await bCloud.call(cloudFavorites);
    expect(bFavorites.status).toBe(200);
    expect(await bFavorites.json()).toMatchObject({ userId: b.id, productIds: [] });
  } finally {
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
  }
}, 60_000);
