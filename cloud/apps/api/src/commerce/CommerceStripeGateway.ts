import { createHash } from "node:crypto";
import Stripe from "stripe";

import { ApiError } from "../http/errors.ts";

export const COMMERCE_STRIPE_PURPOSE = "commerce_test";
export interface CommerceCheckoutProof {
  readonly id: string;
  readonly url: string | null;
  readonly paymentIntentId: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentStatus: string;
  readonly status: string;
  readonly livemode: boolean;
  readonly metadata: Record<string, string>;
  readonly expiresAt: Date;
}
export interface CommerceRefundProof {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly status: string | null;
  readonly metadata: Record<string, string>;
  readonly livemode?: boolean;
}
export interface CommerceStripeEvent {
  readonly id: string;
  readonly type: string;
  readonly livemode: boolean;
  readonly account?: string;
  readonly objectId: string;
  readonly payloadHash: string;
  readonly currency?: string;
  readonly purpose?: string;
  readonly paymentIntentId?: string;
}
export interface CommerceCheckoutInput {
  readonly attemptId: string;
  readonly orderId: string;
  readonly amountCents: number;
  readonly currency: "cad";
  readonly items: readonly {
    readonly name: string;
    readonly unitAmountCents: number;
    readonly quantity: number;
  }[];
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly idempotencyKey: string;
  readonly expiresAt: Date;
}
export interface CommerceRefundInput {
  readonly refundRequestId: string;
  readonly orderId: string;
  readonly itemId: string;
  readonly paymentIntentId: string;
  readonly amountCents: number;
  readonly idempotencyKey: string;
}
export interface CommerceStripeGateway {
  readonly createCheckout: (input: CommerceCheckoutInput) => Promise<CommerceCheckoutProof>;
  readonly retrieveCheckout: (sessionId: string) => Promise<CommerceCheckoutProof>;
  readonly expireCheckout: (
    sessionId: string,
    idempotencyKey: string,
  ) => Promise<CommerceCheckoutProof>;
  readonly createRefund: (input: CommerceRefundInput) => Promise<CommerceRefundProof>;
  readonly retrieveRefund: (refundId: string) => Promise<CommerceRefundProof>;
  readonly verifyEvent: (payload: string, signature: string) => Promise<CommerceStripeEvent>;
}
export interface CommerceStripeSdk {
  readonly checkout: {
    readonly sessions: {
      readonly create: (
        params: Stripe.Checkout.SessionCreateParams,
        options: Stripe.RequestOptions,
      ) => Promise<Stripe.Checkout.Session>;
      readonly retrieve: (id: string) => Promise<Stripe.Checkout.Session>;
      readonly expire: (
        id: string,
        params: Stripe.Checkout.SessionExpireParams,
        options: Stripe.RequestOptions,
      ) => Promise<Stripe.Checkout.Session>;
    };
  };
  readonly refunds: {
    readonly create: (
      params: Stripe.RefundCreateParams,
      options: Stripe.RequestOptions,
    ) => Promise<Stripe.Refund>;
    readonly retrieve: (id: string) => Promise<Stripe.Refund>;
  };
  readonly webhooks: Pick<Stripe["webhooks"], "constructEventAsync">;
}

function invalid(message: string): never {
  throw new ApiError(400, "commerce_payment_input", message);
}
function proofError(): never {
  throw new ApiError(
    502,
    "commerce_payment_proof_invalid",
    "The payment provider returned an unexpected test-mode result. Reconciliation is required.",
  );
}
function amount(value: unknown, minimum = 1): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > 99_999_999
  )
    return invalid("Invalid CAD test payment amount.");
  return value;
}
function text(value: string, name: string, maximum = 255): string {
  if (!value || value.length > maximum || Array.from(value).some((c) => c.charCodeAt(0) < 32))
    return invalid(`Invalid ${name}.`);
  return value;
}
function sessionId(value: string): string {
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(value))
    return invalid("A test Checkout Session is required.");
  return value;
}
function paymentIntentId(value: string): string {
  if (!/^pi_[A-Za-z0-9_]+$/.test(value)) return invalid("Invalid PaymentIntent reference.");
  return value;
}
function refundId(value: string): string {
  if (!/^re_[A-Za-z0-9_]+$/.test(value)) return invalid("Invalid refund reference.");
  return value;
}
function metadata(value: Stripe.Metadata | null): Record<string, string> {
  const keys = ["purpose", "attemptId", "orderId", "refundRequestId", "itemId"];
  return Object.fromEntries(
    keys.flatMap((key) => (typeof value?.[key] === "string" ? [[key, value[key]!]] : [])),
  );
}

/** A checkout capability is bound to its saved test Session, never an arbitrary external URL. */
export function commerceTestCheckoutUrl(value: string, expectedSessionId: string): string {
  sessionId(expectedSessionId);
  try {
    const url = new URL(value);
    if (
      !/^https:\/\/checkout\.stripe\.com\//i.test(value) ||
      url.origin !== "https://checkout.stripe.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      /%(?:2e|2f|5c)/i.test(value.split("#")[0]!) ||
      value.includes("\\") ||
      value.split("#")[0]!.includes("/../") ||
      value.split("#")[0]!.includes("/./") ||
      Array.from(value).some((c) => c.charCodeAt(0) <= 32) ||
      url.pathname !== `/c/pay/${expectedSessionId}`
    )
      return proofError();
    return url.href;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return proofError();
  }
}

