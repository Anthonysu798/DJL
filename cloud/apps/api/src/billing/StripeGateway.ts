/**
 * The narrow slice of Stripe the API depends on, so BillingService can be
 * tested with an in-memory fake and production uses the real SDK.
 */
import Stripe from "stripe";

export interface CheckoutInput {
  readonly customerId: string;
  readonly mode: "subscription" | "payment";
  readonly priceId: string;
  readonly quantity: number;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly metadata: Record<string, string>;
  readonly idempotencyKey: string;
}

export interface StripeGateway {
  readonly createCustomer: (input: {
    readonly email: string;
    readonly orgId: string;
    readonly name: string;
  }) => Promise<{ readonly id: string }>;
  readonly createCheckoutSession: (
    input: CheckoutInput,
  ) => Promise<{ readonly id: string; readonly url: string }>;
  readonly createPortalSession: (input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }) => Promise<{ readonly url: string }>;
  readonly constructEvent: (payload: string, signature: string) => Stripe.Event;
  readonly refundPaymentIntent: (
    paymentIntentId: string,
    idempotencyKey: string,
  ) => Promise<{ readonly id: string }>;
}

export function createStripeGateway(input: {
  readonly secretKey: string;
  readonly webhookSecret: string;
}): StripeGateway {
  const stripe = new Stripe(input.secretKey, {
    apiVersion: "2026-08-27.basil" as Stripe.LatestApiVersion,
    typescript: true,
  });
  return {
    async createCustomer({ email, orgId, name }) {
      const c = await stripe.customers.create(
        { email, name, metadata: { orgId } },
        { idempotencyKey: `customer:${orgId}` },
      );
      return { id: c.id };
    },
    async createCheckoutSession(i) {
      const s = await stripe.checkout.sessions.create(
        {
          customer: i.customerId,
          mode: i.mode,
          line_items: [{ price: i.priceId, quantity: i.quantity }],
          success_url: i.successUrl,
          cancel_url: i.cancelUrl,
          metadata: i.metadata,
          automatic_tax: { enabled: true },
          customer_update: { address: "auto", name: "auto" },
          allow_promotion_codes: true,
          ...(i.mode === "subscription"
            ? { subscription_data: { metadata: i.metadata } }
            : { payment_intent_data: { metadata: i.metadata } }),
        },
        { idempotencyKey: i.idempotencyKey },
      );
      if (!s.url) throw new Error("stripe checkout session has no url");
      return { id: s.id, url: s.url };
    },
    async createPortalSession({ customerId, returnUrl }) {
      const p = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: p.url };
    },
    constructEvent(payload, signature) {
      return stripe.webhooks.constructEvent(payload, signature, input.webhookSecret);
    },
    async refundPaymentIntent(paymentIntentId, idempotencyKey) {
      const r = await stripe.refunds.create(
        { payment_intent: paymentIntentId },
        { idempotencyKey },
      );
      return { id: r.id };
    },
  };
}

/** In-memory fake for tests and local development. */
export class FakeStripeGateway implements StripeGateway {
  readonly customers: { id: string; email: string; orgId: string }[] = [];
  readonly checkouts: (CheckoutInput & { id: string })[] = [];
  readonly refunds: string[] = [];
  private n = 0;
  async createCustomer({ email, orgId }: { email: string; orgId: string; name: string }) {
    const existing = this.customers.find((c) => c.orgId === orgId);
    if (existing) return { id: existing.id };
    const c = { id: `cus_fake_${crypto.randomUUID().slice(0, 12)}`, email, orgId };
    this.customers.push(c);
    return { id: c.id };
  }
  async createCheckoutSession(i: CheckoutInput) {
    const id = `cs_fake_${crypto.randomUUID().slice(0, 12)}`;
    this.checkouts.push({ ...i, id });
    return { id, url: `https://checkout.stripe.test/${id}` };
  }
  async createPortalSession() {
    return { url: "https://billing.stripe.test/portal" };
  }
  constructEvent(payload: string): Stripe.Event {
    return JSON.parse(payload) as Stripe.Event;
  }
  async refundPaymentIntent(paymentIntentId: string) {
    this.refunds.push(paymentIntentId);
    return { id: `re_fake_${++this.n}` };
  }
}
