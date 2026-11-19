import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@djl/db";
import type {
  CommercePaymentStatus,
  CommerceProviderRefund,
  CommerceExternalRefund,
  CommerceExternalRefundDetail,
  CommerceExternalRefundAllocationResult,
} from "@synara/contracts/cloud";
import { ApiError } from "../http/errors.ts";
import {
  CommerceService,
  commerceId,
  commerceInteger,
  commercePage,
  commerceText,
  type CommerceActor,
  type CommerceTransaction,
} from "./CommerceService.ts";
import {
  COMMERCE_STRIPE_PURPOSE,
  commerceTestCheckoutUrl,
  type CommerceCheckoutProof,
  type CommerceRefundProof,
  type CommerceStripeGateway,
} from "./CommerceStripeGateway.ts";

const {
  commerceOrders: orders,
  commerceOrderItems: items,
  commerceProducts: products,
  commerceCustomers: customers,
  commercePaymentAttempts: payments,
  commerceProviderRefunds: refunds,
  commercePaymentEvents: events,
  commerceExternalRefunds: externalRefunds,
  commerceExternalRefundAllocations: externalAllocations,
  commerceOperations: operations,
} = schema;
type Payment = typeof payments.$inferSelect;
type Refund = typeof refunds.$inferSelect;
type ExternalRefund = typeof externalRefunds.$inferSelect;
const active = ["creating", "open", "unknown", "cancel_requested", "requires_review"] as const;
const paymentOrder = [
  sql`case when ${payments.status} in ('creating','open','unknown','cancel_requested','requires_review') then 0 else 1 end`,
  sql`${payments.createdAt} desc`,
  sql`${payments.id} desc`,
];
const checkoutTypes = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const refundTypes = new Set(["refund.created", "refund.updated", "refund.failed"]);
function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
function requestKey(value: unknown) {
  const key = commerceText(value, "idempotencyKey", 100);
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(key)) fail(400, "bad_request", "Invalid idempotency key.");
  return key;
}
export interface CommercePaymentOptions {
  readonly enabled: boolean;
  readonly environment: "local" | "test" | "staging" | "production";
  readonly webPublicUrl: string;
  readonly gateway?: CommerceStripeGateway;
  readonly now?: () => Date;
}

