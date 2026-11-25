import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { InsufficientCreditsError, LedgerService } from "../credits/LedgerService.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import { ApiError } from "../http/errors.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { BillingService } from "./BillingService.ts";
import { FakeStripeGateway } from "./StripeGateway.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
const stripe = new FakeStripeGateway();
const alerts: { title: string; body: string }[] = [];
const billing = new BillingService(
  conn.db,
  stripe,
  { webPublicUrl: "https://app.test", topupPriceId: "price_topup" },
  (alert) => void alerts.push(alert),
);
let orgId: string;
let userId: string;

beforeAll(async () => {
  ({ orgId, userId } = await seedOrg(conn.db, "billing"));
  await conn.db
    .insert(schema.plans)
    .values({
      id: "business",
      name: "Business",
      monthlyPriceUsdCents: 6000,
      annualPriceUsdCents: 60000,
      includedMicrocredits: creditsToMicro(6500),
      concurrentStreams: 15,
      requestsPerMinute: 60,
      priorityWeight: 8,
      syncQuotaBytes: 1n,
      requiresOwner2fa: true,
      stripeMonthlyPriceId: "price_business_m",
    })
    .onConflictDoUpdate({
      target: schema.plans.id,
      set: { stripeMonthlyPriceId: "price_business_m", active: true },
    });
});
afterAll(() => conn.close());

const evt = (id: string, type: string, object: unknown) =>
  JSON.stringify({ id, type, data: { object } });

