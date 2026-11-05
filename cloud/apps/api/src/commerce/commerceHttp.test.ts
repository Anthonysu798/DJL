/**
 * Real HTTP route layers + SQL services + an offline Stripe SDK adapter.
 * The identity resolvers below are injected test principals: this does NOT
 * verify Better Auth login, middleware/CSRF, a provider network, or cross-device sessions.
 * By default testDatabase uses migrated PostgreSQL, matching cloud CI.
 */
import Stripe from "stripe";
import { eq, inArray, sql } from "drizzle-orm";
import { schema } from "@djl/db";
import { Layer, ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CommerceOrder,
  CommercePaymentStatus,
  CommerceProfile,
  CommerceReferralSummaryResponse,
  CommerceWallet,
  CommerceExternalRefund,
  CommerceExternalRefundDetail,
  CommerceExternalRefundAllocationResult,
  CommerceSupplierStatement,
  CommerceAlertsResponse,
  CommerceAdminOrder,
  CommerceAdminWithdrawal,
  CommerceSupplierMemberList,
} from "@synara/contracts/cloud";

import type { AdminAuth, AdminPrincipal } from "../admin/AdminAuth.ts";
import type { Principal, PrincipalResolver } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { CommerceService } from "./CommerceService.ts";
import { CommerceAlertsService } from "./CommerceAlertsService.ts";
import { makeCommerceAlertRoutes } from "./alertRoutes.ts";
import { CommercePaymentService } from "./CommercePaymentService.ts";
import { createCommerceStripeGateway, type CommerceStripeSdk } from "./CommerceStripeGateway.ts";
import { makeCommerceRoutes, makeScopedCommerceRoutes } from "./routes.ts";
import { COMMERCE_STRIPE_TEST_WEBHOOK_PATH, makeCommercePaymentRoutes } from "./paymentRoutes.ts";

const conn = await isolatedCommerceTestDatabase();
const key = () => crypto.randomUUID();
const offlineSecret = "sk_test_offline_http_fixture";
const webhookSecret = "whsec_offline_http_fixture";
const address = {
  name: "HTTP fixture buyer",
  line1: "100 Test Street",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA",
};
const disposers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  await conn.db.execute(sql`select 1 from commerce_payment_attempts limit 1`);
});
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});
afterAll(() => conn.close());

async function json<T>(response: Response, status = 200): Promise<T> {
  const value: unknown = await response.json();
  expect(response.status, JSON.stringify(value)).toBe(status);
  return value as T;
}

function fixture(paymentProvider: "simulation" | "stripe_test" = "simulation") {
  const now = new Date();
  const commerce = new CommerceService(conn.db, {
    mode: "test",
    environment: "test",
    paymentProvider,
    now: () => now,
  });
  const identities = new Map<string, Principal>();
  const sessions = new Map<string, Stripe.Checkout.Session>();
  const externalRefunds = new Map<string, Stripe.Refund>();
  const sdk: CommerceStripeSdk = {
    checkout: {
      sessions: {
        create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
          const id = `cs_test_${key().replaceAll("-", "")}`;
          const value = {
            id,
            url: `https://checkout.stripe.com/c/pay/${id}`,
            payment_intent: null,
            amount_total: params.line_items!.reduce(
              (sum, item) => sum + Number(item.price_data!.unit_amount) * Number(item.quantity),
              0,
            ),
            currency: "cad",
            payment_status: "unpaid",
            status: "open",
            livemode: false,
            metadata: params.metadata,
            expires_at: params.expires_at,
          } as Stripe.Checkout.Session;
          sessions.set(id, value);
          return structuredClone(value);
        }),
        retrieve: vi.fn(async (id) => {
          const value = sessions.get(id);
          if (!value) throw new Error("Offline fixture session missing");
          return structuredClone(value);
        }),
        expire: vi.fn(async (id) => {
          const value = sessions.get(id)!;
          value.status = "expired";
          value.url = null;
          return structuredClone(value);
        }),
      },
    },
    refunds: {
      create: vi.fn(async () => {
        throw new Error("No refund IO in this HTTP fixture");
      }),
      retrieve: vi.fn(async (id) => {
        const value = externalRefunds.get(id);
        if (!value) throw new Error("Offline fixture refund missing");
        return structuredClone(value);
      }),
    },
    webhooks: new Stripe(offlineSecret).webhooks,
  };
  const commercePayments = new CommercePaymentService(commerce, {
    enabled: true,
    environment: "test",
    webPublicUrl: "http://127.0.0.1:3002",
    now: () => now,
    gateway: createCommerceStripeGateway({ secretKey: offlineSecret, webhookSecret, stripe: sdk }),
  });
  const principals: PrincipalResolver = {
    resolve: async ({ headers }) => {
      const identity = identities.get(headers.get("x-fixture-user") ?? "");
      if (!identity) throw new ApiError(401, "unauthorized", "Injected fixture identity required.");
      return identity;
    },
  };
  const administrator: AdminPrincipal = {
    adminId: key(),
    email: "http-admin@test.invalid",
    role: "admin",
    sessionId: "offline-admin",
    mfaVerified: true,
  };
  const adminAuth = {
    resolve: async (token: string | null) => {
      if (token === "offline-admin") return administrator;
      if (token === "offline-no-mfa") return { ...administrator, mfaVerified: false };
      if (token === "offline-employee") return { ...administrator, role: "employee" };
      throw new ApiError(401, "unauthorized", "Injected administrator required.");
    },
  } as unknown as AdminAuth;
  const commerceAlerts = new CommerceAlertsService(conn.db, {
    enabled: true,
    environment: "test",
    now: () => now,
  });
  const deps = { commerce, commercePayments, commerceAlerts, principals, adminAuth };
  const router = HttpRouter.toWebHandler(
    Layer.mergeAll(
      makeCommerceRoutes(deps),
      makeCommercePaymentRoutes(deps),
      makeCommerceAlertRoutes(deps),
    ),
    { disableLogger: true },
  );
  disposers.push(router.dispose);
  const context = ServiceMap.make(RequestContext, {
    traceId: `commerce-http-${key()}`,
    ip: "127.0.0.1",
    userAgent: null,
    region: "test",
    startedAt: Date.now(),
  });
  const call = (
    path: string,
    options: {
      user?: string;
      admin?: "offline-admin" | "offline-no-mfa" | "offline-employee";
      method?: string;
      body?: unknown;
      raw?: string;
      headers?: Record<string, string>;
    } = {},
  ) =>
    router.handler(
      new Request(`http://commerce.test${path}`, {
        method:
          options.method ??
          (options.body === undefined && options.raw === undefined ? "GET" : "POST"),
        headers: {
          "content-type": "application/json",
          ...(options.user ? { "x-fixture-user": options.user } : {}),
          ...(options.admin ? { authorization: `Bearer ${options.admin}` } : {}),
          ...options.headers,
        },
        ...(options.body === undefined && options.raw === undefined
          ? {}
          : { body: options.raw ?? JSON.stringify(options.body) }),
      }),
      context,
    );
  const user = async () => {
    const id = key();
    await conn.db.insert(schema.user).values({
      id,
      name: "HTTP commerce fixture",
      email: `${id}@test.invalid`,
      emailVerified: true,
    });
    identities.set(id, {
      userId: id,
      email: `${id}@test.invalid`,
      emailVerified: true,
      banned: false,
      sessionId: key(),
      orgId: key(),
      personalOrgId: key(),
      role: "owner",
    });
    return id;
  };
  const stock = async () => {
    const supplierUser = await user();
    const { supplier } = await json<{ supplier: { id: string } }>(
      await call("/admin/v1/commerce/suppliers", {
        admin: "offline-admin",
        body: {
          name: "HTTP Canadian supplier",
          returnAddress: "Toronto, ON, Canada",
          reason: "HTTP test administrator approved supplier creation",
          idempotencyKey: key(),
        },
      }),
    );
    await json(
      await call(`/admin/v1/commerce/suppliers/${supplier.id}/members`, {
        admin: "offline-admin",
        body: {
          userId: supplierUser,
          reason: "HTTP test administrator approved supplier membership",
        },
      }),
    );
    const { product } = await json<{ product: { id: string; sku: string } }>(
      await call("/admin/v1/commerce/catalog", {
        admin: "offline-admin",
        body: {
          supplierId: supplier.id,
          sku: key(),
          name: "HTTP test tote",
          description: "Saved HTTP product snapshot",
          category: "Bags",
          imageUrl: "/shop/media/http-tote.png",
          priceCents: 10000,
          costCents: 4000,
          commissionBps: 1000,
          returnDays: 30,
          stock: 20,
          status: "published",
          reason: "Test-only administrator checked supplier quote and approved catalog change",
        },
      }),
    );
    return { supplierUser, supplierId: supplier.id, product };
  };
  const order = async (buyer: string, productId: string, idempotencyKey = key()) =>
    (
      await json<{ order: CommerceOrder }>(
        await call("/v1/commerce/orders", {
          user: buyer,
          body: {
            items: [{ productId, quantity: 1 }],
            address,
            idempotencyKey,
            priceCents: 1,
            totalCents: 1,
            ownerId: "ignored",
          },
        }),
      )
    ).order;
  const reviewedClose = async (orderId: string, itemId: string, reason: string) => {
    const { order: reviewed } = await json<{ order: CommerceAdminOrder }>(
      await call(`/admin/v1/commerce/orders/${orderId}`, { admin: "offline-admin" }),
    );
    const revision = reviewed.items.find((item) => item.id === itemId)?.caseRevision;
    expect(revision).toMatch(/^[0-9a-f]{64}$/);
    return call(`/admin/v1/commerce/items/${itemId}/case`, {
      admin: "offline-admin",
      body: { reviewedClose: { reason, revision } },
    });
  };
  const event = async (type: string, object: unknown) => {
    const raw = JSON.stringify({
      id: `evt_${key().replaceAll("-", "")}`,
      object: "event",
      type,
      livemode: false,
      data: { object },
    });
    const signature = new Stripe(offlineSecret).webhooks.generateTestHeaderString({
      payload: raw,
      secret: webhookSecret,
    });
    return { raw, headers: { "stripe-signature": signature } };
  };
  return {
    call,
    user,
    stock,
    order,
    reviewedClose,
    sessions,
    externalRefunds,
    event,
    sdk,
    commerceAlerts,
    now,
    administrator,
  };
}

