/** Real PostgreSQL integration suite; PGlite supplements never prove multi-connection locking. */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema, type DjlDatabase } from "@djl/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { CommerceAlertsService } from "./CommerceAlertsService.ts";
import type { CommerceTransaction } from "./CommerceService.ts";

const conn = await isolatedCommerceTestDatabase();
const minute = 60_000;
const day = 24 * 60 * minute;
let now = new Date("2030-01-01T00:00:00Z");
const key = () => crypto.randomUUID();
const externalId = (prefix: string) => `${prefix}${key().replaceAll("-", "")}`;
const address = {
  name: "Alert fixture buyer",
  line1: "100 Test Street",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA" as const,
};
const tracked = {
  payments: [] as string[],
  refunds: [] as string[],
  events: [] as string[],
  externals: [] as string[],
  withdrawals: [] as string[],
};
const monitor = (db = conn.db, enabled = true) =>
  new CommerceAlertsService(db, { enabled, environment: "test", now: () => now });
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};
const timestamp = () => now.toISOString().replace("Z", "000Z");

async function fixture(
  state: typeof schema.commercePaymentAttempts.$inferInsert.status = "unknown",
  sessionId = externalId("cs_test_"),
) {
  const userId = key();
  await conn.db.insert(schema.commerceCustomers).values({ userId, referralCode: key() });
  const [supplier] = await conn.db
    .insert(schema.commerceSuppliers)
    .values({ name: "Alert fixture supplier", returnAddress: "Toronto, Canada" })
    .returning();
  const [product] = await conn.db
    .insert(schema.commerceProducts)
    .values({
      supplierId: supplier!.id,
      sku: key(),
      name: "Alert fixture SKU",
      description: "No provider calls",
      category: "Bags",
      imageUrl: "/shop/media/test.png",
      priceCents: 10000,
      costCents: 4000,
      commissionBps: 1000,
      returnDays: 30,
      stock: 5,
      reserved: 1,
      status: "published",
    })
    .returning();
  const [order] = await conn.db
    .insert(schema.commerceOrders)
    .values({
      userId,
      status: "awaiting_payment",
      paymentProvider: "stripe_test",
      totalCents: 10000,
      address,
      expiresAt: new Date(now.getTime() - day),
    })
    .returning();
  const [item] = await conn.db
    .insert(schema.commerceOrderItems)
    .values({
      orderId: order!.id,
      productId: product!.id,
      supplierId: supplier!.id,
      sku: product!.sku,
      name: product!.name,
      quantity: 1,
      priceCents: 10000,
      costCents: 4000,
      lineCents: 10000,
      commissionBps: 1000,
      returnDays: 30,
    })
    .returning();
  const [attempt] = await conn.db
    .insert(schema.commercePaymentAttempts)
    .values({
      orderId: order!.id,
      requestKey: key(),
      amountCents: 10000,
      status: state,
      paymentIntentId: externalId("pi_"),
      sessionId,
      expiresAt: new Date(now.getTime() + day),
      createdAt: new Date(now.getTime() - 40 * day),
      updatedAt: now,
    })
    .returning();
  tracked.payments.push(attempt!.id);
  return {
    userId,
    supplier: supplier!,
    product: product!,
    order: order!,
    item: item!,
    attempt: attempt!,
  };
}

async function refund(
  f: Awaited<ReturnType<typeof fixture>>,
  status: typeof schema.commerceProviderRefunds.$inferInsert.status,
  providerRefundId = externalId("re_"),
) {
  const [row] = await conn.db
    .insert(schema.commerceProviderRefunds)
    .values({
      orderId: f.order.id,
      itemId: f.item.id,
      attemptId: f.attempt.id,
      actorId: key(),
      requestKey: key(),
      reason: "SQL alert fixture only",
      amountCents: 1000,
      refundTotalCents: 1000,
      status,
      providerRefundId,
      createdAt: new Date(now.getTime() - 40 * day),
      updatedAt: now,
    })
    .returning();
  tracked.refunds.push(row!.id);
  return row!;
}

async function event(processed = false, objectId = externalId("re_")) {
  const [row] = await conn.db
    .insert(schema.commercePaymentEvents)
    .values({
      id: externalId("evt_"),
      type: "refund.updated",
      objectId,
      payloadHash: "a".repeat(64),
      receivedAt: new Date(now.getTime() - 40 * day),
      processedAt: processed ? now : null,
      outcome: processed ? "requires_review" : null,
    })
    .returning();
  tracked.events.push(row!.id);
  return row!;
}

