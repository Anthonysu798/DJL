import { Layer, ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";

import type { AdminAuth } from "../admin/AdminAuth.ts";
import type { Principal } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import type { CommerceService } from "./CommerceService.ts";
import { makeCommerceRoutes, makeScopedCommerceRoutes } from "./routes.ts";

const buyerId = "00000000-0000-4000-8000-000000000011";
const legacyId = "00000000-0000-4000-8000-000000000012";
const productId = "00000000-0000-4000-8000-000000000013";
const orderId = "00000000-0000-4000-8000-000000000014";
const traceId = "scoped-commerce-unit";
const prefix = "/v1/shop/commerce";
const origin = "http://shop.test";
const session = "test-shop-session=buyer";
const csrf = "synthetic-csrf";
const actor = { id: buyerId, type: "user", traceId };

const mutations = [
  [
    "favorites/" + productId,
    "setFavorite",
    { saved: true, expectedUserId: buyerId },
    [productId, true, buyerId],
  ],
  ["referrals/bind", "bindReferral", { code: "FRIEND" }, ["FRIEND"]],
  [
    "orders",
    "createOrder",
    { expectedUserId: buyerId, items: [] },
    [{ expectedUserId: buyerId, items: [] }],
  ],
  [
    "orders/" + orderId + "/test-pay",
    "testPay",
    { idempotencyKey: "mock-pay" },
    [orderId, "mock-pay"],
  ],
  [
    "orders/" + orderId + "/cancel",
    "cancelOrder",
    { idempotencyKey: "mock-cancel" },
    [orderId, "mock-cancel"],
  ],
  [
    "orders/" + orderId + "/returns",
    "requestReturn",
    { itemId: productId, reason: "QA" },
    [orderId, { itemId: productId, reason: "QA" }],
  ],
  ["withdrawals", "requestWithdrawal", { idempotencyKey: "mock-withdraw" }, ["mock-withdraw"]],
] as const;

function fixture(includeScoped = true) {
  const commerce = {
    mode: "test",
    paymentProvider: "simulation",
    catalog: vi.fn(async () => ({
      products: [],
      currency: "CAD",
      mode: "test",
      paymentProvider: "simulation",
    })),
    profile: vi.fn(async () => ({})),
    favorites: vi.fn(async () => ({})),
    setFavorite: vi.fn(async () => ({})),
    bindReferral: vi.fn(async () => ({})),
    listOrders: vi.fn(async () => ({})),
    createOrder: vi.fn(async () => ({})),
    testPay: vi.fn(async () => ({})),
    cancelOrder: vi.fn(async () => ({})),
    requestReturn: vi.fn(async () => ({})),
    wallet: vi.fn(async () => ({})),
    ledgerEntries: vi.fn(async () => ({})),
    listWithdrawals: vi.fn(async () => ({})),
    requestWithdrawal: vi.fn(async () => ({})),
    supplierProducts: vi.fn(async () => ({})),
    adminCatalog: vi.fn(async () => ({})),
  } as const;
  const service = commerce as unknown as CommerceService;
  // An injected boundary stub. These markers are not application credentials or CSRF logic.
  const scopedResolve = vi.fn(async (headers: Headers, write: boolean) => {
    if (headers.get("cookie") !== session || headers.has("authorization"))
      throw new ApiError(401, "unauthorized", "Shop sign-in required.");
    if (headers.get("origin") !== origin || (write && headers.get("x-csrf-token") !== csrf))
      throw new ApiError(403, "csrf", "Shop origin or CSRF rejected.");
    return { id: buyerId };
  });
  const legacyResolve = vi.fn(async () => ({ userId: legacyId, emailVerified: true }) as Principal);
  const adminResolve = vi.fn();
  const legacy = makeCommerceRoutes({
    commerce: service,
    principals: { resolve: legacyResolve },
    adminAuth: { resolve: adminResolve } as unknown as AdminAuth,
  });
  const router = HttpRouter.toWebHandler(
    includeScoped
      ? Layer.mergeAll(
          legacy,
          makeScopedCommerceRoutes({ commerce: service, buyer: { resolve: scopedResolve } }),
        )
      : legacy,
    { disableLogger: true },
  );
  const context = ServiceMap.make(RequestContext, {
    traceId,
    ip: "127.0.0.1",
    userAgent: null,
    region: "test",
    startedAt: Date.now(),
  });
  const call = (path: string, init?: RequestInit) =>
    router.handler(new Request(`${origin}${path}`, init), context);
  return { call, commerce, scopedResolve, legacyResolve, adminResolve, dispose: router.dispose };
}

const signedIn = { cookie: session, origin };

describe("scoped TEST buyer routes", () => {
  it.each([
    ["disabled", "disabled"],
    ["test", "stripe_test"],
    ["test", "disabled"],
  ] as const)("refuses route composition for %s / %s", (mode, paymentProvider) => {
    expect(() =>
      makeScopedCommerceRoutes({
        commerce: { mode, paymentProvider } as CommerceService,
        buyer: { resolve: async () => ({ id: buyerId }) },
      }),
    ).toThrow("Scoped commerce routes require simulated TEST commerce.");
  });

  it("preserves the public catalog, and never mounts the scoped alias in default routes", async () => {
    const f = fixture();
    const legacy = fixture(false);
    try {
      const guest = await f.call(`${prefix}/catalog`);
      expect(guest.status).toBe(200);
      expect(await guest.json()).toMatchObject({ mode: "test", paymentProvider: "simulation" });
      expect(f.scopedResolve).not.toHaveBeenCalled();
      expect(f.legacyResolve).not.toHaveBeenCalled();
      expect((await legacy.call("/v1/commerce/catalog")).status).toBe(200);
      expect((await legacy.call(`${prefix}/catalog`)).status).toBe(404);
    } finally {
      await Promise.all([f.dispose(), legacy.dispose()]);
    }
  });

  it("uses only the scoped buyer for alias reads and preserves the legacy identity on default routes", async () => {
    const f = fixture();
    try {
      expect((await f.call(`${prefix}/me?userId=forged`, { headers: signedIn })).status).toBe(200);
      expect(f.scopedResolve).toHaveBeenCalledExactlyOnceWith(expect.any(Headers), false);
      expect(f.scopedResolve.mock.calls[0]?.[0].get("origin")).toBe(origin);
      expect(f.legacyResolve).not.toHaveBeenCalled();
      expect(f.commerce.profile).toHaveBeenLastCalledWith(buyerId);
      expect((await f.call("/v1/commerce/me?userId=forged")).status).toBe(200);
      expect(f.legacyResolve).toHaveBeenCalledOnce();
      expect(f.scopedResolve).toHaveBeenCalledOnce();
      expect(f.commerce.profile).toHaveBeenLastCalledWith(legacyId);

      for (const [path, handler, args] of [
        ["favorites", "favorites", [buyerId]],
        ["orders?page=2", "listOrders", [buyerId, "2"]],
        ["wallet", "wallet", [buyerId]],
        ["wallet/entries?page=3", "ledgerEntries", [buyerId, "3"]],
        ["withdrawals?page=4", "listWithdrawals", [buyerId, "4"]],
      ] as const) {
        expect((await f.call(`${prefix}/${path}`, { headers: signedIn })).status).toBe(200);
        expect(f.commerce[handler]).toHaveBeenCalledExactlyOnceWith(...args);
        expect(f.scopedResolve.mock.lastCall?.[1]).toBe(false);
      }
    } finally {
      await f.dispose();
    }
  });

  it("rejects legacy cookie or bearer, missing session, and wrong Origin before private reads", async () => {
    const f = fixture();
    try {
      for (const headers of [
        { origin },
        { origin, cookie: "djl.session_token=legacy" },
        { origin, authorization: "Bearer old-cloud-token" },
      ]) {
        expect((await f.call(`${prefix}/me`, { headers })).status).toBe(401);
        expect(
          (
            await f.call(`${prefix}/orders`, {
              method: "POST",
              headers: { ...headers, "content-type": "application/json" },
              body: "{",
            })
          ).status,
        ).toBe(401);
      }
      expect(f.commerce.createOrder).not.toHaveBeenCalled();
      expect(
        (await f.call(`${prefix}/me`, { headers: { ...signedIn, origin: "http://other.test" } }))
          .status,
      ).toBe(403);
      expect(f.commerce.profile).not.toHaveBeenCalled();
      expect(f.legacyResolve).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });

  it.each(mutations)(
    "gates %s before JSON parsing or mutation, then forwards a verified actor",
    async (path, handler, body, args) => {
      const f = fixture();
      try {
        const url = `${prefix}/${path}`;
        const denied = await f.call(url, {
          method: "POST",
          headers: { ...signedIn, "content-type": "application/json" },
          body: "{",
        });
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { code: "csrf", traceId } });
        expect(f.commerce[handler]).not.toHaveBeenCalled();
        expect(f.scopedResolve.mock.lastCall?.[1]).toBe(true);

        const ok = await f.call(url, {
          method: "POST",
          headers: { ...signedIn, "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify(body),
        });
        expect(ok.status).toBe(200);
        expect(f.commerce[handler]).toHaveBeenCalledExactlyOnceWith(actor, ...args);
        expect(f.scopedResolve.mock.lastCall?.[0].get("x-csrf-token")).toBe(csrf);
        expect(f.scopedResolve.mock.lastCall?.[1]).toBe(true);
        expect(f.legacyResolve).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    },
  );

  it("does not alias supplier/admin operations, Stripe checkout or generic resources", async () => {
    const f = fixture();
    try {
      for (const path of [
        `${prefix}/supplier/products`,
        `${prefix}/admin/catalog`,
        `${prefix}/orders/${orderId}/payment`,
        `${prefix}/auth/get-session`,
        `${prefix}/files`,
        "/v1/shop/me",
        "/v1/shop/files",
      ])
        expect((await f.call(path, { headers: signedIn })).status).toBe(404);
      for (const path of [
        `${prefix}/orders/${orderId}/checkout`,
        `${prefix}/orders/${orderId}/checkout/cancel`,
        `${prefix}/webhooks/stripe-test`,
      ])
        expect((await f.call(path, { method: "POST", headers: signedIn })).status).toBe(404);
      expect(f.scopedResolve).not.toHaveBeenCalled();
      expect(f.legacyResolve).not.toHaveBeenCalled();
      expect(f.adminResolve).not.toHaveBeenCalled();
      expect(f.commerce.supplierProducts).not.toHaveBeenCalled();
      expect(f.commerce.adminCatalog).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
});
