import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LedgerService } from "../credits/LedgerService.ts";
import { ApiError } from "../http/errors.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { BillingService } from "./BillingService.ts";
import { FakeStripeGateway } from "./StripeGateway.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
const stripe = new FakeStripeGateway();
const billing = new BillingService(conn.db, ledger, stripe, {
  webPublicUrl: "https://app.test",
  topupPriceId: "price_topup",
});
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
    await expect(billing.handleWebhook(replayed, "sig")).rejects.toThrow();
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
    expect(history.map((e) => e.type).slice(0, 2)).toEqual(["plan_grant", "expiry"]);
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
});