describe("commerce HTTP + SQL integration with injected identities and offline provider IO", () => {
  it("exposes only the opted-in current buyer referral totals through both read routes", async () => {
    const f = fixture();
    const [referrer, buyer, unrelated] = await Promise.all([f.user(), f.user(), f.user()]);
    const { product } = await f.stock();
    const ordinary = "/v1/commerce/me";
    const selected = "?referralSummary=1";
    const profile = await json<CommerceProfile>(await f.call(ordinary, { user: referrer }));
    expect(profile).not.toHaveProperty("referralSummary");
    await json(
      await f.call("/v1/commerce/referrals/bind", {
        user: buyer,
        body: { code: profile.referralCode },
      }),
    );
    const purchase = await f.order(buyer, product.id);
    await json(
      await f.call(`/v1/commerce/orders/${purchase.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    const snapshot = () =>
      Promise.all([
        conn.db.select().from(schema.commerceCustomers).orderBy(schema.commerceCustomers.userId),
        conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
        conn.db.select().from(schema.auditEvents).orderBy(schema.auditEvents.id),
      ]);
    const prior = await snapshot();
    const expected = {
      userId: referrer,
      referralSummary: {
        mode: "test",
        currency: "CAD",
        directBuyers: 1,
        ordersWithCommission: 1,
        netCommissionCents: 1000,
      },
    };
    const own = await f.call(ordinary + selected, { user: referrer });
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect(await json<CommerceReferralSummaryResponse>(own)).toEqual(expected);
    await json(await f.call(ordinary + selected), 401);
    await json(await f.call(ordinary + selected + "&referralSummary=0", { user: referrer }), 400);

    const commerce = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      now: () => f.now,
    });
    const router = HttpRouter.toWebHandler(
      makeScopedCommerceRoutes({
        commerce,
        buyer: {
          async resolve(headers) {
            const id = headers.get("x-fixture-user");
            if (id !== referrer && id !== unrelated)
              throw new ApiError(401, "unauthorized", "Injected fixture identity required.");
            return { id };
          },
        },
      }),
      { disableLogger: true },
    );
    disposers.push(router.dispose);
    const context = ServiceMap.make(RequestContext, {
      traceId: `referral-summary-http-${key()}`,
      ip: "127.0.0.1",
      userAgent: null,
      region: "test",
      startedAt: Date.now(),
    });
    const scoped = (query: string, user?: string) =>
      router.handler(
        new Request(`http://commerce.test/v1/shop/commerce/me${query}`, {
          headers: user ? { "x-fixture-user": user } : {},
        }),
        context,
      );
    const scopedOwn = await scoped(selected, referrer);
    expect(scopedOwn.headers.get("cache-control")).toContain("no-store");
    expect(await json(scopedOwn)).toEqual(expected);
    await json(await scoped(selected), 401);
    expect(await json(await scoped(selected + "&userId=" + referrer, unrelated))).toEqual({
      userId: unrelated,
      referralSummary: {
        mode: "test",
        currency: "CAD",
        directBuyers: 0,
        ordersWithCommission: 0,
        netCommissionCents: 0,
      },
    });
    expect(await snapshot()).toEqual(prior);
    expect(await json(await scoped("", referrer))).not.toHaveProperty("referralSummary");
  });

  it("keeps scoped Canadian checkout validation and exact recovery when new orders are paused", async () => {
    const f = fixture();
    const [owner, other] = await Promise.all([f.user(), f.user()]);
    const { product } = await f.stock();
    const routing = (checkoutPaused: boolean) => {
      const commerce = new CommerceService(conn.db, {
        mode: "test",
        environment: "test",
        checkoutPaused,
        now: () => f.now,
      });
      const router = HttpRouter.toWebHandler(
        makeScopedCommerceRoutes({
          commerce,
          buyer: {
            async resolve(headers, write) {
              const id = headers.get("x-fixture-user");
              if (id !== owner && id !== other)
                throw new ApiError(401, "unauthorized", "Injected fixture identity required.");
              if (write && headers.get("x-csrf-token") !== "synthetic-scoped-proof")
                throw new ApiError(403, "forbidden", "Injected write proof required.");
              return { id };
            },
          },
        }),
        { disableLogger: true },
      );
      disposers.push(router.dispose);
      const context = ServiceMap.make(RequestContext, {
        traceId: `scoped-checkout-${key()}`,
        ip: "127.0.0.1",
        userAgent: null,
        region: "test",
        startedAt: Date.now(),
      });
      return (user: string, body: unknown, csrf = true, suffix: "" | "/recover" = "") =>
        router.handler(
          new Request(`http://commerce.test/v1/shop/commerce/orders${suffix}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-fixture-user": user,
              ...(csrf ? { "x-csrf-token": "synthetic-scoped-proof" } : {}),
            },
            body: JSON.stringify(body),
          }),
          context,
        );
    };
    const open = routing(false);
    const paused = routing(true);
    const vancouver = { ...address, city: "Vancouver", province: "BC", postalCode: "V6B 1A1" };
    const intent = {
      items: [{ productId: product.id, quantity: 1 }],
      address: vancouver,
      idempotencyKey: key(),
    };
    const saved = () =>
      conn.db.select().from(schema.commerceOrders).where(eq(schema.commerceOrders.userId, owner));
    await json(await open(owner, { ...intent, address: { ...vancouver, province: "" } }), 400);
    expect(await saved()).toHaveLength(0);
    // Treat the successful response body as lost. Recovery must use the original intent.
    const lost = await open(owner, intent);
    expect(lost.status).toBe(200);
    await lost.body?.cancel();
    const [stored] = await saved();
    expect(stored).toMatchObject({ address: { province: "BC", postalCode: "V6B1A1" } });
    await json(await paused(owner, intent, false), 403);
    const { order: replay } = await json<{ order: CommerceOrder }>(await paused(owner, intent));
    expect(replay).toMatchObject({
      id: stored!.id,
      status: "awaiting_payment",
      paymentProvider: "simulation",
    });
    await json(
      await paused(owner, { ...intent, items: [{ productId: product.id, quantity: 2 }] }),
      409,
    );
    await json(await paused(owner, { ...intent, idempotencyKey: key() }), 503);
    await json(await paused(other, intent), 503);
    expect(await saved()).toHaveLength(1);
    const [inventory] = await conn.db
      .select({ reserved: schema.commerceProducts.reserved })
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.id, product.id));
    expect(inventory?.reserved).toBe(1);

    const recover = { expectedUserId: owner, idempotencyKey: intent.idempotencyKey };
    await json(await paused(owner, recover, false, "/recover"), 403);
    await json(await paused(other, recover, true, "/recover"), 401);
    const response = await paused(owner, recover, true, "/recover");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await json(response)).toMatchObject({ status: "found", order: { id: stored!.id } });

    const notYetCreated = { expectedUserId: owner, idempotencyKey: key() };
    expect(await json(await paused(owner, notYetCreated, true, "/recover"))).toEqual({
      status: "closed",
    });
    expect(await json(await paused(owner, notYetCreated, true, "/recover"))).toEqual({
      status: "closed",
    });
    expect(await json(await open(owner, { ...intent, ...notYetCreated }), 409)).toMatchObject({
      error: { code: "checkout_attempt_closed" },
    });
    await json(await open(other, { ...intent, expectedUserId: owner, idempotencyKey: key() }), 401);
    expect(await saved()).toHaveLength(1);
  });

  it("requires and persists catalog review reasons and archives an existing inactive supplier SKU through the real routes", async () => {
    const f = fixture(),
      { product, supplierId } = await f.stock();
    const path = `/admin/v1/commerce/catalog/${product.id}`;
    const [original] = await conn.db
      .select()
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.id, product.id));
    const auditBefore = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.targetId, product.id));
    await json(
      await f.call(path, { admin: "offline-admin", method: "PATCH", body: { priceCents: 11000 } }),
      400,
    );
    await json(
      await f.call("/admin/v1/commerce/catalog", {
        admin: "offline-admin",
        body: { ...original, sku: key(), reason: " " },
      }),
      400,
    );
    expect(
      (
        await conn.db
          .select()
          .from(schema.commerceProducts)
          .where(eq(schema.commerceProducts.id, product.id))
      )[0],
    ).toEqual(original);
    expect(
      await conn.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.targetId, product.id)),
    ).toEqual(auditBefore);
    await json(
      await f.call(`/admin/v1/commerce/suppliers/${supplierId}/status`, {
        admin: "offline-admin",
        body: { active: false, reason: "Synthetic supplier paused" },
      }),
    );
    const reason = "Synthetic operator archived the inactive supplier listing";
    await json(
      await f.call(path, {
        admin: "offline-admin",
        method: "PATCH",
        body: { status: "archived", reason: ` ${reason} ` },
      }),
    );
    expect(
      (
        await conn.db
          .select()
          .from(schema.commerceProducts)
          .where(eq(schema.commerceProducts.id, product.id))
      )[0],
    ).toMatchObject({ supplierId, status: "archived" });
    expect(
      (
        await conn.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.reason, reason))
      )[0],
    ).toMatchObject({
      action: "commerce.product.save",
      targetId: product.id,
      reason,
      after: { reason, status: "archived" },
    });
    await json(
      await f.call(path, {
        admin: "offline-admin",
        method: "PATCH",
        body: { status: "published", reason },
      }),
      404,
    );
  });

  it("accepts an owned fulfilled full-refund support request without another refund or any new financial posting", async () => {
    const f = fixture(),
      { product, supplierUser } = await f.stock(),
      buyer = await f.user(),
      stranger = await f.user();
    const order = await f.order(buyer, product.id),
      itemId = order.items[0]!.id;
    await json(
      await f.call(`/v1/commerce/orders/${order.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    await json(
      await f.call(`/v1/commerce/supplier/items/${itemId}/accept`, {
        user: supplierUser,
        body: {},
      }),
    );
    await json(
      await f.call(`/v1/commerce/supplier/items/${itemId}/ship`, {
        user: supplierUser,
        body: { carrier: "Synthetic courier", trackingNumber: key() },
      }),
    );
    await json(
      await f.call(`/admin/v1/commerce/items/${itemId}/refund`, {
        admin: "offline-admin",
        body: {
          refundTotalCents: 10000,
          reason: "Synthetic full refund; physical return remains",
          idempotencyKey: key(),
        },
      }),
    );
    const ledger = await conn.db
      .select()
      .from(schema.commerceLedger)
      .orderBy(schema.commerceLedger.id);
    const snapshot = await conn.db
      .select()
      .from(schema.commerceOrders)
      .where(eq(schema.commerceOrders.id, order.id));
    const body = { itemId, reason: "Physical return still requires support after refund" };
    await json(
      await f.call(`/v1/commerce/orders/${order.id}/returns`, { user: stranger, body }),
      404,
    );
    const result = await json<{ order: CommerceOrder }>(
      await f.call(`/v1/commerce/orders/${order.id}/returns`, { user: buyer, body }),
    );
    expect(result.order).toMatchObject({ status: "refunded", refundedCents: 10000 });
    expect(result.order.items[0]).toMatchObject({ status: "shipped", openCase: true });
    expect(
      await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    ).toEqual(ledger);
    expect(
      await conn.db
        .select()
        .from(schema.commerceOrders)
        .where(eq(schema.commerceOrders.id, order.id)),
    ).toEqual(snapshot);
    expect(
      (
        await json<{ order: CommerceAdminOrder }>(
          await f.call(`/admin/v1/commerce/orders/${order.id}`, { admin: "offline-admin" }),
        )
      ).order.items[0]?.returnRequest?.reason,
    ).toBe(body.reason);
    expect(f.sdk.refunds.create).not.toHaveBeenCalled();
  });

  it("replays a lost buyer return across both authenticated HTTP routes without reopening staff-closed work", async () => {
    const f = fixture();
    const [buyer, other] = await Promise.all([f.user(), f.user()]);
    const { product, supplierUser } = await f.stock();
    const order = await f.order(buyer, product.id);
    const itemId = order.items[0]!.id;
    await json(
      await f.call(`/v1/commerce/orders/${order.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    const commerce = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      now: () => f.now,
    });
    const scoped = HttpRouter.toWebHandler(
      makeScopedCommerceRoutes({
        commerce,
        buyer: {
          async resolve(headers, write) {
            const id = headers.get("x-fixture-user");
            if (id !== buyer && id !== other)
              throw new ApiError(401, "unauthorized", "Injected fixture identity required.");
            if (write && headers.get("x-csrf-token") !== "synthetic-return-proof")
              throw new ApiError(403, "forbidden", "Injected write proof required.");
            return { id };
          },
        },
      }),
      { disableLogger: true },
    );
    disposers.push(scoped.dispose);
    const context = ServiceMap.make(RequestContext, {
      traceId: `scoped-return-${key()}`,
      ip: "127.0.0.1",
      userAgent: null,
      region: "test",
      startedAt: Date.now(),
    });
    const standardPath = `/v1/commerce/orders/${order.id}/returns`;
    const callScoped = (user: string, body: unknown, proof = true) =>
      scoped.handler(
        new Request(`http://commerce.test/v1/shop/commerce/orders/${order.id}/returns`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fixture-user": user,
            ...(proof ? { "x-csrf-token": "synthetic-return-proof" } : {}),
          },
          body: JSON.stringify(body),
        }),
        context,
      );
    const intent = {
      request: { itemId, reason: "Synthetic buyer reports a torn seam" },
      expectedUserId: buyer,
      idempotencyKey: key(),
    };
    const audits = () =>
      conn.db
        .select({ id: schema.auditEvents.id })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "commerce.item.return-request"))
        .orderBy(schema.auditEvents.id);
    const accounting = () =>
      Promise.all([
        conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
        conn.db
          .select()
          .from(schema.commerceProducts)
          .where(eq(schema.commerceProducts.id, product.id)),
      ]);
    const baselineAudits = await audits();
    const baselineAccounting = await accounting();
    await json(await callScoped(buyer, intent, false), 403);
    await json(await callScoped(other, intent), 401);
    await json(await callScoped(other, { ...intent, expectedUserId: other }), 404);
    await json(
      await f.call(standardPath, {
        user: buyer,
        body: { ...intent, itemId, reason: intent.request.reason },
      }),
      400,
    );
    expect(await audits()).toEqual(baselineAudits);

    // Server committed, but the buyer never got the response body.
    const lost = await callScoped(buyer, intent);
    expect(lost.status).toBe(200);
    expect(lost.headers.get("cache-control")).toContain("no-store");
    await lost.body?.cancel();
    expect(await audits()).toHaveLength(baselineAudits.length + 1);
    const blocked = await f.call(`/v1/commerce/supplier/items/${itemId}/accept`, {
      user: supplierUser,
      body: {},
    });
    await json(blocked, 409);
    await json(
      await f.reviewedClose(
        order.id,
        itemId,
        "Synthetic staff reviewed the report and resolved it",
      ),
    );

    const ordinary = await json<{ order: CommerceOrder }>(
      await f.call(standardPath, { user: buyer, body: intent }),
    );
    expect(ordinary.order.items[0]).toMatchObject({ id: itemId, openCase: false });
    const scopedReplay = await json<{ order: CommerceOrder }>(
      await callScoped(buyer, {
        ...intent,
        request: { ...intent.request, reason: `  ${intent.request.reason}  ` },
      }),
    );
    expect(scopedReplay.order.items[0]).toMatchObject({ id: itemId, openCase: false });
    expect(
      await json(
        await callScoped(buyer, {
          ...intent,
          request: { ...intent.request, reason: "This is not the original report" },
        }),
        409,
      ),
    ).toMatchObject({ error: { code: "idempotency_conflict" } });
    expect(await audits()).toHaveLength(baselineAudits.length + 1);
    expect(await accounting()).toEqual(baselineAccounting);
    await json(
      await f.call(`/v1/commerce/supplier/items/${itemId}/accept`, {
        user: supplierUser,
        body: {},
      }),
    );

    const newRequest = await json<{ order: CommerceOrder }>(
      await callScoped(buyer, {
        ...intent,
        idempotencyKey: key(),
        request: { ...intent.request, reason: "A new and separate follow-up question" },
      }),
    );
    expect(newRequest.order.items[0]).toMatchObject({ id: itemId, openCase: true });
    expect(await audits()).toHaveLength(baselineAudits.length + 2);
    expect(await accounting()).toEqual(baselineAccounting);
    expect(f.sdk.refunds.create).not.toHaveBeenCalled();
  });

  it("rejects an old staff review of case A after a buyer opens case B through the real routes", async () => {
    const f = fixture();
    const buyer = await f.user();
    const { product, supplierUser } = await f.stock();
    const order = await f.order(buyer, product.id);
    const itemId = order.items[0]!.id;
    const base = `/v1/commerce/orders/${order.id}`;
    const staffOrder = () =>
      f
        .call(`/admin/v1/commerce/orders/${order.id}`, { admin: "offline-admin" })
        .then((response) => json<{ order: CommerceAdminOrder }>(response));
    const casePath = `/admin/v1/commerce/items/${itemId}/case`;
    await json(await f.call(base + "/test-pay", { user: buyer, body: { idempotencyKey: key() } }));
    const returnRequest = (reason: string) =>
      f.call(base + "/returns", {
        user: buyer,
        body: {
          request: { itemId, reason },
          expectedUserId: buyer,
          idempotencyKey: key(),
        },
      });
    await json(await returnRequest("Synthetic support round A"));
    const first = (await staffOrder()).order.items[0]!;
    const commerce = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      now: () => f.now,
    });
    // Staff 1 resolves A using its own review; staff 2 retains the A snapshot.
    await commerce.setOpenCase(
      { id: f.administrator.adminId, type: "admin", traceId: "synthetic-staff-case-review" },
      itemId,
      false,
      "Staff 1 reviewed and resolved A",
      first.caseRevision,
    );
    await json(await returnRequest("A separate synthetic buyer question opens B"));
    const second = (await staffOrder()).order.items[0]!;
    const caseAudits = () =>
      conn.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "commerce.item.case"))
        .orderBy(schema.auditEvents.id);
    const accounting = () =>
      Promise.all([
        conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
        conn.db
          .select()
          .from(schema.commerceProducts)
          .where(eq(schema.commerceProducts.id, product.id)),
      ]);
    const beforeAudit = await caseAudits();
    const beforeAccounting = await accounting();
    const oldReason = "Staff 2 is looking at the old evidence for A";
    expect(
      await json(
        await f.call(casePath, {
          admin: "offline-admin",
          body: { open: false, reason: oldReason },
        }),
        409,
      ),
    ).toMatchObject({ error: { code: "commerce_case_review_required" } });

    expect(first.caseRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(second.caseRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(second.caseRevision).not.toBe(first.caseRevision);
    const stale = { reviewedClose: { reason: oldReason, revision: first.caseRevision } };
    await json(await f.call(casePath, { admin: "offline-no-mfa", body: stale }), 403);
    await json(
      await f.call(casePath, { admin: "offline-admin", body: { ...stale, open: false } }),
      400,
    );
    expect(
      await json(
        await f.call(casePath, {
          admin: "offline-admin",
          body: stale,
        }),
        409,
      ),
    ).toMatchObject({ error: { code: "commerce_case_review_stale" } });
    expect((await staffOrder()).order.items[0]).toMatchObject({
      openCase: true,
      caseRevision: second.caseRevision,
    });
    expect(await caseAudits()).toEqual(beforeAudit);
    expect(await accounting()).toEqual(beforeAccounting);

    const listed = await json<{ orders: CommerceAdminOrder[] }>(
      await f.call("/admin/v1/commerce/orders", { admin: "offline-admin" }),
    );
    expect(listed.orders.find(({ id }) => id === order.id)?.items[0]?.caseRevision).toBe(
      second.caseRevision,
    );
    for (const [path, user] of [
      ["/v1/commerce/orders", buyer],
      ["/v1/commerce/supplier/orders", supplierUser],
    ] as const) {
      const publicView: unknown = await json(await f.call(path, { user }));
      expect(JSON.stringify(publicView)).not.toContain("caseRevision");
    }

    await json(
      await f.call(casePath, {
        admin: "offline-admin",
        body: { reviewedClose: { reason: "Fresh review of B", revision: second.caseRevision } },
      }),
    );
    expect((await staffOrder()).order.items[0]).toMatchObject({ openCase: false });
    expect(await caseAudits()).toHaveLength(beforeAudit.length + 1);
    expect(await accounting()).toEqual(beforeAccounting);
  });

  it("replays supplier creation through HTTP without a second insert or audit and rejects changed payloads", async () => {
    const f = fixture(),
      body = {
        name: "HTTP same intent supplier",
        returnAddress: "Toronto",
        reason: "Explicit approved creation intent",
        idempotencyKey: key(),
      };
    const created = await json<{ supplier: { id: string; active: boolean } }>(
      await f.call("/admin/v1/commerce/suppliers", { admin: "offline-admin", body }),
    );
    const replay = await json<{ supplier: { id: string; active: boolean } }>(
      await f.call("/admin/v1/commerce/suppliers", {
        admin: "offline-admin",
        body: { ...body, name: ` ${body.name} `, reason: ` ${body.reason} ` },
      }),
    );
    expect(replay.supplier.id).toBe(created.supplier.id);
    expect(
      (
        await f.call("/admin/v1/commerce/suppliers", {
          admin: "offline-admin",
          body: { ...body, returnAddress: "Changed payload" },
        })
      ).status,
    ).toBe(409);
    await json(
      await f.call(`/admin/v1/commerce/suppliers/${created.supplier.id}/status`, {
        admin: "offline-admin",
        body: { active: false, reason: "Temporarily disabled" },
      }),
    );
    const inactive = await json<{ supplier: { id: string; active: boolean } }>(
      await f.call("/admin/v1/commerce/suppliers", { admin: "offline-admin", body }),
    );
    expect(inactive.supplier).toMatchObject({ id: created.supplier.id, active: false });
    expect(
      await conn.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.targetId, created.supplier.id)),
    ).toHaveLength(2);
    const { idempotencyKey: _key, ...missingKey } = body;
    expect(
      (await f.call("/admin/v1/commerce/suppliers", { admin: "offline-admin", body: missingKey }))
        .status,
    ).toBe(400);
  });
  it("enforces MFA-scoped supplier revocation and status routes against real SQL without changing accounting history", async () => {
    const f = fixture(),
      a = await f.stock(),
      other = await f.stock(),
      buyer = await f.user(),
      retained = await f.user();
    const base = `/admin/v1/commerce/suppliers/${a.supplierId}`;
    const reason = "HTTP administrator independently reviewed supplier access";
    await json(
      await f.call(`${base}/members`, {
        admin: "offline-admin",
        body: { userId: retained, reason },
      }),
    );
    const purchase = await f.order(buyer, a.product.id);
    await json(
      await f.call(`/v1/commerce/orders/${purchase.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    const ledgerBefore = await conn.db
      .select()
      .from(schema.commerceLedger)
      .orderBy(schema.commerceLedger.id);
    const current = await json<CommerceSupplierMemberList>(
      await f.call(`${base}/members?ownerId=forged&userId=forged`, { admin: "offline-admin" }),
    );
    expect(current.supplier).toMatchObject({ id: a.supplierId, active: true });
    expect(current.members).toEqual(
      [a.supplierUser, retained].toSorted().map((userId) => ({ userId })),
    );
    for (const principal of [undefined, "offline-no-mfa", "offline-employee"] as const) {
      const expected = principal === undefined ? 401 : 403;
      const authorization = principal === undefined ? {} : { admin: principal };
      expect(
        (await f.call(`${base}/members`, { user: a.supplierUser, ...authorization })).status,
      ).toBe(expected);
      expect(
        (
          await f.call(`${base}/members/${a.supplierUser}/revoke`, {
            user: a.supplierUser,
            ...authorization,
            body: { reason },
          })
        ).status,
      ).toBe(expected);
      expect(
        (
          await f.call(`${base}/status`, {
            user: a.supplierUser,
            ...authorization,
            body: { active: false, reason },
          })
        ).status,
      ).toBe(expected);
    }
    for (const body of [
      { active: false },
      { active: "false", reason },
      { active: false, reason: " " },
    ])
      expect((await f.call(`${base}/status`, { admin: "offline-admin", body })).status).toBe(400);
    expect(
      (
        await f.call(`${base}/members/${a.supplierUser}/revoke`, {
          admin: "offline-admin",
          body: {},
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call(
          `/admin/v1/commerce/suppliers/${other.supplierId}/members/${a.supplierUser}/revoke`,
          { admin: "offline-admin", body: { reason } },
        )
      ).status,
    ).toBe(404);
    expect((await f.call(`${base}/members?page=-1`, { admin: "offline-admin" })).status).toBe(400);
    await json(
      await f.call(`${base}/status`, {
        admin: "offline-admin",
        body: { active: false, reason: ` ${reason} ` },
      }),
    );
    expect((await f.call("/v1/commerce/supplier/products", { user: a.supplierUser })).status).toBe(
      403,
    );
    expect(
      (
        await f.call("/v1/commerce/orders", {
          user: buyer,
          body: {
            items: [{ productId: a.product.id, quantity: 1 }],
            address,
            idempotencyKey: key(),
          },
        })
      ).status,
    ).toBe(409);
    await json(
      await f.call(`${base}/members/${a.supplierUser}/revoke`, {
        admin: "offline-admin",
        body: { reason, userId: retained, supplierId: other.supplierId, actorId: "forged" },
      }),
    );
    await json(
      await f.call(`${base}/status`, { admin: "offline-admin", body: { active: true, reason } }),
    );
    expect((await f.call("/v1/commerce/supplier/products", { user: a.supplierUser })).status).toBe(
      403,
    );
    expect((await f.call("/v1/commerce/supplier/products", { user: retained })).status).toBe(200);
    const remaining = await json<CommerceSupplierMemberList>(
      await f.call(`${base}/members`, { admin: "offline-admin" }),
    );
    expect(remaining.members).toEqual([{ userId: retained }]);
    expect(
      (
        await json<{ order: CommerceAdminOrder }>(
          await f.call(`/admin/v1/commerce/orders/${purchase.id}`, { admin: "offline-admin" }),
        )
      ).order.status,
    ).toBe("paid");
    expect(
      await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    ).toEqual(ledgerBefore);
    const [revocation] = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "commerce.supplier.member.revoke"));
    expect(revocation).toMatchObject({
      actorType: "admin",
      actorId: f.administrator.adminId,
      targetId: a.supplierId,
      reason,
      after: { userId: a.supplierUser, reason },
    });
  });
  it("routes a supplier shortage into the original private review queue without changing goods or money", async () => {
    const f = fixture();
    const { product, supplierUser } = await f.stock();
    const buyer = await f.user(),
      foreign = await f.user();
    const purchase = await f.order(buyer, product.id);
    await json(
      await f.call(`/v1/commerce/orders/${purchase.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    const itemId = purchase.items[0]!.id;
    const path = `/v1/commerce/supplier/items/${itemId}/issues`;
    const body = {
      kind: "out_of_stock",
      reason: "Private supplier shortage report",
      idempotencyKey: key(),
      supplierId: "ignored",
      refundCents: 10000,
    };
    expect((await f.call(path, { body })).status).toBe(401);
    expect((await f.call(path, { user: buyer, body })).status).toBe(404);
    expect((await f.call(path, { user: foreign, body })).status).toBe(404);
    const beforeProduct = await conn.db
      .select()
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.id, product.id));
    const beforeLedger = await conn.db
      .select()
      .from(schema.commerceLedger)
      .orderBy(schema.commerceLedger.id);
    await json(await f.call(path, { user: supplierUser, body }));
    await json(await f.call(path, { user: supplierUser, body }));
    const owned = await json<{
      orders: { id: string; openCase: boolean; supplierIssue: { kind: string; reason: string } }[];
    }>(await f.call("/v1/commerce/supplier/orders", { user: supplierUser }));
    expect(owned.orders.find((i) => i.id === itemId)).toMatchObject({
      openCase: true,
      supplierIssue: { kind: "out_of_stock", reason: body.reason },
    });
    const personal = await json<{ orders: CommerceOrder[] }>(
      await f.call("/v1/commerce/orders", { user: buyer }),
    );
    expect(personal.orders[0]!.items[0]).toMatchObject({
      status: "pending",
      openCase: true,
      refundedCents: 0,
    });
    expect(personal.orders[0]!.items[0]).not.toHaveProperty("supplierIssue");
    const managed = await json<{ order: CommerceAdminOrder }>(
      await f.call(`/admin/v1/commerce/orders/${purchase.id}`, { admin: "offline-admin" }),
    );
    expect(managed.order.items[0]!.supplierIssue?.reason).toBe(body.reason);
    expect(managed.order.attentionReasons).toContain("open_case");
    expect(
      (
        await f.call(`/v1/commerce/supplier/items/${itemId}/accept`, {
          user: supplierUser,
          body: {},
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.call(`/v1/commerce/supplier/items/${itemId}/ship`, {
          user: supplierUser,
          body: { carrier: "Fixture", trackingNumber: "NO-SHIP" },
        })
      ).status,
    ).toBe(409);
    expect(
      await conn.db
        .select()
        .from(schema.commerceProducts)
        .where(eq(schema.commerceProducts.id, product.id)),
    ).toEqual(beforeProduct);
    expect(
      await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    ).toEqual(beforeLedger);
    await json(
      await f.reviewedClose(
        purchase.id,
        itemId,
        "HTTP administrator verified supplier shortage resolution",
      ),
    );
    await json(await f.call(path, { user: supplierUser, body }));
    expect(
      (
        await json<{ order: CommerceAdminOrder }>(
          await f.call(`/admin/v1/commerce/orders/${purchase.id}`, { admin: "offline-admin" }),
        )
      ).order.items[0]!.openCase,
    ).toBe(false);
    await json(
      await f.call(`/v1/commerce/supplier/items/${itemId}/accept`, {
        user: supplierUser,
        body: {},
      }),
    );
    expect(f.sdk.refunds.create).not.toHaveBeenCalled();
  });
  it("serves durable alerts and exact processing targets only to verified commerce administrators", async () => {
    const f = fixture("stripe_test");
    const { product } = await f.stock();
    const buyer = await f.user();
    const purchase = await f.order(buyer, product.id);
    vi.mocked(f.sdk.checkout.sessions.create).mockRejectedValueOnce(
      new Error("Offline unknown outcome"),
    );
    await json(
      await f.call(`/v1/commerce/orders/${purchase.id}/checkout`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    const [withdrawal] = await conn.db
      .insert(schema.commerceWithdrawals)
      .values({
        userId: buyer,
        amountCents: 2000,
        createdAt: new Date(f.now.getTime() - 9 * 86400000),
      })
      .returning();
    const paths = [
      "/admin/v1/commerce/alerts",
      `/admin/v1/commerce/orders/${purchase.id}`,
      `/admin/v1/commerce/withdrawals/${withdrawal!.id}`,
    ];
    for (const path of paths) {
      expect((await f.call(path, { user: buyer })).status).toBe(401);
      expect((await f.call(path, { admin: "offline-no-mfa" })).status).toBe(403);
      expect((await f.call(path, { admin: "offline-employee" })).status).toBe(403);
    }
    const before = await conn.db
      .select()
      .from(schema.commerceLedger)
      .orderBy(schema.commerceLedger.id);
    await f.commerceAlerts.scan();
    f.now.setTime(f.now.getTime() + 900000);
    await f.commerceAlerts.scan();
    const alerts = await json<CommerceAlertsResponse>(
      await f.call(paths[0]!, { admin: "offline-admin" }),
    );
    expect(alerts).toMatchObject({
      enabled: true,
      externalDelivery: {
        enabled: false,
        configuration: "disabled",
        mode: "mock",
        counts: {
          pending: 0,
          submitting: 0,
          accepted: 0,
          simulated: 0,
          needsReview: 0,
          skipped: 0,
        },
        lastAttemptAt: null,
      },
      monitor: { status: "healthy" },
    });
    expect(alerts.incidents).toContainEqual(
      expect.objectContaining({
        kind: "payment_unresolved",
        orderId: purchase.id,
        state: "open",
        emailDelivery: null,
      }),
    );
    expect(alerts.incidents).toContainEqual(
      expect.objectContaining({
        kind: "withdrawal_requested",
        resourceId: withdrawal!.id,
        state: "open",
      }),
    );
    const directOrder = await json<{ order: CommerceAdminOrder }>(
      await f.call(paths[1]!, { admin: "offline-admin" }),
    );
    expect(directOrder.order).toMatchObject({
      id: purchase.id,
      attentionReasons: ["payment_unresolved"],
    });
    expect(directOrder.order.items[0]!.sku).toBe(product.sku);
    const directWithdrawal = await json<{ withdrawal: CommerceAdminWithdrawal }>(
      await f.call(paths[2]!, { admin: "offline-admin" }),
    );
    expect(directWithdrawal.withdrawal).toMatchObject({
      id: withdrawal!.id,
      userId: buyer,
      status: "requested",
    });
    expect(
      (await f.call("/admin/v1/commerce/alerts?cursor=bad", { admin: "offline-admin" })).status,
    ).toBe(400);
    expect(
      (await f.call("/admin/v1/commerce/alerts?status=pending", { admin: "offline-admin" })).status,
    ).toBe(400);
    expect(
      (await f.call(`/admin/v1/commerce/orders/${key()}`, { admin: "offline-admin" })).status,
    ).toBe(404);
    expect(
      (await f.call(`/admin/v1/commerce/withdrawals/${key()}`, { admin: "offline-admin" })).status,
    ).toBe(404);
    expect(
      (await f.call("/admin/v1/commerce/alerts", { admin: "offline-admin", body: { scan: true } }))
        .status,
    ).toBe(404);
    f.now.setTime(f.now.getTime() + 901000);
    expect(
      (await json<CommerceAlertsResponse>(await f.call(paths[0]!, { admin: "offline-admin" })))
        .monitor.status,
    ).toBe("stale");
    expect(
      await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    ).toEqual(before);
    expect(f.sdk.refunds.create).not.toHaveBeenCalled();
  });
  it("serves supplier-scoped historical cost statements without turning accounting totals into payable balances", async () => {
    const f = fixture();
    const a = await f.stock(),
      b = await f.stock();
    const buyer = await f.user();
    const order = await f.order(buyer, a.product.id);
    await json(
      await f.call(`/v1/commerce/orders/${order.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    await conn.db
      .update(schema.commerceProducts)
      .set({ costCents: 1 })
      .where(eq(schema.commerceProducts.id, a.product.id));
    await json(
      await f.call(`/admin/v1/commerce/items/${order.items[0]!.id}/refund`, {
        admin: "offline-admin",
        body: { refundTotalCents: 2500, reason: "Statement refund fixture", idempotencyKey: key() },
      }),
    );
    const path = `/v1/commerce/supplier/${a.supplierId}/statement`;
    expect((await f.call(path)).status).toBe(401);
    expect((await f.call(path, { user: buyer })).status).toBe(403);
    expect((await f.call(path, { user: b.supplierUser })).status).toBe(403);
    const before = await conn.db
      .select()
      .from(schema.commerceLedger)
      .where(eq(schema.commerceLedger.ownerId, a.supplierId))
      .orderBy(schema.commerceLedger.id);
    const report = await json<CommerceSupplierStatement>(
      await f.call(`${path}?ownerId=${b.supplierId}&userId=${b.supplierUser}`, {
        user: a.supplierUser,
      }),
    );
    expect(report).toMatchObject({
      supplier: { id: a.supplierId },
      currency: "CAD",
      mode: "test",
      settlementAssessment: "not_assessed",
      summary: {
        openingCents: 0,
        accruedCents: 4000,
        reversedCents: 1000,
        closingCents: 3000,
        reconciliationOk: true,
        equationDifferenceCents: 0,
      },
      totalRows: 2,
    });
    expect(report.rows.map((row) => row.kind).toSorted()).toEqual([
      "cost_accrual",
      "refund_reversal",
    ]);
    expect(
      report.rows
        .flatMap((row) => row.items)
        .every((item) => item.unitCostCents === 4000 && item.sku === a.product.sku),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain(b.supplierId);
    const adminPath = `/admin/v1/commerce/suppliers/${a.supplierId}/statement?to=${encodeURIComponent(report.period.to)}`;
    expect((await f.call(adminPath, { user: a.supplierUser })).status).toBe(401);
    expect((await f.call(adminPath, { admin: "offline-no-mfa" })).status).toBe(403);
    expect((await f.call(adminPath, { admin: "offline-employee" })).status).toBe(403);
    const same = await json<CommerceSupplierStatement>(
      await f.call(adminPath, { admin: "offline-admin" }),
    );
    expect(same.summary).toEqual(report.summary);
    expect(same.rows).toEqual(report.rows);
    expect(
      await conn.db
        .select()
        .from(schema.commerceLedger)
        .where(eq(schema.commerceLedger.ownerId, a.supplierId))
        .orderBy(schema.commerceLedger.id),
    ).toEqual(before);
    await conn.db
      .update(schema.commerceSuppliers)
      .set({ active: false })
      .where(eq(schema.commerceSuppliers.id, a.supplierId));
    expect((await f.call(path, { user: a.supplierUser })).status).toBe(403);
    expect(
      (await json<CommerceSupplierStatement>(await f.call(adminPath, { admin: "offline-admin" })))
        .supplier.active,
    ).toBe(false);
  });

  it("filters actionable orders on the server while personal and administrator trust boundaries remain separate", async () => {
    const f = fixture("stripe_test");
    const { product } = await f.stock();
    const buyer = await f.user(),
      other = await f.user();
    const affected = await f.order(buyer, product.id);
    const normal = await f.order(other, product.id);
    vi.mocked(f.sdk.checkout.sessions.create).mockRejectedValueOnce(
      new Error("Lost test provider result"),
    );
    const failed = await json<{ payment: CommercePaymentStatus }>(
      await f.call(`/v1/commerce/orders/${affected.id}/checkout`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    expect(failed.payment.status).toBe("unknown");
    const path = "/admin/v1/commerce/orders?attention=needs_attention";
    expect((await f.call(path, { user: buyer })).status).toBe(401);
    expect((await f.call(path, { admin: "offline-no-mfa" })).status).toBe(403);
    expect((await f.call(path, { admin: "offline-employee" })).status).toBe(403);
    const queue = await json<{ orders: (CommerceOrder & { attentionReasons: string[] })[] }>(
      await f.call(path, { admin: "offline-admin" }),
    );
    const row = queue.orders.find((order) => order.id === affected.id);
    expect(
      row?.attentionReasons.length,
      JSON.stringify({ row, payment: failed.payment.status }),
    ).toBeGreaterThan(0);
    expect(queue.orders.some((order) => order.id === normal.id)).toBe(false);
    const personal = await json<{ orders: CommerceOrder[] }>(
      await f.call(`/v1/commerce/orders?attention=needs_attention&userId=${other}`, {
        user: buyer,
      }),
    );
    expect(personal.orders.some((order) => order.id === affected.id)).toBe(true);
    expect(personal.orders.some((order) => order.id === normal.id)).toBe(false);
    expect(
      (await f.call("/admin/v1/commerce/orders?attention=invalid", { admin: "offline-admin" }))
        .status,
    ).toBe(400);
    expect(
      (await f.call("/admin/v1/commerce/withdrawals?status=invalid", { admin: "offline-admin" }))
        .status,
    ).toBe(400);
  });

  it("requires signed TEST evidence and MFA administration to allocate an external refund once without sending another refund", async () => {
    const f = fixture("stripe_test");
    const first = await f.stock(),
      second = await f.stock();
    const buyer = await f.user(),
      referrer = await f.user();
    const profile = await json<CommerceProfile>(
      await f.call("/v1/commerce/me", { user: referrer }),
    );
    await json(
      await f.call("/v1/commerce/referrals/bind", {
        user: buyer,
        body: { code: profile.referralCode },
      }),
    );
    const { order } = await json<{ order: CommerceOrder }>(
      await f.call("/v1/commerce/orders", {
        user: buyer,
        body: {
          items: [
            { productId: first.product.id, quantity: 1 },
            { productId: second.product.id, quantity: 1 },
          ],
          address,
          idempotencyKey: key(),
        },
      }),
    );
    expect(order.items.map((item) => item.sku).toSorted()).toEqual(
      [first.product.sku, second.product.sku].toSorted(),
    );
    const prepared = await json<{ payment: CommercePaymentStatus }>(
      await f.call(`/v1/commerce/orders/${order.id}/checkout`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    const session = f.sessions.get(prepared.payment.sessionId!)!;
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = `pi_${key().replaceAll("-", "")}`;
    await json(
      await f.call(
        COMMERCE_STRIPE_TEST_WEBHOOK_PATH,
        await f.event("checkout.session.completed", session),
      ),
    );
    const refund = {
      id: `re_${key().replaceAll("-", "")}`,
      object: "refund",
      amount: 3500,
      currency: "cad",
      status: "succeeded",
      payment_intent: session.payment_intent,
      metadata: {},
    } as Stripe.Refund;
    f.externalRefunds.set(refund.id, refund);
    const callback = await f.event("refund.updated", refund);
    const listPath = `/admin/v1/commerce/orders/${order.id}/external-refunds`;
    expect(
      (
        await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
          ...callback,
          headers: { "stripe-signature": "invalid" },
        })
      ).status,
    ).toBe(400);
    expect(f.sdk.refunds.retrieve).not.toHaveBeenCalled();
    expect(
      (
        await json<{ refunds: CommerceExternalRefund[] }>(
          await f.call(listPath, { admin: "offline-admin" }),
        )
      ).refunds,
    ).toEqual([]);
    await json(await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, callback));
    for (const options of [
      {},
      { user: buyer },
      { admin: "offline-no-mfa" as const },
      { admin: "offline-employee" as const },
    ]) {
      expect((await f.call(listPath, options)).status).toBe("admin" in options ? 403 : 401);
    }
    const list = await json<{ refunds: CommerceExternalRefund[] }>(
      await f.call(listPath, { admin: "offline-admin" }),
    );
    const external = list.refunds.find((row) => row.providerRefundId === refund.id)!;
    expect(external).toMatchObject({
      amountCents: 3500,
      currency: "CAD",
      allocationState: "unallocated",
    });
    const observe = "/admin/v1/commerce/external-refunds/observe";
    const observeBody = {
      sourceEventId: JSON.parse(callback.raw).id as string,
      reason: "Verify the signed provider event before allocating",
    };
    expect((await f.call(observe, { user: buyer, body: observeBody })).status).toBe(401);
    expect((await f.call(observe, { admin: "offline-no-mfa", body: observeBody })).status).toBe(
      403,
    );
    expect((await f.call(observe, { admin: "offline-employee", body: observeBody })).status).toBe(
      403,
    );
    expect(
      (
        await f.call(observe, {
          admin: "offline-admin",
          body: { ...observeBody, sourceEventId: `evt_${key().replaceAll("-", "")}` },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.call(observe, {
          admin: "offline-admin",
          body: { ...observeBody, sourceEventId: refund.id },
        })
      ).status,
    ).toBe(400);
    const observed = await json<CommerceExternalRefundDetail>(
      await f.call(observe, { admin: "offline-admin", body: observeBody }),
    );
    expect(observed.refund.id).toBe(external.id);
    const detailPath = `/admin/v1/commerce/external-refunds/${external.id}`;
    const detail = await json<CommerceExternalRefundDetail>(
      await f.call(detailPath, { admin: "offline-admin" }),
    );
    expect(detail.canAllocate).toBe(true);
    expect(detail.items.map((item) => item.sku).toSorted()).toEqual(
      [first.product.sku, second.product.sku].toSorted(),
    );
    const allocation = {
      expectedVersion: detail.refund.version,
      allocations: [
        { itemId: order.items[0]!.id, amountCents: 1500 },
        { itemId: order.items[1]!.id, amountCents: 2000 },
      ],
      reason: "Allocate confirmed external test refund, without refunding again",
      idempotencyKey: key(),
    };
    expect((await f.call(`${detailPath}/allocate`, { user: buyer, body: allocation })).status).toBe(
      401,
    );
    expect(
      (await f.call(`${detailPath}/allocate`, { admin: "offline-no-mfa", body: allocation }))
        .status,
    ).toBe(403);
    expect(
      (await f.call(`${detailPath}/allocate`, { admin: "offline-employee", body: allocation }))
        .status,
    ).toBe(403);
    expect(
      (
        await f.call(`${detailPath}/allocate`, {
          admin: "offline-admin",
          body: {
            ...allocation,
            allocations: [{ itemId: order.items[0]!.id, amountCents: 3499 }],
            idempotencyKey: key(),
          },
        })
      ).status,
    ).toBe(400);
    const result = await json<CommerceExternalRefundAllocationResult>(
      await f.call(`${detailPath}/allocate`, { admin: "offline-admin", body: allocation }),
    );
    expect(result.refund.allocationState).toBe("allocated");
    expect(result.applied).toBe(true);
    const current = (
      await json<{ orders: CommerceOrder[] }>(await f.call("/v1/commerce/orders", { user: buyer }))
    ).orders.find((row) => row.id === order.id)!;
    expect(current.refundedCents).toBe(3500);
    expect(current.items.every((item) => item.openCase)).toBe(true);
    expect(
      await json<CommerceWallet>(await f.call("/v1/commerce/wallet", { user: referrer })),
    ).toMatchObject({ pendingCents: 1650, availableCents: 0 });
    const journals = () =>
      conn.db
        .select()
        .from(schema.commerceLedger)
        .where(
          inArray(
            schema.commerceLedger.resourceId,
            order.items.map((item) => item.id),
          ),
        )
        .orderBy(schema.commerceLedger.id);
    const posted = await journals();
    expect(
      posted
        .filter((row) => row.account === "cash_test")
        .reduce((sum, row) => sum + row.amountCents, 0),
    ).toBe(-3500);
    await json(
      await f.call(`${detailPath}/allocate`, { admin: "offline-admin", body: allocation }),
    );
    await json(await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, callback));
    await json(
      await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, await f.event("refund.updated", refund)),
    );
    expect(await journals()).toEqual(posted);
    expect(f.sdk.refunds.create).not.toHaveBeenCalled();
  });

  it("binds a direct referrer and buys at the saved price with replay-safe orders, commission, and wallet scope", async () => {
    const f = fixture();
    const { product } = await f.stock();
    const referrer = await f.user(),
      buyer = await f.user(),
      stranger = await f.user();
    const profile = await json<CommerceProfile>(
      await f.call("/v1/commerce/me", { user: referrer }),
    );
    await json(
      await f.call("/v1/commerce/referrals/bind", {
        user: buyer,
        body: { code: profile.referralCode },
      }),
    );
    const catalog = await json<{ products: { id: string; sku: string; priceCents: number }[] }>(
      await f.call("/v1/commerce/catalog"),
    );
    expect(catalog.products.find((p) => p.id === product.id)).toMatchObject({
      sku: product.sku,
      priceCents: 10000,
    });
    const orderKey = key();
    const order = await f.order(buyer, product.id, orderKey);
    expect((await f.order(buyer, product.id, orderKey)).id).toBe(order.id);
    expect(order.totalCents).toBe(10000);
    const payKey = key();
    await json(
      await f.call(`/v1/commerce/orders/${order.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: payKey },
      }),
    );
    await json(
      await f.call(`/v1/commerce/orders/${order.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: payKey },
      }),
    );
    expect(
      await json<CommerceWallet>(
        await f.call(`/v1/commerce/wallet?ownerId=${referrer}`, { user: buyer }),
      ),
    ).toMatchObject({ pendingCents: 0, availableCents: 0 });
    expect(
      await json<CommerceWallet>(await f.call("/v1/commerce/wallet", { user: referrer })),
    ).toMatchObject({ pendingCents: 1000, availableCents: 0 });
    expect(
      (
        await json<{ orders: CommerceOrder[] }>(
          await f.call("/v1/commerce/orders", { user: buyer }),
        )
      ).orders[0],
    ).toMatchObject({ id: order.id, status: "paid", paymentProvider: "simulation" });
    expect(
      (await json<CommerceProfile>(await f.call("/v1/commerce/me", { user: buyer }))).firstPaidAt,
    ).not.toBeNull();
    expect(
      (
        await f.call("/v1/commerce/referrals/bind", {
          user: buyer,
          body: {
            code: (
              await json<CommerceProfile>(await f.call("/v1/commerce/me", { user: stranger }))
            ).referralCode,
          },
        })
      ).status,
    ).toBe(409);
  });

  it("rejects foreign order and supplier actions while the authorized supplier and MFA admin fulfill the saved order", async () => {
    const f = fixture();
    const { product, supplierUser } = await f.stock();
    const buyer = await f.user(),
      foreign = await f.user();
    const order = await f.order(buyer, product.id);
    await json(
      await f.call(`/v1/commerce/orders/${order.id}/test-pay`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    const itemId = order.items[0]!.id;
    expect((await f.call("/v1/commerce/orders")).status).toBe(401);
    expect(
      (
        await f.call(`/v1/commerce/orders/${order.id}/cancel`, {
          user: foreign,
          body: { idempotencyKey: key() },
        })
      ).status,
    ).toBe(404);
    expect((await f.call("/v1/commerce/supplier/orders", { user: foreign })).status).toBe(403);
    expect(
      (
        await f.call(`/v1/commerce/supplier/items/${itemId}/ship`, {
          user: foreign,
          body: { carrier: "Fixture courier", trackingNumber: "FIXTURE-TRACK" },
        })
      ).status,
    ).toBe(404);
    await json(
      await f.call(`/v1/commerce/supplier/items/${itemId}/accept`, {
        user: supplierUser,
        body: {},
      }),
    );
    await json(
      await f.call(`/v1/commerce/supplier/items/${itemId}/ship`, {
        user: supplierUser,
        body: { carrier: "Fixture courier", trackingNumber: "FIXTURE-TRACK" },
      }),
    );
    expect(
      (
        await f.call(`/admin/v1/commerce/items/${itemId}/deliver`, {
          user: buyer,
          body: { reason: "AI org owner is not admin" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await f.call(`/admin/v1/commerce/items/${itemId}/deliver`, {
          admin: "offline-no-mfa",
          body: { reason: "No MFA" },
        })
      ).status,
    ).toBe(403);
    await json(
      await f.call(`/admin/v1/commerce/items/${itemId}/deliver`, {
        admin: "offline-admin",
        body: { reason: "Offline receipt verified" },
      }),
    );
    const list = await json<{ orders: CommerceOrder[] }>(
      await f.call("/v1/commerce/orders", { user: buyer }),
    );
    expect(list.orders[0]!.items[0]).toMatchObject({
      id: itemId,
      status: "delivered",
      trackingNumber: "FIXTURE-TRACK",
    });
    expect(
      (
        await json<{ orders: CommerceOrder[] }>(
          await f.call(`/v1/commerce/orders?ownerId=${buyer}`, { user: foreign }),
        )
      ).orders,
    ).toEqual([]);
  });

  it("prepares one session-bound Stripe TEST checkout and denies simulated payment or foreign checkout/status access", async () => {
    const f = fixture("stripe_test");
    const { product } = await f.stock();
    const buyer = await f.user(),
      foreign = await f.user();
    const order = await f.order(buyer, product.id);
    expect(
      (
        await f.call(`/v1/commerce/orders/${order.id}/test-pay`, {
          user: buyer,
          body: { idempotencyKey: key() },
        })
      ).status,
    ).toBe(409);
    const requestKey = key();
    const prepared = await json<{ payment: CommercePaymentStatus; checkoutUrl: string }>(
      await f.call(`/v1/commerce/orders/${order.id}/checkout`, {
        user: buyer,
        body: { idempotencyKey: requestKey },
      }),
    );
    expect(prepared.payment).toMatchObject({
      enabled: true,
      mode: "test",
      provider: "stripe_test",
      orderId: order.id,
      status: "open",
    });
    expect(prepared.checkoutUrl).toBe(
      `https://checkout.stripe.com/c/pay/${prepared.payment.sessionId}`,
    );
    const replay = await json<{ payment: CommercePaymentStatus }>(
      await f.call(`/v1/commerce/orders/${order.id}/checkout`, {
        user: buyer,
        body: { idempotencyKey: requestKey },
      }),
    );
    expect(replay.payment.attemptId).toBe(prepared.payment.attemptId);
    expect(f.sdk.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(
      (await f.call(`/v1/commerce/orders/${order.id}/payment?ownerId=${buyer}`, { user: foreign }))
        .status,
    ).toBe(404);
    expect(
      (
        await f.call(`/v1/commerce/orders/${order.id}/checkout`, {
          user: foreign,
          body: { idempotencyKey: requestKey },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.call(`/v1/commerce/orders/${order.id}/cancel`, {
          user: buyer,
          body: { idempotencyKey: key() },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await json<{ payment: CommercePaymentStatus }>(
          await f.call(`/v1/commerce/orders/${order.id}/payment?payment=success`, { user: buyer }),
        )
      ).payment.status,
    ).toBe("open");
    expect(
      (
        await json<{ orders: CommerceOrder[] }>(
          await f.call("/v1/commerce/orders", { user: buyer }),
        )
      ).orders[0]!.status,
    ).toBe("awaiting_payment");
  });

  it("verifies locally signed webhook bytes through the real adapter and never journals a duplicate callback twice", async () => {
    const f = fixture("stripe_test");
    const { product } = await f.stock();
    const buyer = await f.user(),
      referrer = await f.user();
    const profile = await json<CommerceProfile>(
      await f.call("/v1/commerce/me", { user: referrer }),
    );
    await json(
      await f.call("/v1/commerce/referrals/bind", {
        user: buyer,
        body: { code: profile.referralCode },
      }),
    );
    const order = await f.order(buyer, product.id);
    const prepared = await json<{ payment: CommercePaymentStatus }>(
      await f.call(`/v1/commerce/orders/${order.id}/checkout`, {
        user: buyer,
        body: { idempotencyKey: key() },
      }),
    );
    const session = f.sessions.get(prepared.payment.sessionId!)!;
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = `pi_${key().replaceAll("-", "")}`;
    const raw = JSON.stringify({
      id: `evt_${key().replaceAll("-", "")}`,
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: session },
    });
    const signature = new Stripe(offlineSecret).webhooks.generateTestHeaderString({
      payload: raw,
      secret: webhookSecret,
    });
    expect((await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, { raw })).status).toBe(400);
    expect(
      (
        await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
          raw,
          headers: { "stripe-signature": "invalid" },
        })
      ).status,
    ).toBe(400);
    expect(f.sdk.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(
      (
        await json<{ orders: CommerceOrder[] }>(
          await f.call("/v1/commerce/orders", { user: buyer }),
        )
      ).orders[0]!.status,
    ).toBe("awaiting_payment");
    expect(
      await json<CommerceWallet>(await f.call("/v1/commerce/wallet", { user: referrer })),
    ).toMatchObject({ pendingCents: 0, availableCents: 0 });
    await json(
      await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
        raw,
        headers: { "stripe-signature": signature },
      }),
    );
    const before = await conn.db
      .select({ id: schema.commerceLedger.id })
      .from(schema.commerceLedger)
      .where(eq(schema.commerceLedger.resourceId, order.id))
      .orderBy(schema.commerceLedger.id);
    expect(before.length).toBeGreaterThan(0);
    await json(
      await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
        raw,
        headers: { "stripe-signature": signature },
      }),
    );
    expect(
      await conn.db
        .select({ id: schema.commerceLedger.id })
        .from(schema.commerceLedger)
        .where(eq(schema.commerceLedger.resourceId, order.id))
        .orderBy(schema.commerceLedger.id),
    ).toEqual(before);
    expect(
      (
        await f.call(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
          raw: raw.replace("checkout.session.completed", "checkout.session.expired"),
          headers: { "stripe-signature": signature },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await json<{ orders: CommerceOrder[] }>(
          await f.call("/v1/commerce/orders", { user: buyer }),
        )
      ).orders[0]!.status,
    ).toBe("paid");
    expect(
      await json<CommerceWallet>(await f.call("/v1/commerce/wallet", { user: referrer })),
    ).toMatchObject({ pendingCents: 1000, availableCents: 0 });
  });
});
