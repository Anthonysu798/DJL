/** Real Better Auth cookies, CSRF middleware, HTTP listener, PostgreSQL and Redis.
 * External OTP delivery, password-breach lookup and providers are mocked; all data is synthetic. */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CommerceFavoritesResponse } from "@synara/contracts/cloud";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";

const connection = await isolatedCommerceTestDatabase();
let api: ApiRuntime | undefined;
let first: TestClient, second: TestClient, other: TestClient;
let buyerId: string, otherId: string, productId: string;
let breachLookups = 0;
const password = "correct-horse-battery-staple";

async function body<T>(response: Response, status = 200): Promise<T> {
  // Consume every response, but never attach auth cookies, OTPs or bodies to assertions/logs.
  const value: unknown = await response.json();
  const error =
    value && typeof value === "object"
      ? (value as { error?: { code?: unknown }; code?: unknown })
      : null;
  const code = error?.error?.code ?? error?.code;
  const diagnostic =
    typeof code === "string" && /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : "unclassified";
  expect(response.status, `HTTP status (${diagnostic})`).toBe(status);
  return value as T;
}
async function account(label: string) {
  const client = TestClient.for(api!);
  const email = `${label}-${crypto.randomUUID()}@test.invalid`;
  await body(
    await client.call("/v1/auth/sign-up/email", {
      method: "POST",
      json: { email, password, name: label },
    }),
  );
  const message = api!.outbox!.emails.findLast((mail) => mail.to === email && mail.tag === "otp");
  expect(Boolean(message)).toBe(true);
  const otp = message!.subject.match(/^(\d{6})/)![1];
  await body(
    await client.call("/v1/auth/email-otp/verify-email", {
      method: "POST",
      json: { email, otp },
    }),
  );
  const me = await body<{ user: { id: string } }>(await client.call("/v1/me"));
  return { client, email, password, id: me.user.id };
}
const save = (client: TestClient, userId: string, saved: boolean, csrf?: false) =>
  client.call(`/v1/commerce/favorites/${productId}`, {
    method: "POST",
    json: { expectedUserId: userId, saved },
    ...(csrf === false ? { csrf } : {}),
  });

beforeAll(async () => {
  const realFetch = globalThis.fetch;
  const prefix = createHash("sha1").update(password).digest("hex").slice(0, 5).toUpperCase();
  vi.stubGlobal(
    "fetch",
    Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname === "api.pwnedpasswords.com") {
          if (
            url.pathname !== `/range/${prefix}` ||
            (init?.method ?? "GET").toUpperCase() !== "GET"
          )
            throw new Error("Unexpected password-breach fixture request");
          breachLookups++;
          return Promise.resolve(
            new Response("00000000000000000000000000000000000:0\r\n", {
              headers: { "content-type": "text/plain" },
            }),
          );
        }
        return realFetch(input, init);
      },
      { preconnect: realFetch.preconnect },
    ) satisfies typeof fetch,
  );
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${connection.sql.options.database}`;
  api = await startApi({
    env: loadApiEnv({
      ...process.env,
      DATABASE_URL: url.href,
      DJL_ENV: "test",
      DJL_MOCK_EXTERNALS: "true",
      SMS_ENABLED: "false",
    }),
    host: "127.0.0.1",
    port: 0,
  });
  const a = await account("favorites-a"),
    b = await account("favorites-b");
  first = a.client;
  other = b.client;
  buyerId = a.id;
  otherId = b.id;
  second = TestClient.for(api);
  await body(
    await second.call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email: a.email, password: a.password },
    }),
  );
  const me = await body<{ user: { id: string } }>(await second.call("/v1/me"));
  expect(me.user.id).toBe(buyerId);
  const sessions = await connection.db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(eq(schema.session.userId, buyerId));
  expect(sessions.length).toBeGreaterThanOrEqual(2);
  const [supplier] = await connection.db
    .insert(schema.commerceSuppliers)
    .values({ name: "Synthetic HTTP supplier", returnAddress: "Synthetic address" })
    .returning();
  const [product] = await connection.db
    .insert(schema.commerceProducts)
    .values({
      supplierId: supplier!.id,
      sku: crypto.randomUUID(),
      name: "Synthetic HTTP favorite",
      description: "Synthetic fixture",
      category: "QA",
      imageUrl: "",
      priceCents: 100,
      costCents: 0,
      commissionBps: 0,
      returnDays: 30,
      stock: 5,
      status: "published",
    })
    .returning();
  productId = product!.id;
}, 30_000);
afterAll(async () => {
  try {
    await api?.close();
  } finally {
    vi.unstubAllGlobals();
    await connection.close();
  }
});

describe("authenticated favorite sharing across independent HTTP sessions", () => {
  it("shares a saved item across two separately logged-in clients without enabling commerce funds", async () => {
    await body(await save(first, buyerId, true));
    expect(
      await body<CommerceFavoritesResponse>(await second.call("/v1/commerce/favorites")),
    ).toEqual({ userId: buyerId, productIds: [productId] });
    expect(api!.commerce.mode).toBe("disabled");
    expect(breachLookups).toBeGreaterThan(0);
  });
  it("prevents another buyer and a rotated-account payload from modifying the first buyer's collection", async () => {
    await body(await save(first, buyerId, true));
    expect(
      await body<CommerceFavoritesResponse>(
        await other.call(`/v1/commerce/favorites?userId=${buyerId}`),
      ),
    ).toEqual({ userId: otherId, productIds: [] });
    const mismatch = await body<{ error: { code: string } }>(
      await save(other, buyerId, false),
      401,
    );
    expect(mismatch.error.code).toBe("commerce_account_changed");
    await body(
      await other.call(`/v1/commerce/favorites/${productId}`, {
        method: "POST",
        json: { userId: buyerId, expectedUserId: otherId, saved: false },
      }),
    );
    expect(
      (await body<CommerceFavoritesResponse>(await first.call("/v1/commerce/favorites")))
        .productIds,
    ).toEqual([productId]);
  });
  it("requires real sign-in and CSRF on cookie mutations", async () => {
    await body(await save(first, buyerId, true));
    const guest = TestClient.for(api!);
    await body(await guest.call("/v1/commerce/favorites"), 401);
    const denied = await body<{ error: { code: string } }>(
      await save(second, buyerId, false, false),
      403,
    );
    expect(denied.error.code).toBe("csrf_token");
    expect(
      (await body<CommerceFavoritesResponse>(await second.call("/v1/commerce/favorites")))
        .productIds,
    ).toEqual([productId]);
  });
  it("deduplicates actual HTTP replays and shares confirmed removal without orders, commission or inference", async () => {
    await body(await save(first, buyerId, true));
    await Promise.all(
      Array.from({ length: 4 }, async () => body(await save(first, buyerId, true))),
    );
    expect(
      (await body<CommerceFavoritesResponse>(await second.call("/v1/commerce/favorites")))
        .productIds,
    ).toEqual([productId]);
    await body(await save(second, buyerId, false));
    expect(
      (await body<CommerceFavoritesResponse>(await first.call("/v1/commerce/favorites")))
        .productIds,
    ).toEqual([]);
    expect(await connection.db.select().from(schema.commerceOrders)).toHaveLength(0);
    expect(await connection.db.select().from(schema.commerceLedger)).toHaveLength(0);
    expect(await connection.db.select().from(schema.usageRequests)).toHaveLength(0);
  });
});
