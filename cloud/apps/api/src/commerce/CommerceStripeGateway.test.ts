import Stripe from "stripe";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  COMMERCE_STRIPE_PURPOSE,
  commerceTestCheckoutUrl,
  createCommerceStripeGateway,
  type CommerceCheckoutInput,
  type CommerceStripeSdk,
} from "./CommerceStripeGateway.ts";

const secretKey = "sk_test_offline_fixture";
const webhookSecret = "whsec_offline_fixture";
const sessionId = "cs_test_offline1";
const paymentIntentId = "pi_offline1";
const input: CommerceCheckoutInput = {
  attemptId: "attempt-1",
  orderId: "order-1",
  amountCents: 4900,
  currency: "cad",
  items: [
    { name: "Saved tote SKU", unitAmountCents: 1900, quantity: 1 },
    { name: "Saved lamp SKU", unitAmountCents: 1500, quantity: 2 },
  ],
  successUrl: "http://127.0.0.1:3002/shop?order=order-1",
  cancelUrl: "http://127.0.0.1:3002/shop?order=order-1&payment=cancelled",
  idempotencyKey: "checkout:attempt-1",
  expiresAt: new Date(Date.now() + 31 * 60 * 1000),
};
const session = () =>
  ({
    id: sessionId,
    url: `https://checkout.stripe.com/c/pay/${sessionId}#offline-test`,
    payment_intent: paymentIntentId,
    amount_total: 4900,
    currency: "cad",
    payment_status: "unpaid",
    status: "open",
    livemode: false,
    metadata: {
      purpose: COMMERCE_STRIPE_PURPOSE,
      attemptId: input.attemptId,
      orderId: input.orderId,
    },
    expires_at: Math.floor(input.expiresAt.getTime() / 1000),
  }) as unknown as Stripe.Checkout.Session;
const refundInput = {
  refundRequestId: "refund-request-1",
  orderId: "order-1",
  itemId: "item-1",
  paymentIntentId,
  amountCents: 1,
  idempotencyKey: "refund:request-1",
};
const refund = () =>
  ({
    id: "re_offline1",
    payment_intent: paymentIntentId,
    amount: 1,
    currency: "cad",
    status: "pending",
    metadata: {
      purpose: COMMERCE_STRIPE_PURPOSE,
      refundRequestId: refundInput.refundRequestId,
      orderId: refundInput.orderId,
      itemId: refundInput.itemId,
    },
  }) as unknown as Stripe.Refund;

function fixture() {
  const sdk: CommerceStripeSdk = {
    checkout: {
      sessions: {
        create: vi.fn(async () => session()),
        retrieve: vi.fn(async () => session()),
        expire: vi.fn(async () => ({ ...session(), status: "expired" as const, url: null })),
      },
    },
    refunds: { create: vi.fn(async () => refund()), retrieve: vi.fn(async () => refund()) },
    webhooks: new Stripe(secretKey).webhooks,
  };
  return { sdk, gateway: createCommerceStripeGateway({ secretKey, webhookSecret, stripe: sdk }) };
}
function signed(type = "checkout.session.completed", overrides: Record<string, unknown> = {}) {
  const payload = JSON.stringify({
    id: "evt_offline1",
    object: "event",
    type,
    livemode: false,
    data: { object: { id: sessionId, customer_email: "never-forward@test.invalid" } },
    ...overrides,
  });
  const signature = new Stripe(secretKey).webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  return { payload, signature };
}