/** Optional test-only payment IO. No Stripe network call runs inside a commerce transaction. */
export class CommercePaymentService {
  constructor(
    readonly commerce: CommerceService,
    readonly options: CommercePaymentOptions,
  ) {}
  private get db() {
    return this.commerce.db;
  }
  private now() {
    return this.options.now?.() ?? new Date();
  }
  get enabled() {
    return Boolean(
      this.options.enabled &&
      ["local", "test"].includes(this.options.environment) &&
      this.commerce.mode === "test" &&
      this.commerce.paymentProvider === "stripe_test" &&
      this.options.gateway,
    );
  }
  private gateway() {
    if (!this.enabled)
      fail(
        503,
        "commerce_stripe_test_disabled",
        "Stripe TEST checkout is not configured. No live payments are supported.",
      );
    return this.options.gateway!;
  }
  private async order(id: string, userId?: string) {
    commerceId(id);
    const [order] = await this.db
      .select()
      .from(orders)
      .where(userId ? and(eq(orders.id, id), eq(orders.userId, userId)) : eq(orders.id, id));
    if (!order) return fail(404, "order_not_found", "Order not found.");
    if (order.paymentProvider !== "stripe_test")
      fail(409, "commerce_payment_provider_mismatch", "This is not a Stripe TEST order.");
    return order;
  }
  private async audit(
    tx: CommerceTransaction,
    actor: CommerceActor,
    action: string,
    targetId: string,
    after: Readonly<Record<string, unknown>> = {},
  ) {
    await tx.insert(schema.auditEvents).values({
      actorType: actor.type,
      actorId: actor.id,
      action: `commerce.payment.${action}`,
      targetType: "commerce",
      targetId,
      traceId: actor.traceId,
      after,
    });
  }
  private async markReviewIn(
    tx: CommerceTransaction,
    actor: CommerceActor,
    id: string,
    key: string,
    verifiedNewExternalId?: string,
  ) {
    const [current] = await tx.select().from(payments).where(eq(payments.id, id));
    if (!current) return fail(404, "commerce_payment_not_found", "Payment attempt not found.");
    if (current.status === "requires_review" && current.reviewKey === key) return current;
    const externalKey = async (value: string | null) => {
      if (value === "external_refunds")
        return (
          (
            await tx
              .select({ id: externalRefunds.id })
              .from(externalRefunds)
              .where(eq(externalRefunds.attemptId, id))
              .limit(2)
          ).length >= 2
        );
      if (!value?.startsWith("external_refund:")) return false;
      const externalId = value.slice("external_refund:".length);
      if (verifiedNewExternalId && externalId === verifiedNewExternalId && value === key)
        return true;
      try {
        commerceId(externalId);
      } catch {
        return false;
      }
      return (
        (
          await tx
            .select({ id: externalRefunds.id })
            .from(externalRefunds)
            .where(and(eq(externalRefunds.id, externalId), eq(externalRefunds.attemptId, id)))
            .limit(1)
        ).length === 1
      );
    };
    const nextKey =
      current.status !== "requires_review"
        ? key
        : current.reviewKey === null
          ? "legacy_unclassified"
          : (await externalKey(current.reviewKey)) && (await externalKey(key))
            ? "external_refunds"
            : "multiple";
    const [updated] = await tx
      .update(payments)
      .set({
        status: "requires_review",
        checkoutUrl: null,
        reviewKey: nextKey,
        reviewVersion: current.reviewVersion + 1,
        updatedAt: this.now(),
      })
      .where(eq(payments.id, id))
      .returning();
    await this.audit(tx, actor, "review.hold", id, {
      key: nextKey,
      reviewVersion: updated!.reviewVersion,
    });
    return updated!;
  }
  private refundView(row: Refund): CommerceProviderRefund {
    return {
      id: row.id,
      itemId: row.itemId,
      amountCents: row.amountCents,
      refundTotalCents: row.refundTotalCents,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }
  async status(id: string, userId?: string): Promise<{ payment: CommercePaymentStatus }> {
    await this.order(id, userId);
    const [attempt] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, id))
      .orderBy(...paymentOrder)
      .limit(1);
    const rows = await this.db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, id))
      .orderBy(
        sql`case when ${refunds.status} in ('submitting','unknown','pending','requires_review') then 0 else 1 end`,
        sql`${refunds.createdAt} desc`,
        sql`${refunds.id} desc`,
      )
      .limit(100);
    let checkoutUrl: string | null = null;
    if (
      this.enabled &&
      attempt?.status === "open" &&
      attempt.sessionId &&
      attempt.checkoutUrl &&
      attempt.expiresAt > this.now()
    )
      checkoutUrl = commerceTestCheckoutUrl(attempt.checkoutUrl, attempt.sessionId);
    return {
      payment: {
        enabled: this.enabled,
        mode: "test",
        provider: "stripe_test",
        paymentProvider: "stripe_test",
        orderId: id,
        attemptId: attempt?.id ?? null,
        sessionId: attempt?.sessionId ?? null,
        status: attempt?.status ?? "not_started",
        checkoutUrl,
        expiresAt: attempt?.expiresAt.toISOString() ?? null,
        refunds: rows.map((row) => this.refundView(row)),
      },
    };
  }
  async checkout(actor: CommerceActor, id: string, key: unknown) {
    const gateway = this.gateway();
    const k = requestKey(key);
    await this.order(id, actor.id);
    if (this.commerce.options.checkoutPaused)
      fail(
        503,
        "commerce_checkout_paused",
        "New checkout is temporarily paused. History and support remain available.",
      );
    const attempt = await this.commerce.paymentTransaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, id), eq(orders.userId, actor.id)));
      if (!order || order.paymentProvider !== "stripe_test")
        return fail(404, "order_not_found", "Order not found.");
      const [prior] = await tx
        .select()
        .from(payments)
        .where(eq(payments.orderId, id))
        .orderBy(...paymentOrder)
        .limit(1);
      if (prior) {
        if (prior.requestKey !== k && active.includes(prior.status as (typeof active)[number]))
          fail(
            409,
            "commerce_checkout_in_progress",
            "Reuse the current checkout request while its outcome is unresolved.",
          );
        return prior;
      }
      if (order.status !== "awaiting_payment" || order.expiresAt <= this.now())
        fail(409, "order_not_payable", "Order is no longer payable.");
      commerceInteger(order.totalCents, "provider amount", 50, 99999999);
      const [customer] = await tx.select().from(customers).where(eq(customers.userId, actor.id));
      const [created] = await tx
        .insert(payments)
        .values({
          orderId: id,
          requestKey: k,
          referrerId: customer!.referrerId,
          amountCents: order.totalCents,
          expiresAt: new Date(this.now().getTime() + 31 * 60_000),
          createdAt: this.now(),
          updatedAt: this.now(),
        })
        .returning();
      await this.audit(tx, actor, "checkout.request", created!.id, { orderId: id, mode: "test" });
      return created!;
    });
    if (["creating", "unknown"].includes(attempt.status)) {
      // Stripe API-v1 may prune idempotency keys after 24 hours. Never recreate an uncertain old charge.
      if (this.now().getTime() - attempt.createdAt.getTime() > 23 * 60 * 60_000) {
        await this.reviewAttempt(actor, attempt.id, "idempotency_window_elapsed");
      } else {
        try {
          const lines = await this.db.select().from(items).where(eq(items.orderId, id));
          const success = new URL("/shop", this.options.webPublicUrl),
            cancel = new URL("/shop", this.options.webPublicUrl);
          success.searchParams.set("payment", "confirming");
          success.searchParams.set("order", id);
          cancel.searchParams.set("payment", "cancelled");
          cancel.searchParams.set("order", id);
          const proof = await gateway.createCheckout({
            attemptId: attempt.id,
            orderId: id,
            amountCents: attempt.amountCents,
            currency: "cad",
            items: lines.map((line) => ({
              name: line.name,
              unitAmountCents: line.priceCents,
              quantity: line.quantity,
            })),
            successUrl: success.href,
            cancelUrl: cancel.href,
            idempotencyKey: `commerce-checkout:${attempt.id}`,
            expiresAt: attempt.expiresAt,
          });
          await this.commerce.paymentTransaction((tx) =>
            this.applyCheckout(tx, actor, attempt.id, proof),
          );
        } catch (error) {
          await this.markUnknown(actor, attempt.id);
          if (error instanceof ApiError && error.code === "commerce_payment_proof_invalid")
            throw error;
        }
      }
    }
    const result = await this.status(id, actor.id);
    return { ...result, checkoutUrl: result.payment.checkoutUrl };
  }
  private validateCheckout(attempt: Payment, proof: CommerceCheckoutProof) {
    if (
      proof.livemode !== false ||
      proof.currency !== "cad" ||
      proof.amountCents !== attempt.amountCents ||
      proof.metadata.purpose !== COMMERCE_STRIPE_PURPOSE ||
      proof.metadata.orderId !== attempt.orderId ||
      proof.metadata.attemptId !== attempt.id ||
      (attempt.sessionId && attempt.sessionId !== proof.id) ||
      (attempt.paymentIntentId &&
        proof.paymentIntentId &&
        attempt.paymentIntentId !== proof.paymentIntentId)
    )
      fail(
        502,
        "commerce_payment_proof_invalid",
        "Payment proof does not match this test order. Reconciliation is required.",
      );
    if (proof.url) commerceTestCheckoutUrl(proof.url, proof.id);
  }
  private async applyCheckout(
    tx: CommerceTransaction,
    actor: CommerceActor,
    attemptId: string,
    proof: CommerceCheckoutProof,
  ) {
    const [attempt] = await tx.select().from(payments).where(eq(payments.id, attemptId));
    if (!attempt) return fail(404, "commerce_payment_not_found", "Payment attempt not found.");
    this.validateCheckout(attempt, proof);
    const [order] = await tx.select().from(orders).where(eq(orders.id, attempt.orderId));
    const refs = {
      sessionId: proof.id,
      paymentIntentId: proof.paymentIntentId ?? attempt.paymentIntentId,
      expiresAt: proof.expiresAt,
      updatedAt: this.now(),
    };
    if (order!.status === "cancelled" && proof.paymentStatus !== "paid") return;
    if (attempt.status === "requires_review" && ["paid", "refunded"].includes(order!.status))
      return;
    if (proof.paymentStatus === "paid" && proof.status === "complete" && proof.paymentIntentId) {
      if (order!.status === "cancelled") {
        await tx
          .update(payments)
          .set({ ...refs, checkoutUrl: null })
          .where(eq(payments.id, attempt.id));
        await this.markReviewIn(tx, actor, attempt.id, `late_payment:${proof.id}`);
        await tx.update(items).set({ openCase: true }).where(eq(items.orderId, attempt.orderId));
        await this.audit(tx, actor, "late_payment.review", attempt.id);
        return;
      }
      await this.commerce.settleTestPaymentIn(tx, actor, attempt.orderId, {
        provider: "stripe_test",
        referrerId: attempt.referrerId,
      });
      await tx
        .update(payments)
        .set({
          ...refs,
          status: attempt.status === "requires_review" ? "requires_review" : "paid",
          checkoutUrl: null,
        })
        .where(eq(payments.id, attempt.id));
      const deferred = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            sql`${events.processedAt} is null`,
            inArray(events.type, ["refund.created", "refund.updated", "refund.failed"]),
            sql`${events.facts}->>'paymentIntentId'=${proof.paymentIntentId}`,
          ),
        )
        .limit(1);
      if (deferred.length) {
        await this.markReviewIn(tx, actor, attempt.id, "deferred_refund");
        await tx.update(items).set({ openCase: true }).where(eq(items.orderId, attempt.orderId));
        await this.audit(tx, actor, "deferred_refund.review", attempt.id);
      }
    } else if (
      attempt.status === "paid" ||
      order!.status === "paid" ||
      order!.status === "refunded"
    ) {
      // An older unpaid/expired observation cannot undo an already committed successful payment.
      return;
    } else if (proof.status === "expired" && proof.paymentStatus === "unpaid") {
      if (order!.status === "awaiting_payment") {
        const lines = await tx.select().from(items).where(eq(items.orderId, order!.id));
        for (const line of lines)
          await tx
            .update(products)
            .set({ reserved: sql`${products.reserved}-${line.quantity}` })
            .where(eq(products.id, line.productId));
        await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order!.id));
        await tx.update(items).set({ status: "cancelled" }).where(eq(items.orderId, order!.id));
      }
      await tx
        .update(payments)
        .set({ ...refs, status: "expired_unpaid", checkoutUrl: null })
        .where(eq(payments.id, attempt.id));
      await this.audit(tx, actor, "unpaid.cancelled", attempt.id);
    } else {
      const status =
        proof.status === "open" && proof.paymentStatus === "unpaid"
          ? attempt.status === "cancel_requested"
            ? "cancel_requested"
            : "open"
          : "unknown";
      await tx
        .update(payments)
        .set({ ...refs, status, checkoutUrl: status === "open" ? proof.url : null })
        .where(eq(payments.id, attempt.id));
    }
  }
  private async markUnknown(actor: CommerceActor, id: string) {
    await this.commerce.paymentTransaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: "unknown", checkoutUrl: null, updatedAt: this.now() })
        .where(
          and(
            eq(payments.id, id),
            inArray(payments.status, ["creating", "open", "unknown", "cancel_requested"]),
          ),
        );
      await this.audit(tx, actor, "outcome.unknown", id);
    });
  }
  private async reviewAttempt(actor: CommerceActor, id: string, code: string) {
    await this.commerce.paymentTransaction(async (tx) => {
      const [current] = await tx.select().from(payments).where(eq(payments.id, id));
      if (current && ["creating", "unknown", "cancel_requested"].includes(current.status))
        await this.markReviewIn(tx, actor, id, code);
      await this.audit(tx, actor, "review", id, { code });
    });
  }
  async cancel(actor: CommerceActor, id: string, key: unknown) {
    requestKey(key);
    await this.order(id, actor.id);
    const attempt = await this.commerce.paymentTransaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(payments)
        .where(eq(payments.orderId, id))
        .orderBy(...paymentOrder)
        .limit(1);
      if (attempt) return attempt;
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, id), eq(orders.userId, actor.id)));
      if (!order || order.paymentProvider !== "stripe_test")
        return fail(404, "order_not_found", "Order not found.");
      if (order.status === "awaiting_payment") {
        const lines = await tx.select().from(items).where(eq(items.orderId, id));
        for (const line of lines)
          await tx
            .update(products)
            .set({ reserved: sql`${products.reserved}-${line.quantity}` })
            .where(eq(products.id, line.productId));
        await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, id));
        await tx.update(items).set({ status: "cancelled" }).where(eq(items.orderId, id));
        await this.audit(tx, actor, "unstarted.cancelled", id);
      }
      return null;
    });
    if (!attempt) return this.status(id, actor.id);
    const gateway = this.gateway();
    if (["paid", "expired_unpaid", "failed"].includes(attempt.status))
      return this.status(id, actor.id);
    if (!attempt.sessionId) {
      await this.markUnknown(actor, attempt.id);
      return this.status(id, actor.id);
    }
    await this.commerce.paymentTransaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: "cancel_requested", checkoutUrl: null, updatedAt: this.now() })
        .where(
          and(
            eq(payments.id, attempt.id),
            inArray(payments.status, ["creating", "open", "unknown", "cancel_requested"]),
          ),
        );
      await this.audit(tx, actor, "cancel.request", attempt.id);
    });
    try {
      let proof: CommerceCheckoutProof;
      try {
        proof = await gateway.expireCheckout(attempt.sessionId, `commerce-expire:${attempt.id}`);
      } catch {
        proof = await gateway.retrieveCheckout(attempt.sessionId);
      }
      await this.commerce.paymentTransaction((tx) =>
        this.applyCheckout(tx, actor, attempt.id, proof),
      );
    } catch {
      await this.markUnknown(actor, attempt.id);
    }
    return this.status(id, actor.id);
  }
  async reconcile(actor: CommerceActor, id: string, reason: unknown) {
    const gateway = this.gateway();
    const auditReason = commerceText(reason, "reason", 500);
    await this.order(id);
    const [attempt] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, id))
      .orderBy(...paymentOrder)
      .limit(1);
    if (!attempt?.sessionId)
      return fail(
        409,
        "commerce_payment_unresolved",
        "The provider result is unknown. Retry the original checkout key within its safe window; do not create a new payment.",
      );
    try {
      const proof = await gateway.retrieveCheckout(attempt.sessionId);
      await this.commerce.paymentTransaction(async (tx) => {
        await this.applyCheckout(tx, actor, attempt.id, proof);
        await this.audit(tx, actor, "reconcile", attempt.id, { reason: auditReason });
      });
    } catch {
      await this.markUnknown(actor, attempt.id);
    }
    const pending = await this.db
      .select()
      .from(refunds)
      .where(
        and(
          eq(refunds.orderId, id),
          inArray(refunds.status, ["submitting", "unknown", "pending", "requires_review"]),
        ),
      );
    for (const refund of pending)
      if (refund.providerRefundId) {
        try {
          const proof = await gateway.retrieveRefund(refund.providerRefundId);
          await this.commerce.paymentTransaction((tx) =>
            this.applyRefund(tx, actor, refund.id, proof),
          );
        } catch {
          /* preserve the durable unresolved record; never issue another refund */
        }
      }
    return this.status(id);
  }
  async requestRefund(actor: CommerceActor, itemId: string, body: Record<string, unknown>) {
    const gateway = this.gateway();
    commerceId(itemId);
    const k = requestKey(body.idempotencyKey),
      reason = commerceText(body.reason, "reason", 500),
      total = commerceInteger(body.refundTotalCents, "refundTotalCents", 1, 99999999);
    const refund = await this.commerce.paymentTransaction(async (tx) => {
      const [prior] = await tx
        .select()
        .from(refunds)
        .where(and(eq(refunds.actorId, actor.id), eq(refunds.requestKey, k)));
      if (prior) {
        if (prior.itemId !== itemId || prior.refundTotalCents !== total || prior.reason !== reason)
          fail(409, "idempotency_conflict", "This refund key was used for another operation.");
        return prior;
      }
      const [line] = await tx.select().from(items).where(eq(items.id, itemId));
      if (!line) return fail(404, "not_found", "Order item not found.");
      const [order] = await tx.select().from(orders).where(eq(orders.id, line.orderId));
      if (order!.paymentProvider !== "stripe_test" || !["paid", "refunded"].includes(order!.status))
        fail(409, "commerce_payment_provider_mismatch", "A paid Stripe TEST order is required.");
      if (
        (
          await tx
            .select({ id: externalRefunds.id })
            .from(externalRefunds)
            .where(
              and(
                eq(externalRefunds.orderId, order!.id),
                inArray(externalRefunds.allocationState, ["unallocated", "requires_review"]),
              ),
            )
            .limit(1)
        ).length
      )
        fail(
          409,
          "commerce_external_refund_blocked",
          "Allocate and review existing external refunds before requesting another refund.",
        );
      const [attempt] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, order!.id), eq(payments.status, "paid")));
      if (!attempt?.paymentIntentId)
        return fail(409, "commerce_payment_unresolved", "Confirmed provider payment is required.");
      if (total <= line.refundedCents || total > line.lineCents)
        fail(409, "refund_conflict", "Refund total must increase within the original item amount.");
      if (
        (
          await tx
            .select({ id: refunds.id })
            .from(refunds)
            .where(
              and(
                eq(refunds.itemId, itemId),
                inArray(refunds.status, ["submitting", "unknown", "pending", "requires_review"]),
              ),
            )
        ).length
      )
        fail(
          409,
          "commerce_refund_unresolved",
          "An earlier refund still requires confirmation. Do not submit another payment.",
        );
      const [created] = await tx
        .insert(refunds)
        .values({
          orderId: order!.id,
          itemId,
          attemptId: attempt.id,
          actorId: actor.id,
          requestKey: k,
          reason,
          amountCents: total - line.refundedCents,
          refundTotalCents: total,
          createdAt: this.now(),
          updatedAt: this.now(),
        })
        .returning();
      await tx.update(items).set({ openCase: true }).where(eq(items.id, itemId));
      await this.audit(tx, actor, "refund.request", created!.id, {
        orderId: order!.id,
        itemId,
        amountCents: created!.amountCents,
      });
      return created!;
    });
    if (["submitting", "unknown"].includes(refund.status)) {
      if (this.now().getTime() - refund.createdAt.getTime() > 23 * 60 * 60_000) {
        await this.commerce.paymentTransaction(async (tx) => {
          await tx
            .update(refunds)
            .set({ status: "requires_review", updatedAt: this.now() })
            .where(eq(refunds.id, refund.id));
          await this.audit(tx, actor, "refund.review", refund.id, {
            code: "idempotency_window_elapsed",
          });
        });
      } else {
        try {
          const [attempt] = await this.db
            .select()
            .from(payments)
            .where(eq(payments.id, refund.attemptId));
          const proof = refund.providerRefundId
            ? await gateway.retrieveRefund(refund.providerRefundId)
            : await gateway.createRefund({
                refundRequestId: refund.id,
                orderId: refund.orderId,
                itemId: refund.itemId,
                paymentIntentId: attempt!.paymentIntentId!,
                amountCents: refund.amountCents,
                idempotencyKey: `commerce-refund:${refund.id}`,
              });
          await this.commerce.paymentTransaction((tx) =>
            this.applyRefund(tx, actor, refund.id, proof),
          );
        } catch {
          await this.commerce.paymentTransaction(async (tx) => {
            await tx
              .update(refunds)
              .set({ status: "unknown", updatedAt: this.now() })
              .where(
                and(eq(refunds.id, refund.id), inArray(refunds.status, ["submitting", "unknown"])),
              );
            await this.audit(tx, actor, "refund.unknown", refund.id);
          });
        }
      }
    }
    const [latest] = await this.db.select().from(refunds).where(eq(refunds.id, refund.id));
    return { refund: this.refundView(latest!) };
  }
  private async applyRefund(
    tx: CommerceTransaction,
    actor: CommerceActor,
    id: string,
    proof: CommerceRefundProof,
  ) {
    const [refund] = await tx.select().from(refunds).where(eq(refunds.id, id));
    if (!refund) return fail(404, "not_found", "Refund request not found.");
    const [attempt] = await tx.select().from(payments).where(eq(payments.id, refund.attemptId));
    if (
      proof.livemode === true ||
      proof.currency !== "cad" ||
      proof.amountCents !== refund.amountCents ||
      proof.paymentIntentId !== attempt!.paymentIntentId ||
      (refund.providerRefundId !== proof.id &&
        (proof.metadata.purpose !== COMMERCE_STRIPE_PURPOSE ||
          proof.metadata.refundRequestId !== refund.id ||
          proof.metadata.orderId !== refund.orderId ||
          proof.metadata.itemId !== refund.itemId)) ||
      (refund.providerRefundId && refund.providerRefundId !== proof.id)
    )
      fail(
        502,
        "commerce_payment_proof_invalid",
        "Refund proof does not match this test operation. Reconciliation is required.",
      );
    const [external] = await tx
      .select()
      .from(externalRefunds)
      .where(eq(externalRefunds.providerRefundId, proof.id));
    if (external) {
      if (external.allocationState === "allocated") {
        await tx
          .update(refunds)
          .set({ providerRefundId: proof.id, status: "requires_review", updatedAt: this.now() })
          .where(eq(refunds.id, id));
        await this.markReviewIn(tx, actor, attempt!.id, `refund_origin_conflict:${proof.id}`);
        await tx.update(items).set({ openCase: true }).where(eq(items.orderId, refund.orderId));
        await this.audit(tx, actor, "refund.origin_conflict", id, {
          externalRefundId: external.id,
        });
        return;
      }
      if (external.allocationState !== "excluded_owned")
        await tx
          .update(externalRefunds)
          .set({ allocationState: "excluded_owned", version: external.version + 1 })
          .where(eq(externalRefunds.id, external.id));
      await this.markReviewIn(tx, actor, attempt!.id, `refund_origin_conflict:${proof.id}`);
    }
    if (refund.appliedAt) {
      if (["failed", "canceled", "requires_action"].includes(proof.status ?? "")) {
        await tx
          .update(refunds)
          .set({ status: "requires_review", updatedAt: this.now() })
          .where(eq(refunds.id, id));
        await tx.update(items).set({ openCase: true }).where(eq(items.id, refund.itemId));
        await this.markReviewIn(tx, actor, attempt!.id, `returned_refund:${proof.id}`);
        await this.audit(tx, actor, "refund.returned.review", id);
      }
      return;
    }
    // A stale API response cannot revive a terminal failed refund after its callback committed.
    if (refund.status === "failed") return;
    if (proof.status === "succeeded") {
      await this.commerce.settleStripeRefundIn(tx, actor, refund.itemId, {
        refundTotalCents: refund.refundTotalCents,
        reason: refund.reason,
        idempotencyKey: `provider-refund:${refund.id}`,
      });
      await tx
        .update(refunds)
        .set({
          providerRefundId: proof.id,
          status: "succeeded",
          appliedAt: this.now(),
          updatedAt: this.now(),
        })
        .where(eq(refunds.id, id));
    } else {
      const status = ["failed", "canceled"].includes(proof.status ?? "")
        ? "failed"
        : proof.status === "pending"
          ? "pending"
          : "requires_review";
      await tx
        .update(refunds)
        .set({ providerRefundId: proof.id, status, updatedAt: this.now() })
        .where(eq(refunds.id, id));
    }
    await this.audit(tx, actor, "refund.observed", id, {
      providerRefundId: proof.id,
      status: proof.status,
    });
  }
  private async externalRecord(
    id: string,
    tx: CommerceTransaction | CommerceService["db"] = this.db,
  ) {
    commerceId(id);
    const rows = await tx
      .select({ record: externalRefunds, allocation: externalAllocations })
      .from(externalRefunds)
      .leftJoin(externalAllocations, eq(externalAllocations.externalRefundId, externalRefunds.id))
      .where(eq(externalRefunds.id, id))
      .orderBy(externalAllocations.itemId);
    const record = rows[0]?.record;
    if (!record)
      return fail(404, "commerce_external_refund_not_found", "External refund not found.");
    const refund: CommerceExternalRefund = {
      id: record.id,
      orderId: record.orderId,
      attemptId: record.attemptId,
      providerRefundId: record.providerRefundId,
      sourceEventId: record.sourceEventId,
      amountCents: record.amountCents,
      currency: "CAD",
      providerStatus: record.providerStatus,
      allocationState: record.allocationState,
      version: record.version,
      allocatedAt: record.allocatedAt?.toISOString() ?? null,
      allocations: rows.flatMap((row) =>
        row.allocation
          ? [
              {
                itemId: row.allocation.itemId,
                amountCents: row.allocation.amountCents,
                refundedBeforeCents: row.allocation.refundedBeforeCents,
                refundedAfterCents: row.allocation.refundedAfterCents,
              },
            ]
          : [],
      ),
    };
    return { record, refund };
  }
  private async externalBlocked(
    tx: CommerceTransaction | CommerceService["db"],
    record: ExternalRefund,
  ) {
    const [owned] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.providerRefundId, record.providerRefundId))
      .limit(1);
    if (owned) return "This provider refund is already owned by an internal refund request.";
    const [uncertain] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.orderId, record.orderId),
          inArray(refunds.status, ["submitting", "unknown", "pending", "requires_review"]),
        ),
      )
      .limit(1);
    if (uncertain)
      return "An internal refund on this order remains unresolved. Reconcile it before allocating an external refund.";
    const [order] = await tx.select().from(orders).where(eq(orders.id, record.orderId));
    if (
      !order ||
      order.paymentProvider !== "stripe_test" ||
      !["paid", "refunded"].includes(order.status)
    )
      return "A confirmed paid Stripe TEST order is required.";
    const [event] = await tx.select().from(events).where(eq(events.id, record.sourceEventId));
    if (!event || !refundTypes.has(event.type) || event.objectId !== record.providerRefundId)
      return "The verified refund-event source is unavailable.";
    return null;
  }
  async listExternalRefunds(orderId: string, page: unknown = 0) {
    await this.order(orderId);
    const current = commercePage(page);
    const rows = await this.db
      .select({ id: externalRefunds.id })
      .from(externalRefunds)
      .where(eq(externalRefunds.orderId, orderId))
      .orderBy(
        sql`case when ${externalRefunds.allocationState}='unallocated' then 0 else 1 end`,
        sql`${externalRefunds.createdAt} desc`,
        sql`${externalRefunds.id} desc`,
      )
      .limit(101)
      .offset(current * 100);
    return {
      refunds: await Promise.all(
        rows.slice(0, 100).map(async (row) => (await this.externalRecord(row.id)).refund),
      ),
      enabled: this.enabled,
      page: current,
      hasMore: rows.length > 100,
    };
  }
  async externalRefundDetail(id: string): Promise<CommerceExternalRefundDetail> {
    const { record, refund } = await this.externalRecord(id);
    const lines = await this.db
      .select()
      .from(items)
      .where(eq(items.orderId, record.orderId))
      .orderBy(items.id);
    const blocked = await this.externalBlocked(this.db, record);
    const canAllocate =
      this.enabled &&
      record.providerStatus === "succeeded" &&
      record.allocationState === "unallocated" &&
      !blocked;
    return {
      refund,
      enabled: this.enabled,
      canAllocate,
      message:
        blocked ??
        (canAllocate
          ? "Allocate the already completed provider refund. No new refund payment will be created."
          : "Allocation requires an enabled test gateway and a confirmed, unallocated succeeded refund."),
      items: lines.map((line) => ({
        itemId: line.id,
        name: line.name,
        sku: line.sku,
        remainingCents: line.lineCents - line.refundedCents,
      })),
      payment: (await this.status(record.orderId)).payment,
    };
  }
  private async recordExternalIn(
    tx: CommerceTransaction,
    actor: CommerceActor,
    sourceEventId: string,
    proof: CommerceRefundProof,
  ) {
    const [event] = await tx.select().from(events).where(eq(events.id, sourceEventId));
    if (!event || !refundTypes.has(event.type) || event.objectId !== proof.id)
      return fail(
        409,
        "commerce_external_source_invalid",
        "A previously verified refund event is required.",
      );
    const [attempt] = await tx
      .select()
      .from(payments)
      .where(eq(payments.paymentIntentId, proof.paymentIntentId));
    if (!attempt)
      return fail(
        409,
        "commerce_payment_mapping_pending",
        "The provider payment has not been mapped to an order.",
      );
    if (
      proof.livemode === true ||
      proof.currency !== "cad" ||
      !Number.isSafeInteger(proof.amountCents) ||
      proof.amountCents < 1 ||
      proof.amountCents > attempt.amountCents
    )
      fail(
        502,
        "commerce_payment_proof_invalid",
        "External refund proof does not match the test payment.",
      );
    const [owned] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.providerRefundId, proof.id));
    if (owned)
      return fail(
        409,
        "commerce_external_refund_owned",
        "This provider refund is already assigned to an internal operation.",
      );
    const [prior] = await tx
      .select()
      .from(externalRefunds)
      .where(eq(externalRefunds.providerRefundId, proof.id));
    const providerStatus = (
      proof.status &&
      ["pending", "requires_action", "succeeded", "failed", "canceled"].includes(proof.status)
        ? proof.status
        : "unknown"
    ) as ExternalRefund["providerStatus"];
    let record: ExternalRefund | undefined;
    if (prior) {
      if (
        prior.attemptId !== attempt.id ||
        prior.orderId !== attempt.orderId ||
        prior.amountCents !== proof.amountCents ||
        prior.currency !== proof.currency ||
        prior.paymentIntentId !== proof.paymentIntentId
      )
        fail(
          502,
          "commerce_payment_proof_invalid",
          "The external refund identity changed. Keep its existing history frozen.",
        );
      if (prior.allocationState === "excluded_owned") return prior;
      if (
        ["failed", "canceled"].includes(prior.providerStatus) &&
        !["failed", "canceled"].includes(providerStatus)
      )
        return prior;
      const state =
        prior.allocationState === "allocated"
          ? "allocated"
          : ["failed", "canceled"].includes(providerStatus)
            ? "requires_review"
            : prior.allocationState;
      const changed = providerStatus !== prior.providerStatus || state !== prior.allocationState;
      [record] = await tx
        .update(externalRefunds)
        .set({
          providerStatus,
          allocationState: state,
          version: prior.version + (changed ? 1 : 0),
          observedAt: this.now(),
        })
        .where(eq(externalRefunds.id, prior.id))
        .returning();
    } else {
      const id = crypto.randomUUID();
      const held = await this.markReviewIn(tx, actor, attempt.id, `external_refund:${id}`, id);
      [record] = await tx
        .insert(externalRefunds)
        .values({
          id,
          orderId: attempt.orderId,
          attemptId: attempt.id,
          providerRefundId: proof.id,
          sourceEventId,
          paymentIntentId: proof.paymentIntentId,
          amountCents: proof.amountCents,
          providerStatus,
          allocationState: ["failed", "canceled"].includes(providerStatus)
            ? "requires_review"
            : "unallocated",
          holdVersion: held.reviewKey === `external_refund:${id}` ? held.reviewVersion : null,
          observedAt: this.now(),
          createdAt: this.now(),
        })
        .returning();
    }
    if (record!.allocationState !== "allocated" || providerStatus !== "succeeded") {
      if (record!.allocationState === "allocated")
        await this.markReviewIn(tx, actor, attempt.id, `returned_external_refund:${record!.id}`);
      else if (prior && attempt.status !== "requires_review")
        await this.markReviewIn(tx, actor, attempt.id, `external_refund:${record!.id}`);
      await tx.update(items).set({ openCase: true }).where(eq(items.orderId, attempt.orderId));
    }
    await this.audit(tx, actor, "external_refund.observed", record!.id, {
      providerRefundId: proof.id,
      sourceEventId,
      providerStatus,
      version: record!.version,
    });
    return record!;
  }
  async observeExternalRefund(actor: CommerceActor, sourceEventId: unknown, reason: unknown) {
    const gateway = this.gateway();
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator required.");
    const auditReason = commerceText(reason, "reason", 500);
    const eventId = commerceText(sourceEventId, "sourceEventId", 150);
    if (!/^evt_[A-Za-z0-9_]+$/.test(eventId)) fail(400, "bad_request", "Invalid source event id.");
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event)
      return fail(
        404,
        "commerce_external_source_missing",
        "The verified source event was not found.",
      );
    if (!refundTypes.has(event.type))
      fail(409, "commerce_external_source_invalid", "The source must be a verified refund event.");
    const proof = await gateway.retrieveRefund(event.objectId);
    const record = await this.commerce.paymentTransaction(async (tx) => {
      const record = await this.recordExternalIn(tx, actor, event.id, proof);
      await this.audit(tx, actor, "external_refund.observe_requested", record.id, {
        sourceEventId: event.id,
        reason: auditReason,
      });
      await tx
        .update(events)
        .set({ processedAt: this.now(), outcome: "requires_review", errorCode: null })
        .where(eq(events.id, event.id));
      return record;
    });
    return this.externalRefundDetail(record.id);
  }
  private async allocationResult(id: string): Promise<CommerceExternalRefundAllocationResult> {
    const { record, refund } = await this.externalRecord(id);
    const payment = (await this.status(record.orderId)).payment;
    const [attempt] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, record.attemptId));
    const reviewCleared = attempt?.status === "paid" && attempt.reviewKey === null;
    return {
      refund,
      payment,
      applied: true,
      reviewCleared,
      message: reviewCleared
        ? "The completed refund was allocated to the ledger. Existing support cases remain open until explicitly reviewed."
        : "The completed refund was allocated once. Other or unclassified reviews remain frozen; no new payment was made.",
    };
  }
  async allocateExternalRefund(
    actor: CommerceActor,
    id: string,
    body: Record<string, unknown>,
  ): Promise<CommerceExternalRefundAllocationResult> {
    const gateway = this.gateway();
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator required.");
    commerceId(id);
    if (
      Object.keys(body).some(
        (key) => !["expectedVersion", "allocations", "reason", "idempotencyKey"].includes(key),
      )
    )
      fail(400, "bad_request", "Unexpected allocation input.");
    const key = requestKey(body.idempotencyKey),
      reason = commerceText(body.reason, "reason", 500),
      expectedVersion = commerceInteger(body.expectedVersion, "expectedVersion", 1, 2147483647);
    if (
      !Array.isArray(body.allocations) ||
      body.allocations.length < 1 ||
      body.allocations.length > 50
    )
      fail(400, "bad_request", "Allocate the full refund to 1–50 distinct order items.");
    const plan = (body.allocations as Record<string, unknown>[])
      .map((line) => ({
        itemId: commerceId(line?.itemId),
        amountCents: commerceInteger(line?.amountCents, "amountCents", 1, 99999999),
      }))
      .toSorted((a, b) => a.itemId.localeCompare(b.itemId));
    if (new Set(plan.map((line) => line.itemId)).size !== plan.length)
      fail(400, "bad_request", "Duplicate allocation item.");
    const allocationFingerprint = createHash("sha256")
      .update(JSON.stringify({ reason, allocations: plan }))
      .digest("hex");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ id, expectedVersion, reason, allocations: plan }))
      .digest("hex");
    const prepare = async (tx: CommerceTransaction) => {
      const [operation] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.actorId, actor.id),
            eq(operations.kind, "external-refund.allocate"),
            eq(operations.key, key),
          ),
        );
      if (operation) {
        if (operation.fingerprint !== fingerprint)
          fail(409, "idempotency_conflict", "The allocation key belongs to another request.");
        return { done: true as const, id: operation.resourceId };
      }
      const { record } = await this.externalRecord(id, tx);
      if (record.allocationState === "allocated") {
        if (record.allocationFingerprint !== allocationFingerprint)
          fail(
            409,
            "commerce_external_refund_allocated",
            "This provider refund already has a different immutable allocation.",
          );
        await tx.insert(operations).values({
          actorId: actor.id,
          kind: "external-refund.allocate",
          key,
          fingerprint,
          resourceId: id,
        });
        await this.audit(tx, actor, "external_refund.replayed", id);
        return { done: true as const, id };
      }
      if (record.version !== expectedVersion)
        fail(
          409,
          "commerce_external_refund_stale",
          "The provider refund changed. Reload it before allocating.",
        );
      if (record.providerStatus !== "succeeded" || record.allocationState !== "unallocated")
        fail(
          409,
          "commerce_external_refund_unconfirmed",
          "Only a confirmed succeeded, unallocated refund can be allocated.",
        );
      if (
        plan.reduce((sum, line) => sum + BigInt(line.amountCents), 0n) !==
        BigInt(record.amountCents)
      )
        fail(
          400,
          "commerce_allocation_sum",
          "Allocation amounts must exactly equal the confirmed provider refund.",
        );
      const blocked = await this.externalBlocked(tx, record);
      if (blocked) fail(409, "commerce_external_refund_blocked", blocked);
      const [attempt] = await tx.select().from(payments).where(eq(payments.id, record.attemptId));
      return { done: false as const, record, reviewVersion: attempt!.reviewVersion };
    };
    const prepared = await this.commerce.paymentTransaction(prepare);
    if (prepared.done) return this.allocationResult(prepared.id);
    // This is a read-only provider call. Allocation never calls createRefund or any payout API.
    let proof: CommerceRefundProof;
    try {
      proof = await gateway.retrieveRefund(prepared.record.providerRefundId);
    } catch {
      return fail(
        503,
        "commerce_external_refund_proof_unavailable",
        "Refund verification is unavailable. The ledger and freeze are unchanged.",
      );
    }
    const result = await this.commerce.paymentTransaction(async (tx) => {
      const current = await prepare(tx);
      if (current.done) return { done: true as const, id: current.id };
      const record = current.record;
      if (
        record.version !== prepared.record.version ||
        current.reviewVersion !== prepared.reviewVersion
      )
        fail(
          409,
          "commerce_external_refund_stale",
          "Refund or review state changed while verifying. No allocation was applied.",
        );
      if (
        proof.id !== record.providerRefundId ||
        proof.paymentIntentId !== record.paymentIntentId ||
        proof.currency !== "cad" ||
        proof.amountCents !== record.amountCents ||
        proof.livemode === true
      )
        fail(
          502,
          "commerce_payment_proof_invalid",
          "Provider proof does not match the stored refund.",
        );
      if (proof.status !== "succeeded") {
        await this.recordExternalIn(tx, actor, record.sourceEventId, proof);
        return { blocked: true as const };
      }
      const lines = await tx.select().from(items).where(eq(items.orderId, record.orderId));
      const selected = plan.map((part) => {
        const line = lines.find((line) => line.id === part.itemId);
        if (!line || part.amountCents > line.lineCents - line.refundedCents)
          fail(
            409,
            "commerce_allocation_item_conflict",
            "An item does not belong to this order or exceeds its remaining goods amount.",
          );
        return { line: line!, amountCents: part.amountCents };
      });
      for (const { line, amountCents } of selected) {
        await this.commerce.settleStripeRefundIn(tx, actor, line.id, {
          refundTotalCents: line.refundedCents + amountCents,
          reason,
          idempotencyKey: `external-refund:${id}:${line.id}`,
        });
        await tx.insert(externalAllocations).values({
          externalRefundId: id,
          itemId: line.id,
          amountCents,
          refundedBeforeCents: line.refundedCents,
          refundedAfterCents: line.refundedCents + amountCents,
        });
      }
      // Preserve original support cases independently of the financial allocation.
      for (const line of lines)
        if (line.openCase)
          await tx.update(items).set({ openCase: true }).where(eq(items.id, line.id));
      await tx
        .update(externalRefunds)
        .set({
          allocationState: "allocated",
          allocatedAt: this.now(),
          allocatedBy: actor.id,
          allocationFingerprint,
          allocationReason: reason,
          version: record.version + 1,
        })
        .where(eq(externalRefunds.id, id));
      const [attempt] = await tx.select().from(payments).where(eq(payments.id, record.attemptId));
      const [remaining] = await tx
        .select({ id: externalRefunds.id })
        .from(externalRefunds)
        .where(
          and(
            eq(externalRefunds.orderId, record.orderId),
            inArray(externalRefunds.allocationState, ["unallocated", "requires_review"]),
          ),
        )
        .limit(1);
      const [deferred] = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            sql`${events.processedAt} is null`,
            inArray(events.type, ["refund.created", "refund.updated", "refund.failed"]),
            sql`${events.facts}->>'paymentIntentId'=${record.paymentIntentId}`,
          ),
        )
        .limit(1);
      if (
        !remaining &&
        !deferred &&
        attempt!.status === "requires_review" &&
        (attempt!.reviewKey === `external_refund:${id}` ||
          attempt!.reviewKey === "external_refunds")
      ) {
        await tx
          .update(payments)
          .set({
            status: "paid",
            reviewKey: null,
            reviewVersion: attempt!.reviewVersion + 1,
            updatedAt: this.now(),
          })
          .where(eq(payments.id, attempt!.id));
      } else {
        await tx
          .update(payments)
          .set({ reviewVersion: attempt!.reviewVersion + 1, updatedAt: this.now() })
          .where(eq(payments.id, attempt!.id));
      }
      await tx.insert(operations).values({
        actorId: actor.id,
        kind: "external-refund.allocate",
        key,
        fingerprint,
        resourceId: id,
      });
      await this.audit(tx, actor, "external_refund.allocated", id, {
        providerRefundId: record.providerRefundId,
        sourceEventId: record.sourceEventId,
        amountCents: record.amountCents,
        allocations: plan,
        reason,
      });
      return { done: true as const, id };
    });
    if ("blocked" in result)
      fail(
        409,
        "commerce_external_refund_unconfirmed",
        "The provider no longer confirms success. No allocation was posted and the review remains frozen.",
      );
    return this.allocationResult(result.id);
  }
  async handleWebhook(payload: string, signature: string, traceId: string) {
    const gateway = this.gateway();
    const event = await gateway.verifyEvent(payload, signature);
    if (event.livemode !== false || event.account)
      fail(400, "commerce_live_event_rejected", "Only platform Stripe TEST events are accepted.");
    const actor: CommerceActor = { id: `stripe:${event.id}`, type: "system", traceId };
    const duplicate = await this.commerce.paymentTransaction(async (tx) => {
      const [prior] = await tx.select().from(events).where(eq(events.id, event.id));
      if (prior) {
        if (prior.type !== event.type || prior.objectId !== event.objectId)
          fail(
            400,
            "commerce_event_conflict",
            "Event identity does not match its original payload.",
          );
        if (prior.processedAt) return true;
      } else
        await tx.insert(events).values({
          id: event.id,
          type: event.type,
          objectId: event.objectId,
          payloadHash: event.payloadHash,
          facts: {
            currency: event.currency ?? null,
            paymentIntentId: event.paymentIntentId ?? null,
            purpose: event.purpose ?? null,
          },
        });
      await tx
        .update(events)
        .set({ attempts: sql`${events.attempts}+1`, errorCode: null })
        .where(eq(events.id, event.id));
      return false;
    });
    if (duplicate) return { received: true, outcome: "duplicate" as const };
    try {
      const [knownSession] = checkoutTypes.has(event.type)
        ? await this.db
            .select({ id: payments.id })
            .from(payments)
            .where(eq(payments.sessionId, event.objectId))
            .limit(1)
        : [];
      const checkout =
        checkoutTypes.has(event.type) &&
        (event.purpose === COMMERCE_STRIPE_PURPOSE || knownSession) &&
        (!event.currency || event.currency === "cad")
          ? await gateway.retrieveCheckout(event.objectId)
          : null;
      const refund =
        refundTypes.has(event.type) && (!event.currency || event.currency === "cad")
          ? await gateway.retrieveRefund(event.objectId)
          : null;
      const outcome = await this.commerce.paymentTransaction(async (tx) => {
        const [inbox] = await tx.select().from(events).where(eq(events.id, event.id));
        if (inbox!.processedAt) return "duplicate" as const;
        let result: "processed" | "ignored" | "requires_review" | "deferred" = "ignored";
        if (checkout?.metadata.purpose === COMMERCE_STRIPE_PURPOSE) {
          const [attempt] = await tx
            .select()
            .from(payments)
            .where(eq(payments.id, commerceId(checkout.metadata.attemptId)));
          if (attempt) {
            await this.applyCheckout(tx, actor, attempt.id, checkout);
            result = "processed";
          } else result = "requires_review";
        }
        if (refund) {
          const [attempt] = await tx
            .select()
            .from(payments)
            .where(eq(payments.paymentIntentId, refund.paymentIntentId));
          if (attempt) {
            const [knownRequest] = await tx
              .select()
              .from(refunds)
              .where(eq(refunds.providerRefundId, refund.id));
            let request = knownRequest;
            if (!request) {
              let metadataId: string | undefined;
              if (refund.metadata.refundRequestId)
                try {
                  metadataId = commerceId(refund.metadata.refundRequestId);
                } catch {
                  /* mutable metadata is not an identity anchor */
                }
              if (metadataId)
                [request] = await tx.select().from(refunds).where(eq(refunds.id, metadataId));
            }
            if (request && request.attemptId === attempt.id) {
              await this.applyRefund(tx, actor, request.id, refund);
              result = "processed";
            } else {
              const external = await this.recordExternalIn(tx, actor, event.id, refund);
              await this.audit(tx, actor, "unallocated_refund.review", attempt.id, {
                providerRefundId: refund.id,
              });
              result =
                external.allocationState === "allocated" && external.providerStatus === "succeeded"
                  ? "processed"
                  : "requires_review";
            }
          } else {
            await tx
              .update(events)
              .set({
                facts: {
                  currency: refund.currency,
                  paymentIntentId: refund.paymentIntentId,
                  purpose: refund.metadata.purpose ?? null,
                },
              })
              .where(eq(events.id, event.id));
            result = "deferred";
          }
        }
        if (result === "deferred") {
          await tx
            .update(events)
            .set({ outcome: "requires_review", errorCode: "commerce_payment_mapping_pending" })
            .where(eq(events.id, event.id));
          return result;
        }
        await tx
          .update(events)
          .set({ processedAt: this.now(), outcome: result, errorCode: null })
          .where(eq(events.id, event.id));
        return result;
      });
      if (outcome === "deferred")
        throw new ApiError(
          503,
          "commerce_payment_mapping_pending",
          "A refund arrived before its payment mapping. The event remains retryable and requires reconciliation.",
        );
      return { received: true, outcome };
    } catch (error) {
      await this.commerce.paymentTransaction(async (tx) => {
        await tx
          .update(events)
          .set({ errorCode: "commerce_event_processing_failed" })
          .where(eq(events.id, event.id));
      });
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        "commerce_event_processing_failed",
        "Test payment event remains retryable.",
      );
    }
  }
}