function checkoutProof(session: Stripe.Checkout.Session): CommerceCheckoutProof {
  if (
    !session ||
    session.livemode !== false ||
    !/^cs_test_[A-Za-z0-9_]+$/.test(session.id) ||
    session.currency !== "cad" ||
    typeof session.amount_total !== "number" ||
    !Number.isSafeInteger(session.amount_total) ||
    session.amount_total < 50 ||
    session.amount_total > 99_999_999 ||
    !Number.isSafeInteger(session.expires_at) ||
    session.expires_at <= 0 ||
    !["open", "complete", "expired"].includes(session.status ?? "") ||
    typeof session.payment_status !== "string"
  )
    return proofError();
  const intent = session.payment_intent;
  if (intent && typeof intent !== "string" && intent.livemode !== false) return proofError();
  const pi = typeof intent === "string" ? intent : (intent?.id ?? null);
  if (pi && !/^pi_[A-Za-z0-9_]+$/.test(pi)) return proofError();
  return {
    id: session.id,
    url: session.url ? commerceTestCheckoutUrl(session.url, session.id) : null,
    paymentIntentId: pi,
    amountCents: session.amount_total,
    currency: session.currency,
    paymentStatus: session.payment_status,
    status: session.status!,
    livemode: false,
    metadata: metadata(session.metadata),
    expiresAt: new Date(session.expires_at * 1000),
  };
}
function refundProof(refund: Stripe.Refund): CommerceRefundProof {
  const intent = refund?.payment_intent;
  const pi = typeof intent === "string" ? intent : intent?.id;
  const mode = (refund as Stripe.Refund & { livemode?: boolean })?.livemode;
  if (
    !refund ||
    !/^re_[A-Za-z0-9_]+$/.test(refund.id) ||
    !pi ||
    !/^pi_[A-Za-z0-9_]+$/.test(pi) ||
    refund.currency !== "cad" ||
    !Number.isSafeInteger(refund.amount) ||
    refund.amount < 1 ||
    refund.amount > 99_999_999 ||
    mode === true ||
    (intent && typeof intent !== "string" && intent.livemode !== false)
  )
    return proofError();
  return {
    id: refund.id,
    paymentIntentId: pi,
    amountCents: refund.amount,
    currency: refund.currency,
    status: refund.status,
    metadata: metadata(refund.metadata),
    ...(mode === false || (intent && typeof intent !== "string") ? { livemode: false } : {}),
  };
}
function returnUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
      return invalid("Invalid configured commerce return URL.");
    return url.href;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return invalid("Invalid configured commerce return URL.");
  }
}
async function provider<A>(work: () => Promise<A>): Promise<A> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Provider errors can contain request metadata and customer information. Preserve no raw details.
    throw new ApiError(
      502,
      "commerce_payment_provider_unavailable",
      "The test payment result is unknown. Check its status before retrying.",
    );
  }
}