describe("commerce-only Stripe TEST adapter", () => {
  it("rejects live/shared/absent credential configuration without calling the SDK", () => {
    for (const key of ["", "sk_live_not_allowed", "rk_test_not_selected", "sk_test_ whitespace"])
      expect(() => createCommerceStripeGateway({ secretKey: key, webhookSecret })).toThrow();
    expect(() => createCommerceStripeGateway({ secretKey, webhookSecret: "" })).toThrow();
  });

  it("builds CAD card-only hosted Checkout from saved lines with its own metadata and idempotency key", async () => {
    const { sdk, gateway } = fixture();
    const result = await gateway.createCheckout(input);
    expect(result).toMatchObject({
      id: sessionId,
      paymentIntentId,
      amountCents: 4900,
      currency: "cad",
      status: "open",
      livemode: false,
    });
    const create = vi.mocked(sdk.checkout.sessions.create);
    expect(create).toHaveBeenCalledOnce();
    const [params, options] = create.mock.calls[0]!;
    expect(options).toEqual({ idempotencyKey: input.idempotencyKey });
    expect(params).toMatchObject({
      mode: "payment",
      ui_mode: "hosted_page",
      currency: "cad",
      payment_method_types: ["card"],
      automatic_tax: { enabled: false },
      allow_promotion_codes: false,
      adaptive_pricing: { enabled: false },
      metadata: { purpose: "commerce_test", attemptId: "attempt-1", orderId: "order-1" },
      payment_intent_data: {
        metadata: { purpose: "commerce_test", attemptId: "attempt-1", orderId: "order-1" },
      },
    });
    expect(params.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: 1900,
          product_data: { name: "Saved tote SKU" },
        },
      },
      {
        quantity: 2,
        price_data: {
          currency: "cad",
          unit_amount: 1500,
          product_data: { name: "Saved lamp SKU" },
        },
      },
    ]);
    expect(params).not.toHaveProperty("customer");
    expect(params).not.toHaveProperty("customer_email");
  });

  it("validates snapshot totals, cents, quantities and configured return URLs before any provider call", async () => {
    const { sdk, gateway } = fixture();
    for (const candidate of [
      { ...input, amountCents: 4901 },
      { ...input, amountCents: 49 },
      { ...input, amountCents: 100_000_000 },
      { ...input, items: [] },
      { ...input, items: [{ name: "SKU", unitAmountCents: 49.5, quantity: 1 }] },
      { ...input, items: [{ name: "SKU", unitAmountCents: 4900, quantity: -1 }] },
      { ...input, successUrl: "javascript:alert(1)" },
      { ...input, cancelUrl: "http://foreign.test/shop" },
      { ...input, currency: "usd" },
    ])
      await expect(
        gateway.createCheckout(candidate as CommerceCheckoutInput),
      ).rejects.toMatchObject({ status: 400 });
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("binds external checkout URLs to the exact saved test Session and rejects navigation tricks", () => {
    expect(
      commerceTestCheckoutUrl(`https://checkout.stripe.com/c/pay/${sessionId}#token`, sessionId),
    ).toBe(`https://checkout.stripe.com/c/pay/${sessionId}#token`);
    for (const value of [
      `http://checkout.stripe.com/c/pay/${sessionId}`,
      `https://checkout.stripe.com.evil.test/c/pay/${sessionId}`,
      `https://user:secret@checkout.stripe.com/c/pay/${sessionId}`,
      `https://checkout.stripe.com:443/c/pay/${sessionId}`,
      `https://checkout.stripe.com/c/pay/cs_test_other`,
      `https://checkout.stripe.com/c/pay/${sessionId}?redirect=foreign`,
      `https://checkout.stripe.com/x/../c/pay/${sessionId}`,
      `https://checkout.stripe.com/c/%70ay/${sessionId}`,
      `https://checkout.stripe.com/c/pay/${sessionId}/`,
      `https://checkout.stripe.com/c/pay/${sessionId}\n`,
      `https://checkout.stripe.com/c/pay/${sessionId}\\`,
    ])
      expect(() => commerceTestCheckoutUrl(value, sessionId)).toThrow();
    expect(() =>
      commerceTestCheckoutUrl("https://checkout.stripe.com/c/pay/cs_live_123", "cs_live_123"),
    ).toThrow();
  });

  it("rejects live, mismatched, wrong-currency and incorrect-session provider responses", async () => {
    for (const patch of [
      { livemode: true },
      { currency: "usd" },
      { amount_total: 4901 },
      { metadata: { purpose: "topup", orgId: "ai-org" } },
      { url: "https://foreign.test/payment" },
    ]) {
      const { sdk, gateway } = fixture();
      vi.mocked(sdk.checkout.sessions.create).mockResolvedValue({
        ...session(),
        ...patch,
      } as Stripe.Checkout.Session);
      await expect(gateway.createCheckout(input)).rejects.toMatchObject({ status: 502 });
    }
    const { sdk, gateway } = fixture();
    vi.mocked(sdk.checkout.sessions.retrieve).mockResolvedValue({
      ...session(),
      id: "cs_test_another",
      url: null,
    });
    await expect(gateway.retrieveCheckout(sessionId)).rejects.toMatchObject({ status: 502 });
  });

  it("uses persisted cancellation idempotency without treating an unknown cancellation as expired", async () => {
    const { sdk, gateway } = fixture();
    expect((await gateway.expireCheckout(sessionId, "cancel:attempt-1")).status).toBe("expired");
    expect(sdk.checkout.sessions.expire).toHaveBeenCalledExactlyOnceWith(
      sessionId,
      {},
      { idempotencyKey: "cancel:attempt-1" },
    );
    vi.mocked(sdk.checkout.sessions.expire).mockRejectedValue(
      new Error("private Stripe response: private-address private-key"),
    );
    await expect(gateway.expireCheckout(sessionId, "cancel:attempt-1")).rejects.toMatchObject({
      status: 502,
      code: "commerce_payment_provider_unavailable",
      message: "The test payment result is unknown. Check its status before retrying.",
    });
  });

  it("sends partial refunds with an independent operation reference and preserves pending status", async () => {
    const { sdk, gateway } = fixture();
    const result = await gateway.createRefund(refundInput);
    expect(result).toMatchObject({
      id: "re_offline1",
      paymentIntentId,
      amountCents: 1,
      status: "pending",
      currency: "cad",
    });
    expect(sdk.refunds.create).toHaveBeenCalledExactlyOnceWith(
      {
        payment_intent: paymentIntentId,
        amount: 1,
        metadata: {
          purpose: "commerce_test",
          refundRequestId: "refund-request-1",
          orderId: "order-1",
          itemId: "item-1",
        },
      },
      { idempotencyKey: "refund:request-1" },
    );
    expect(result).not.toHaveProperty("livemode");
  });

  it("rejects refunds from another PaymentIntent, amount, operation, live expanded PI or invalid currency", async () => {
    for (const patch of [
      { payment_intent: "pi_foreign" },
      { amount: 2 },
      { currency: "usd" },
      { metadata: { purpose: "commerce_test", refundRequestId: "foreign" } },
      { payment_intent: { id: paymentIntentId, livemode: true } },
    ]) {
      const { sdk, gateway } = fixture();
      vi.mocked(sdk.refunds.create).mockResolvedValue({ ...refund(), ...patch } as Stripe.Refund);
      await expect(gateway.createRefund(refundInput)).rejects.toMatchObject({ status: 502 });
    }
  });

  it("verifies real SDK signatures over the unchanged body without forwarding private event data", async () => {
    const { gateway } = fixture();
    const { payload, signature } = signed();
    expect(await gateway.verifyEvent(payload, signature)).toEqual({
      id: "evt_offline1",
      type: "checkout.session.completed",
      livemode: false,
      objectId: sessionId,
      payloadHash: createHash("sha256").update(payload).digest("hex"),
    });
    await expect(gateway.verifyEvent(`${payload} `, signature)).rejects.toMatchObject({
      status: 400,
      code: "commerce_bad_signature",
    });
    await expect(gateway.verifyEvent(payload, "invalid")).rejects.toMatchObject({
      status: 400,
      code: "commerce_bad_signature",
    });
    const stale = new Stripe(secretKey).webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    await expect(gateway.verifyEvent(payload, stale)).rejects.toMatchObject({
      status: 400,
      code: "commerce_bad_signature",
    });
  });

  it("rejects signed live/Connect events and caps webhook input without trusting its headers", async () => {
    const { gateway, sdk } = fixture();
    for (const overrides of [
      { livemode: true },
      { account: "acct_foreign" },
      { livemode: undefined },
    ]) {
      const s = signed("checkout.session.completed", overrides);
      await expect(gateway.verifyEvent(s.payload, s.signature)).rejects.toMatchObject({
        status: 400,
        code: "commerce_live_event_rejected",
      });
    }
    const verifier = vi.spyOn(sdk.webhooks, "constructEventAsync");
    await expect(
      gateway.verifyEvent("x".repeat(1024 * 1024 + 1), "anything"),
    ).rejects.toMatchObject({ status: 400 });
    expect(verifier).not.toHaveBeenCalled();
  });
  it("normalizes only safe signed routing facts for foreign-currency filtering and deferred refunds", async () => {
    const { gateway } = fixture();
    for (const payment_intent of [
      paymentIntentId,
      { id: paymentIntentId, client_secret: "never-forward" },
    ]) {
      const event = signed("refund.updated", {
        data: {
          object: {
            id: "re_offline1",
            currency: "usd",
            metadata: { purpose: "topup", orgId: "never-forward" },
            payment_intent,
          },
        },
      });
      const normalized = await gateway.verifyEvent(event.payload, event.signature);
      expect(normalized).toMatchObject({ currency: "usd", purpose: "topup", paymentIntentId });
      expect(normalized).not.toHaveProperty("metadata");
      expect(normalized).not.toHaveProperty("client_secret");
    }
  });
});
