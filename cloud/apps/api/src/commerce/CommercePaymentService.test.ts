/** SQL integration with an injected offline provider. Default execution uses the migrated test PostgreSQL. */
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import {
  CommerceService,
  type CommerceActor,
  type CommerceTransaction,
} from "./CommerceService.ts";
import { CommercePaymentService } from "./CommercePaymentService.ts";
import {
  COMMERCE_STRIPE_PURPOSE,
  type CommerceCheckoutInput,
  type CommerceCheckoutProof,
  type CommerceRefundProof,
  type CommerceStripeEvent,
  type CommerceStripeGateway,
} from "./CommerceStripeGateway.ts";

const conn = await isolatedCommerceTestDatabase();
const key = () => crypto.randomUUID();
const externalId = (prefix: string) => `${prefix}${key().replaceAll("-", "")}`;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const eventPayload = (
  type: string,
  objectId: string,
  facts: Partial<CommerceStripeEvent> = {},
  id = externalId("evt_"),
) => JSON.stringify({ id, type, objectId, livemode: false, ...facts });
const admin: CommerceActor = { id: key(), type: "admin", traceId: "commerce-payment-sql" };
const recorder: CommerceActor = { ...admin, id: key() };
const address = {
  name: "Offline test buyer",
  line1: "100 Test Street",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA" as const,
};
async function fixture() {
  let now = new Date(),
    depth = 0;
  const commerce = new CommerceService(conn.db, {
    mode: "test",
    environment: "test",
    paymentProvider: "stripe_test",
    now: () => now,
  });
  const original = commerce.paymentTransaction.bind(commerce);
  vi.spyOn(commerce, "paymentTransaction").mockImplementation((fn) =>
    original(async (tx) => {
      depth++;
      try {
        return await fn(controls.transactionProxy?.(tx) ?? tx);
      } finally {
        depth--;
      }
    }),
  );
  const io = () =>
    expect(depth, "Provider IO must never hold the commerce transaction lock").toBe(0);
  const sessions = new Map<string, Mutable<CommerceCheckoutProof>>(),
    sessionKeys = new Map<string, string>();
  const providerRefunds = new Map<string, Mutable<CommerceRefundProof>>(),
    refundKeys = new Map<string, string>();
  const controls = {
    failCreate: 0,
    failRefund: 0,
    failExpire: false,
    failRetrieve: false,
    refundStatus: "pending",
    onCreate: undefined as
      | ((proof: Mutable<CommerceCheckoutProof>, input: CommerceCheckoutInput) => Promise<void>)
      | undefined,
    onRefund: undefined as ((proof: CommerceRefundProof) => Promise<void>) | undefined,
    onRetrieveRefund: undefined as ((proof: CommerceRefundProof) => Promise<void>) | undefined,
    transactionProxy: undefined as ((tx: CommerceTransaction) => CommerceTransaction) | undefined,
  };
  const gateway: CommerceStripeGateway = {
    createCheckout: vi.fn(async (i) => {
      io();
      let id = sessionKeys.get(i.idempotencyKey);
      if (!id) {
        id = externalId("cs_test_");
        sessionKeys.set(i.idempotencyKey, id);
        sessions.set(id, {
          id,
          url: `https://checkout.stripe.com/c/pay/${id}`,
          paymentIntentId: null,
          amountCents: i.amountCents,
          currency: "cad",
          paymentStatus: "unpaid",
          status: "open",
          livemode: false,
          metadata: {
            purpose: COMMERCE_STRIPE_PURPOSE,
            attemptId: i.attemptId,
            orderId: i.orderId,
          },
          expiresAt: i.expiresAt,
        });
      }
      const result = structuredClone(sessions.get(id)!);
      if (controls.failCreate-- > 0) throw new Error("offline provider response lost");
      if (controls.onCreate) await controls.onCreate(result, i);
      return result;
    }),
    retrieveCheckout: vi.fn(async (id) => {
      io();
      if (controls.failRetrieve) throw new Error("offline retrieval unavailable");
      const proof = sessions.get(id);
      if (!proof) throw new Error("missing offline session");
      return structuredClone(proof);
    }),
    expireCheckout: vi.fn(async (id) => {
      io();
      if (controls.failExpire) throw new Error("offline expire unavailable");
      const proof = sessions.get(id)!;
      if (proof.paymentStatus === "paid") throw new Error("offline paid session cannot expire");
      proof.status = "expired";
      proof.paymentStatus = "unpaid";
      proof.url = null;
      return structuredClone(proof);
    }),
    createRefund: vi.fn(async (i) => {
      io();
      let id = refundKeys.get(i.idempotencyKey);
      if (!id) {
        id = externalId("re_");
        refundKeys.set(i.idempotencyKey, id);
        providerRefunds.set(id, {
          id,
          paymentIntentId: i.paymentIntentId,
          amountCents: i.amountCents,
          currency: "cad",
          status: controls.refundStatus,
          metadata: {
            purpose: COMMERCE_STRIPE_PURPOSE,
            refundRequestId: i.refundRequestId,
            orderId: i.orderId,
            itemId: i.itemId,
          },
        });
      }
      if (controls.failRefund-- > 0) throw new Error("offline refund response lost");
      const result = structuredClone(providerRefunds.get(id)!);
      if (controls.onRefund) await controls.onRefund(result);
      return result;
    }),
    retrieveRefund: vi.fn(async (id) => {
      io();
      const proof = providerRefunds.get(id);
      if (!proof) throw new Error("missing offline refund");
      const result = structuredClone(proof);
      if (controls.onRetrieveRefund) await controls.onRetrieveRefund(result);
      return result;
    }),
    verifyEvent: vi.fn(async (payload) => {
      io();
      const event = JSON.parse(payload) as CommerceStripeEvent;
      return { ...event, payloadHash: createHash("sha256").update(payload).digest("hex") };
    }),
  };
  const payments = new CommercePaymentService(commerce, {
    enabled: true,
    environment: "test",
    webPublicUrl: "https://shop.test",
    gateway,
    now: () => now,
  });
  const user = async () => {
    const id = key();
    await conn.db
      .insert(schema.user)
      .values({ id, name: "Offline shopper", email: `${id}@test.invalid`, emailVerified: true });
    await commerce.profile(id);
    return { id, type: "user", traceId: "commerce-payment-sql" } satisfies CommerceActor;
  };
  const buyer = await user(),
    supplierUser = await user(),
    referrer = await user();
  const { supplier } = await commerce.createSupplier(admin, {
    name: "Canadian offline supplier",
    returnAddress: "Toronto, Canada",
    reason: "Test-only administrator supplier creation approved",
    idempotencyKey: crypto.randomUUID(),
  });
  await commerce.addSupplierMember(
    admin,
    supplier.id,
    supplierUser.id,
    "Test-only administrator supplier access approved",
  );
  const { product } = await commerce.saveProduct(admin, {
    supplierId: supplier.id,
    sku: key(),
    name: "Offline test tote",
    description: "Saved product snapshot",
    category: "Bags",
    imageUrl: "/shop/media/offline.png",
    priceCents: 30000,
    costCents: 12000,
    commissionBps: 1000,
    returnDays: 30,
    stock: 20,
    status: "published",
    reason: "Test-only administrator checked supplier quote and approved catalog change",
  });
  const createOrder = async () =>
    (
      await commerce.createOrder(buyer, {
        items: [{ productId: product.id, quantity: 1 }],
        address,
        idempotencyKey: key(),
      })
    ).order;
  const order = await createOrder();
  const send = (payload: string) =>
    payments.handleWebhook(payload, "offline-fake-signature", "commerce-payment-sql");
  const checkoutEvent = (id: string, eventId?: string) => {
    const proof = sessions.get(id)!;
    return eventPayload(
      "checkout.session.completed",
      id,
      {
        currency: proof.currency,
        ...(proof.metadata.purpose ? { purpose: proof.metadata.purpose } : {}),
        ...(proof.paymentIntentId ? { paymentIntentId: proof.paymentIntentId } : {}),
      },
      eventId,
    );
  };
  const refundEvent = (id: string, eventId?: string) => {
    const proof = providerRefunds.get(id)!;
    return eventPayload(
      "refund.updated",
      id,
      {
        currency: proof.currency,
        ...(proof.metadata.purpose ? { purpose: proof.metadata.purpose } : {}),
        paymentIntentId: proof.paymentIntentId,
      },
      eventId,
    );
  };
  const makePaid = (id: string) => {
    const proof = sessions.get(id)!;
    proof.paymentIntentId ??= externalId("pi_");
    proof.status = "complete";
    proof.paymentStatus = "paid";
    proof.url = null;
    return proof;
  };
  const charge = async (orderId = order.id) => {
    const opened = await payments.checkout(buyer, orderId, key());
    const proof = makePaid(opened.payment.sessionId!);
    await send(checkoutEvent(proof.id));
    return proof;
  };
  const stock = async () =>
    (
      await conn.db
        .select()
        .from(schema.commerceProducts)
        .where(eq(schema.commerceProducts.id, product.id))
    )[0]!;
  const currentOrder = async () =>
    (await commerce.listOrders(buyer.id)).orders.find((candidate) => candidate.id === order.id)!;
  const deliver = async () => {
    const line = (await currentOrder()).items[0]!;
    await commerce.accept(supplierUser, line.id);
    await commerce.ship(supplierUser, line.id, {
      carrier: "Offline carrier",
      trackingNumber: key(),
    });
    await commerce.deliver(admin, line.id, "Test-only operator reviewed delivery evidence");
  };
  const bindReferrer = async () =>
    commerce.bindReferral(buyer, (await commerce.profile(referrer.id)).referralCode);
  return {
    commerce,
    payments,
    gateway,
    sessions,
    sessionKeys,
    providerRefunds,
    refundKeys,
    controls,
    buyer,
    supplierUser,
    referrer,
    product,
    order,
    user,
    createOrder,
    eventPayload,
    send,
    checkoutEvent,
    refundEvent,
    makePaid,
    charge,
    stock,
    currentOrder,
    deliver,
    bindReferrer,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

async function closeReviewedSupport(f: Awaited<ReturnType<typeof fixture>>, itemId: string) {
  const { order } = await f.commerce.adminOrder(f.order.id);
  const revision = order.items.find((item) => item.id === itemId)?.caseRevision;
  expect(revision).toMatch(/^[0-9a-f]{64}$/);
  return f.commerce.setOpenCase(admin, itemId, false, "Reviewed test support outcome", revision);
}

async function externalRefund(
  f: Awaited<ReturnType<typeof fixture>>,
  orderId: string,
  paymentIntentId: string,
  amountCents: number,
) {
  const proof: Mutable<CommerceRefundProof> = {
    id: externalId("re_"),
    paymentIntentId,
    amountCents,
    currency: "cad",
    status: "succeeded",
    metadata: {},
    livemode: false,
  };
  f.providerRefunds.set(proof.id, proof);
  const payload = f.refundEvent(proof.id);
  await f.send(payload);
  const entry = (await f.payments.listExternalRefunds(orderId)).refunds.find(
    (row) => row.providerRefundId === proof.id,
  )!;
  expect(
    entry,
    "A verified provider callback must create the reviewable external parent",
  ).toBeDefined();
  return { proof, payload, entry, detail: await f.payments.externalRefundDetail(entry.id) };
}

async function multiItemRefundFixture() {
  const f = await fixture();
  await f.bindReferrer();
  await f.payments.cancel(f.buyer, f.order.id, key());
  const { product: second } = await f.commerce.saveProduct(admin, {
    supplierId: f.product.supplierId,
    sku: key(),
    name: "Small test organizer",
    description: "Integer rounding fixture",
    category: "Storage",
    imageUrl: "/shop/media/organizer.png",
    priceCents: 199,
    costCents: 99,
    commissionBps: 500,
    returnDays: 45,
    stock: 10,
    status: "published",
    reason: "Test-only administrator checked supplier quote and approved catalog change",
  });
  const { order } = await f.commerce.createOrder(f.buyer, {
    items: [
      { productId: f.product.id, quantity: 1 },
      { productId: second.id, quantity: 1 },
    ],
    address,
    idempotencyKey: key(),
  });
  const proof = await f.charge(order.id);
  const current = async () =>
    (await f.commerce.listOrders(f.buyer.id)).orders.find((row) => row.id === order.id)!;
  const first = order.items.find((line) => line.productId === f.product.id)!;
  const other = order.items.find((line) => line.productId === second.id)!;
  return { f, order, proof, first, other, second, current };
}

async function orderLedger(orderId: string, itemIds: readonly string[]) {
  return conn.db
    .select()
    .from(schema.commerceLedger)
    .where(inArray(schema.commerceLedger.resourceId, [orderId, ...itemIds]))
    .orderBy(schema.commerceLedger.eventKey, schema.commerceLedger.line);
}

beforeAll(async () => {
  await conn.db.execute(sql`select 1 from commerce_payment_attempts limit 1`);
});
afterAll(() => conn.close());

describe("known refund ownership anchors", () => {
  it("uses the already-bound provider id when a late failure has malformed or foreign request metadata", async () => {
    for (const metadata of ["malformed", "other-request"] as const) {
      const f = await fixture();
      await f.charge();
      f.controls.refundStatus = "succeeded";
      const first = await f.payments.requestRefund(admin, f.order.items[0]!.id, {
        refundTotalCents: 1000,
        reason: "First confirmed local refund",
        idempotencyKey: key(),
      });
      const secondOrder = await f.createOrder();
      await f.charge(secondOrder.id);
      const second = await f.payments.requestRefund(admin, secondOrder.items[0]!.id, {
        refundTotalCents: 2000,
        reason: "Unrelated confirmed local refund",
        idempotencyKey: key(),
      });
      const originalProof = [...f.providerRefunds.values()].find(
        (proof) => proof.metadata.refundRequestId === first.refund.id,
      )!;
      const beforeFirst = await orderLedger(f.order.id, [f.order.items[0]!.id]);
      const beforeSecond = await orderLedger(secondOrder.id, [secondOrder.items[0]!.id]);
      originalProof.metadata = {
        ...originalProof.metadata,
        refundRequestId: metadata === "malformed" ? "not-a-valid-uuid" : second.refund.id,
      };
      originalProof.status = "failed";
      await f.send(
        eventPayload("refund.failed", originalProof.id, {
          currency: "cad",
          paymentIntentId: originalProof.paymentIntentId,
          purpose: COMMERCE_STRIPE_PURPOSE,
        }),
      );
      const own = (await f.payments.status(f.order.id)).payment;
      const unrelated = (await f.payments.status(secondOrder.id)).payment;
      expect(own.status).toBe("requires_review");
      expect(own.refunds.find((refund) => refund.id === first.refund.id)!.status).toBe(
        "requires_review",
      );
      expect((await f.currentOrder()).items[0]!.openCase).toBe(true);
      expect(unrelated.status).toBe("paid");
      expect(unrelated.refunds.find((refund) => refund.id === second.refund.id)!.status).toBe(
        "succeeded",
      );
      const otherOrder = (await f.commerce.listOrders(f.buyer.id)).orders.find(
        (order) => order.id === secondOrder.id,
      )!;
      expect(otherOrder.items[0]!.openCase).toBe(true); // Its own confirmed refund still needs manual support closure.
      expect(otherOrder.refundedCents).toBe(2000);
      expect((await f.currentOrder()).refundedCents).toBe(1000);
      expect(await orderLedger(f.order.id, [f.order.items[0]!.id])).toEqual(beforeFirst);
      expect(await orderLedger(secondOrder.id, [secondOrder.items[0]!.id])).toEqual(beforeSecond);
      expect(
        (await f.payments.listExternalRefunds(f.order.id)).refunds.some(
          (refund) => refund.providerRefundId === originalProof.id,
        ),
      ).toBe(false);
      expect(f.gateway.createRefund).toHaveBeenCalledTimes(2);
    }
  });
});

describe("commerce Stripe TEST persistence and settlement", () => {
  it("selects the active/current attempt instead of an older failed attempt for cancellation and reconciliation", async () => {
    for (const action of ["cancel", "reconcile"] as const) {
      const f = await fixture();
      await conn.db.insert(schema.commercePaymentAttempts).values({
        orderId: f.order.id,
        requestKey: key(),
        amountCents: f.order.totalCents,
        status: "failed",
        expiresAt: f.now(),
        createdAt: new Date(f.now().getTime() - 60000),
      });
      const [current] = await conn.db
        .insert(schema.commercePaymentAttempts)
        .values({
          orderId: f.order.id,
          requestKey: key(),
          amountCents: f.order.totalCents,
          status: "creating",
          expiresAt: new Date(f.now().getTime() + 31 * 60000),
          createdAt: f.now(),
        })
        .returning();
      const proof = await f.gateway.createCheckout({
        attemptId: current!.id,
        orderId: f.order.id,
        amountCents: f.order.totalCents,
        currency: "cad",
        items: f.order.items.map((line) => ({
          name: line.name,
          unitAmountCents: line.priceCents,
          quantity: line.quantity,
        })),
        successUrl: "https://shop.test/shop",
        cancelUrl: "https://shop.test/shop",
        idempotencyKey: `commerce-checkout:${current!.id}`,
        expiresAt: current!.expiresAt,
      });
      await conn.db
        .update(schema.commercePaymentAttempts)
        .set({ status: "open", sessionId: proof.id, checkoutUrl: proof.url })
        .where(eq(schema.commercePaymentAttempts.id, current!.id));
      expect(
        (await f.payments.checkout(f.buyer, f.order.id, current!.requestKey)).payment.attemptId,
      ).toBe(current!.id);
      if (action === "cancel") {
        const result = await f.payments.cancel(f.buyer, f.order.id, key());
        expect(result.payment).toMatchObject({ attemptId: current!.id, status: "expired_unpaid" });
        expect((await f.stock()).reserved).toBe(0);
      } else {
        f.makePaid(proof.id);
        const result = await f.payments.reconcile(
          admin,
          f.order.id,
          "Resolve the current payment, not its old failed history",
        );
        expect(result.payment).toMatchObject({ attemptId: current!.id, status: "paid" });
        expect((await f.currentOrder()).status).toBe("paid");
      }
    }
  });
  it("rejects a sub-CAD-0.50 saved order before creating any provider attempt", async () => {
    const f = await fixture();
    await f.commerce.saveProduct(
      admin,
      {
        priceCents: 49,
        costCents: 20,
        reason: "Test-only administrator checked supplier quote and approved catalog change",
      },
      f.product.id,
    );
    const small = await f.createOrder();
    await expect(f.payments.checkout(f.buyer, small.id, key())).rejects.toMatchObject({
      status: 400,
    });
    expect(
      await conn.db
        .select()
        .from(schema.commercePaymentAttempts)
        .where(eq(schema.commercePaymentAttempts.orderId, small.id)),
    ).toHaveLength(0);
    expect(f.gateway.createCheckout).not.toHaveBeenCalled();
  });
  it("settles verified payment once across same-event replay and distinct-event duplicates, with no provider IO under lock", async () => {
    const f = await fixture();
    await f.bindReferrer();
    const opened = await f.payments.checkout(f.buyer, f.order.id, key());
    expect(opened.payment.status).toBe("open");
    expect((await f.stock()).reserved).toBe(1);
    await expect(f.commerce.testPay(f.buyer, f.order.id, key())).rejects.toMatchObject({
      status: 409,
      code: "commerce_payment_provider_mismatch",
    });
    f.makePaid(opened.payment.sessionId!);
    const payload = f.checkoutEvent(opened.payment.sessionId!);
    await f.send(payload);
    expect((await f.send(payload)).outcome).toBe("duplicate");
    await f.send(f.checkoutEvent(opened.payment.sessionId!));
    expect(await f.stock()).toMatchObject({ stock: 19, reserved: 0 });
    expect((await f.currentOrder()).status).toBe("paid");
    expect((await f.commerce.wallet(f.referrer.id)).pendingCents).toBe(3000);
    expect(
      await conn.db
        .select()
        .from(schema.commerceCommissions)
        .where(eq(schema.commerceCommissions.orderItemId, f.order.items[0]!.id)),
    ).toHaveLength(1);
    await expect(
      f.commerce.refund(admin, f.order.items[0]!.id, {
        refundTotalCents: 100,
        reason: "Must use provider",
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ status: 409, code: "commerce_payment_provider_mismatch" });
  });

  it("preserves a callback committed before the original create API response instead of reverting to unpaid", async () => {
    const f = await fixture();
    f.controls.onCreate = async (proof) => {
      f.makePaid(proof.id);
      await f.send(f.checkoutEvent(proof.id));
    };
    const result = await f.payments.checkout(f.buyer, f.order.id, key());
    expect(result.payment.status).toBe("paid");
    expect(result.checkoutUrl).toBeNull();
    expect(await f.stock()).toMatchObject({ stock: 19, reserved: 0 });
  });

  it("preserves definite unpaid cancellation when an older opening API response arrives afterward", async () => {
    const f = await fixture();
    f.controls.onCreate = async (proof) => {
      const remote = f.sessions.get(proof.id)!;
      remote.status = "expired";
      remote.paymentStatus = "unpaid";
      remote.url = null;
      await f.send(
        f.eventPayload("checkout.session.expired", proof.id, {
          currency: "cad",
          purpose: COMMERCE_STRIPE_PURPOSE,
        }),
      );
    };
    const result = await f.payments.checkout(f.buyer, f.order.id, key());
    expect(result.payment.status).toBe("expired_unpaid");
    expect(result.checkoutUrl).toBeNull();
    expect((await f.currentOrder()).status).toBe("cancelled");
    expect(await f.stock()).toMatchObject({ stock: 20, reserved: 0 });
  });

  it("deduplicates equivalent JSON redeliveries but rejects a reused event ID with a different object", async () => {
    const f = await fixture(),
      opened = await f.payments.checkout(f.buyer, f.order.id, key());
    f.makePaid(opened.payment.sessionId!);
    const payload = f.checkoutEvent(opened.payment.sessionId!);
    await f.send(payload);
    expect((await f.send(JSON.stringify(JSON.parse(payload), null, 2))).outcome).toBe("duplicate");
    await expect(
      f.send(JSON.stringify({ ...JSON.parse(payload), objectId: "cs_test_foreign" })),
    ).rejects.toMatchObject({ status: 400, code: "commerce_event_conflict" });
    expect(await f.stock()).toMatchObject({ stock: 19, reserved: 0 });
    const event = JSON.parse(payload) as { id: string };
    const [inbox] = await conn.db
      .select()
      .from(schema.commercePaymentEvents)
      .where(eq(schema.commercePaymentEvents.id, event.id));
    expect(inbox!.payloadHash).toBe(createHash("sha256").update(payload).digest("hex"));
  });

  it("keeps unknown creation on the same durable key, rejects fresh keys, and releases stock only after definite cancellation", async () => {
    const f = await fixture();
    f.controls.failCreate = 1;
    const request = key();
    expect((await f.payments.checkout(f.buyer, f.order.id, request)).payment.status).toBe(
      "unknown",
    );
    await expect(f.payments.checkout(f.buyer, f.order.id, key())).rejects.toMatchObject({
      status: 409,
    });
    await f.payments.cancel(f.buyer, f.order.id, key());
    expect((await f.stock()).reserved).toBe(1);
    const recovered = await f.payments.checkout(f.buyer, f.order.id, request);
    expect(recovered.payment.status).toBe("open");
    expect(f.sessionKeys.size).toBe(1);
    const calls = vi.mocked(f.gateway.createCheckout).mock.calls;
    expect(calls[0]![0].idempotencyKey).toBe(calls[1]![0].idempotencyKey);
    f.controls.failExpire = true;
    f.controls.failRetrieve = true;
    expect((await f.payments.cancel(f.buyer, f.order.id, key())).payment.status).toBe("unknown");
    expect((await f.stock()).reserved).toBe(1);
    f.controls.failExpire = false;
    f.controls.failRetrieve = false;
    expect((await f.payments.cancel(f.buyer, f.order.id, key())).payment.status).toBe(
      "expired_unpaid",
    );
    expect(await f.stock()).toMatchObject({ stock: 20, reserved: 0 });
  });

  it("never recreates an uncertain payment after the safe idempotency retry window", async () => {
    const f = await fixture();
    f.controls.failCreate = 1;
    const request = key();
    await f.payments.checkout(f.buyer, f.order.id, request);
    f.advance(24 * 60 * 60 * 1000);
    expect((await f.payments.checkout(f.buyer, f.order.id, request)).payment.status).toBe(
      "requires_review",
    );
    expect(f.gateway.createCheckout).toHaveBeenCalledTimes(1);
    expect((await f.stock()).reserved).toBe(1);
  });

  it("cancels or expires a provider order with no started attempt without permanently holding inventory", async () => {
    const f = await fixture();
    await f.payments.cancel(f.buyer, f.order.id, key());
    expect((await f.currentOrder()).status).toBe("cancelled");
    expect((await f.stock()).reserved).toBe(0);
    await expect(f.payments.checkout(f.buyer, f.order.id, key())).rejects.toMatchObject({
      status: 409,
    });
    await f.createOrder();
    f.advance(31 * 60 * 1000);
    await f.commerce.expireReservations();
    expect((await f.stock()).reserved).toBe(0);
    expect(f.gateway.createCheckout).not.toHaveBeenCalled();
  });

  it("temporarily blocks referral binding during uncertain checkout but restores eligibility after definite unpaid cancellation", async () => {
    const f = await fixture();
    const code = (await f.commerce.profile(f.referrer.id)).referralCode;
    const opened = await f.payments.checkout(f.buyer, f.order.id, key());
    await expect(f.commerce.bindReferral(f.buyer, code)).rejects.toMatchObject({
      status: 409,
      code: "commerce_payment_unresolved",
    });
    expect((await f.commerce.profile(f.buyer.id)).firstPaidAt).toBeNull();
    await f.payments.cancel(f.buyer, f.order.id, key());
    await f.commerce.bindReferral(f.buyer, code);
    f.makePaid(opened.payment.sessionId!);
    await f.send(f.checkoutEvent(opened.payment.sessionId!));
    expect((await f.payments.status(f.order.id, f.buyer.id)).payment.status).toBe(
      "requires_review",
    );
    expect((await f.commerce.wallet(f.referrer.id)).pendingCents).toBe(0);
    expect((await f.currentOrder()).status).toBe("cancelled");
  });

  it("keeps pending refunds unposted, then applies exact cumulative partial refunds once after confirmation", async () => {
    const f = await fixture();
    await f.bindReferrer();
    await f.charge();
    const itemId = f.order.items[0]!.id;
    const first = await f.payments.requestRefund(admin, itemId, {
      refundTotalCents: 10000,
      reason: "Partial test return",
      idempotencyKey: key(),
    });
    expect(first.refund.status).toBe("pending");
    expect((await f.currentOrder()).refundedCents).toBe(0);
    expect((await f.commerce.wallet(f.referrer.id)).pendingCents).toBe(3000);
    await expect(closeReviewedSupport(f, itemId)).rejects.toMatchObject({
      status: 409,
      code: "commerce_refund_unresolved",
    });
    const provider = [...f.providerRefunds.values()][0]!;
    provider.status = "succeeded";
    const payload = f.refundEvent(provider.id);
    await f.send(payload);
    await f.send(payload);
    await f.send(f.refundEvent(provider.id));
    expect((await f.currentOrder()).refundedCents).toBe(10000);
    expect((await f.commerce.wallet(f.referrer.id)).pendingCents).toBe(2000);
    const second = await f.payments.requestRefund(admin, itemId, {
      refundTotalCents: 15000,
      reason: "Second cumulative return",
      idempotencyKey: key(),
    });
    expect(second.refund.amountCents).toBe(5000);
    const next = [...f.providerRefunds.values()][1]!;
    next.status = "succeeded";
    await f.send(f.refundEvent(next.id));
    expect((await f.currentOrder()).refundedCents).toBe(15000);
    expect((await f.commerce.wallet(f.referrer.id)).pendingCents).toBe(1500);
  });

  it.each([
    { total: 6000, confirmation: "immediate" },
    { total: 30000, confirmation: "immediate" },
    { total: 6000, confirmation: "callback" },
    { total: 30000, confirmation: "callback" },
  ])(
    "keeps a $total-cent $confirmation internal Stripe refund separate from manual support closure",
    async ({ total, confirmation }) => {
      const f = await fixture();
      await f.bindReferrer();
      await f.charge();
      await f.deliver();
      const itemId = f.order.items[0]!.id;
      await f.commerce.requestReturn(f.buyer, f.order.id, {
        itemId,
        reason: "Returned parcel still needs inspection",
      });
      f.advance(31 * 86400000);
      const firstPaidAt = (await f.commerce.profile(f.buyer.id)).firstPaidAt;
      const request = {
        refundTotalCents: total,
        reason: "Refund only, do not close the return inspection",
        idempotencyKey: key(),
      };
      f.controls.refundStatus = confirmation === "immediate" ? "succeeded" : "pending";
      const result = await f.payments.requestRefund(admin, itemId, request);
      expect(result.refund.status).toBe(confirmation === "immediate" ? "succeeded" : "pending");
      const proof = [...f.providerRefunds.values()][0]!;
      if (confirmation === "callback") {
        await expect(closeReviewedSupport(f, itemId)).rejects.toMatchObject({
          status: 409,
          code: "commerce_refund_unresolved",
        });
        proof.status = "succeeded";
      }
      const payload = f.refundEvent(proof.id);
      await f.send(payload);
      const refundLedger = await orderLedger(f.order.id, [itemId]);
      await f.send(payload);
      await f.send(f.refundEvent(proof.id));
      await f.payments.requestRefund(admin, itemId, request);
      expect(f.gateway.createRefund).toHaveBeenCalledTimes(1);
      expect(await orderLedger(f.order.id, [itemId])).toEqual(refundLedger);
      await f.commerce.releaseCommissions(
        admin,
        "Test-only review of observation window and support outcomes",
      );
      const remaining = (30000 - total) / 10;
      expect(await f.commerce.wallet(f.referrer.id)).toMatchObject({
        availableCents: 0,
        pendingCents: remaining,
      });
      expect((await f.currentOrder()).items[0]).toMatchObject({
        refundedCents: total,
        openCase: true,
      });
      expect((await f.commerce.profile(f.buyer.id)).firstPaidAt).toBe(firstPaidAt);
      expect((await f.stock()).stock).toBe(19);
      expect(
        refundLedger
          .filter((line) => line.account === "supplier_payable")
          .reduce((sum, line) => sum + line.amountCents, 0),
      ).toBe(((30000 - total) * 12000) / 30000);
      await closeReviewedSupport(f, itemId);
      await f.commerce.releaseCommissions(
        admin,
        "Test-only review of observation window and support outcomes",
      );
      expect(await f.commerce.wallet(f.referrer.id)).toMatchObject({
        availableCents: remaining,
        pendingCents: 0,
      });
      const settled = await f.commerce.wallet(f.referrer.id);
      await f.commerce.releaseCommissions(
        admin,
        "Test-only review of observation window and support outcomes",
      );
      expect(await f.commerce.wallet(f.referrer.id)).toEqual(settled);
    },
  );

  it("does not issue a second refund when the first provider response was lost", async () => {
    const f = await fixture();
    await f.charge();
    f.controls.failRefund = 1;
    const itemId = f.order.items[0]!.id,
      request = key(),
      body = { refundTotalCents: 10000, reason: "Unknown result", idempotencyKey: request };
    expect((await f.payments.requestRefund(admin, itemId, body)).refund.status).toBe("unknown");
    await expect(
      f.payments.requestRefund(admin, itemId, { ...body, idempotencyKey: key() }),
    ).rejects.toMatchObject({ status: 409, code: "commerce_refund_unresolved" });
    expect((await f.payments.requestRefund(admin, itemId, body)).refund.status).toBe("pending");
    expect(f.refundKeys.size).toBe(1);
    const calls = vi.mocked(f.gateway.createRefund).mock.calls;
    expect(calls[0]![0].idempotencyKey).toBe(calls[1]![0].idempotencyKey);
    expect((await f.currentOrder()).refundedCents).toBe(0);
  });

  it("does not revive a failed refund when a stale pending API response arrives afterward", async () => {
    const f = await fixture();
    await f.charge();
    f.controls.onRefund = async (proof) => {
      f.providerRefunds.get(proof.id)!.status = "failed";
      await f.send(f.refundEvent(proof.id));
    };
    const body = {
      refundTotalCents: 10000,
      reason: "Callback failed first",
      idempotencyKey: key(),
    };
    const result = await f.payments.requestRefund(admin, f.order.items[0]!.id, body);
    expect(result.refund.status).toBe("failed");
    expect((await f.currentOrder()).refundedCents).toBe(0);
    expect((await f.payments.requestRefund(admin, f.order.items[0]!.id, body)).refund.status).toBe(
      "failed",
    );
    expect(f.gateway.createRefund).toHaveBeenCalledTimes(1);
  });

  it("defers a refund arriving before its payment mapping and freezes the later paid order for review", async () => {
    const f = await fixture();
    const opened = await f.payments.checkout(f.buyer, f.order.id, key()),
      remote = f.makePaid(opened.payment.sessionId!);
    const refund: CommerceRefundProof = {
      id: externalId("re_"),
      paymentIntentId: remote.paymentIntentId!,
      amountCents: 100,
      currency: "cad",
      status: "succeeded",
      metadata: {},
    };
    f.providerRefunds.set(refund.id, refund);
    const payload = f.refundEvent(refund.id);
    await expect(f.send(payload)).rejects.toMatchObject({
      status: 503,
      code: "commerce_payment_mapping_pending",
    });
    const event = JSON.parse(payload) as { id: string };
    const [inbox] = await conn.db
      .select()
      .from(schema.commercePaymentEvents)
      .where(eq(schema.commercePaymentEvents.id, event.id));
    expect(inbox!.processedAt).toBeNull();
    await f.send(f.checkoutEvent(remote.id));
    expect((await f.payments.status(f.order.id, f.buyer.id)).payment.status).toBe(
      "requires_review",
    );
    expect((await f.currentOrder()).items[0]!.openCase).toBe(true);
    expect((await f.send(payload)).outcome).toBe("requires_review");
  });

  it("makes unallocated refund review sticky and blocks closing cases, release, and frozen payout recording", async () => {
    const f = await fixture();
    await f.bindReferrer();
    const proof = await f.charge();
    await f.deliver();
    f.advance(31 * 24 * 60 * 60 * 1000);
    await f.commerce.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    const { withdrawal } = await f.commerce.requestWithdrawal(f.referrer, key());
    await f.commerce.reviewWithdrawal(admin, withdrawal.id, "approve", {});
    const refund: CommerceRefundProof = {
      id: externalId("re_"),
      paymentIntentId: proof.paymentIntentId!,
      amountCents: 100,
      currency: "cad",
      status: "succeeded",
      metadata: {},
    };
    f.providerRefunds.set(refund.id, refund);
    await f.send(f.refundEvent(refund.id));
    expect(
      (await f.payments.reconcile(admin, f.order.id, "Check paid status")).payment.status,
    ).toBe("requires_review");
    await expect(closeReviewedSupport(f, f.order.items[0]!.id)).rejects.toMatchObject({
      status: 409,
      code: "commerce_refund_unresolved",
    });
    await expect(f.commerce.requestWithdrawal(f.referrer, key())).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      f.commerce.reviewWithdrawal(recorder, withdrawal.id, "record", {
        reference: key(),
        reason: "Must remain frozen",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.commerce.wallet(f.referrer.id)).frozenCents).toBe(3000);
  });

  it("does not release a mature commission while an unallocated provider refund requires review", async () => {
    const f = await fixture();
    await f.bindReferrer();
    const proof = await f.charge();
    await f.deliver();
    const refund: CommerceRefundProof = {
      id: externalId("re_"),
      paymentIntentId: proof.paymentIntentId!,
      amountCents: 100,
      currency: "cad",
      status: "succeeded",
      metadata: {},
    };
    f.providerRefunds.set(refund.id, refund);
    await f.send(f.refundEvent(refund.id));
    f.advance(31 * 24 * 60 * 60 * 1000);
    await f.commerce.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect(await f.commerce.wallet(f.referrer.id)).toMatchObject({
      pendingCents: 3000,
      availableCents: 0,
    });
  });

  it("hides checkout capabilities when disabled or outside local/test while retaining readable history", async () => {
    const f = await fixture();
    await f.payments.checkout(f.buyer, f.order.id, key());
    for (const options of [
      { enabled: false, environment: "test" as const },
      { enabled: true, environment: "staging" as const },
      { enabled: true, environment: "production" as const },
    ]) {
      const disabled = new CommercePaymentService(f.commerce, {
        ...options,
        gateway: f.gateway,
        webPublicUrl: "https://shop.test",
        now: f.now,
      });
      expect((await disabled.status(f.order.id, f.buyer.id)).payment.checkoutUrl).toBeNull();
      await expect(disabled.checkout(f.buyer, f.order.id, key())).rejects.toMatchObject({
        status: 503,
      });
      await expect(disabled.handleWebhook("{}", "offline", "trace")).rejects.toMatchObject({
        status: 503,
      });
      await expect(
        disabled.requestRefund(admin, f.order.items[0]!.id, {
          refundTotalCents: 1,
          reason: "Disabled",
          idempotencyKey: key(),
        }),
      ).rejects.toMatchObject({ status: 503 });
    }
  });

  it("rejects IDOR before provider IO and ignores clearly foreign USD billing events", async () => {
    const f = await fixture(),
      stranger = await f.user();
    await expect(f.payments.status(f.order.id, stranger.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.payments.checkout(stranger, f.order.id, key())).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.payments.cancel(stranger, f.order.id, key())).rejects.toMatchObject({
      status: 404,
    });
    expect(f.gateway.createCheckout).not.toHaveBeenCalled();
    expect(
      (
        await f.send(
          f.eventPayload("checkout.session.completed", "cs_test_foreign", {
            currency: "usd",
            purpose: "topup",
          }),
        )
      ).outcome,
    ).toBe("ignored");
    expect(
      (await f.send(f.eventPayload("refund.updated", "re_foreign", { currency: "usd" }))).outcome,
    ).toBe("ignored");
    expect(f.gateway.retrieveCheckout).not.toHaveBeenCalled();
    expect(f.gateway.retrieveRefund).not.toHaveBeenCalled();
  });

  it("rejects live mode proof/events and never enables Stripe for simulation-selected commerce", async () => {
    const f = await fixture();
    f.controls.onCreate = async (proof) => {
      proof.livemode = true;
    };
    await expect(f.payments.checkout(f.buyer, f.order.id, key())).rejects.toMatchObject({
      status: 502,
      code: "commerce_payment_proof_invalid",
    });
    expect((await f.stock()).reserved).toBe(1);
    expect((await f.currentOrder()).status).toBe("awaiting_payment");
    await expect(
      f.send(f.eventPayload("checkout.session.completed", "cs_test_live", { livemode: true })),
    ).rejects.toMatchObject({ status: 400, code: "commerce_live_event_rejected" });
    const simulation = new CommerceService(conn.db, { mode: "test", environment: "test" });
    const disabled = new CommercePaymentService(simulation, {
      enabled: true,
      environment: "test",
      webPublicUrl: "https://shop.test",
      gateway: f.gateway,
    });
    await expect(disabled.checkout(f.buyer, f.order.id, key())).rejects.toMatchObject({
      status: 503,
    });
    expect((await disabled.status(f.order.id, f.buyer.id)).payment.checkoutUrl).toBeNull();
  });
});

describe("already-successful external Stripe TEST refund allocation", () => {
  it("allocates increments across item snapshots after a prior local refund without issuing another refund", async () => {
    const { f, order, proof, first, other, current } = await multiItemRefundFixture();
    f.controls.refundStatus = "succeeded";
    await f.payments.requestRefund(admin, first.id, {
      refundTotalCents: 1000,
      reason: "Earlier local refund",
      idempotencyKey: key(),
    });
    const calls = vi.mocked(f.gateway.createRefund).mock.calls.length;
    const profile = await f.commerce.profile(f.buyer.id);
    const external = await externalRefund(f, order.id, proof.paymentIntentId!, 149);
    const result = await f.payments.allocateExternalRefund(admin, external.entry.id, {
      expectedVersion: external.detail.refund.version,
      reason: "Allocate the confirmed dashboard refund",
      idempotencyKey: key(),
      allocations: [
        { itemId: first.id, amountCents: 50 },
        { itemId: other.id, amountCents: 99 },
      ],
    });
    expect(result.applied).toBe(true);
    expect((await current()).refundedCents).toBe(1149);
    expect((await current()).items.find((item) => item.id === first.id)!.refundedCents).toBe(1050);
    expect((await current()).items.find((item) => item.id === other.id)!.refundedCents).toBe(99);
    expect((await f.commerce.wallet(f.referrer.id)).pendingCents).toBe(2900);
    const entries = await orderLedger(order.id, [first.id, other.id]);
    expect(
      entries
        .filter((entry) => entry.account === "cash_test")
        .reduce((sum, entry) => sum + entry.amountCents, 0),
    ).toBe(29050);
    expect(
      entries
        .filter((entry) => entry.account === "supplier_payable")
        .reduce((sum, entry) => sum + entry.amountCents, 0),
    ).toBe(11629);
    expect(entries.reduce((sum, entry) => sum + BigInt(entry.amountCents), 0n)).toBe(0n);
    expect(f.gateway.createRefund).toHaveBeenCalledTimes(calls);
    expect((await f.commerce.profile(f.buyer.id)).firstPaidAt).toBe(profile.firstPaidAt);
    expect((await f.commerce.profile(f.buyer.id)).referrerId).toBe(f.referrer.id);
  });

  it("is idempotent across event replay, reordered allocation lines, keys and independent administrators", async () => {
    const { f, order, proof, first, other } = await multiItemRefundFixture();
    const external = await externalRefund(f, order.id, proof.paymentIntentId!, 150);
    const allocations = [
      { itemId: first.id, amountCents: 100 },
      { itemId: other.id, amountCents: 50 },
    ];
    const body = {
      expectedVersion: external.detail.refund.version,
      allocations,
      reason: "One external payment fact",
      idempotencyKey: key(),
    };
    expect((await f.payments.allocateExternalRefund(admin, external.entry.id, body)).applied).toBe(
      true,
    );
    const before = await orderLedger(order.id, [first.id, other.id]);
    expect((await f.payments.allocateExternalRefund(admin, external.entry.id, body)).applied).toBe(
      true,
    );
    await expect(
      f.payments.allocateExternalRefund(admin, external.entry.id, {
        ...body,
        allocations: [
          { itemId: first.id, amountCents: 99 },
          { itemId: other.id, amountCents: 51 },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.payments.allocateExternalRefund(admin, external.entry.id, {
        ...body,
        idempotencyKey: key(),
        reason: "A different immutable attribution must not replace the first",
        allocations: [
          { itemId: first.id, amountCents: 99 },
          { itemId: other.id, amountCents: 51 },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await f.payments.allocateExternalRefund(recorder, external.entry.id, {
          ...body,
          idempotencyKey: key(),
          allocations: allocations.toReversed(),
        })
      ).applied,
    ).toBe(true);
    await f.send(external.payload);
    await f.send(f.refundEvent(external.proof.id));
    expect(await orderLedger(order.id, [first.id, other.id])).toEqual(before);
    expect(
      (await f.payments.externalRefundDetail(external.entry.id)).refund.allocations,
    ).toHaveLength(2);
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("rejects wrong totals, amounts, item identities and stale versions without changing any accounting", async () => {
    const { f, order, proof, first, other, current } = await multiItemRefundFixture();
    const external = await externalRefund(f, order.id, proof.paymentIntentId!, 200);
    const before = await orderLedger(order.id, [first.id, other.id]);
    const invalid = [
      { allocations: [] },
      { allocations: [{ itemId: first.id, amountCents: 199 }] },
      { allocations: [{ itemId: first.id, amountCents: 201 }] },
      { allocations: [{ itemId: first.id, amountCents: -200 }] },
      { allocations: [{ itemId: first.id, amountCents: 0 }] },
      {
        allocations: [
          { itemId: first.id, amountCents: 100.5 },
          { itemId: other.id, amountCents: 99.5 },
        ],
      },
      {
        allocations: [
          { itemId: first.id, amountCents: 100 },
          { itemId: first.id, amountCents: 100 },
        ],
      },
      { allocations: [{ itemId: f.order.items[0]!.id, amountCents: 200 }] },
      { allocations: [{ itemId: other.id, amountCents: 200 }] },
      { allocations: [{ itemId: key(), amountCents: 200 }] },
      {
        expectedVersion: external.detail.refund.version + 1,
        allocations: [{ itemId: first.id, amountCents: 200 }],
      },
    ];
    for (const patch of invalid) {
      await expect(
        f.payments.allocateExternalRefund(admin, external.entry.id, {
          expectedVersion: external.detail.refund.version,
          reason: "Invalid allocation must be atomic",
          idempotencyKey: key(),
          ...patch,
        }),
      ).rejects.toHaveProperty("status");
      expect((await current()).refundedCents).toBe(0);
      expect(await orderLedger(order.id, [first.id, other.id])).toEqual(before);
      expect(
        (await f.payments.externalRefundDetail(external.entry.id)).refund.allocations,
      ).toHaveLength(0);
    }
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("rolls the entire multi-item allocation back if a later settlement fails", async () => {
    const { f, order, proof, first, other, current } = await multiItemRefundFixture();
    const external = await externalRefund(f, order.id, proof.paymentIntentId!, 150);
    const before = await orderLedger(order.id, [first.id, other.id]);
    const original = f.commerce.settleStripeRefundIn.bind(f.commerce);
    let calls = 0;
    const settle = vi
      .spyOn(f.commerce, "settleStripeRefundIn")
      .mockImplementation(async (...args) => {
        if (++calls === 2) throw new Error("Injected second-item settlement failure");
        return original(...args);
      });
    const body = {
      expectedVersion: external.detail.refund.version,
      allocations: [
        { itemId: first.id, amountCents: 100 },
        { itemId: other.id, amountCents: 50 },
      ],
      reason: "Atomic multi-item application",
      idempotencyKey: key(),
    };
    try {
      await expect(
        f.payments.allocateExternalRefund(admin, external.entry.id, body),
      ).rejects.toHaveProperty("status");
    } finally {
      settle.mockRestore();
    }
    expect(calls).toBe(2);
    expect(await orderLedger(order.id, [first.id, other.id])).toEqual(before);
    expect((await current()).refundedCents).toBe(0);
    expect(
      (await f.payments.externalRefundDetail(external.entry.id)).refund.allocations,
    ).toHaveLength(0);
    expect((await f.payments.allocateExternalRefund(admin, external.entry.id, body)).applied).toBe(
      true,
    );
    expect((await current()).refundedCents).toBe(150);
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("rejects a stale successful provider snapshot when a concurrent signed event changes its version", async () => {
    const f = await fixture();
    const paid = await f.charge();
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, 1000);
    f.controls.onRetrieveRefund = async () => {
      f.controls.onRetrieveRefund = undefined;
      f.providerRefunds.get(external.proof.id)!.status = "pending";
      await f.send(f.refundEvent(external.proof.id));
    };
    await expect(
      f.payments.allocateExternalRefund(admin, external.entry.id, {
        expectedVersion: external.detail.refund.version,
        allocations: [{ itemId: f.order.items[0]!.id, amountCents: 1000 }],
        reason: "Stale proof must not apply",
        idempotencyKey: key(),
      }),
    ).rejects.toHaveProperty("status");
    expect((await f.currentOrder()).refundedCents).toBe(0);
    expect(
      (await f.payments.externalRefundDetail(external.entry.id)).refund.allocations,
    ).toHaveLength(0);
    expect((await f.payments.status(f.order.id)).payment.status).toBe("requires_review");
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("rolls monetary entries, allocation rows and replay markers back when the final audit fails", async () => {
    const f = await fixture();
    const paid = await f.charge();
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, 1000);
    const itemId = f.order.items[0]!.id;
    const before = await orderLedger(f.order.id, [itemId]);
    let settled = false,
      auditFault = false;
    const original = f.commerce.settleStripeRefundIn.bind(f.commerce);
    const settle = vi
      .spyOn(f.commerce, "settleStripeRefundIn")
      .mockImplementation(async (...args) => {
        const result = await original(...args);
        settled = true;
        return result;
      });
    f.controls.transactionProxy = (tx) =>
      new Proxy(tx, {
        get(target, property, receiver) {
          if (property === "insert")
            return (table: Parameters<typeof tx.insert>[0]) => {
              if (table === schema.auditEvents && settled) {
                auditFault = true;
                throw new Error("Injected final audit persistence failure");
              }
              return target.insert(table);
            };
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const body = {
      expectedVersion: external.detail.refund.version,
      allocations: [{ itemId, amountCents: 1000 }],
      reason: "Ledger and audit commit together",
      idempotencyKey: key(),
    };
    try {
      await expect(
        f.payments.allocateExternalRefund(admin, external.entry.id, body),
      ).rejects.toHaveProperty("status");
    } finally {
      settle.mockRestore();
      f.controls.transactionProxy = undefined;
    }
    expect(auditFault).toBe(true);
    expect(await orderLedger(f.order.id, [itemId])).toEqual(before);
    expect((await f.currentOrder()).refundedCents).toBe(0);
    expect(
      (await f.payments.externalRefundDetail(external.entry.id)).refund.allocations,
    ).toHaveLength(0);
    expect((await f.payments.allocateExternalRefund(admin, external.entry.id, body)).applied).toBe(
      true,
    );
    expect((await f.currentOrder()).refundedCents).toBe(1000);
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("keeps other external refunds and independent cases blocked instead of clearing the whole order", async () => {
    const f = await fixture();
    await f.bindReferrer();
    const paid = await f.charge();
    await f.deliver();
    const one = await externalRefund(f, f.order.id, paid.paymentIntentId!, 1000);
    const two = await externalRefund(f, f.order.id, paid.paymentIntentId!, 500);
    const line = f.order.items[0]!;
    const applied = await f.payments.allocateExternalRefund(admin, one.entry.id, {
      expectedVersion: (await f.payments.externalRefundDetail(one.entry.id)).refund.version,
      allocations: [{ itemId: line.id, amountCents: 1000 }],
      reason: "Resolve only the first external fact",
      idempotencyKey: key(),
    });
    expect(applied.applied).toBe(true);
    expect(applied.reviewCleared).toBe(false);
    await expect(closeReviewedSupport(f, line.id)).rejects.toMatchObject({
      status: 409,
      code: "commerce_refund_unresolved",
    });
    f.advance(46 * 24 * 60 * 60 * 1000);
    await f.commerce.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect(await f.commerce.wallet(f.referrer.id)).toMatchObject({
      pendingCents: 2900,
      availableCents: 0,
    });
    await expect(f.commerce.requestWithdrawal(f.referrer, key())).rejects.toMatchObject({
      status: 409,
    });
    expect((await f.payments.externalRefundDetail(two.entry.id)).refund.allocations).toHaveLength(
      0,
    );
    expect((await f.currentOrder()).items[0]!.openCase).toBe(true);
    const finished = await f.payments.allocateExternalRefund(admin, two.entry.id, {
      expectedVersion: (await f.payments.externalRefundDetail(two.entry.id)).refund.version,
      allocations: [{ itemId: line.id, amountCents: 500 }],
      reason: "Resolve the final known external fact",
      idempotencyKey: key(),
    });
    expect(finished.reviewCleared).toBe(true);
    expect(finished.payment.status).toBe("paid");
    expect((await f.currentOrder()).items[0]!.openCase).toBe(true);
    await f.commerce.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect((await f.commerce.wallet(f.referrer.id)).availableCents).toBe(0);
    await closeReviewedSupport(f, line.id);
    await f.commerce.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect(await f.commerce.wallet(f.referrer.id)).toMatchObject({
      pendingCents: 0,
      availableCents: 2850,
    });
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("clears only the fully allocated external-only family when newer facts are allocated before older facts", async () => {
    const f = await fixture();
    const paid = await f.charge();
    const older = await externalRefund(f, f.order.id, paid.paymentIntentId!, 500);
    const newer = await externalRefund(f, f.order.id, paid.paymentIntentId!, 1000);
    const newerResult = await f.payments.allocateExternalRefund(admin, newer.entry.id, {
      expectedVersion: (await f.payments.externalRefundDetail(newer.entry.id)).refund.version,
      allocations: [{ itemId: f.order.items[0]!.id, amountCents: 1000 }],
      reason: "Process newest confirmed external fact first",
      idempotencyKey: key(),
    });
    expect(newerResult.reviewCleared).toBe(false);
    expect(newerResult.payment.status).toBe("requires_review");
    await expect(closeReviewedSupport(f, f.order.items[0]!.id)).rejects.toMatchObject({
      status: 409,
      code: "commerce_refund_unresolved",
    });
    const olderResult = await f.payments.allocateExternalRefund(recorder, older.entry.id, {
      expectedVersion: (await f.payments.externalRefundDetail(older.entry.id)).refund.version,
      allocations: [{ itemId: f.order.items[0]!.id, amountCents: 500 }],
      reason: "Finish the older confirmed external fact",
      idempotencyKey: key(),
    });
    expect(olderResult.reviewCleared).toBe(true);
    expect(olderResult.payment.status).toBe("paid");
    expect((await f.currentOrder()).refundedCents).toBe(1500);
    expect((await f.currentOrder()).items[0]!.openCase).toBe(true);
    await closeReviewedSupport(f, f.order.items[0]!.id);
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("refuses allocation while another item's internal provider refund is unresolved", async () => {
    const { f, order, proof, first, other, current } = await multiItemRefundFixture();
    await f.payments.requestRefund(admin, other.id, {
      refundTotalCents: 50,
      reason: "Internal refund still pending",
      idempotencyKey: key(),
    });
    const external = await externalRefund(f, order.id, proof.paymentIntentId!, 100);
    await expect(
      f.payments.allocateExternalRefund(admin, external.entry.id, {
        expectedVersion: external.detail.refund.version,
        allocations: [{ itemId: first.id, amountCents: 100 }],
        reason: "Do not mix unresolved origins",
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await current()).refundedCents).toBe(0);
    expect(f.gateway.createRefund).toHaveBeenCalledTimes(1);
  });

  it("records released/frozen commission recovery without unfreezing or falsely marking a payout paid", async () => {
    const f = await fixture();
    await f.bindReferrer();
    const paid = await f.charge();
    await f.deliver();
    f.advance(31 * 24 * 60 * 60 * 1000);
    await f.commerce.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    const { withdrawal } = await f.commerce.requestWithdrawal(f.referrer, key());
    await f.commerce.reviewWithdrawal(admin, withdrawal.id, "approve", {});
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, 10000);
    await f.payments.allocateExternalRefund(admin, external.entry.id, {
      expectedVersion: external.detail.refund.version,
      allocations: [{ itemId: f.order.items[0]!.id, amountCents: 10000 }],
      reason: "Refund after withdrawal freeze",
      idempotencyKey: key(),
    });
    expect(await f.commerce.wallet(f.referrer.id)).toMatchObject({
      availableCents: 0,
      frozenCents: 3000,
      recoveryCents: 1000,
      paidCents: 0,
    });
    await expect(
      f.commerce.reviewWithdrawal(recorder, withdrawal.id, "record", {
        reference: key(),
        reason: "Recovery must block recording",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await f.commerce.reviewWithdrawal(admin, withdrawal.id, "reject", {
      reason: "Reject and offset recovery",
    });
    expect(await f.commerce.wallet(f.referrer.id)).toMatchObject({
      availableCents: 2000,
      frozenCents: 0,
      recoveryCents: 0,
      paidCents: 0,
    });
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("retains paid history and creates recovery when an external refund arrives after payout", async () => {
    const f = await fixture();
    await f.bindReferrer();
    const paid = await f.charge();
    await f.deliver();
    f.advance(31 * 24 * 60 * 60 * 1000);
    await f.commerce.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    const { withdrawal } = await f.commerce.requestWithdrawal(f.referrer, key());
    await f.commerce.reviewWithdrawal(admin, withdrawal.id, "approve", {});
    await f.commerce.reviewWithdrawal(recorder, withdrawal.id, "record", {
      reference: key(),
      reason: "Offline test payout",
    });
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, 10000);
    await f.payments.allocateExternalRefund(admin, external.entry.id, {
      expectedVersion: external.detail.refund.version,
      allocations: [{ itemId: f.order.items[0]!.id, amountCents: 10000 }],
      reason: "Refund after recorded payout",
      idempotencyKey: key(),
    });
    expect(await f.commerce.wallet(f.referrer.id)).toMatchObject({
      availableCents: 0,
      frozenCents: 0,
      recoveryCents: 1000,
      paidCents: 3000,
    });
    await expect(f.commerce.requestWithdrawal(f.referrer, key())).rejects.toMatchObject({
      status: 409,
    });
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("does not reassign a locally applied refund after dashboard metadata was cleared", async () => {
    const f = await fixture();
    await f.charge();
    f.controls.refundStatus = "succeeded";
    await f.payments.requestRefund(admin, f.order.items[0]!.id, {
      refundTotalCents: 1000,
      reason: "Already locally applied",
      idempotencyKey: key(),
    });
    const owned = [...f.providerRefunds.values()][0]!;
    owned.metadata = {};
    const payload = f.refundEvent(owned.id);
    await f.send(payload);
    const external = (await f.payments.listExternalRefunds(f.order.id)).refunds.find(
      (row) => row.providerRefundId === owned.id,
    );
    if (external) {
      expect(external.allocationState).toBe("excluded_owned");
      await expect(
        f.payments.allocateExternalRefund(admin, external.id, {
          expectedVersion: external.version,
          allocations: [{ itemId: f.order.items[0]!.id, amountCents: 1000 }],
          reason: "Must not apply twice",
          idempotencyKey: key(),
        }),
      ).rejects.toMatchObject({ status: 409 });
    }
    expect((await f.currentOrder()).refundedCents).toBe(1000);
    expect(f.gateway.createRefund).toHaveBeenCalledTimes(1);
  });

  it("requires persisted signed source events and TEST configuration rather than accepting a fabricated refund id", async () => {
    const f = await fixture();
    const paid = await f.charge();
    await expect(
      f.payments.observeExternalRefund(admin, externalId("evt_"), "Unknown source"),
    ).rejects.toHaveProperty("status");
    await expect(
      f.payments.observeExternalRefund(admin, externalId("re_"), "Raw provider id is not proof"),
    ).rejects.toHaveProperty("status");
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, 100);
    for (const environment of ["staging", "production"] as const) {
      const disabled = new CommercePaymentService(f.commerce, {
        enabled: true,
        environment,
        gateway: f.gateway,
        webPublicUrl: "https://shop.test",
        now: f.now,
      });
      await expect(
        disabled.allocateExternalRefund(admin, external.entry.id, {
          expectedVersion: external.detail.refund.version,
          allocations: [{ itemId: f.order.items[0]!.id, amountCents: 100 }],
          reason: "No deployment override",
          idempotencyKey: key(),
        }),
      ).rejects.toMatchObject({ status: 503 });
    }
    expect((await f.currentOrder()).refundedCents).toBe(0);
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("registers a refund that arrived before payment mapping only once after the payment is confirmed", async () => {
    const f = await fixture();
    const opened = await f.payments.checkout(f.buyer, f.order.id, key());
    const paid = f.makePaid(opened.payment.sessionId!);
    const proof: Mutable<CommerceRefundProof> = {
      id: externalId("re_"),
      paymentIntentId: paid.paymentIntentId!,
      amountCents: 1000,
      currency: "cad",
      status: "succeeded",
      metadata: {},
      livemode: false,
    };
    f.providerRefunds.set(proof.id, proof);
    const payload = f.refundEvent(proof.id);
    await expect(f.send(payload)).rejects.toMatchObject({ status: 503 });
    const sourceEvent = (JSON.parse(payload) as { id: string }).id;
    await expect(
      f.payments.observeExternalRefund(admin, sourceEvent, "Mapping is not established yet"),
    ).rejects.toHaveProperty("status");
    expect((await f.currentOrder()).refundedCents).toBe(0);
    await f.send(f.checkoutEvent(paid.id));
    await f.send(payload);
    await f.send(payload);
    const entries = (await f.payments.listExternalRefunds(f.order.id)).refunds.filter(
      (row) => row.providerRefundId === proof.id,
    );
    expect(entries).toHaveLength(1);
    const detail = await f.payments.observeExternalRefund(
      admin,
      sourceEvent,
      "Observe the persisted verified event",
    );
    expect(detail.refund.id).toBe(entries[0]!.id);
    const allocated = await f.payments.allocateExternalRefund(admin, detail.refund.id, {
      expectedVersion: detail.refund.version,
      allocations: [{ itemId: f.order.items[0]!.id, amountCents: 1000 }],
      reason: "Allocate after genuine payment mapping",
      idempotencyKey: key(),
    });
    expect(allocated.applied).toBe(true);
    expect(allocated.reviewCleared).toBe(false);
    expect(allocated.payment.status).toBe("requires_review");
    await expect(closeReviewedSupport(f, f.order.items[0]!.id)).rejects.toMatchObject({
      status: 409,
      code: "commerce_refund_unresolved",
    });
    expect((await f.currentOrder()).refundedCents).toBe(1000);
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("never accounts pending, action-required, failed or canceled external outcomes as a successful refund", async () => {
    const f = await fixture();
    const paid = await f.charge();
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, 1000);
    for (const status of ["pending", "requires_action", "failed", "canceled"]) {
      f.providerRefunds.get(external.proof.id)!.status = status;
      await f.send(f.refundEvent(external.proof.id));
      const detail = await f.payments.externalRefundDetail(external.entry.id);
      await expect(
        f.payments.allocateExternalRefund(admin, external.entry.id, {
          expectedVersion: detail.refund.version,
          allocations: [{ itemId: f.order.items[0]!.id, amountCents: 1000 }],
          reason: "Success must be confirmed",
          idempotencyKey: key(),
        }),
      ).rejects.toHaveProperty("status");
      expect((await f.currentOrder()).refundedCents).toBe(0);
      expect(detail.refund.allocations).toHaveLength(0);
    }
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("keeps applied refund history immutable and re-freezes contradictory late provider outcomes", async () => {
    const f = await fixture();
    const paid = await f.charge();
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, 1000);
    await f.payments.allocateExternalRefund(admin, external.entry.id, {
      expectedVersion: external.detail.refund.version,
      allocations: [{ itemId: f.order.items[0]!.id, amountCents: 1000 }],
      reason: "Successful external allocation",
      idempotencyKey: key(),
    });
    const before = await orderLedger(f.order.id, [f.order.items[0]!.id]);
    f.providerRefunds.get(external.proof.id)!.status = "failed";
    await f.send(
      eventPayload("refund.failed", external.proof.id, {
        currency: "cad",
        paymentIntentId: paid.paymentIntentId!,
      }),
    );
    expect(await orderLedger(f.order.id, [f.order.items[0]!.id])).toEqual(before);
    expect((await f.currentOrder()).refundedCents).toBe(1000);
    expect((await f.payments.status(f.order.id)).payment.status).toBe("requires_review");
    expect(
      (await f.payments.externalRefundDetail(external.entry.id)).refund.allocations,
    ).toHaveLength(1);
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("preserves SKU snapshots and physical stock when a full external refund cancels an unshipped item", async () => {
    const f = await fixture();
    const paid = await f.charge();
    const before = await f.stock();
    await f.commerce.saveProduct(
      admin,
      {
        sku: key(),
        name: "Renamed catalog item",
        reason: "Test-only administrator checked supplier quote and approved catalog change",
      },
      f.product.id,
    );
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, f.order.totalCents);
    expect(external.detail.items.find((line) => line.itemId === f.order.items[0]!.id)!.sku).toBe(
      f.product.sku,
    );
    await f.payments.allocateExternalRefund(admin, external.entry.id, {
      expectedVersion: external.detail.refund.version,
      allocations: [{ itemId: f.order.items[0]!.id, amountCents: f.order.totalCents }],
      reason: "Full financial refund before shipment",
      idempotencyKey: key(),
    });
    expect((await f.currentOrder()).status).toBe("refunded");
    expect((await f.currentOrder()).items[0]).toMatchObject({
      sku: f.product.sku,
      name: f.product.name,
      status: "cancelled",
    });
    expect((await f.stock()).stock).toBe(before.stock);
    await expect(
      conn.db
        .update(schema.commerceOrderItems)
        .set({ sku: "tampered-snapshot" })
        .where(eq(schema.commerceOrderItems.id, f.order.items[0]!.id)),
    ).rejects.toThrow();
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });

  it("protects external allocation financial history and provider identity against direct database rewriting", async () => {
    const f = await fixture();
    const paid = await f.charge();
    const external = await externalRefund(f, f.order.id, paid.paymentIntentId!, 1000);
    await f.payments.allocateExternalRefund(admin, external.entry.id, {
      expectedVersion: external.detail.refund.version,
      allocations: [{ itemId: f.order.items[0]!.id, amountCents: 1000 }],
      reason: "Immutable financial attribution",
      idempotencyKey: key(),
    });
    const before = await f.payments.externalRefundDetail(external.entry.id);
    await expect(
      conn.db
        .update(schema.commerceExternalRefundAllocations)
        .set({ amountCents: 2000, refundedAfterCents: 2000 })
        .where(eq(schema.commerceExternalRefundAllocations.externalRefundId, external.entry.id)),
    ).rejects.toThrow();
    await expect(
      conn.db
        .delete(schema.commerceExternalRefundAllocations)
        .where(eq(schema.commerceExternalRefundAllocations.externalRefundId, external.entry.id)),
    ).rejects.toThrow();
    await expect(
      conn.db
        .update(schema.commerceExternalRefunds)
        .set({ amountCents: 2000 })
        .where(eq(schema.commerceExternalRefunds.id, external.entry.id)),
    ).rejects.toThrow();
    await expect(
      conn.db
        .update(schema.commerceExternalRefunds)
        .set({ paymentIntentId: externalId("pi_") })
        .where(eq(schema.commerceExternalRefunds.id, external.entry.id)),
    ).rejects.toThrow();
    expect((await f.payments.externalRefundDetail(external.entry.id)).refund).toEqual(
      before.refund,
    );
    expect((await f.currentOrder()).refundedCents).toBe(1000);
    expect(f.gateway.createRefund).not.toHaveBeenCalled();
  });
});