/** Test credentials only. The caller additionally gates this adapter to local/test environments. */
export function createCommerceStripeGateway(input: {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly stripe?: CommerceStripeSdk;
}): CommerceStripeGateway {
  if (
    !/^sk_test_[A-Za-z0-9_]+$/.test(input.secretKey) ||
    !/^whsec_[A-Za-z0-9_]+$/.test(input.webhookSecret)
  )
    throw new ApiError(
      503,
      "commerce_payment_configuration",
      "Separate Stripe TEST credentials are required.",
    );
  const stripe: CommerceStripeSdk =
    input.stripe ??
    new Stripe(input.secretKey, {
      apiVersion: "2026-08-26.dahlia",
      typescript: true,
      timeout: 5000,
      maxNetworkRetries: 0,
    });
  return {
    async createCheckout(i) {
      amount(i.amountCents, 50);
      if (i.currency !== "cad") return invalid("Only CAD test checkout is supported.");
      text(i.attemptId, "attemptId");
      text(i.orderId, "orderId");
      text(i.idempotencyKey, "idempotency key");
      if (!Array.isArray(i.items) || i.items.length < 1 || i.items.length > 50)
        return invalid("Choose 1–50 distinct test SKUs.");
      let total = 0n;
      for (const item of i.items) {
        text(item.name, "product name", 150);
        amount(item.unitAmountCents);
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000)
          return invalid("Invalid test SKU quantity.");
        total += BigInt(item.unitAmountCents) * BigInt(item.quantity);
      }
      if (total !== BigInt(i.amountCents) || !Number.isFinite(i.expiresAt.getTime()))
        return invalid("Test checkout must match the saved order snapshot.");
      const meta = { purpose: COMMERCE_STRIPE_PURPOSE, attemptId: i.attemptId, orderId: i.orderId };
      const params: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        ui_mode: "hosted_page",
        payment_method_types: ["card"],
        currency: "cad",
        line_items: i.items.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: "cad",
            unit_amount: item.unitAmountCents,
            product_data: { name: item.name },
          },
        })),
        metadata: meta,
        payment_intent_data: { metadata: meta },
        client_reference_id: i.orderId,
        success_url: returnUrl(i.successUrl),
        cancel_url: returnUrl(i.cancelUrl),
        expires_at: Math.floor(i.expiresAt.getTime() / 1000),
        automatic_tax: { enabled: false },
        allow_promotion_codes: false,
        adaptive_pricing: { enabled: false },
      };
      const result = checkoutProof(
        await provider(() =>
          stripe.checkout.sessions.create(params, { idempotencyKey: i.idempotencyKey }),
        ),
      );
      if (
        result.amountCents !== i.amountCents ||
        result.metadata.purpose !== COMMERCE_STRIPE_PURPOSE ||
        result.metadata.attemptId !== i.attemptId ||
        result.metadata.orderId !== i.orderId
      )
        return proofError();
      return result;
    },
    async retrieveCheckout(id) {
      sessionId(id);
      const result = checkoutProof(await provider(() => stripe.checkout.sessions.retrieve(id)));
      if (result.id !== id) return proofError();
      return result;
    },
    async expireCheckout(id, key) {
      sessionId(id);
      text(key, "idempotency key");
      const result = checkoutProof(
        await provider(() => stripe.checkout.sessions.expire(id, {}, { idempotencyKey: key })),
      );
      if (result.id !== id) return proofError();
      return result;
    },
    async createRefund(i) {
      amount(i.amountCents);
      paymentIntentId(i.paymentIntentId);
      text(i.refundRequestId, "refundRequestId");
      text(i.orderId, "orderId");
      text(i.itemId, "itemId");
      text(i.idempotencyKey, "idempotency key");
      const meta = {
        purpose: COMMERCE_STRIPE_PURPOSE,
        refundRequestId: i.refundRequestId,
        orderId: i.orderId,
        itemId: i.itemId,
      };
      const result = refundProof(
        await provider(() =>
          stripe.refunds.create(
            { payment_intent: i.paymentIntentId, amount: i.amountCents, metadata: meta },
            { idempotencyKey: i.idempotencyKey },
          ),
        ),
      );
      if (
        result.paymentIntentId !== i.paymentIntentId ||
        result.amountCents !== i.amountCents ||
        result.metadata.purpose !== COMMERCE_STRIPE_PURPOSE ||
        result.metadata.refundRequestId !== i.refundRequestId ||
        result.metadata.orderId !== i.orderId ||
        result.metadata.itemId !== i.itemId
      )
        return proofError();
      return result;
    },
    async retrieveRefund(id) {
      refundId(id);
      const result = refundProof(await provider(() => stripe.refunds.retrieve(id)));
      if (result.id !== id) return proofError();
      return result;
    },
    async verifyEvent(payload, signature) {
      if (!signature || signature.length > 4096 || Buffer.byteLength(payload, "utf8") > 1024 * 1024)
        throw new ApiError(400, "commerce_bad_signature", "Webhook signature failed.");
      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(payload, signature, input.webhookSecret);
      } catch {
        throw new ApiError(400, "commerce_bad_signature", "Webhook signature failed.");
      }
      if (event.livemode !== false || event.account !== undefined)
        throw new ApiError(
          400,
          "commerce_live_event_rejected",
          "Only direct-account Stripe TEST events are accepted.",
        );
      const object = event.data?.object as
        | {
            id?: unknown;
            currency?: unknown;
            metadata?: Record<string, unknown> | null;
            payment_intent?: unknown;
          }
        | undefined;
      if (
        !/^evt_[A-Za-z0-9_]+$/.test(event.id) ||
        typeof event.type !== "string" ||
        event.type.length > 150 ||
        !object ||
        typeof object.id !== "string" ||
        object.id.length > 255
      )
        throw new ApiError(400, "commerce_bad_event", "Invalid test webhook event.");
      const currency =
        typeof object.currency === "string" && object.currency.length <= 10
          ? object.currency
          : undefined;
      const purpose =
        typeof object.metadata?.purpose === "string" && object.metadata.purpose.length <= 100
          ? object.metadata.purpose
          : undefined;
      const intent = object.payment_intent;
      const intentId =
        typeof intent === "string"
          ? intent
          : intent && typeof intent === "object" && "id" in intent && typeof intent.id === "string"
            ? intent.id
            : undefined;
      const pi = intentId && /^pi_[A-Za-z0-9_]+$/.test(intentId) ? intentId : undefined;
      return {
        id: event.id,
        type: event.type,
        livemode: false,
        objectId: object.id,
        payloadHash: createHash("sha256").update(payload).digest("hex"),
        ...(currency ? { currency } : {}),
        ...(purpose ? { purpose } : {}),
        ...(pi ? { paymentIntentId: pi } : {}),
      };
    },
  };
}