describe("BillingService", () => {
  it("retries a failed webhook without granting credits twice", async () => {
    const before = await ledger.available(orgId);
    const payload = evt(`evt_${orgId}_retry`, "checkout.session.completed", {
      id: `cs_${orgId}_retry`,
      payment_status: "paid",
      amount_total: 1000,
      metadata: { kind: "topup", orgId, userId, usd: "10" },
    });
    const failure = vi
      .spyOn(AuditLog, "writeAudit")
      .mockRejectedValueOnce(new Error("temporary database failure"));
    await expect(billing.handleWebhook(payload, "sig")).rejects.toThrow();
    failure.mockRestore();
    expect(await ledger.available(orgId)).toBe(before);
    expect(await billing.handleWebhook(payload, "sig")).toBe("processed");
    expect(await ledger.available(orgId)).toBe(before + creditsToMicro(1000));
    expect(await billing.handleWebhook(payload, "sig")).toBe("duplicate");
  });

  it("grants delayed top-ups once, excluding tax from credits", async () => {
    const before = await ledger.available(orgId);
    const session = {
      id: `cs_${orgId}_async`,
      payment_status: "paid",
      currency: "usd",
      amount_total: 2260,
      amount_subtotal: 2000,
      total_details: { amount_tax: 260, amount_discount: 0 },
      metadata: { kind: "topup", orgId, userId, usd: "20" },
    };
    expect(
      await billing.handleWebhook(
        evt(`evt_${orgId}_async`, "checkout.session.async_payment_succeeded", session),
        "sig",
      ),
    ).toBe("processed");
    expect(await ledger.available(orgId)).toBe(before + creditsToMicro(2000));
    expect(
      await billing.handleWebhook(
        evt(`evt_${orgId}_async_replay`, "checkout.session.completed", session),
        "sig",
      ),
    ).toBe("processed");
    expect(await ledger.available(orgId)).toBe(before + creditsToMicro(2000));
  });
  it("creates one Stripe customer per org and a top-up checkout", async () => {
    const a = await billing.topupCheckout({
      orgId,
      userId,
      email: "b@test.invalid",
      orgName: "Acme",
      usd: 20,
    });
    const b = await billing.topupCheckout({
      orgId,
      userId,
      email: "b@test.invalid",
      orgName: "Acme",
      usd: 20,
    });
    expect(a.url).toContain("checkout.stripe.test");
    expect(b.url).not.toBe(a.url);
    expect(stripe.customers.filter((c) => c.orgId === orgId)).toHaveLength(1);
    expect(stripe.checkouts.at(-1)?.quantity).toBe(20);
  });

  it("rejects top-ups under the minimum and non-integer amounts", async () => {
    await expect(
      billing.topupCheckout({ orgId, userId, email: "b@test.invalid", orgName: "Acme", usd: 4 }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      billing.topupCheckout({ orgId, userId, email: "b@test.invalid", orgName: "Acme", usd: 5.5 }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("grants top-up credits exactly once per checkout session, even when the webhook is replayed", async () => {
    const before = await ledger.available(orgId);
    const payload = evt(`evt_${orgId}_1`, "checkout.session.completed", {
      id: `cs_${orgId}_1`,
      payment_status: "paid",
      amount_total: 2000,
      payment_intent: "pi_1",
      metadata: { kind: "topup", orgId, userId, usd: "20" },
    });
    expect(await billing.handleWebhook(payload, "sig")).toBe("processed");
    expect(await billing.handleWebhook(payload, "sig")).toBe("duplicate");
    // A different event id carrying the same session must also not double-grant.
    const replayed = evt(
      `evt_${orgId}_1b`,
      "checkout.session.completed",
      JSON.parse(payload).data.object,
    );
    expect(await billing.handleWebhook(replayed, "sig")).toBe("processed");
    expect(await ledger.available(orgId)).toBe(before + creditsToMicro(2000));
  });

  it("mirrors subscriptions and grants plan credits on invoice.paid once per invoice", async () => {
    const subObj = {
      id: `sub_${orgId}`,
      status: "active",
      cancel_at_period_end: false,
      metadata: { orgId, planId: "business" },
      items: {
        data: [
          {
            current_period_start: 1_760_000_000,
            current_period_end: 1_762_592_000,
            plan: { interval: "month" },
          },
        ],
      },
    };
    expect(
      await billing.handleWebhook(
        evt(`evt_${orgId}_sub`, "customer.subscription.created", subObj),
        "sig",
      ),
    ).toBe("processed");
    const sub = await conn.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.orgId, orgId),
    });
    expect(sub?.planId).toBe("business");
    expect(sub?.status).toBe("active");

    const before = await ledger.balances(orgId);
    const invoice = {
      id: `in_${orgId}`,
      status: "paid",
      amount_due: 6000,
      amount_paid: 6000,
      currency: "usd",
      created: 1_760_000_000,
      period_start: 1_760_000_000,
      hosted_invoice_url: "https://invoice.test",
      invoice_pdf: null,
      lines: { data: [{ period: { start: 1_760_000_000, end: 1_762_592_000 } }] },
      parent: { subscription_details: { subscription: `sub_${orgId}` } },
    };
    expect(
      await billing.handleWebhook(evt(`evt_${orgId}_inv`, "invoice.paid", invoice), "sig"),
    ).toBe("processed");
    const after = await ledger.balances(orgId);
    expect(after.plan).toBe(creditsToMicro(6500));
    expect(after.topup).toBe(before.topup);
    // second invoice: leftover plan credits expire, new allowance granted
    const invoice2 = {
      ...invoice,
      id: `in_${orgId}_2`,
      period_start: 1_762_592_000,
      lines: { data: [{ period: { start: 1_762_592_000, end: 1_765_000_000 } }] },
    };
    expect(
      await billing.handleWebhook(evt(`evt_${orgId}_inv2`, "invoice.paid", invoice2), "sig"),
    ).toBe("processed");
    expect((await ledger.balances(orgId)).plan).toBe(creditsToMicro(6500));
    const history = await ledger.history(orgId, { limit: 5 });
    // Both entries share the webhook transaction timestamp.
    expect(history.map((e) => e.type).slice(0, 2)).toEqual(
      expect.arrayContaining(["plan_grant", "expiry"]),
    );
    // subscribing again while active is refused
    await expect(
      billing.subscribeCheckout({
        orgId,
        userId,
        email: "b@test.invalid",
        orgName: "Acme",
        planId: "business",
        interval: "month",
      }),
    ).rejects.toMatchObject({ code: "already_subscribed" });
  });

  it("refuses checkouts while the billing kill switch is engaged", async () => {
    await conn.db
      .insert(schema.killSwitches)
      .values({ name: "billing", engaged: true })
      .onConflictDoUpdate({ target: schema.killSwitches.name, set: { engaged: true } });
    await expect(
      billing.topupCheckout({ orgId, userId, email: "b@test.invalid", orgName: "Acme", usd: 10 }),
    ).rejects.toMatchObject({ code: "billing_paused" });
    await conn.db
      .update(schema.killSwitches)
      .set({ engaged: false })
      .where(eq(schema.killSwitches.name, "billing"));
  });

  /** A fresh org with one paid top-up of `usd` dollars (plus 13% tax), and its Stripe ids. */
  async function toppedUp(label: string, usd: number) {
    const org = await seedOrg(conn.db, label);
    const pi = `pi_${org.orgId}`;
    const charged = usd * 113;
    await billing.handleWebhook(
      evt(`evt_${org.orgId}_topup`, "checkout.session.completed", {
        id: `cs_${org.orgId}`,
        payment_status: "paid",
        currency: "usd",
        amount_total: charged,
        total_details: { amount_tax: charged - usd * 100 },
        payment_intent: pi,
        metadata: { kind: "topup", orgId: org.orgId, userId: org.userId, usd: String(usd) },
      }),
      "sig",
    );
    const refund = (eventId: string, amount_refunded: number) =>
      billing.handleWebhook(
        evt(`evt_${org.orgId}_${eventId}`, "charge.refunded", {
          id: `ch_${org.orgId}`,
          payment_intent: pi,
          amount: charged,
          amount_refunded,
          currency: "usd",
        }),
        "sig",
      );
    const dispute = (eventId: string, type = "charge.dispute.created") =>
      billing.handleWebhook(
        evt(`evt_${org.orgId}_${eventId}`, type, {
          id: `dp_${org.orgId}`,
          payment_intent: pi,
          charge: `ch_${org.orgId}`,
          amount: charged,
          reason: "fraudulent",
        }),
        "sig",
      );
    /** Spend `credits` of the top-up, as a settled gateway request would. */
    const spend = async (credits: number) => {
      const reservationId = crypto.randomUUID();
      const input = {
        orgId: org.orgId,
        reservationId,
        idempotencyKey: `r:${reservationId}`,
        actor: "test",
      };
      await ledger.reserve({ ...input, estimate: creditsToMicro(credits) });
      await ledger.settle({ ...input, actual: creditsToMicro(credits) });
    };
    return { ...org, charged, refund, dispute, spend };
  }

  it("takes back the credits of a refunded top-up once, in step with partial refunds", async () => {
    const t = await toppedUp("refund", 20);
    expect(await ledger.available(t.orgId)).toBe(creditsToMicro(2000));
    // Half the payment refunded: half the credits, tax excluded from both.
    expect(await t.refund("r1", t.charged / 2)).toBe("processed");
    expect(await ledger.available(t.orgId)).toBe(creditsToMicro(1000));
    // The same webhook again, and the same refund under a new event id, take nothing more.
    expect(await t.refund("r1", t.charged / 2)).toBe("duplicate");
    expect(await t.refund("r1b", t.charged / 2)).toBe("ignored");
    expect(await ledger.available(t.orgId)).toBe(creditsToMicro(1000));
    // The rest refunded: Stripe reports the running total, and only the difference is taken.
    expect(await t.refund("r2", t.charged)).toBe("processed");
    expect(await ledger.available(t.orgId)).toBe(0n);
    expect(await t.refund("r2b", t.charged)).toBe("ignored");
    expect(await ledger.available(t.orgId)).toBe(0n);
    const history = await ledger.history(t.orgId, { limit: 10 });
    expect(history.filter((e) => e.type === "refund").map((e) => e.amount)).toEqual([
      -creditsToMicro(1000),
      -creditsToMicro(1000),
    ]);
    const { before, after } = await ledger.refold(t.orgId);
    expect(before).toEqual(after);
  });

  it("leaves an org that spent refunded credits in debt and blocks paid usage until it is cleared", async () => {
    const t = await toppedUp("refund-spent", 10);
    await t.spend(600);
    expect(await t.refund("r1", t.charged)).toBe("processed");
    // 1,000 credits taken back from the 400 left: the folded balance is negative by 600.
    expect(await ledger.balances(t.orgId)).toMatchObject({ topup: -creditsToMicro(600) });
    const { before, after } = await ledger.refold(t.orgId);
    expect(before).toEqual(after);
    await expect(t.spend(1)).rejects.toBeInstanceOf(InsufficientCreditsError);
    // A new top-up pays the debt before anything is spendable.
    await ledger.grant({
      orgId: t.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(1000),
      idempotencyKey: `g:${t.orgId}:again`,
      actor: "test",
    });
    expect(await ledger.available(t.orgId)).toBe(creditsToMicro(400));
    await t.spend(1);
  });

  it("takes a disputed top-up back in full, flags the org for review, and alerts once", async () => {
    const t = await toppedUp("dispute", 10);
    await t.spend(250);
    // An earlier partial refund already took a tenth.
    await t.refund("r1", t.charged / 10);
    alerts.length = 0;
    expect(await t.dispute("d1")).toBe("processed");
    expect(await ledger.balances(t.orgId)).toMatchObject({ topup: -creditsToMicro(250) });
    // Stripe's follow-up event for the same dispute, and a replay, change nothing.
    expect(await t.dispute("d2", "charge.dispute.funds_withdrawn")).toBe("ignored");
    expect(await t.dispute("d1")).toBe("duplicate");
    expect(await ledger.balances(t.orgId)).toMatchObject({ topup: -creditsToMicro(250) });
    await expect(t.spend(1)).rejects.toBeInstanceOf(InsufficientCreditsError);
    const flags = await conn.db.query.abuseFlags.findMany({
      where: eq(schema.abuseFlags.orgId, t.orgId),
    });
    expect(flags).toMatchObject([
      { kind: "payment", severity: "warn", details: { dispute: `dp_${t.orgId}` } },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ title: "Top-up payment disputed" });
    expect(alerts[0]!.body).toContain(t.orgId);
    const { before, after } = await ledger.refold(t.orgId);
    expect(before).toEqual(after);
  });

  it("ignores refunds and disputes of payments that granted no top-up", async () => {
    const unknown = `pi_${crypto.randomUUID()}`;
    expect(
      await billing.handleWebhook(
        evt(`evt_${unknown}_r`, "charge.refunded", {
          id: `ch_${unknown}`,
          payment_intent: unknown,
          amount: 6000,
          amount_refunded: 6000,
        }),
        "sig",
      ),
    ).toBe("ignored");
    expect(
      await billing.handleWebhook(
        evt(`evt_${unknown}_d`, "charge.dispute.created", {
          id: `dp_${unknown}`,
          payment_intent: unknown,
          amount: 6000,
          reason: "general",
        }),
        "sig",
      ),
    ).toBe("ignored");
  });
});