async function external(
  f: Awaited<ReturnType<typeof fixture>>,
  providerRefundId = externalId("re_"),
) {
  const source = await event(true, providerRefundId);
  const [row] = await conn.db
    .insert(schema.commerceExternalRefunds)
    .values({
      orderId: f.order.id,
      attemptId: f.attempt.id,
      providerRefundId,
      sourceEventId: source.id,
      paymentIntentId: f.attempt.paymentIntentId!,
      amountCents: 1000,
      providerStatus: "succeeded",
      allocationState: "unallocated",
      observedAt: now,
      createdAt: new Date(now.getTime() - 40 * day),
    })
    .returning();
  tracked.externals.push(row!.id);
  return row!;
}

async function incidents(resourceId: string) {
  return conn.db
    .select()
    .from(schema.commerceAlertIncidents)
    .where(eq(schema.commerceAlertIncidents.resourceId, resourceId))
    .orderBy(schema.commerceAlertIncidents.firstDetectedAt, schema.commerceAlertIncidents.id);
}

async function allListed(status: "open" | "resolved" = "open") {
  const rows = [] as Awaited<ReturnType<CommerceAlertsService["list"]>>["incidents"][number][];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  for (let page = 0; page < 50; page++) {
    const result = await monitor().list({ status, cursor });
    rows.push(...result.incidents);
    if (!result.nextCursor) return rows;
    expect(cursors.has(result.nextCursor), "Alert cursor must make progress").toBe(false);
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error("Alert listing did not terminate within the fixture bound");
}

async function audit(action: string, targetId?: string) {
  return conn.db
    .select()
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.action, action),
        targetId ? eq(schema.auditEvents.targetId, targetId) : undefined,
      ),
    )
    .orderBy(schema.auditEvents.createdAt, schema.auditEvents.id);
}

async function businessSnapshot() {
  return Promise.all([
    conn.db.select().from(schema.commerceCustomers).orderBy(schema.commerceCustomers.userId),
    conn.db.select().from(schema.commerceProducts).orderBy(schema.commerceProducts.id),
    conn.db.select().from(schema.commerceOrders).orderBy(schema.commerceOrders.id),
    conn.db.select().from(schema.commerceOrderItems).orderBy(schema.commerceOrderItems.id),
    conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    conn.db.select().from(schema.commerceCommissions).orderBy(schema.commerceCommissions.id),
    conn.db.select().from(schema.commerceWithdrawals).orderBy(schema.commerceWithdrawals.id),
    conn.db
      .select()
      .from(schema.commercePaymentAttempts)
      .orderBy(schema.commercePaymentAttempts.id),
    conn.db
      .select()
      .from(schema.commerceProviderRefunds)
      .orderBy(schema.commerceProviderRefunds.id),
    conn.db.select().from(schema.commercePaymentEvents).orderBy(schema.commercePaymentEvents.id),
    conn.db
      .select()
      .from(schema.commerceExternalRefunds)
      .orderBy(schema.commerceExternalRefunds.id),
    conn.db
      .select()
      .from(schema.commerceExternalRefundAllocations)
      .orderBy(
        schema.commerceExternalRefundAllocations.externalRefundId,
        schema.commerceExternalRefundAllocations.itemId,
      ),
    conn.db.select().from(schema.commerceOperations).orderBy(schema.commerceOperations.id),
  ]);
}

function faultDatabase(mode: "candidate_query" | "audit") {
  return new Proxy(conn.db, {
    get(target, property, receiver) {
      if (property === "transaction")
        return (callback: (tx: CommerceTransaction) => Promise<unknown>, options: unknown) =>
          Reflect.apply(target.transaction, target, [
            (tx: CommerceTransaction) =>
              callback(
                new Proxy(tx, {
                  get(inner, method, innerReceiver) {
                    if (method === "execute")
                      return (...args: unknown[]) => {
                        const statement = new PgDialect().sqlToQuery(args[0] as SQL).sql;
                        if (mode === "candidate_query" && statement.includes("with candidates as"))
                          throw new Error("Injected candidate query failure");
                        if (
                          mode === "audit" &&
                          statement.includes("'commerce.alert.scan_complete'")
                        )
                          throw new Error("Injected final scan audit failure");
                        return Reflect.apply(inner.execute, inner, args);
                      };
                    return Reflect.get(inner, method, innerReceiver);
                  },
                }),
              ),
            options,
          ]);
      return Reflect.get(target, property, receiver);
    },
  });
}

