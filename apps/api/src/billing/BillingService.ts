/**
 * Billing: Stripe Checkout for tiers and top-ups, the Customer Portal, and
 * webhook processing that turns Stripe facts into ledger entries.
 *
 * Idempotency: every Stripe event id is inserted into stripe_events before
 * processing; a replayed event is a no-op. Every ledger write carries an
 * idempotency key derived from the Stripe object id so a retried webhook can
 * never double-grant.
 */
import { and, eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { TOPUP_MIN_USD_CENTS, usdCentsToMicro, type PlanId } from "@djl/domain";
import type Stripe from "stripe";

import { writeAudit } from "../audit/AuditLog.ts";
import type { LedgerService } from "../credits/LedgerService.ts";
import { ApiError } from "../http/errors.ts";
import type { StripeGateway } from "./StripeGateway.ts";

export interface BillingConfig {
  readonly webPublicUrl: string;
  /** Stripe price id for one-off top-ups, priced per 1 USD (quantity = dollars). */
  readonly topupPriceId: string;
}

const PAID_PLANS: readonly PlanId[] = ["starter", "business", "autopilot"];

type SubscriptionStatus = (typeof schema.subscriptionStatusEnum.enumValues)[number];
const SUBSCRIPTION_STATUSES = new Set<string>(schema.subscriptionStatusEnum.enumValues);
function toStatus(status: string): SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES.has(status) ? status : "incomplete") as SubscriptionStatus;
}