beforeAll(async () => {
  await conn.db.execute(sql`select 1 from commerce_alert_incidents limit 1`);
});
beforeEach(() => advance(20 * day));
afterEach(async () => {
  vi.restoreAllMocks();
  if (tracked.payments.length)
    await conn.db
      .update(schema.commercePaymentAttempts)
      .set({ status: "paid" })
      .where(inArray(schema.commercePaymentAttempts.id, tracked.payments.splice(0)));
  if (tracked.refunds.length)
    await conn.db
      .update(schema.commerceProviderRefunds)
      .set({ status: "failed" })
      .where(inArray(schema.commerceProviderRefunds.id, tracked.refunds.splice(0)));
  if (tracked.events.length)
    await conn.db
      .update(schema.commercePaymentEvents)
      .set({ processedAt: now, outcome: "ignored" })
      .where(inArray(schema.commercePaymentEvents.id, tracked.events.splice(0)));
  if (tracked.externals.length)
    await conn.db
      .update(schema.commerceExternalRefunds)
      .set({
        allocationState: "excluded_owned",
        version: sql`${schema.commerceExternalRefunds.version}+1`,
      })
      .where(inArray(schema.commerceExternalRefunds.id, tracked.externals.splice(0)));
  if (tracked.withdrawals.length)
    await conn.db
      .update(schema.commerceWithdrawals)
      .set({ status: "rejected" })
      .where(inArray(schema.commerceWithdrawals.id, tracked.withdrawals.splice(0)));
});
afterAll(() => conn.close());

describe("durable commerce operational alerts", () => {
  it("requires continuous observation, ignores normal open sessions, and keeps unknown-state retries on one clock", async () => {
    const f = await fixture(),
      normal = await fixture("open");
    const initial = now.toISOString();
    await monitor().scan();
    expect(await incidents(f.attempt.id)).toMatchObject([
      { state: "pending", firstDetectedAt: new Date(initial), openedAt: null },
    ]);
    expect(await incidents(normal.attempt.id)).toHaveLength(0);
    expect((await allListed()).some((row) => row.resourceId === f.attempt.id)).toBe(false);
    advance(14 * minute);
    await conn.db
      .update(schema.commercePaymentAttempts)
      .set({ status: "cancel_requested", updatedAt: now })
      .where(eq(schema.commercePaymentAttempts.id, f.attempt.id));
    await monitor().scan();
    expect((await incidents(f.attempt.id))[0]!.state).toBe("pending");
    advance(minute - 1);
    await monitor().scan();
    expect((await incidents(f.attempt.id))[0]!.state).toBe("pending");
    advance(1);
    const scan = await monitor().scan();
    const [opened] = await incidents(f.attempt.id);
    expect(opened).toMatchObject({
      kind: "payment_unresolved",
      resourceType: "payment_attempt",
      orderId: f.order.id,
      sourceStatus: "cancel_requested",
      state: "open",
      firstDetectedAt: new Date(initial),
      openedAt: now,
    });
    expect(scan.scannedAt).toBe(timestamp());
    expect((await monitor().list()).monitor).toMatchObject({
      status: "healthy",
      lastSuccessfulScanAt: timestamp(),
    });
    await monitor().scan();
    expect(await incidents(f.attempt.id)).toHaveLength(1);
    expect(await audit("commerce.alert.opened", opened!.id)).toHaveLength(1);
    expect(await audit("commerce.alert.opened", opened!.id)).toMatchObject([
      {
        actorType: "system",
        actorId: "worker:commerce-alerts",
        targetType: "commerce_alert",
        after: { kind: "payment_unresolved", resourceId: f.attempt.id, orderId: f.order.id },
      },
    ]);
    expect(await audit("commerce.alert.scan_complete", "singleton")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetType: "commerce_alert_scan", after: scan, createdAt: now }),
      ]),
    );
  });

  it("resolves exactly once and records a new incident rather than overwriting history when the condition recurs", async () => {
    const f = await fixture("requires_review");
    await monitor().scan();
    advance(5 * minute);
    await monitor().scan();
    const original = (await incidents(f.attempt.id))[0]!;
    await conn.db
      .update(schema.commercePaymentAttempts)
      .set({ status: "paid" })
      .where(eq(schema.commercePaymentAttempts.id, f.attempt.id));
    advance(minute);
    await monitor().scan();
    await monitor().scan();
    expect(await incidents(f.attempt.id)).toMatchObject([
      { id: original.id, state: "resolved", resolvedAt: now },
    ]);
    expect(await audit("commerce.alert.resolved", original.id)).toHaveLength(1);
    expect((await allListed("resolved")).some((row) => row.id === original.id)).toBe(true);
    await conn.db
      .update(schema.commercePaymentAttempts)
      .set({ status: "requires_review", updatedAt: now })
      .where(eq(schema.commercePaymentAttempts.id, f.attempt.id));
    await monitor().scan();
    expect(await incidents(f.attempt.id)).toHaveLength(2);
    advance(5 * minute);
    await monitor().scan();
    const history = await incidents(f.attempt.id);
    expect(history[0]).toMatchObject({ id: original.id, state: "resolved" });
    expect(history[1]).toMatchObject({
      state: "open",
      firstDetectedAt: new Date(now.getTime() - 5 * minute),
    });
    expect(history[1]!.id).not.toBe(original.id);
    expect(await audit("commerce.alert.opened", history[1]!.id)).toHaveLength(1);
  });

  it.each([
    ["unknown", "refund_unresolved", 15 * minute],
    ["requires_review", "refund_review", 5 * minute],
    ["pending", "refund_pending", day],
  ] as const)(
    "observes refund %s for its engineering window without treating it as permission to pay",
    async (status, kind, window) => {
      const f = await fixture("paid");
      const source = await refund(f, status);
      const before = await businessSnapshot();
      await monitor().scan();
      advance(window - 1);
      await monitor().scan();
      expect((await incidents(source.id))[0]!.state).toBe("pending");
      advance(1);
      await monitor().scan();
      expect(await incidents(source.id)).toMatchObject([
        { state: "open", kind, sourceStatus: status },
      ]);
      expect(await businessSnapshot()).toEqual(before);
    },
  );

  it.each([
    ["requested", 8 * day],
    ["approved", 2 * day],
  ] as const)(
    "observes withdrawal %s without making a contractual-overdue or payout decision",
    async (status, window) => {
      const f = await fixture("paid");
      const [source] = await conn.db
        .insert(schema.commerceWithdrawals)
        .values({
          userId: f.userId,
          amountCents: 2000,
          status,
          approvedBy: status === "approved" ? key() : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      tracked.withdrawals.push(source!.id);
      await monitor().scan();
      advance(window - 1);
      await monitor().scan();
      expect((await incidents(source!.id))[0]!.state).toBe("pending");
      advance(1);
      await monitor().scan();
      expect(await incidents(source!.id)).toMatchObject([
        {
          kind: `withdrawal_${status}`,
          state: "open",
          orderId: null,
        },
      ]);
      expect(
        (
          await conn.db
            .select()
            .from(schema.commerceWithdrawals)
            .where(eq(schema.commerceWithdrawals.id, source!.id))
        )[0],
      ).toEqual(source);

      // Unlike mutable unknown states, persisted withdrawal milestone dates are trustworthy at cold start.
      const old = await fixture("paid");
      const milestone = new Date(now.getTime() - window);
      const [late] = await conn.db
        .insert(schema.commerceWithdrawals)
        .values({
          userId: old.userId,
          amountCents: 2000,
          status,
          approvedBy: status === "approved" ? key() : null,
          createdAt: status === "requested" ? milestone : new Date(milestone.getTime() - day),
          updatedAt: status === "approved" ? milestone : now,
        })
        .returning();
      tracked.withdrawals.push(late!.id);
      await monitor().scan();
      expect(await incidents(late!.id)).toMatchObject([
        {
          kind: `withdrawal_${status}`,
          state: "open",
          openedAt: now,
        },
      ]);
    },
  );

  it.each(["payment_pending", "payment_unknown"] as const)(
    "keeps %s unresolved in its own database without rejecting it for fixture cleanup",
    async (status) => {
      const scoped = await isolatedCommerceTestDatabase();
      let observedAt = new Date("2030-01-01T00:00:00Z");
      const watcher = new CommerceAlertsService(scoped.db, {
        enabled: true,
        environment: "test",
        now: () => observedAt,
      });
      const seed = async (started: Date) => {
        const userId = key();
        await scoped.db.insert(schema.commerceCustomers).values({ userId, referralCode: key() });
        const [requested] = await scoped.db
          .insert(schema.commerceWithdrawals)
          .values({
            userId,
            amountCents: 2000,
            status: "requested",
            createdAt: started,
            updatedAt: started,
          })
          .returning();
        await scoped.db
          .update(schema.commerceWithdrawals)
          .set({ status: "approved", approvedBy: key() })
          .where(eq(schema.commerceWithdrawals.id, requested!.id));
        await scoped.db
          .update(schema.commerceWithdrawals)
          .set({
            status: "payment_pending",
            paymentOperationId: key(),
            paymentStartedBy: key(),
            paymentStartedAt: started,
          })
          .where(eq(schema.commerceWithdrawals.id, requested!.id));
        if (status === "payment_unknown")
          await scoped.db
            .update(schema.commerceWithdrawals)
            .set({ status, paymentUnknownAt: started })
            .where(eq(schema.commerceWithdrawals.id, requested!.id));
        const [row] = await scoped.db
          .select()
          .from(schema.commerceWithdrawals)
          .where(eq(schema.commerceWithdrawals.id, requested!.id));
        const eventKey = `manual-alert-fixture:${key()}`;
        await scoped.db.insert(schema.commerceLedger).values([
          {
            eventKey,
            line: 0,
            ownerId: userId,
            account: "frozen",
            amountCents: 2000,
            resourceId: row!.id,
          },
          {
            eventKey,
            line: 1,
            ownerId: "platform",
            account: "commission_cost_test",
            amountCents: -2000,
            resourceId: row!.id,
          },
        ]);
        return row!;
      };
      const incident = async (id: string) =>
        (
          await scoped.db
            .select()
            .from(schema.commerceAlertIncidents)
            .where(eq(schema.commerceAlertIncidents.resourceId, id))
        )[0]!;
      try {
        const source = await seed(observedAt);
        const moneyBefore = await scoped.db
          .select()
          .from(schema.commerceLedger)
          .orderBy(schema.commerceLedger.id);
        await watcher.scan();
        expect((await incident(source.id)).state).toBe("pending");
        observedAt = new Date(observedAt.getTime() + 2 * day);
        await watcher.scan();
        const opened = await incident(source.id);
        expect(opened).toMatchObject({
          kind: "withdrawal_approved",
          state: "open",
          sourceStatus: status,
        });
        expect(
          (
            await scoped.db
              .select()
              .from(schema.commerceWithdrawals)
              .where(eq(schema.commerceWithdrawals.id, source.id))
          )[0],
        ).toEqual(source);
        expect(
          await scoped.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
        ).toEqual(moneyBefore);
        if (status === "payment_pending") {
          await scoped.db
            .update(schema.commerceWithdrawals)
            .set({ status: "payment_unknown", paymentUnknownAt: observedAt, updatedAt: observedAt })
            .where(eq(schema.commerceWithdrawals.id, source.id));
          await watcher.scan();
          expect(await incident(source.id)).toMatchObject({
            id: opened.id,
            state: "open",
            sourceStatus: "payment_unknown",
          });
        }
        const late = await seed(new Date(observedAt.getTime() - 2 * day));
        await watcher.scan();
        expect(await incident(late.id)).toMatchObject({
          state: "open",
          kind: "withdrawal_approved",
          openedAt: observedAt,
          sourceStatus: status,
        });
        // No terminal business mutation or deletion: only the owned synthetic database is closed.
      } finally {
        await scoped.close();
      }
    },
  );

  it("keeps independent reasons for the same order and finds more than one page of candidates without business mutations or network calls", async () => {
    const f = await fixture("requires_review");
    const unknown = await refund(f, "unknown"),
      unknownEvent = await event(),
      outside = await external(f);
    const orders = await conn.db
      .insert(schema.commerceOrders)
      .values(
        Array.from({ length: 105 }, () => ({
          userId: f.userId,
          status: "awaiting_payment" as const,
          paymentProvider: "stripe_test" as const,
          totalCents: 100,
          address,
          expiresAt: now,
        })),
      )
      .returning();
    const attempts = await conn.db
      .insert(schema.commercePaymentAttempts)
      .values(
        orders.map((order) => ({
          orderId: order.id,
          requestKey: key(),
          amountCents: 100,
          status: "unknown" as const,
          expiresAt: now,
        })),
      )
      .returning();
    tracked.payments.push(...attempts.map((row) => row.id));
    // Persist monetary fixtures so unchanged snapshots prove more than empty financial tables.
    const finances = await fixture("paid");
    const recipientId = key();
    await conn.db
      .insert(schema.commerceCustomers)
      .values({ userId: recipientId, referralCode: key() });
    await conn.db
      .update(schema.commerceOrderItems)
      .set({ status: "delivered", deliveredAt: new Date(now.getTime() - 35 * day) })
      .where(eq(schema.commerceOrderItems.id, finances.item.id));
    await conn.db
      .insert(schema.commerceCommissions)
      .values({ orderItemId: finances.item.id, userId: recipientId, amountCents: 1000 });
    await conn.db.insert(schema.commerceLedger).values([
      {
        eventKey: `alert-fixture:${finances.order.id}`,
        resourceId: finances.order.id,
        line: 0,
        ownerId: recipientId,
        account: "pending",
        amountCents: 1000,
      },
      {
        eventKey: `alert-fixture:${finances.order.id}`,
        resourceId: finances.order.id,
        line: 1,
        ownerId: finances.userId,
        account: "frozen",
        amountCents: 2000,
      },
      {
        eventKey: `alert-fixture:${finances.order.id}`,
        resourceId: finances.order.id,
        line: 2,
        ownerId: "platform",
        account: "alert_fixture_offset",
        amountCents: -3000,
      },
    ]);
    const [withdrawal] = await conn.db
      .insert(schema.commerceWithdrawals)
      .values({
        userId: finances.userId,
        amountCents: 2000,
        status: "approved",
        approvedBy: key(),
        updatedAt: new Date(now.getTime() - 2 * day),
      })
      .returning();
    tracked.withdrawals.push(withdrawal!.id);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Alert scanning must not use HTTP"));
    const before = await businessSnapshot();
    await monitor().scan();
    advance(15 * minute);
    await monitor().scan();
    const listed = await allListed();
    for (const attempt of attempts)
      expect(
        listed.some((row) => row.kind === "payment_unresolved" && row.resourceId === attempt.id),
      ).toBe(true);
    expect(new Set(listed.map((row) => row.id)).size).toBe(listed.length);
    for (const [resourceId, kind] of [
      [f.attempt.id, "payment_review"],
      [unknown.id, "refund_unresolved"],
      [unknownEvent.id, "event_unprocessed"],
      [outside.id, "external_refund_unresolved"],
    ])
      expect(listed.some((row) => row.resourceId === resourceId && row.kind === kind)).toBe(true);
    expect(await businessSnapshot()).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
    expect((await monitor().list()).externalDelivery).toMatchObject({
      enabled: false,
      configuration: "disabled",
      mode: "mock",
    });
    await conn.db
      .update(schema.commercePaymentAttempts)
      .set({ status: "paid" })
      .where(eq(schema.commercePaymentAttempts.id, f.attempt.id));
    const afterExplicitRecovery = await businessSnapshot();
    await monitor().scan();
    expect((await incidents(f.attempt.id))[0]!.state).toBe("resolved");
    for (const id of [unknown.id, unknownEvent.id, outside.id])
      expect((await incidents(id))[0]!.state).toBe("open");
    expect(await businessSnapshot()).toEqual(afterExplicitRecovery);
  });

  it.each(["candidate_query", "audit"] as const)(
    "rolls back %s failure without false recovery or advancing last successful scan",
    async (mode) => {
      const f = await fixture("requires_review");
      await monitor().scan();
      advance(5 * minute);
      await monitor().scan();
      const before = await incidents(f.attempt.id);
      const completed = await audit("commerce.alert.scan_complete", "singleton");
      const lastSuccess = (await monitor().list()).monitor.lastSuccessfulScanAt;
      await conn.db
        .update(schema.commercePaymentAttempts)
        .set({ status: "paid" })
        .where(eq(schema.commercePaymentAttempts.id, f.attempt.id));
      const other = await fixture("unknown");
      advance(16 * minute);
      await expect(monitor(faultDatabase(mode)).scan()).rejects.toMatchObject({
        status: 503,
        code: "commerce_alert_scan_failed",
      });
      expect(await incidents(f.attempt.id)).toEqual(before);
      expect(await incidents(other.attempt.id)).toHaveLength(0);
      expect(await audit("commerce.alert.scan_complete", "singleton")).toEqual(completed);
      expect((await monitor().list()).monitor).toMatchObject({
        status: "stale",
        lastSuccessfulScanAt: lastSuccess,
      });
      await monitor().scan();
      expect((await incidents(f.attempt.id))[0]!.state).toBe("resolved");
      expect((await incidents(other.attempt.id))[0]!.state).toBe("pending");
      expect((await monitor().list()).monitor).toMatchObject({
        status: "healthy",
        lastSuccessfulScanAt: timestamp(),
      });
    },
  );

  it("disabled scans do not touch the database, call HTTP, or invent successful zero counts", async () => {
    const access = vi.fn(() => {
      throw new Error("Disabled scanner accessed its database");
    });
    const db = new Proxy({} as DjlDatabase, { get: access });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Disabled scanner used HTTP"));
    expect(await monitor(db, false).scan()).toEqual({
      enabled: false,
      skipped: true,
      opened: null,
      resolved: null,
      pending: null,
      open: null,
      scannedAt: null,
    });
    expect(access).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("transitions unprocessed events to unmapped-review follow-up and resolves each only when its own condition clears", async () => {
    const source = await event();
    await monitor().scan();
    advance(5 * minute);
    await monitor().scan();
    await conn.db
      .update(schema.commercePaymentEvents)
      .set({ processedAt: now, outcome: "requires_review" })
      .where(eq(schema.commercePaymentEvents.id, source.id));
    await monitor().scan();
    expect(await incidents(source.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "event_unprocessed", state: "resolved" }),
        expect.objectContaining({ kind: "event_review_unmapped", state: "pending" }),
      ]),
    );
    advance(5 * minute);
    await monitor().scan();
    expect(
      (await incidents(source.id)).find((row) => row.kind === "event_review_unmapped")!.state,
    ).toBe("open");
    const f = await fixture("paid");
    await external(f, source.objectId);
    await monitor().scan();
    expect((await incidents(source.id)).every((row) => row.state === "resolved")).toBe(true);
    advance(5 * minute);
    await monitor().scan();
    expect((await allListed()).some((row) => row.resourceId === source.id)).toBe(false);
    expect(
      (await allListed()).some(
        (row) => row.orderId === f.order.id && row.kind === "external_refund_unresolved",
      ),
    ).toBe(true);
  });

  it.each(["checkout", "owned_refund"] as const)(
    "does not leave processed review events permanently unmapped after a %s identity is known",
    async (mapping) => {
      const objectId = externalId(mapping === "checkout" ? "cs_test_" : "re_");
      const source = await event(true, objectId);
      await monitor().scan();
      advance(5 * minute);
      await monitor().scan();
      expect((await incidents(source.id))[0]!.state).toBe("open");
      const f = await fixture("paid", mapping === "checkout" ? objectId : undefined);
      if (mapping === "owned_refund") await refund(f, "succeeded", objectId);
      await monitor().scan();
      expect(await incidents(source.id)).toMatchObject([{ state: "resolved" }]);
      await monitor().scan();
      expect(await incidents(source.id)).toHaveLength(1);
    },
  );

  it.skipIf(process.env.COMMERCE_TEST_PGLITE === "true")(
    "deduplicates across real PostgreSQL connections and skips a held scan lock without recording success",
    async () => {
      const f = await fixture("requires_review");
      await monitor().scan();
      advance(5 * minute);
      const before = await incidents(f.attempt.id);
      const completed = await audit("commerce.alert.scan_complete", "singleton");
      await conn.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(17473,2)`);
        expect(await monitor().scan()).toMatchObject({
          enabled: true,
          skipped: true,
          opened: null,
          resolved: null,
          pending: null,
          open: null,
          scannedAt: null,
        });
      });
      expect(await incidents(f.attempt.id)).toEqual(before);
      expect(await audit("commerce.alert.scan_complete", "singleton")).toEqual(completed);
      const attempts = await Promise.all([monitor().scan(), monitor().scan()]);
      expect(attempts.some((result) => !result.skipped)).toBe(true);
      const [opened] = await incidents(f.attempt.id);
      expect(opened!.state).toBe("open");
      expect(await incidents(f.attempt.id)).toHaveLength(1);
      expect(await audit("commerce.alert.opened", opened!.id)).toHaveLength(1);
    },
  );
});