export class BillingService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly ledger: LedgerService,
    private readonly stripe: StripeGateway,
    private readonly config: BillingConfig,
  ) {}

  async ensureCustomer(orgId: string, email: string, name: string): Promise<string> {
    const existing = await this.db.query.customers.findFirst({
      where: eq(schema.customers.orgId, orgId),
    });
    if (existing) return existing.stripeCustomerId;
    const created = await this.stripe.createCustomer({ email, orgId, name });
    await this.db
      .insert(schema.customers)
      .values({ orgId, stripeCustomerId: created.id, billingEmail: email })
      .onConflictDoNothing({ target: schema.customers.orgId });
    return created.id;
  }

  async killSwitchEngaged(): Promise<boolean> {
    const row = await this.db.query.killSwitches.findFirst({
      where: eq(schema.killSwitches.name, "billing"),
    });
    return Boolean(row?.engaged);
  }

  /** Start a subscription checkout for a paid tier. */
  async subscribeCheckout(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly email: string;
    readonly orgName: string;
    readonly planId: PlanId;
    readonly interval: "month" | "year";
  }): Promise<{ readonly url: string }> {
    if (await this.killSwitchEngaged())
      throw new ApiError(503, "billing_paused", "Billing is temporarily paused.");
    if (!PAID_PLANS.includes(input.planId))
      throw new ApiError(400, "bad_plan", "Choose a paid plan.");
    const plan = await this.db.query.plans.findFirst({ where: eq(schema.plans.id, input.planId) });
    const priceId =
      input.interval === "year" ? plan?.stripeAnnualPriceId : plan?.stripeMonthlyPriceId;
    if (!plan?.active || !priceId)
      throw new ApiError(400, "plan_unavailable", "That plan is not available.");
    const active = await this.db.query.subscriptions.findFirst({
      where: and(
        eq(schema.subscriptions.orgId, input.orgId),
        eq(schema.subscriptions.status, "active"),
      ),
    });
    if (active)
      throw new ApiError(
        409,
        "already_subscribed",
        "Manage the existing subscription from the billing portal.",
      );
    const customerId = await this.ensureCustomer(input.orgId, input.email, input.orgName);
    const session = await this.stripe.createCheckoutSession({
      customerId,
      mode: "subscription",
      priceId,
      quantity: 1,
      successUrl: `${this.config.webPublicUrl}/billing?status=success`,
      cancelUrl: `${this.config.webPublicUrl}/billing?status=cancelled`,
      metadata: {
        orgId: input.orgId,
        userId: input.userId,
        kind: "subscription",
        planId: input.planId,
        interval: input.interval,
      },
      idempotencyKey: `checkout:sub:${input.orgId}:${input.planId}:${input.interval}:${(Date.now() / 60_000) | 0}`,
    });
    return { url: session.url };
  }

  /** Start a one-off top-up checkout. Amount in whole USD, minimum $5. */
  async topupCheckout(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly email: string;
    readonly orgName: string;
    readonly usd: number;
  }): Promise<{ readonly url: string }> {
    if (await this.killSwitchEngaged())
      throw new ApiError(503, "billing_paused", "Billing is temporarily paused.");
    if (
      !Number.isInteger(input.usd) ||
      input.usd * 100 < TOPUP_MIN_USD_CENTS ||
      input.usd > 10_000
    ) {
      throw new ApiError(400, "bad_amount", "Top-ups are whole dollars from $5 to $10,000.");
    }
    const customerId = await this.ensureCustomer(input.orgId, input.email, input.orgName);
    const session = await this.stripe.createCheckoutSession({
      customerId,
      mode: "payment",
      priceId: this.config.topupPriceId,
      quantity: input.usd,
      successUrl: `${this.config.webPublicUrl}/billing?status=topup-success`,
      cancelUrl: `${this.config.webPublicUrl}/billing?status=cancelled`,
      metadata: { orgId: input.orgId, userId: input.userId, kind: "topup", usd: String(input.usd) },
      idempotencyKey: `checkout:topup:${input.orgId}:${input.usd}:${crypto.randomUUID()}`,
    });
    return { url: session.url };
  }

  async portal(orgId: string, email: string, orgName: string): Promise<{ readonly url: string }> {
    const customerId = await this.ensureCustomer(orgId, email, orgName);
    return this.stripe.createPortalSession({
      customerId,
      returnUrl: `${this.config.webPublicUrl}/billing`,
    });
  }

  /**
   * Verify and record a webhook, then process it. Returns "duplicate" when the
   * event id was already recorded.
   */
  async handleWebhook(
    payload: string,
    signature: string,
  ): Promise<"processed" | "duplicate" | "ignored"> {
    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(payload, signature);
    } catch {
      throw new ApiError(400, "bad_signature", "Webhook signature failed.");
    }
    const inserted = await this.db
      .insert(schema.stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing({ target: schema.stripeEvents.id })
      .returning({ id: schema.stripeEvents.id });
    if (inserted.length === 0) return "duplicate";
    try {
      const outcome = await this.process(event);
      await this.db
        .update(schema.stripeEvents)
        .set({ processedAt: new Date() })
        .where(eq(schema.stripeEvents.id, event.id));
      return outcome;
    } catch (error) {
      await this.db
        .update(schema.stripeEvents)
        .set({ error: error instanceof Error ? error.message.slice(0, 500) : "unknown" })
        .where(eq(schema.stripeEvents.id, event.id));
      throw error;
    }
  }

  private async process(event: Stripe.Event): Promise<"processed" | "ignored"> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const meta = session.metadata ?? {};
        if (meta.kind === "topup" && meta.orgId && session.payment_status === "paid") {
          const cents = session.amount_total ?? Number(meta.usd) * 100;
          await this.ledger.grant({
            orgId: meta.orgId,
            bucket: "topup",
            type: "topup",
            amount: usdCentsToMicro(cents),
            idempotencyKey: `stripe:checkout:${session.id}`,
            actor: `stripe:${event.id}`,
            reason: "top-up",
            metadata: {
              paymentIntent: String(session.payment_intent ?? ""),
              amountUsdCents: cents,
            },
          });
          await writeAudit(this.db, {
            actorType: "stripe",
            actorId: event.id,
            action: "credits.topup",
            targetType: "org",
            targetId: meta.orgId,
            after: { cents },
          });
          return "processed";
        }
        return "ignored";
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const orgId = sub.metadata?.orgId;
        const planId = sub.metadata?.planId as PlanId | undefined;
        if (!orgId || !planId) return "ignored";
        const item = sub.items.data[0];
        const periodStart = new Date((item?.current_period_start ?? 0) * 1000);
        const periodEnd = new Date((item?.current_period_end ?? 0) * 1000);
        await this.db
          .insert(schema.subscriptions)
          .values({
            orgId,
            planId,
            stripeSubscriptionId: sub.id,
            status: toStatus(sub.status),
            interval: item?.plan?.interval ?? "month",
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          })
          .onConflictDoUpdate({
            target: schema.subscriptions.stripeSubscriptionId,
            set: {
              status: toStatus(sub.status),
              planId,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
            },
          });
        return "processed";
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const subId =
          typeof invoice.parent?.subscription_details?.subscription === "string"
            ? invoice.parent.subscription_details.subscription
            : invoice.parent?.subscription_details?.subscription?.id;
        if (!subId) return "ignored";
        const sub = await this.db.query.subscriptions.findFirst({
          where: eq(schema.subscriptions.stripeSubscriptionId, subId),
        });
        if (!sub) return "ignored";
        const plan = await this.db.query.plans.findFirst({
          where: eq(schema.plans.id, sub.planId),
        });
        if (!plan) return "ignored";
        const line = invoice.lines.data[0];
        const periodStart = new Date((line?.period?.start ?? invoice.period_start) * 1000);
        // Expire leftover plan credits from the previous period, then grant the new allowance.
        await this.ledger.expire({
          orgId: sub.orgId,
          bucket: "plan",
          idempotencyKey: `stripe:invoice:${invoice.id}:expire`,
          actor: `stripe:${event.id}`,
          reason: "cycle rollover",
        });
        await this.ledger.grant({
          orgId: sub.orgId,
          bucket: "plan",
          type: "plan_grant",
          amount: plan.includedMicrocredits,
          idempotencyKey: `stripe:invoice:${invoice.id}:grant`,
          actor: `stripe:${event.id}`,
          reason: `${plan.name} ${sub.interval}ly allowance`,
        });
        await this.db
          .update(schema.subscriptions)
          .set({ lastGrantedPeriodStart: periodStart })
          .where(eq(schema.subscriptions.id, sub.id));
        await this.db
          .insert(schema.invoices)
          .values({
            id: invoice.id,
            orgId: sub.orgId,
            status: invoice.status ?? "paid",
            amountDueUsdCents: invoice.amount_due,
            amountPaidUsdCents: invoice.amount_paid,
            currency: invoice.currency,
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            pdfUrl: invoice.invoice_pdf ?? null,
            createdAt: new Date(invoice.created * 1000),
          })
          .onConflictDoNothing({ target: schema.invoices.id });
        return "processed";
      }
      default:
        return "ignored";
    }
  }
}
