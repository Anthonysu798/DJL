/** Real PostgreSQL integration suite. CI supplies the migrated DATABASE_URL. */
import { and, eq, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import {
  CommerceService,
  type CommerceActor,
  type CommerceTransaction,
} from "./CommerceService.ts";

const conn = await isolatedCommerceTestDatabase();
let now = new Date("2026-10-01T00:00:00Z");
const service = new CommerceService(conn.db, { mode: "test", environment: "test", now: () => now });
const admin: CommerceActor = { id: crypto.randomUUID(), type: "admin", traceId: "commerce-test" };
const recorder: CommerceActor = { ...admin, id: crypto.randomUUID() };
const address = {
  name: "Test Buyer",
  line1: "100 Test Street",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA",
};
const key = () => crypto.randomUUID();

async function user(): Promise<CommerceActor> {
  const id = crypto.randomUUID();
  await conn.db
    .insert(schema.user)
    .values({ id, name: "Commerce test", email: `${id}@test.invalid`, emailVerified: true });
  await service.profile(id);
  return { id, type: "user", traceId: "commerce-test" };
}
async function fixture(overrides: Record<string, unknown> = {}) {
  now = new Date("2026-10-01T00:00:00Z");
  const supplierUser = await user();
  const { supplier } = await service.createSupplier(admin, {
    name: "CA test supplier",
    returnAddress: "Toronto, ON, Canada",
    reason: "Test-only administrator supplier creation approved",
    idempotencyKey: crypto.randomUUID(),
  });
  await service.addSupplierMember(
    admin,
    supplier.id,
    supplierUser.id,
    "Test-only administrator supplier access approved",
  );
  const { product } = await service.saveProduct(admin, {
    supplierId: supplier.id,
    sku: key(),
    name: "Test tote",
    description: "Cotton tote",
    category: "Bags",
    imageUrl: "/shop/media/test-tote.png",
    priceCents: 10000,
    costCents: 4000,
    commissionBps: 1000,
    returnDays: 30,
    stock: 20,
    status: "published",
    ...overrides,
    reason: "Test-only administrator checked supplier quote and approved catalog change",
  });
  return { supplier, supplierUser, product };
}
async function pay(buyer: CommerceActor, productId: string, quantity = 1) {
  const { order } = await service.createOrder(buyer, {
    items: [{ productId, quantity }],
    address,
    idempotencyKey: key(),
  });
  return (await service.testPay(buyer, order.id, key())).order;
}
async function closeReviewedCase(orderId: string, itemId: string, reason: string) {
  const { order } = await service.adminOrder(orderId);
  const item = order.items.find(({ id }) => id === itemId);
  expect(item).toMatchObject({
    openCase: true,
    caseRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  return service.setOpenCase(admin, itemId, false, reason, item!.caseRevision);
}
async function deliver(f: Awaited<ReturnType<typeof fixture>>, itemId: string) {
  await service.accept(f.supplierUser, itemId);
  await service.ship(f.supplierUser, itemId, { carrier: "Test courier", trackingNumber: key() });
  await service.deliver(admin, itemId, "Test-only operator reviewed delivery evidence");
}

/** Historical SQL fixtures preserve actual immutable journals and real snapshot references. */
async function historicalSupplierCost(
  f: Awaited<ReturnType<typeof fixture>>,
  buyer: CommerceActor,
  cost: number,
  at: string,
) {
  const [order] = await conn.db
    .insert(schema.commerceOrders)
    .values({
      userId: buyer.id,
      status: "paid",
      totalCents: cost * 10,
      address: address as typeof schema.commerceOrders.$inferInsert.address,
      expiresAt: new Date(at),
      paidAt: new Date(at),
      createdAt: new Date(at),
    })
    .returning();
  const [item] = await conn.db
    .insert(schema.commerceOrderItems)
    .values({
      orderId: order!.id,
      productId: f.product.id,
      supplierId: f.supplier.id,
      sku: f.product.sku,
      name: f.product.name,
      quantity: 1,
      priceCents: cost * 10,
      costCents: cost,
      lineCents: cost * 10,
      commissionBps: 0,
      returnDays: 30,
    })
    .returning();
  await conn.db.insert(schema.commerceLedger).values([
    {
      eventKey: `paid:${order!.id}`,
      resourceId: order!.id,
      line: 0,
      ownerId: f.supplier.id,
      account: "supplier_payable",
      amountCents: cost,
      createdAt: sql`${at}::timestamptz`,
    },
    {
      eventKey: `paid:${order!.id}`,
      resourceId: order!.id,
      line: 1,
      ownerId: "platform",
      account: "goods_cost_test",
      amountCents: -cost,
      createdAt: sql`${at}::timestamptz`,
    },
  ]);
  return { order: order!, item: item! };
}

async function historicalSupplierRefund(
  f: Awaited<ReturnType<typeof fixture>>,
  paid: Awaited<ReturnType<typeof historicalSupplierCost>>,
  goods: number,
  at: string,
) {
  const remainingCost = Number(
    (BigInt(paid.item.lineCents - goods) * BigInt(paid.item.costCents)) /
      BigInt(paid.item.priceCents),
  );
  const reversed = paid.item.costCents - remainingCost;
  await conn.db.transaction(async (tx) => {
    await tx
      .update(schema.commerceOrderItems)
      .set({ refundedCents: goods })
      .where(eq(schema.commerceOrderItems.id, paid.item.id));
    await tx
      .update(schema.commerceOrders)
      .set({ refundedCents: goods })
      .where(eq(schema.commerceOrders.id, paid.order.id));
    await tx.insert(schema.commerceLedger).values([
      {
        eventKey: `refund:${paid.item.id}:${goods}`,
        resourceId: paid.item.id,
        line: 0,
        ownerId: f.supplier.id,
        account: "supplier_payable",
        amountCents: -reversed,
        createdAt: sql`${at}::timestamptz`,
      },
      {
        eventKey: `refund:${paid.item.id}:${goods}`,
        resourceId: paid.item.id,
        line: 1,
        ownerId: "platform",
        account: "goods_cost_test",
        amountCents: reversed,
        createdAt: sql`${at}::timestamptz`,
      },
    ]);
  });
}

async function supplierReadSnapshot(f: Awaited<ReturnType<typeof fixture>>, buyer: CommerceActor) {
  return Promise.all([
    conn.db
      .select()
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.supplierId, f.supplier.id))
      .orderBy(schema.commerceProducts.id),
    conn.db
      .select()
      .from(schema.commerceOrders)
      .where(eq(schema.commerceOrders.userId, buyer.id))
      .orderBy(schema.commerceOrders.id),
    conn.db
      .select()
      .from(schema.commerceLedger)
      .where(eq(schema.commerceLedger.ownerId, f.supplier.id))
      .orderBy(schema.commerceLedger.id),
    conn.db
      .select({ id: schema.auditEvents.id })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.actorId, admin.id))
      .orderBy(schema.auditEvents.id),
    conn.db
      .select({ id: schema.commerceOperations.id })
      .from(schema.commerceOperations)
      .where(eq(schema.commerceOperations.actorId, buyer.id))
      .orderBy(schema.commerceOperations.id),
  ]);
}

beforeAll(async () => {
  await conn.db.execute(sql`select 1 from commerce_ledger limit 1`);
});
afterAll(() => conn.close());

describe("buyer safe aftersales receipt", () => {
  it("keeps keyed return retries from reopening a closed or cancelled case", async () => {
    const f = await fixture();
    const buyer = await user();
    const stranger = await user();
    const order = await pay(buyer, f.product.id);
    const other = await pay(buyer, f.product.id);
    const itemId = order.items[0]!.id;
    const intent = {
      request: { itemId, reason: "Buyer requests an inspection" },
      expectedUserId: buyer.id,
      idempotencyKey: key(),
    };
    const effects = async () => ({
      ledger: await conn.db
        .select()
        .from(schema.commerceLedger)
        .where(sql`${schema.commerceLedger.resourceId} in (${order.id}, ${itemId})`)
        .orderBy(schema.commerceLedger.id),
      inventory: await conn.db
        .select({
          stock: schema.commerceProducts.stock,
          reserved: schema.commerceProducts.reserved,
        })
        .from(schema.commerceProducts)
        .where(eq(schema.commerceProducts.id, f.product.id)),
    });
    const audit = async () =>
      await conn.db
        .select({ id: schema.auditEvents.id })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.action, "commerce.item.return-request"),
            eq(schema.auditEvents.targetId, itemId),
          ),
        );
    const before = await effects();
    await expect(service.requestReturn(buyer, order.id, intent)).resolves.toMatchObject({
      order: { items: [{ id: itemId, openCase: true, afterSalesStatus: "open" }] },
    });
    await closeReviewedCase(order.id, itemId, "Support investigation completed");
    await expect(
      service.requestReturn(buyer, order.id, {
        ...intent,
        request: { itemId, reason: `  ${intent.request.reason}  ` },
      }),
    ).resolves.toMatchObject({
      order: { items: [{ id: itemId, openCase: false, afterSalesStatus: "closed" }] },
    });
    expect(await audit()).toHaveLength(1);

    for (const [orderId, request] of [
      [order.id, { itemId, reason: "Changed explanation" }],
      [order.id, { ...intent.request, itemId: other.items[0]!.id }],
      [other.id, intent.request],
    ] as const) {
      await expect(
        service.requestReturn(buyer, orderId, { ...intent, request }),
      ).rejects.toMatchObject({
        status: 409,
        code: "idempotency_conflict",
      });
    }
    await expect(service.requestReturn(stranger, order.id, intent)).rejects.toMatchObject({
      status: 401,
      code: "commerce_account_changed",
    });
    await expect(
      service.requestReturn(stranger, order.id, { ...intent, expectedUserId: stranger.id }),
    ).rejects.toMatchObject({ status: 404, code: "order_not_found" });
    expect(await audit()).toHaveLength(1);

    // A genuinely new request can use the same description; both concurrent callers see one effect.
    const followup = { ...intent, idempotencyKey: key() };
    const concurrent = await Promise.all([
      service.requestReturn(buyer, order.id, followup),
      service.requestReturn(buyer, order.id, followup),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0].order.items[0]).toMatchObject({
      openCase: true,
      afterSalesStatus: "open",
    });
    expect(await audit()).toHaveLength(2);
    expect(await effects()).toEqual(before);

    await closeReviewedCase(order.id, itemId, "Follow-up completed before refund");
    await service.refund(admin, itemId, {
      refundTotalCents: order.totalCents,
      reason: "Synthetic full refund after case closure",
      idempotencyKey: key(),
    });
    const afterRefund = await effects();
    await expect(service.requestReturn(buyer, order.id, followup)).resolves.toMatchObject({
      order: {
        status: "refunded",
        items: [{ id: itemId, status: "cancelled", openCase: false, afterSalesStatus: "closed" }],
      },
    });
    await expect(
      service.requestReturn(buyer, order.id, { ...followup, idempotencyKey: key() }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(await audit()).toHaveLength(2);
    expect(await effects()).toEqual(afterRefund);
  });

  it("rejects mixed or incomplete return envelopes without falling through to legacy writes", async () => {
    const f = await fixture();
    const buyer = await user();
    const order = await pay(buyer, f.product.id);
    const request = { itemId: order.items[0]!.id, reason: "Legacy reason" };
    const envelope = { request, expectedUserId: buyer.id, idempotencyKey: key() };
    for (const invalid of [
      { ...envelope, ...request },
      { ...request, idempotencyKey: envelope.idempotencyKey },
      { ...request, expectedUserId: buyer.id },
      { request, idempotencyKey: envelope.idempotencyKey },
      { request, expectedUserId: buyer.id },
      { ...envelope, request: { ...request, extra: true } },
      { ...envelope, request: [request] },
      { ...envelope, idempotencyKey: null },
      { ...envelope, idempotencyKey: "ABCDEF01-2345-4678-8ABC-ABCDEF012345" },
      { ...envelope, idempotencyKey: `${envelope.idempotencyKey}\n` },
      { ...envelope, expectedUserId: `${buyer.id} ` },
    ]) {
      await expect(service.requestReturn(buyer, order.id, invalid)).rejects.toMatchObject({
        status: 400,
        code: "bad_request",
      });
    }
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]).toMatchObject({
      openCase: false,
      afterSalesStatus: "none",
    });
    await expect(service.requestReturn(buyer, order.id, request)).resolves.toMatchObject({
      order: { items: [{ openCase: true, afterSalesStatus: "open" }] },
    });
  });

  it("distinguishes no request, open, closed and reopened support without exposing private context or changing money", async () => {
    const f = await fixture(),
      buyer = await user();
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    const read = async () =>
      (await service.listOrders(buyer.id)).orders.find((entry) => entry.id === order.id)!.items[0]!;
    const ledgerBefore = await conn.db
      .select()
      .from(schema.commerceLedger)
      .where(sql`${schema.commerceLedger.resourceId} in (${order.id}, ${itemId})`)
      .orderBy(schema.commerceLedger.id);
    const stockBefore = await conn.db
      .select({ stock: schema.commerceProducts.stock, reserved: schema.commerceProducts.reserved })
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.id, f.product.id));
    expect(await read()).toMatchObject({ openCase: false, afterSalesStatus: "none" });
    await service.requestReturn(buyer, order.id, {
      itemId,
      reason: "Buyer-private support description",
    });
    expect(await read()).toMatchObject({ openCase: true, afterSalesStatus: "open" });
    await service.reportSupplierIssue(f.supplierUser, itemId, {
      kind: "delay",
      reason: "Supplier-private investigation notes",
      idempotencyKey: key(),
    });
    await closeReviewedCase(order.id, itemId, "Admin-private handling explanation");
    const closed = await read();
    expect(closed).toMatchObject({ openCase: false, afterSalesStatus: "closed", refundedCents: 0 });
    expect(closed).not.toHaveProperty("returnRequest");
    expect(closed).not.toHaveProperty("caseHandling");
    expect(JSON.stringify(closed)).not.toContain("Buyer-private support description");
    expect(JSON.stringify(closed)).not.toContain("Supplier-private investigation notes");
    expect(JSON.stringify(closed)).not.toContain("Admin-private handling explanation");
    expect(JSON.stringify(closed)).not.toContain(admin.id);
    await service.requestReturn(buyer, order.id, {
      itemId,
      reason: "New follow-up after the closure",
    });
    expect(await read()).toMatchObject({
      openCase: true,
      afterSalesStatus: "open",
      refundedCents: 0,
    });
    // A tied/late historical audit timestamp must not override the actual current open flag.
    await conn.db.insert(schema.auditEvents).values({
      actorType: "admin",
      actorId: admin.id,
      action: "commerce.item.case",
      targetType: "commerce",
      targetId: itemId,
      after: { open: false },
      reason: "Legacy closure record",
      createdAt: new Date("2099-01-01T00:00:00Z"),
    });
    expect(await read()).toMatchObject({ openCase: true, afterSalesStatus: "open" });
    expect(
      await conn.db
        .select()
        .from(schema.commerceLedger)
        .where(sql`${schema.commerceLedger.resourceId} in (${order.id}, ${itemId})`)
        .orderBy(schema.commerceLedger.id),
    ).toEqual(ledgerBefore);
    expect(
      await conn.db
        .select({
          stock: schema.commerceProducts.stock,
          reserved: schema.commerceProducts.reserved,
        })
        .from(schema.commerceProducts)
        .where(eq(schema.commerceProducts.id, f.product.id)),
    ).toEqual(stockBefore);
  });
  it("keeps legacy history unconfirmed until a valid administrator closure exists, without treating false as closure", async () => {
    const f = await fixture(),
      buyer = await user(),
      stranger = await user();
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    const read = async () =>
      (await service.listOrders(buyer.id)).orders.find((entry) => entry.id === order.id)!.items[0]!;
    await service.requestReturn(buyer, order.id, {
      itemId,
      reason: "Legacy request whose closure evidence is unavailable",
    });
    // Synthetic historical fixture only: old state cannot itself prove an operator closed the case.
    await conn.db
      .update(schema.commerceOrderItems)
      .set({ openCase: false })
      .where(eq(schema.commerceOrderItems.id, itemId));
    expect(await read()).toMatchObject({ openCase: false, afterSalesStatus: "unconfirmed" });
    await conn.db.insert(schema.auditEvents).values([
      {
        actorType: "user",
        actorId: buyer.id,
        action: "commerce.item.case",
        targetType: "commerce",
        targetId: itemId,
        after: { open: false },
      },
      {
        actorType: "admin",
        actorId: admin.id,
        action: "commerce.item.case",
        targetType: "commerce",
        targetId: itemId,
        after: { open: "false" },
      },
      {
        actorType: "admin",
        actorId: admin.id,
        action: "commerce.item.case",
        targetType: "commerce",
        targetId: itemId,
        after: {},
      },
    ]);
    expect(await read()).toMatchObject({ openCase: false, afterSalesStatus: "unconfirmed" });
    await service.setOpenCase(admin, itemId, true, "Review the previously unconfirmed case");
    await closeReviewedCase(
      order.id,
      itemId,
      "Actual operator closure recorded separately from money",
    );
    expect(await read()).toMatchObject({
      openCase: false,
      afterSalesStatus: "closed",
      refundedCents: 0,
    });
    expect((await service.listOrders(stranger.id)).orders).toHaveLength(0);
  });
});

describe("administrator support context", () => {
  it("refuses stale staff case revisions after same-open support and after reopening", async () => {
    const f = await fixture();
    const buyer = await user();
    const order = await pay(buyer, f.product.id);
    const itemId = order.items[0]!.id;
    const request = {
      expectedUserId: buyer.id,
      idempotencyKey: key(),
      request: { itemId, reason: "Synthetic buyer support evidence" },
    };
    const detail = async () => (await service.adminOrder(order.id)).order.items[0]!;
    const closeAudits = async () =>
      await conn.db
        .select({ id: schema.auditEvents.id })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.action, "commerce.item.case"),
            eq(schema.auditEvents.targetId, itemId),
          ),
        );
    await service.requestReturn(buyer, order.id, request);
    const initial = await detail();
    await service.requestReturn(buyer, order.id, request);
    expect((await detail()).caseRevision).toBe(initial.caseRevision);

    const supplierReport = {
      kind: "delay",
      reason: "Synthetic supplier support evidence",
      idempotencyKey: key(),
    };
    await service.reportSupplierIssue(f.supplierUser, itemId, supplierReport);
    const updated = await detail();
    expect(updated.openCase).toBe(true);
    await service.reportSupplierIssue(f.supplierUser, itemId, supplierReport);
    expect((await detail()).caseRevision).toBe(updated.caseRevision);
    const beforeClose = await supplierReadSnapshot(f, buyer);
    await expect(
      service.setOpenCase(
        admin,
        itemId,
        false,
        "Stale support review",
        initial.caseRevision ?? "a".repeat(64),
      ),
    ).rejects.toMatchObject({ status: 409, code: "commerce_case_review_stale" });
    expect(initial).toMatchObject({
      openCase: true,
      caseRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(updated.caseRevision).not.toBe(initial.caseRevision);
    expect(
      (await service.adminOrders()).orders.find((row) => row.id === order.id)?.items[0],
    ).toEqual(updated);
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]).not.toHaveProperty(
      "caseRevision",
    );
    expect((await service.supplierOrders(f.supplierUser.id)).orders[0]).not.toHaveProperty(
      "caseRevision",
    );
    expect(await detail()).toEqual(updated);
    expect(await closeAudits()).toHaveLength(0);
    expect(await supplierReadSnapshot(f, buyer)).toEqual(beforeClose);

    await service.setOpenCase(
      admin,
      itemId,
      false,
      "Reviewed both current support notes",
      updated.caseRevision,
    );
    expect((await detail()).openCase).toBe(false);
    await service.requestReturn(buyer, order.id, { ...request, idempotencyKey: key() });
    const reopened = await detail();
    expect(reopened.openCase).toBe(true);
    expect(reopened.caseRevision).not.toBe(updated.caseRevision);
    const reopenedBaseline = await supplierReadSnapshot(f, buyer);
    await expect(
      service.setOpenCase(
        admin,
        itemId,
        false,
        "Lost reply from the first close",
        updated.caseRevision,
      ),
    ).rejects.toMatchObject({ status: 409, code: "commerce_case_review_stale" });
    expect(await detail()).toEqual(reopened);
    expect(await closeAudits()).toHaveLength(1);
    expect(await supplierReadSnapshot(f, buyer)).toEqual(reopenedBaseline);
    await service.setOpenCase(
      admin,
      itemId,
      false,
      "Reviewed the second support round",
      reopened.caseRevision,
    );
    const closed = await detail();
    expect(closed.openCase).toBe(false);
    expect(await closeAudits()).toHaveLength(2);
    await expect(
      service.setOpenCase(admin, itemId, false, "An already closed case", closed.caseRevision),
    ).rejects.toMatchObject({ status: 409, code: "commerce_case_review_stale" });
    expect(await closeAudits()).toHaveLength(2);
  });

  it("fails closed for an unreviewed staff closure and keeps provider review holds", async () => {
    const f = await fixture();
    const buyer = await user();
    const order = await pay(buyer, f.product.id);
    const itemId = order.items[0]!.id;
    await service.setOpenCase(admin, itemId, true, "Legacy explicit open remains permitted");
    const before = await supplierReadSnapshot(f, buyer);
    await expect(
      service.setOpenCase(admin, itemId, false, "A page that did not review this case"),
    ).rejects.toMatchObject({ status: 409, code: "commerce_case_review_required" });
    await expect(
      service.setOpenCase(admin, itemId, false, "Malformed revision", "B".repeat(64)),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
    expect(await supplierReadSnapshot(f, buyer)).toEqual(before);
    const detail = (await service.adminOrder(order.id)).order.items[0]!;
    expect(detail.openCase).toBe(true);

    // Synthetic provider state only; no real provider calls or new ledger entries.
    await conn.db.insert(schema.commercePaymentAttempts).values({
      orderId: order.id,
      requestKey: key(),
      amountCents: order.totalCents,
      status: "requires_review",
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });
    const held = (await service.adminOrder(order.id)).order.items[0]!;
    expect(held.caseRevision).toBe(detail.caseRevision);
    await expect(
      service.setOpenCase(
        admin,
        itemId,
        false,
        "A matching token cannot lift a payment hold",
        held.caseRevision,
      ),
    ).rejects.toMatchObject({ status: 409, code: "commerce_refund_unresolved" });
    expect((await service.adminOrder(order.id)).order.items[0]).toEqual(held);
    expect(await supplierReadSnapshot(f, buyer)).toEqual(before);
  });

  it("invalidates a reviewed staff case after a same-value provider-style item row update", async () => {
    const f = await fixture();
    const buyer = await user();
    const order = await pay(buyer, f.product.id);
    const itemId = order.items[0]!.id;
    await service.requestReturn(buyer, order.id, { itemId, reason: "Synthetic buyer context" });
    const before = (await service.adminOrder(order.id)).order.items[0]!;
    // Provider review writers can set an already-true flag without adding an item-target audit row.
    await service.paymentTransaction((tx) =>
      tx
        .update(schema.commerceOrderItems)
        .set({ openCase: true })
        .where(eq(schema.commerceOrderItems.id, itemId)),
    );
    const current = (await service.adminOrder(order.id)).order.items[0]!;
    expect(current).toMatchObject({ openCase: true, returnRequest: before.returnRequest });
    const baseline = await supplierReadSnapshot(f, buyer);
    await expect(
      service.setOpenCase(
        admin,
        itemId,
        false,
        "Old view before provider review",
        before.caseRevision ?? "a".repeat(64),
      ),
    ).rejects.toMatchObject({ status: 409, code: "commerce_case_review_stale" });
    expect(current.caseRevision).not.toBe(before.caseRevision);
    expect((await service.adminOrder(order.id)).order.items[0]).toEqual(current);
    expect(await supplierReadSnapshot(f, buyer)).toEqual(baseline);
    const historicAudit = {
      actorType: "user",
      actorId: buyer.id,
      targetType: "commerce",
      targetId: itemId,
      after: { reason: "Synthetic historical import" },
      createdAt: new Date("2000-01-01T00:00:00Z"),
    };
    await conn.db
      .insert(schema.auditEvents)
      .values({ ...historicAudit, action: "unrelated.fixture" });
    expect((await service.adminOrder(order.id)).order.items[0]!.caseRevision).toBe(
      current.caseRevision,
    );
    await conn.db
      .insert(schema.auditEvents)
      .values({ ...historicAudit, action: "commerce.item.return-request" });
    const audited = (await service.adminOrder(order.id)).order.items[0]!;
    expect(audited.returnRequest).toEqual(current.returnRequest);
    expect(audited.caseRevision).not.toBe(current.caseRevision);
    await service.setOpenCase(
      admin,
      itemId,
      false,
      "Rechecked the current item",
      audited.caseRevision,
    );
    expect((await service.adminOrder(order.id)).order.items[0]!.openCase).toBe(false);
  });

  it("shows buyer requests and historical operator handling only in administrator orders", async () => {
    const f = await fixture(),
      buyer = await user(),
      stranger = await user();
    const order = await pay(buyer, f.product.id);
    const itemId = order.items[0]!.id;
    await service.reportSupplierIssue(f.supplierUser, itemId, {
      kind: "delay",
      reason: "Supplier follow-up",
      idempotencyKey: key(),
    });
    await service.requestReturn(buyer, order.id, {
      itemId,
      reason: "Buyer reports damaged packaging",
    });
    await closeReviewedCase(
      order.id,
      itemId,
      "  Reviewed packaging photographs; support resolved  ",
    );
    const detail = (await service.adminOrder(order.id)).order.items[0]!;
    expect(detail).toMatchObject({
      openCase: false,
      supplierIssue: { reason: "Supplier follow-up" },
      returnRequest: { reason: "Buyer reports damaged packaging", requestedAt: expect.any(String) },
      caseHandling: {
        open: false,
        reason: "Reviewed packaging photographs; support resolved",
        handledBy: admin.id,
        handledAt: expect.any(String),
      },
    });
    expect(
      (await service.adminOrders()).orders.find((entry) => entry.id === order.id)!.items[0],
    ).toEqual(detail);
    const audit = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, "commerce.item.case"),
          eq(schema.auditEvents.targetId, itemId),
        ),
      );
    expect(audit).toMatchObject([
      {
        actorType: "admin",
        actorId: admin.id,
        reason: "Reviewed packaging photographs; support resolved",
        after: { open: false, reason: "Reviewed packaging photographs; support resolved" },
      },
    ]);
    const publicItem = (await service.listOrders(buyer.id)).orders[0]!.items[0]!;
    const supplierItem = (await service.supplierOrders(f.supplierUser.id)).orders[0]!;
    for (const item of [publicItem, supplierItem]) {
      expect(item).not.toHaveProperty("returnRequest");
      expect(item).not.toHaveProperty("caseHandling");
    }
    expect((await service.listOrders(stranger.id)).orders).toHaveLength(0);
    await expect(
      service.requestReturn(stranger, order.id, { itemId, reason: "Foreign request" }),
    ).rejects.toMatchObject({ status: 404 });
    await service.requestReturn(buyer, order.id, {
      itemId,
      reason: "New follow-up after the old closure",
    });
    expect((await service.adminOrder(order.id)).order.items[0]).toMatchObject({
      openCase: true,
      returnRequest: { reason: "New follow-up after the old closure" },
      caseHandling: { open: false },
    });
    const context = (await service.adminOrder(order.id)).order.items[0]!;
    await service.refund(admin, itemId, {
      refundTotalCents: 10000,
      reason: "Test financial refund without support closure",
      idempotencyKey: key(),
    });
    expect((await service.adminOrder(order.id)).order.items[0]).toMatchObject({
      openCase: true,
      returnRequest: context.returnRequest,
      caseHandling: context.caseHandling,
      refundedCents: 10000,
    });
  });

  it("requires a bounded reason and administrator authority without mutating the case or money", async () => {
    const f = await fixture(),
      buyer = await user();
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    const before = await supplierReadSnapshot(f, buyer);
    for (const open of [false, true]) {
      for (const reason of [undefined, null, "", "   ", "x".repeat(501), 123])
        await expect(service.setOpenCase(admin, itemId, open, reason)).rejects.toMatchObject({
          status: 400,
        });
      for (const actor of [buyer, f.supplierUser, { ...admin, type: "system" as const }])
        await expect(
          service.setOpenCase(actor, itemId, open, "Unauthorized support change"),
        ).rejects.toMatchObject({ status: 403 });
    }
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]!.openCase).toBe(false);
    expect(await supplierReadSnapshot(f, buyer)).toEqual(before);
  });

  it("rolls back case state when the mandatory audit fails", async () => {
    const f = await fixture(),
      buyer = await user();
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    const db = new Proxy(conn.db, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (callback: (tx: CommerceTransaction) => Promise<unknown>, options: unknown) =>
            Reflect.apply(target.transaction, target, [
              (tx: CommerceTransaction) =>
                callback(
                  new Proxy(tx, {
                    get(inner, method, innerReceiver) {
                      if (method === "insert")
                        return (table: Parameters<typeof tx.insert>[0]) => {
                          if (table === schema.auditEvents)
                            throw new Error("Injected support audit failure");
                          return inner.insert(table);
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
    const failing = new CommerceService(db, service.options);
    const before = await supplierReadSnapshot(f, buyer);
    await expect(
      failing.setOpenCase(admin, itemId, true, "Must be audited atomically"),
    ).rejects.toHaveProperty("status");
    expect((await service.adminOrder(order.id)).order.items[0]).toMatchObject({
      openCase: false,
      caseHandling: null,
    });
    expect(await supplierReadSnapshot(f, buyer)).toEqual(before);
    await service.setOpenCase(admin, itemId, true, "Support remains open pending evidence");
    const opened = (await service.adminOrder(order.id)).order.items[0]!;
    const beforeClose = await supplierReadSnapshot(f, buyer);
    await expect(
      failing.setOpenCase(
        admin,
        itemId,
        false,
        "Closing also requires a durable audit",
        opened.caseRevision,
      ),
    ).rejects.toMatchObject({ status: 500, code: "commerce_write_failed" });
    expect((await service.adminOrder(order.id)).order.items[0]).toEqual(opened);
    expect(await supplierReadSnapshot(f, buyer)).toEqual(beforeClose);
  });

  it("selects the deterministic latest audit per action and keeps old missing explanations explicit", async () => {
    const f = await fixture(),
      buyer = await user();
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    const at = new Date("2099-01-01T00:00:00Z");
    await conn.db.insert(schema.auditEvents).values([
      {
        id: "10000000-0000-4000-8000-000000000001",
        actorType: "user",
        actorId: buyer.id,
        action: "commerce.item.return-request",
        targetType: "commerce",
        targetId: itemId,
        after: { reason: "Older request" },
        createdAt: at,
      },
      {
        id: "20000000-0000-4000-8000-000000000001",
        actorType: "user",
        actorId: buyer.id,
        action: "commerce.item.return-request",
        targetType: "commerce",
        targetId: itemId,
        after: { reason: "Latest tied request" },
        createdAt: at,
      },
      {
        actorType: "admin",
        actorId: admin.id,
        action: "commerce.item.case",
        targetType: "commerce",
        targetId: itemId,
        after: {
          open: false,
          handledBy: "untrusted-after-actor",
          handledAt: "untrusted-after-time",
        },
        createdAt: at,
      },
    ]);
    expect((await service.adminOrder(order.id)).order.items[0]).toMatchObject({
      openCase: false,
      returnRequest: { reason: "Latest tied request" },
      caseHandling: { open: false, reason: null, handledBy: admin.id, handledAt: at.toISOString() },
    });
  });
  it("batch-loads support histories for a whole administrator page without writing business or audit state", async () => {
    const f = await fixture(),
      buyer = await user();
    const orderIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const order = await pay(buyer, f.product.id);
      orderIds.push(order.id);
      await service.requestReturn(buyer, order.id, {
        itemId: order.items[0]!.id,
        reason: `Batch buyer request ${i}`,
      });
    }
    let auditBatches = 0;
    const db = new Proxy(conn.db, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (callback: (tx: CommerceTransaction) => Promise<unknown>, options: unknown) =>
            Reflect.apply(target.transaction, target, [
              (tx: CommerceTransaction) =>
                callback(
                  new Proxy(tx, {
                    get(inner, method, innerReceiver) {
                      if (method === "selectDistinctOn")
                        return (...args: Parameters<typeof tx.selectDistinctOn>) => {
                          auditBatches++;
                          return Reflect.apply(inner.selectDistinctOn, inner, args);
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
    const before = await supplierReadSnapshot(f, buyer);
    const response = await new CommerceService(db, service.options).adminOrders();
    expect(response.orders.filter((order) => orderIds.includes(order.id))).toHaveLength(3);
    for (const order of response.orders.filter((order) => orderIds.includes(order.id)))
      expect(order.items[0]!.returnRequest?.reason).toMatch(/^Batch buyer request [0-2]$/);
    expect(auditBatches).toBe(2); // One supplier-history query and one support-history query, not one per order.
    expect(await supplierReadSnapshot(f, buyer)).toEqual(before);
  });
});

describe("read-only supplier payable statements", () => {
  it("folds actual cost/refund journals and immutable multi-SKU snapshots instead of current catalog prices", async () => {
    const f = await fixture();
    const buyer = await user();
    const { product: other } = await service.saveProduct(admin, {
      supplierId: f.supplier.id,
      sku: key(),
      name: "Second original SKU",
      description: "Original cost fixture",
      category: "Bags",
      imageUrl: "/shop/media/other.png",
      priceCents: 7000,
      costCents: 2000,
      commissionBps: 0,
      returnDays: 30,
      stock: 20,
      status: "published",
      reason: "Test-only administrator checked supplier quote and approved catalog change",
    });
    const { order } = await service.createOrder(buyer, {
      items: [
        { productId: f.product.id, quantity: 1 },
        { productId: other.id, quantity: 2 },
      ],
      address,
      idempotencyKey: key(),
    });
    await service.saveProduct(
      admin,
      {
        priceCents: 20000,
        costCents: 8000,
        name: "Changed catalog name",
        sku: key(),
        reason: "Test-only administrator checked supplier quote and approved catalog change",
      },
      f.product.id,
    );
    await service.saveProduct(
      admin,
      {
        priceCents: 9000,
        costCents: 3000,
        sku: key(),
        reason: "Test-only administrator checked supplier quote and approved catalog change",
      },
      other.id,
    );
    const paid = (await service.testPay(buyer, order.id, key())).order;
    const first = paid.items.find((line) => line.productId === f.product.id)!;
    await service.refund(admin, first.id, {
      refundTotalCents: 2500,
      reason: "Supplier cost reversal fixture",
      idempotencyKey: key(),
    });
    const statement = await service.supplierStatement(f.supplierUser, f.supplier.id, {});
    expect(statement).toMatchObject({
      currency: "CAD",
      mode: "test",
      settlementAssessment: "not_assessed",
      totalRows: 2,
      page: 0,
      hasMore: false,
      summary: {
        openingCents: 0,
        accruedCents: 8000,
        reversedCents: 1000,
        unclassifiedCents: 0,
        closingCents: 7000,
        equationDifferenceCents: 0,
        reconciliationOk: true,
        hasUnresolvedRefunds: false,
      },
    });
    const accrual = statement.rows.find((row) => row.kind === "cost_accrual")!;
    expect(accrual).toMatchObject({ amountCents: 8000, orderId: order.id, orderItemId: null });
    expect(accrual.ledgerEntryIds).toHaveLength(2);
    expect(accrual.items).toHaveLength(2);
    expect(accrual.items.find((line) => line.itemId === first.id)).toMatchObject({
      sku: f.product.sku,
      name: f.product.name,
      quantity: 1,
      unitCostCents: 4000,
      totalCostCents: 4000,
    });
    expect(accrual.items.find((line) => line.itemId !== first.id)).toMatchObject({
      sku: other.sku,
      quantity: 2,
      unitCostCents: 2000,
      totalCostCents: 4000,
    });
    expect(statement.rows.find((row) => row.kind === "refund_reversal")).toMatchObject({
      amountCents: -1000,
      orderId: order.id,
      orderItemId: first.id,
    });
    expect(statement.rows.reduce((total, row) => total + row.amountCents, 0)).toBe(7000);
    expect(
      (await service.supplierStatement(admin, f.supplier.id, { to: statement.period.to })).summary,
    ).toEqual(statement.summary);

    // A statement read must not trigger catalog expiry or other business writes.
    await service.createOrder(buyer, {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    });
    now = new Date(now.getTime() + 31 * 60_000);
    const before = await supplierReadSnapshot(f, buyer);
    await service.supplierStatement(f.supplierUser, f.supplier.id, { to: statement.period.to });
    await service.supplierStatement(admin, f.supplier.id, { to: statement.period.to });
    expect(await supplierReadSnapshot(f, buyer)).toEqual(before);
  });

  it("uses exact UTC microsecond half-open boundaries and replayable database-generated cutoffs", async () => {
    const f = await fixture();
    const buyer = await user();
    const from = "2026-04-01T00:00:00.000500Z",
      to = "2026-04-02T00:00:00.000500Z";
    const opening = await historicalSupplierCost(f, buyer, 100, "2026-04-01T00:00:00.000499Z");
    await historicalSupplierCost(f, buyer, 20, from);
    await historicalSupplierRefund(f, opening, 100, "2026-04-02T00:00:00.000499Z");
    await historicalSupplierCost(f, buyer, 30, to);
    const period = await service.supplierStatement(f.supplierUser, f.supplier.id, { from, to });
    expect(period.period).toEqual({ from, to });
    expect(period.summary).toMatchObject({
      openingCents: 100,
      accruedCents: 20,
      reversedCents: 10,
      closingCents: 110,
      equationDifferenceCents: 0,
      reconciliationOk: true,
    });
    expect(period.rows).toHaveLength(2);
    expect(
      (
        await service.supplierStatement(admin, f.supplier.id, {
          from: to,
          to: "2026-04-03T00:00:00.000500Z",
        })
      ).summary,
    ).toMatchObject({ openingCents: 110, accruedCents: 30, reversedCents: 0, closingCents: 140 });
    const current = await service.supplierStatement(f.supplierUser, f.supplier.id, {});
    expect(current.period.to).toBe(current.generatedAt);
    expect(current.period.to).toMatch(/\.\d{6}Z$/);
    expect(
      (await service.supplierStatement(f.supplierUser, f.supplier.id, { to: current.period.to }))
        .summary,
    ).toEqual(current.summary);
    for (const invalid of [
      { from: to, to: from },
      { to: "2026-04-02" },
      { to: "2026-04-02T00:00:00+00:00" },
      { to: "2026-04-02T00:00:00.1234567Z" },
      { to: "not-a-date" },
    ]) {
      await expect(
        service.supplierStatement(f.supplierUser, f.supplier.id, invalid),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("isolates supplier identities and denies revoked/inactive members while retaining administrator history", async () => {
    const a = await fixture(),
      b = await fixture();
    const buyer = await user();
    const { order } = await service.createOrder(buyer, {
      items: [
        { productId: a.product.id, quantity: 1 },
        { productId: b.product.id, quantity: 1 },
      ],
      address,
      idempotencyKey: key(),
    });
    await service.testPay(buyer, order.id, key());
    const own = await service.supplierStatement(a.supplierUser, a.supplier.id, {});
    expect(own.summary.closingCents).toBe(4000);
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]!.items).toHaveLength(1);
    expect(own.rows.every((row) => row.items.every((item) => item.sku === a.product.sku))).toBe(
      true,
    );
    await expect(
      service.supplierStatement(a.supplierUser, b.supplier.id, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.supplierStatement(b.supplierUser, a.supplier.id, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.supplierStatement({ ...admin, type: "system" }, a.supplier.id, {}),
    ).rejects.toMatchObject({ status: 403 });
    await conn.db
      .update(schema.commerceSuppliers)
      .set({ active: false })
      .where(eq(schema.commerceSuppliers.id, a.supplier.id));
    await expect(
      service.supplierStatement(a.supplierUser, a.supplier.id, {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(await service.supplierStatement(admin, a.supplier.id, {})).toMatchObject({
      supplier: { id: a.supplier.id, active: false },
      summary: { closingCents: 4000 },
    });
    await conn.db
      .delete(schema.commerceSupplierMembers)
      .where(
        and(
          eq(schema.commerceSupplierMembers.userId, b.supplierUser.id),
          eq(schema.commerceSupplierMembers.supplierId, b.supplier.id),
        ),
      );
    await expect(
      service.supplierStatement(b.supplierUser, b.supplier.id, {}),
    ).rejects.toMatchObject({ status: 403 });
    expect((await service.supplierStatement(admin, b.supplier.id, {})).summary.closingCents).toBe(
      4000,
    );
  });

  it("keeps all-period totals independent from the 100-group page and exposes unclassified entries", async () => {
    const f = await fixture();
    const buyer = await user();
    for (let index = 0; index < 105; index++)
      await historicalSupplierCost(f, buyer, 20, "2026-04-01T12:00:00.000001Z");
    const first = await service.supplierStatement(f.supplierUser, f.supplier.id, {
      from: "2026-04-01T00:00:00Z",
      to: "2026-04-02T00:00:00Z",
      page: 0,
    });
    const second = await service.supplierStatement(f.supplierUser, f.supplier.id, {
      from: "2026-04-01T00:00:00Z",
      to: "2026-04-02T00:00:00Z",
      page: 1,
    });
    expect(first).toMatchObject({
      totalRows: 105,
      hasMore: true,
      pageSize: 100,
      summary: { accruedCents: 2100, closingCents: 2100, reconciliationOk: true },
    });
    expect(first.rows).toHaveLength(100);
    expect(second.rows).toHaveLength(5);
    expect(second.hasMore).toBe(false);
    expect(second.summary).toEqual(first.summary);
    expect(
      new Set([...first.rows, ...second.rows].map((row) => `${row.eventKey}:${row.resourceId}`))
        .size,
    ).toBe(105);
    const eventKey = `unrecognized:${key()}`,
      resourceId = key();
    await conn.db.insert(schema.commerceLedger).values([
      {
        eventKey,
        resourceId,
        line: 0,
        ownerId: f.supplier.id,
        account: "supplier_payable",
        amountCents: 7,
        createdAt: new Date("2026-04-01T13:00:00Z"),
      },
      {
        eventKey,
        resourceId,
        line: 1,
        ownerId: "platform",
        account: "test_offset",
        amountCents: -7,
        createdAt: new Date("2026-04-01T13:00:00Z"),
      },
    ]);
    const unknown = await service.supplierStatement(admin, f.supplier.id, {
      from: "2026-04-01T00:00:00Z",
      to: "2026-04-02T00:00:00Z",
    });
    expect(unknown.summary).toMatchObject({
      accruedCents: 2100,
      closingCents: 2107,
      unclassifiedCents: 7,
      unclassifiedEntries: 1,
      reconciliationOk: false,
    });
    const pages = [
      ...unknown.rows,
      ...(
        await service.supplierStatement(admin, f.supplier.id, {
          from: unknown.period.from!,
          to: unknown.period.to,
          page: 1,
        })
      ).rows,
    ];
    expect(pages.find((row) => row.eventKey === eventKey)).toMatchObject({
      kind: "unclassified",
      amountCents: 7,
      orderId: null,
      orderItemId: null,
      items: [],
    });
  });
});

describe("administrator attention and withdrawal filtering", () => {
  it("preserves an unresolved manual payment when a later refund creates commission recovery", async () => {
    const f = await fixture();
    const buyer = await user(),
      referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const order = await pay(buyer, f.product.id, 3);
    await deliver(f, order.items[0]!.id);
    now = new Date("2026-11-01T00:00:00Z");
    await service.releaseCommissions(admin, "Synthetic observation period ended");
    const { withdrawal } = await service.requestWithdrawal(referrer, key());
    await service.reviewWithdrawal(admin, withdrawal.id, "approve", {});
    const operationId = key(),
      reason = "Synthetic manual payout intent, no banking operation";
    await service.reviewWithdrawal(recorder, withdrawal.id, "start_payment", {
      operationId,
      reason,
    });
    await service.refund(admin, order.items[0]!.id, {
      refundTotalCents: 10000,
      reason,
      idempotencyKey: key(),
    });
    expect(await service.wallet(referrer.id)).toMatchObject({
      availableCents: 0,
      frozenCents: 3000,
      recoveryCents: 1000,
      paidCents: 0,
    });
    await service.reviewWithdrawal(recorder, withdrawal.id, "mark_unknown", {
      operationId,
      reason,
    });
    await expect(
      service.reviewWithdrawal(admin, withdrawal.id, "reject", { reason }),
    ).rejects.toHaveProperty("status", 409);
    expect(
      (
        await service.reviewWithdrawal(recorder, withdrawal.id, "start_payment", {
          operationId,
          reason,
        })
      ).withdrawal.status,
    ).toBe("payment_unknown");
    expect(await service.wallet(referrer.id)).toMatchObject({
      availableCents: 0,
      frozenCents: 3000,
      recoveryCents: 1000,
      paidCents: 0,
    });
  });
  it("filters before pagination and combines every order's reasons without duplicating joins or leaking buyer scope", async () => {
    const f = await fixture();
    const buyer = await user(),
      stranger = await user();
    const normal = await conn.db
      .insert(schema.commerceOrders)
      .values(
        Array.from({ length: 105 }, () => ({
          userId: buyer.id,
          status: "paid" as const,
          totalCents: 100,
          address: address as typeof schema.commerceOrders.$inferInsert.address,
          paidAt: now,
          expiresAt: now,
          createdAt: new Date("2028-01-01T00:00:00Z"),
        })),
      )
      .returning();
    await conn.db.insert(schema.commerceOrderItems).values(
      normal.map((order) => ({
        orderId: order.id,
        supplierId: f.supplier.id,
        productId: f.product.id,
        sku: f.product.sku,
        name: "Normal historical item",
        quantity: 1,
        priceCents: 100,
        costCents: 20,
        lineCents: 100,
        commissionBps: 0,
        returnDays: 30,
        status: "delivered" as const,
        deliveredAt: now,
      })),
    );
    const make = async (
      state?: "creating" | "open" | "unknown" | "cancel_requested" | "paid" | "requires_review",
      openCase = false,
    ) => {
      const awaiting = state && ["creating", "open", "unknown", "cancel_requested"].includes(state);
      const [order] = await conn.db
        .insert(schema.commerceOrders)
        .values({
          userId: buyer.id,
          status: awaiting ? "awaiting_payment" : "paid",
          paymentProvider: "stripe_test",
          totalCents: 100,
          address: address as typeof schema.commerceOrders.$inferInsert.address,
          paidAt: awaiting ? null : now,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          createdAt: new Date("2025-01-01T00:00:00Z"),
        })
        .returning();
      const [item] = await conn.db
        .insert(schema.commerceOrderItems)
        .values({
          orderId: order!.id,
          supplierId: f.supplier.id,
          productId: f.product.id,
          sku: f.product.sku,
          name: "Attention fixture",
          quantity: 1,
          priceCents: 100,
          costCents: 20,
          lineCents: 100,
          commissionBps: 0,
          returnDays: 30,
          openCase,
        })
        .returning();
      const [attempt] = state
        ? await conn.db
            .insert(schema.commercePaymentAttempts)
            .values({
              orderId: order!.id,
              requestKey: key(),
              amountCents: 100,
              status: state,
              paymentIntentId: `pi_${key().replaceAll("-", "")}`,
              expiresAt: new Date("2099-01-01T00:00:00Z"),
            })
            .returning()
        : [];
      return { order: order!, item: item!, attempt };
    };
    const external = async (target: Awaited<ReturnType<typeof make>>, allocatedFailure = false) => {
      const providerRefundId = `re_${key().replaceAll("-", "")}`;
      const [source] = await conn.db
        .insert(schema.commercePaymentEvents)
        .values({
          id: `evt_${key().replaceAll("-", "")}`,
          type: "refund.updated",
          objectId: providerRefundId,
          payloadHash: "a".repeat(64),
          processedAt: now,
          facts: { currency: "cad", paymentIntentId: target.attempt!.paymentIntentId },
        })
        .returning();
      await conn.db.transaction(async (tx) => {
        if (allocatedFailure)
          await tx
            .update(schema.commerceOrderItems)
            .set({ refundedCents: 10 })
            .where(eq(schema.commerceOrderItems.id, target.item.id));
        const [parent] = await tx
          .insert(schema.commerceExternalRefunds)
          .values({
            orderId: target.order.id,
            attemptId: target.attempt!.id,
            sourceEventId: source!.id,
            providerRefundId,
            paymentIntentId: target.attempt!.paymentIntentId!,
            amountCents: 10,
            providerStatus: allocatedFailure ? "failed" : "succeeded",
            allocationState: allocatedFailure ? "allocated" : "unallocated",
            ...(allocatedFailure
              ? {
                  allocatedAt: now,
                  allocatedBy: admin.id,
                  allocationFingerprint: "b".repeat(64),
                  allocationReason: "Historical attributed refund",
                }
              : {}),
          })
          .returning();
        if (allocatedFailure)
          await tx.insert(schema.commerceExternalRefundAllocations).values({
            externalRefundId: parent!.id,
            itemId: target.item.id,
            amountCents: 10,
            refundedBeforeCents: 0,
            refundedAfterCents: 10,
          });
      });
    };
    const open = await make(undefined, true);
    const unresolved = await Promise.all([
      make("creating"),
      make("unknown"),
      make("cancel_requested"),
    ]);
    const mixed = await make("requires_review", true);
    await conn.db.insert(schema.commerceProviderRefunds).values({
      orderId: mixed.order.id,
      itemId: mixed.item.id,
      attemptId: mixed.attempt!.id,
      actorId: admin.id,
      requestKey: key(),
      reason: "Pending refund",
      amountCents: 10,
      refundTotalCents: 10,
      status: "pending",
    });
    await external(mixed);
    await external(mixed);
    const refundOnly = await make("paid");
    await conn.db.insert(schema.commerceProviderRefunds).values({
      orderId: refundOnly.order.id,
      itemId: refundOnly.item.id,
      attemptId: refundOnly.attempt!.id,
      actorId: admin.id,
      requestKey: key(),
      reason: "Unknown refund without a support flag",
      amountCents: 10,
      refundTotalCents: 10,
      status: "unknown",
    });
    const externalOnly = await make("paid");
    await external(externalOnly);
    const returned = await make("paid");
    await external(returned, true);
    const normalOpen = await make("open");
    const expected = [open, ...unresolved, mixed, refundOnly, externalOnly, returned];
    const before = await supplierReadSnapshot(f, buyer);
    const all = await service.adminOrders(0, "all");
    expect(all.orders.some((order) => expected.some((entry) => entry.order.id === order.id))).toBe(
      false,
    );
    const selected: typeof all.orders = [];
    for (let page = 0; page < 20; page++) {
      const result = await service.adminOrders(page, "needs_attention");
      expect(result.attention).toBe("needs_attention");
      selected.push(...result.orders);
      if (!result.hasMore) break;
    }
    expect(new Set(selected.map((order) => order.id)).size).toBe(selected.length);
    for (const entry of expected)
      expect(selected.some((order) => order.id === entry.order.id)).toBe(true);
    expect(selected.some((order) => order.id === normalOpen.order.id)).toBe(false);
    for (const entry of unresolved)
      expect(selected.find((order) => order.id === entry.order.id)!.attentionReasons).toContain(
        "payment_unresolved",
      );
    expect(
      new Set(selected.find((order) => order.id === mixed.order.id)!.attentionReasons),
    ).toEqual(
      new Set(["open_case", "payment_review", "refund_unresolved", "external_refund_unresolved"]),
    );
    expect(selected.find((order) => order.id === refundOnly.order.id)!.attentionReasons).toContain(
      "refund_unresolved",
    );
    expect(selected.find((order) => order.id === returned.order.id)!.attentionReasons).toContain(
      "external_refund_unresolved",
    );
    expect((await service.listOrders(stranger.id)).orders).toHaveLength(0);
    await expect(service.adminOrders(0, "invalid_filter")).rejects.toMatchObject({ status: 400 });
    expect(
      (await service.supplierStatement(admin, f.supplier.id, {})).summary.hasUnresolvedRefunds,
    ).toBe(true);
    expect(await supplierReadSnapshot(f, buyer)).toEqual(before);
  });

  it("filters requested/approved withdrawals before the page and always preserves explicit buyer scope", async () => {
    const a = await user(),
      b = await user();
    await conn.db.insert(schema.commerceWithdrawals).values(
      Array.from({ length: 105 }, () => ({
        userId: a.id,
        amountCents: 2000,
        status: "rejected" as const,
        createdAt: new Date("2028-01-01T00:00:00Z"),
      })),
    );
    const [requested] = await conn.db
      .insert(schema.commerceWithdrawals)
      .values({
        userId: a.id,
        amountCents: 2000,
        status: "requested",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      })
      .returning();
    const [approved] = await conn.db
      .insert(schema.commerceWithdrawals)
      .values({
        userId: b.id,
        amountCents: 2500,
        status: "approved",
        approvedBy: admin.id,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      })
      .returning();
    const pending = await service.listWithdrawals(undefined, 0, "requested");
    const approvedOnly = await service.listWithdrawals(undefined, 0, "approved");
    expect(pending.withdrawals.some((row) => row.id === requested!.id)).toBe(true);
    expect(pending.withdrawals.every((row) => row.status === "requested")).toBe(true);
    expect(approvedOnly.withdrawals.some((row) => row.id === approved!.id)).toBe(true);
    expect(approvedOnly.withdrawals.every((row) => row.status === "approved")).toBe(true);
    expect(
      (await service.listWithdrawals(a.id, 0, "requested")).withdrawals.map((row) => row.id),
    ).toEqual([requested!.id]);
    expect((await service.listWithdrawals(a.id, 0, "approved")).withdrawals).toHaveLength(0);
    expect((await service.listWithdrawals(b.id, 0, "requested")).withdrawals).toHaveLength(0);
    await expect(service.listWithdrawals(undefined, 0, "invalid_filter")).rejects.toMatchObject({
      status: 400,
    });
    const [stillRequested] = await conn.db
      .select()
      .from(schema.commerceWithdrawals)
      .where(eq(schema.commerceWithdrawals.id, requested!.id));
    expect(stillRequested!.status).toBe("requested");
  });
});

const referralTotals = (
  directBuyers: number,
  ordersWithCommission: number,
  netCommissionCents: number,
) => ({
  mode: "test",
  currency: "CAD",
  directBuyers,
  ordersWithCommission,
  netCommissionCents,
});

describe("buyer referral summary", () => {
  it("summarizes only direct TEST commissions without changing wallet, stock or audit", async () => {
    const first = await fixture();
    const second = await fixture();
    const zeroRate = await fixture({ commissionBps: 0 });
    const a = await user();
    const b = await user();
    const c = await user();
    const unpaid = await user();
    const unrelated = await user();
    await service.bindReferral(b, (await service.profile(a.id)).referralCode);
    await service.bindReferral(unpaid, (await service.profile(a.id)).referralCode);
    await service.bindReferral(c, (await service.profile(b.id)).referralCode);
    const created = await service.createOrder(b, {
      items: [
        { productId: first.product.id, quantity: 2 },
        { productId: second.product.id, quantity: 1 },
      ],
      address,
      idempotencyKey: key(),
    });
    const { order } = await service.testPay(b, created.order.id, key());
    const firstLine = order.items.find((item) => item.productId === first.product.id)!;
    const secondLine = order.items.find((item) => item.productId === second.product.id)!;
    await pay(b, zeroRate.product.id);
    await pay(c, first.product.id);
    await pay(a, first.product.id);
    const snapshot = async () => {
      const [row] = await conn.db.execute(sql`select
        (select count(*)::text from commerce_customers) as customer_count,
        (select count(*)::text from audit_events) as audit_count,
        (select count(*)::text from commerce_ledger) as ledger_count,
        (select string_agg(id::text || ':' || stock::text || ':' || reserved::text, ',' order by id)
          from commerce_products) as product_stock`);
      return row;
    };
    const before = await snapshot();
    await expect(service.referralSummary(a.id)).resolves.toEqual(referralTotals(2, 1, 3000));
    await expect(service.referralSummary(b.id)).resolves.toEqual(referralTotals(1, 1, 1000));
    await expect(service.referralSummary(c.id)).resolves.toEqual(referralTotals(0, 0, 0));
    await expect(service.referralSummary(unrelated.id)).resolves.toEqual(referralTotals(0, 0, 0));
    // An authenticated user need not have ever opened the wallet/profile to read real zeroes.
    const fresh = crypto.randomUUID();
    await conn.db.insert(schema.user).values({
      id: fresh,
      name: "Fresh synthetic buyer",
      email: `${fresh}@test.invalid`,
      emailVerified: true,
    });
    await expect(service.referralSummary(fresh)).resolves.toEqual(referralTotals(0, 0, 0));
    expect(await snapshot()).toEqual(before);

    const refund = (id: string, refundTotalCents: number) =>
      service.refund(admin, id, {
        refundTotalCents,
        reason: "Synthetic referral summary refund",
        idempotencyKey: key(),
      });
    await refund(firstLine.id, 5000);
    await expect(service.referralSummary(a.id)).resolves.toEqual(referralTotals(2, 1, 2500));
    await deliver(first, firstLine.id);
    await deliver(second, secondLine.id);
    now = new Date("2026-11-03T00:00:00Z");
    await service.releaseCommissions(admin, "Synthetic observation window and support reviewed");
    await expect(service.wallet(a.id)).resolves.toMatchObject({ availableCents: 2500 });
    await expect(service.referralSummary(a.id)).resolves.toEqual(referralTotals(2, 1, 2500));
    await service.requestWithdrawal(a, key());
    await expect(service.wallet(a.id)).resolves.toMatchObject({ frozenCents: 2500 });
    await expect(service.referralSummary(a.id)).resolves.toEqual(referralTotals(2, 1, 2500));
    await refund(firstLine.id, firstLine.lineCents);
    await expect(service.referralSummary(a.id)).resolves.toEqual(referralTotals(2, 1, 1000));
    await refund(secondLine.id, secondLine.lineCents);
    const afterRefund = await snapshot();
    await expect(service.referralSummary(a.id)).resolves.toEqual(referralTotals(2, 0, 0));
    await expect(service.referralSummary(b.id)).resolves.toEqual(referralTotals(1, 1, 1000));
    expect(await snapshot()).toEqual(afterRefund);
  });

  it("rejects inexact or missing referral aggregates rather than returning zero", async () => {
    const valid = { directBuyers: "1", ordersWithCommission: "1", netCommissionCents: "100" };
    for (const result of [
      [],
      [{ ...valid, netCommissionCents: "9007199254740993" }],
      [{ ...valid, ordersWithCommission: "-1" }],
      [{ ...valid, directBuyers: 1 }],
      new Error("Synthetic SQL detail must not be exposed"),
    ]) {
      const db = {
        execute: async () => {
          if (result instanceof Error) throw result;
          return result;
        },
      } as unknown as DjlDatabase;
      const unavailable = new CommerceService(db, service.options);
      await expect(unavailable.referralSummary(key())).rejects.toMatchObject({
        status: 503,
        code: "commerce_referral_summary_unavailable",
        message: "Referral statistics are unavailable.",
      });
    }
  });
});

describe("commerce transaction and authorization invariants", () => {
  it("rejects missing manual delivery and commission evidence without changing timestamps, journals or audits", async () => {
    const f = await fixture(),
      buyer = await user(),
      referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    await service.accept(f.supplierUser, itemId);
    await service.ship(f.supplierUser, itemId, { carrier: "Test carrier", trackingNumber: key() });
    const auditRows = () =>
      conn.db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.actorId, admin.id),
            sql`${schema.auditEvents.action} in ('commerce.item.deliver','commerce.commission.release')`,
          ),
        )
        .orderBy(schema.auditEvents.id);
    const beforeDelivery = await conn.db
      .select()
      .from(schema.commerceOrderItems)
      .where(eq(schema.commerceOrderItems.id, itemId));
    const beforeAudit = await auditRows();
    for (const reason of [undefined, null, " ", 123, "x".repeat(501)])
      await expect(service.deliver(admin, itemId, reason)).rejects.toMatchObject({ status: 400 });
    expect(
      await conn.db
        .select()
        .from(schema.commerceOrderItems)
        .where(eq(schema.commerceOrderItems.id, itemId)),
    ).toEqual(beforeDelivery);
    expect(await auditRows()).toEqual(beforeAudit);
    await service.deliver(admin, itemId, "Test-only operator reviewed delivery evidence");
    now = new Date("2026-11-02T00:00:00Z");
    const beforeLedger = await conn.db
      .select()
      .from(schema.commerceLedger)
      .orderBy(schema.commerceLedger.id);
    const beforeReleaseAudit = await auditRows();
    for (const reason of [undefined, null, " ", 123, "x".repeat(501)])
      await expect(service.releaseCommissions(admin, reason)).rejects.toMatchObject({
        status: 400,
      });
    expect(
      await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    ).toEqual(beforeLedger);
    expect(await auditRows()).toEqual(beforeReleaseAudit);
    expect(await service.wallet(referrer.id)).toMatchObject({
      pendingCents: 1000,
      availableCents: 0,
    });
  });

  it("persists operator delivery/release reasons in both audit fields atomically without altering replay semantics", async () => {
    const f = await fixture(),
      buyer = await user(),
      referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    await service.accept(f.supplierUser, itemId);
    await service.ship(f.supplierUser, itemId, { carrier: "Test carrier", trackingNumber: key() });
    const db = new Proxy(conn.db, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (callback: (tx: CommerceTransaction) => Promise<unknown>) =>
            target.transaction((tx) =>
              callback(
                new Proxy(tx, {
                  get(inner, method, innerReceiver) {
                    if (method === "insert")
                      return (table: unknown) => {
                        if (table === schema.auditEvents)
                          throw new Error("Injected evidence audit failure");
                        return Reflect.apply(inner.insert, inner, [table]);
                      };
                    return Reflect.get(inner, method, innerReceiver);
                  },
                }),
              ),
            );
        return Reflect.get(target, property, receiver);
      },
    });
    const faulty = new CommerceService(db, { mode: "test", environment: "test", now: () => now });
    const deliveryReason = `  Operator manually reviewed receipt evidence ${key()}  `;
    await expect(faulty.deliver(admin, itemId, deliveryReason)).rejects.toMatchObject({
      status: 500,
    });
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]).toMatchObject({
      status: "shipped",
      deliveredAt: null,
    });
    await service.deliver(admin, itemId, deliveryReason);
    const [deliveryAudit] = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, "commerce.item.deliver"),
          eq(schema.auditEvents.targetId, itemId),
        ),
      );
    expect(deliveryAudit).toMatchObject({
      reason: deliveryReason.trim(),
      after: { reason: deliveryReason.trim() },
    });
    const deliveredAt = (await service.listOrders(buyer.id)).orders[0]!.items[0]!.deliveredAt;
    now = new Date("2026-11-02T00:00:00Z");
    await service.deliver(
      admin,
      itemId,
      "Another reviewed note must not overwrite the original receipt",
    );
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]!.deliveredAt).toBe(deliveredAt);
    expect(
      await conn.db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.action, "commerce.item.deliver"),
            eq(schema.auditEvents.targetId, itemId),
          ),
        ),
    ).toHaveLength(1);
    const releaseReason = `  Operator checked observation window and support outcomes ${key()}  `;
    const beforeLedger = await conn.db
      .select()
      .from(schema.commerceLedger)
      .orderBy(schema.commerceLedger.id);
    await expect(faulty.releaseCommissions(admin, releaseReason)).rejects.toMatchObject({
      status: 500,
    });
    expect(
      await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    ).toEqual(beforeLedger);
    expect(await service.wallet(referrer.id)).toMatchObject({
      pendingCents: 1000,
      availableCents: 0,
    });
    expect(
      await conn.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.reason, releaseReason.trim())),
    ).toHaveLength(0);
    await service.releaseCommissions(admin, releaseReason);
    expect(await service.wallet(referrer.id)).toMatchObject({
      pendingCents: 0,
      availableCents: 1000,
    });
    const [releaseAudit] = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, "commerce.commission.release"),
          eq(schema.auditEvents.reason, releaseReason.trim()),
        ),
      );
    expect(releaseAudit).toMatchObject({
      reason: releaseReason.trim(),
      after: { reason: releaseReason.trim(), mode: "test" },
    });
  });
  it("requires explicitly approved published image origins and rechecks legacy published rows even for price-only changes", async () => {
    const f = await fixture();
    await expect(
      service.saveProduct(
        admin,
        {
          imageUrl: "https://supplier-images.test/unapproved.png",
          reason: "Test-only administrator checked supplier quote and approved catalog change",
        },
        f.product.id,
      ),
    ).rejects.toMatchObject({ status: 400, code: "image_origin_not_approved" });
    const configured = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      now: () => now,
      mediaPolicy: { mediaOrigin: "https://media.test", webPublicUrl: "https://store.test" },
    });
    expect(
      (
        await configured.saveProduct(
          admin,
          {
            imageUrl: "https://media.test/tote.png",
            reason: "Test-only administrator checked supplier quote and approved catalog change",
          },
          f.product.id,
        )
      ).product.imageUrl,
    ).toBe("https://media.test/tote.png");
    expect(
      (
        await configured.saveProduct(
          admin,
          {
            imageUrl: "/shop/media/tote.png",
            reason: "Test-only administrator checked supplier quote and approved catalog change",
          },
          f.product.id,
        )
      ).product.imageUrl,
    ).toBe("/shop/media/tote.png");
    await expect(
      configured.saveProduct(
        admin,
        {
          imageUrl: "https://store.test/account/avatar.png",
          reason: "Test-only administrator checked supplier quote and approved catalog change",
        },
        f.product.id,
      ),
    ).rejects.toMatchObject({ status: 400, code: "image_origin_not_approved" });
    expect(
      (
        await configured.saveProduct(
          admin,
          {
            imageUrl: "https://store.test/shop/media/tote.png",
            reason: "Test-only administrator checked supplier quote and approved catalog change",
          },
          f.product.id,
        )
      ).product.imageUrl,
    ).toBe("https://store.test/shop/media/tote.png");
    await conn.db
      .update(schema.commerceProducts)
      .set({ imageUrl: "https://legacy-unapproved.test/old.png" })
      .where(eq(schema.commerceProducts.id, f.product.id));
    await expect(
      configured.saveProduct(
        admin,
        {
          priceCents: 11000,
          reason: "Test-only administrator checked supplier quote and approved catalog change",
        },
        f.product.id,
      ),
    ).rejects.toMatchObject({ status: 400, code: "image_origin_not_approved" });
    const [unchanged] = await conn.db
      .select()
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.id, f.product.id));
    expect(unchanged).toMatchObject({
      priceCents: 10000,
      imageUrl: "https://legacy-unapproved.test/old.png",
    });
    const broken = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      mediaPolicy: { mediaOrigin: "https://media.test/not-an-origin" },
    });
    await expect(
      broken.saveProduct(
        admin,
        {
          imageUrl: "/shop/media/tote.png",
          reason: "Test-only administrator checked supplier quote and approved catalog change",
        },
        f.product.id,
      ),
    ).rejects.toMatchObject({ status: 503, code: "media_configuration_invalid" });
  });

  it("validates every CSV image atomically and does not let an imported draft bypass publication approval", async () => {
    const f = await fixture(),
      goodSku = key(),
      badSku = key();
    const configured = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      mediaPolicy: { mediaOrigin: "https://media.test", webPublicUrl: "https://store.test" },
    });
    const header =
      "supplierId,sku,name,description,category,imageUrl,priceCents,costCents,commissionBps,returnDays,stock";
    const good = `${f.supplier.id},${goodSku},Tote,Cotton tote,Bags,/shop/media/tote.png,3900,1900,1000,30,10`;
    const bad = `${f.supplier.id},${badSku},Tote,Cotton tote,Bags,https://127.0.0.1/private.png,3900,1900,1000,30,10`;
    for (const confirm of [false, true])
      await expect(
        configured.importCatalog(admin, {
          csv: `${header}\n${good}\n${bad}`,
          confirm,
          reason: "CSV validation fixture",
        }),
      ).rejects.toMatchObject({ status: 400, code: "image_url_invalid" });
    expect(
      await conn.db
        .select()
        .from(schema.commerceProducts)
        .where(sql`${schema.commerceProducts.sku} in (${goodSku},${badSku})`),
    ).toHaveLength(0);
    const draftSku = key();
    await configured.importCatalog(admin, {
      csv: `${header}\n${f.supplier.id},${draftSku},Tote,Cotton tote,Bags,https://supplier-images.test/draft.png,3900,1900,1000,30,10`,
      confirm: true,
      reason: "Draft image review",
    });
    const [draft] = await conn.db
      .select()
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.sku, draftSku));
    expect(draft!.status).toBe("draft");
    await expect(
      configured.saveProduct(
        admin,
        {
          status: "published",
          reason: "Test-only administrator checked supplier quote and approved catalog change",
        },
        draft!.id,
      ),
    ).rejects.toMatchObject({ status: 400, code: "image_origin_not_approved" });
    expect(
      (
        await configured.saveProduct(
          admin,
          {
            status: "published",
            imageUrl: "https://media.test/approved.png",
            reason: "Test-only administrator checked supplier quote and approved catalog change",
          },
          draft!.id,
        )
      ).product.status,
    ).toBe("published");
  });
  it("records supplier exceptions once without financial mutations and exposes notes only to supplier/admin projections", async () => {
    const f = await fixture(),
      buyer = await user(),
      referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const order = await pay(buyer, f.product.id, 2),
      itemId = order.items[0]!.id;
    const snapshot = async () =>
      Promise.all([
        conn.db
          .select()
          .from(schema.commerceProducts)
          .where(eq(schema.commerceProducts.id, f.product.id)),
        conn.db.select().from(schema.commerceOrders).where(eq(schema.commerceOrders.id, order.id)),
        conn.db
          .select()
          .from(schema.commerceLedger)
          .where(eq(schema.commerceLedger.resourceId, order.id))
          .orderBy(schema.commerceLedger.id),
        conn.db
          .select()
          .from(schema.commerceCommissions)
          .where(eq(schema.commerceCommissions.orderItemId, itemId)),
        service.wallet(referrer.id),
      ]);
    const before = await snapshot();
    const body = {
      kind: "out_of_stock",
      reason: "  Supplier stock discrepancy needs platform review  ",
      idempotencyKey: key(),
    };
    expect(await service.reportSupplierIssue(f.supplierUser, itemId, body)).toEqual({ ok: true });
    await service.reportSupplierIssue(f.supplierUser, itemId, body);
    expect(await snapshot()).toEqual(before);
    const audit = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, "commerce.supplier.issue"),
          eq(schema.auditEvents.targetId, itemId),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: "user",
      actorId: f.supplierUser.id,
      targetType: "commerce",
      after: { kind: "out_of_stock", reason: body.reason.trim() },
    });
    const expected = {
      kind: "out_of_stock",
      reason: body.reason.trim(),
      reportedAt: audit[0]!.createdAt.toISOString(),
    };
    const own = (await service.supplierOrders(f.supplierUser.id)).orders.find(
      (line) => line.id === itemId,
    )!;
    expect(own).toMatchObject({
      openCase: true,
      status: "pending",
      quantity: 2,
      supplierIssue: expected,
    });
    expect((await service.adminOrder(order.id)).order.items[0]!.supplierIssue).toEqual(expected);
    expect(
      (await service.adminOrders(0, "needs_attention")).orders.find((row) => row.id === order.id)!
        .items[0]!.supplierIssue,
    ).toEqual(expected);
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]).not.toHaveProperty(
      "supplierIssue",
    );
    await expect(
      service.reportSupplierIssue(f.supplierUser, itemId, { ...body, reason: "Changed operation" }),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
    await service.reportSupplierIssue(f.supplierUser, itemId, {
      kind: "delay",
      reason: "Follow-up lead time confirmation",
      idempotencyKey: key(),
    });
    expect((await service.adminOrder(order.id)).order.items[0]!.supplierIssue).toMatchObject({
      kind: "delay",
      reason: "Follow-up lead time confirmation",
    });
    expect(
      await conn.db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.action, "commerce.supplier.issue"),
            eq(schema.auditEvents.targetId, itemId),
          ),
        ),
    ).toHaveLength(2);
  });

  it("rejects supplier issue IDOR, inactive/revoked membership, invalid inputs, and non-user actors without mutation", async () => {
    const f = await fixture(),
      other = await fixture(),
      buyer = await user();
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    const body = { kind: "out_of_stock", reason: "Needs review", idempotencyKey: key() };
    for (const actor of [buyer, other.supplierUser])
      await expect(service.reportSupplierIssue(actor, itemId, body)).rejects.toMatchObject({
        status: 404,
      });
    for (const actor of [admin, { ...f.supplierUser, type: "system" as const }])
      await expect(service.reportSupplierIssue(actor, itemId, body)).rejects.toMatchObject({
        status: 403,
      });
    for (const patch of [
      { kind: "auto_refund" },
      { reason: " " },
      { reason: "x".repeat(501) },
      { idempotencyKey: "short" },
    ])
      await expect(
        service.reportSupplierIssue(f.supplierUser, itemId, { ...body, ...patch }),
      ).rejects.toMatchObject({ status: 400 });
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]!.openCase).toBe(false);
    await service.reportSupplierIssue(f.supplierUser, itemId, body);
    await conn.db
      .update(schema.commerceSuppliers)
      .set({ active: false })
      .where(eq(schema.commerceSuppliers.id, f.supplier.id));
    await expect(service.reportSupplierIssue(f.supplierUser, itemId, body)).rejects.toMatchObject({
      status: 404,
    });
    await conn.db
      .update(schema.commerceSuppliers)
      .set({ active: true })
      .where(eq(schema.commerceSuppliers.id, f.supplier.id));
    await conn.db
      .delete(schema.commerceSupplierMembers)
      .where(
        and(
          eq(schema.commerceSupplierMembers.supplierId, f.supplier.id),
          eq(schema.commerceSupplierMembers.userId, f.supplierUser.id),
        ),
      );
    await expect(service.reportSupplierIssue(f.supplierUser, itemId, body)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await conn.db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.action, "commerce.supplier.issue"),
            eq(schema.auditEvents.targetId, itemId),
          ),
        ),
    ).toHaveLength(1);
  });

  it("keeps supplier issue states explicit, blocks fulfillment/release, and resumes only after manual support closure", async () => {
    const f = await fixture(),
      buyer = await user(),
      referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const { order } = await service.createOrder(buyer, {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    });
    const itemId = order.items[0]!.id;
    const report = (kind: string) =>
      service.reportSupplierIssue(f.supplierUser, itemId, {
        kind,
        reason: "Manual follow-up required",
        idempotencyKey: key(),
      });
    await expect(report("out_of_stock")).rejects.toMatchObject({ status: 409 });
    await service.testPay(buyer, order.id, key());
    await report("out_of_stock");
    await expect(service.accept(f.supplierUser, itemId)).rejects.toMatchObject({ status: 409 });
    await expect(
      service.ship(f.supplierUser, itemId, { carrier: "Test carrier", trackingNumber: key() }),
    ).rejects.toMatchObject({ status: 409 });
    await closeReviewedCase(order.id, itemId, "Reviewed test support outcome");
    await service.accept(f.supplierUser, itemId);
    await report("out_of_stock");
    await expect(
      service.ship(f.supplierUser, itemId, { carrier: "Test carrier", trackingNumber: key() }),
    ).rejects.toMatchObject({ status: 409 });
    await closeReviewedCase(order.id, itemId, "Reviewed test support outcome");
    await service.ship(f.supplierUser, itemId, { carrier: "Test carrier", trackingNumber: key() });
    await expect(report("out_of_stock")).rejects.toMatchObject({ status: 409 });
    await report("delay");
    await closeReviewedCase(order.id, itemId, "Reviewed test support outcome");
    await service.deliver(admin, itemId, "Test-only operator reviewed delivery evidence");
    await expect(report("delay")).rejects.toMatchObject({ status: 409 });
    await report("other");
    now = new Date("2026-11-02T00:00:00Z");
    await service.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect(await service.wallet(referrer.id)).toMatchObject({
      availableCents: 0,
      pendingCents: 1000,
    });
    await closeReviewedCase(order.id, itemId, "Reviewed test support outcome");
    await service.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect(await service.wallet(referrer.id)).toMatchObject({
      availableCents: 1000,
      pendingCents: 0,
    });
    expect((await service.adminOrder(order.id)).order.items[0]!.supplierIssue?.kind).toBe("other");
    await service.setOpenCase(admin, itemId, true, "Test support follow-up required");
    await service.refund(admin, itemId, {
      refundTotalCents: 10000,
      reason: "Financial test refund",
      idempotencyKey: key(),
    });
    const financial = await conn.db
      .select()
      .from(schema.commerceLedger)
      .where(eq(schema.commerceLedger.resourceId, itemId))
      .orderBy(schema.commerceLedger.id);
    await report("other");
    expect((await service.adminOrder(order.id)).order).toMatchObject({
      status: "refunded",
      items: [{ status: "delivered", openCase: true, supplierIssue: { kind: "other" } }],
    });
    expect(
      await conn.db
        .select()
        .from(schema.commerceLedger)
        .where(eq(schema.commerceLedger.resourceId, itemId))
        .orderBy(schema.commerceLedger.id),
    ).toEqual(financial);
    await expect(report("out_of_stock")).rejects.toMatchObject({ status: 409 });
    await expect(report("delay")).rejects.toMatchObject({ status: 409 });
    const cancelled = await service.createOrder(buyer, {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    });
    await service.cancelOrder(buyer, cancelled.order.id, key());
    await expect(
      service.reportSupplierIssue(f.supplierUser, cancelled.order.items[0]!.id, {
        kind: "other",
        reason: "Cancelled order",
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rolls a supplier exception and its replay marker back when the audit insert fails", async () => {
    const f = await fixture(),
      buyer = await user();
    const order = await pay(buyer, f.product.id),
      itemId = order.items[0]!.id;
    const db = new Proxy(conn.db, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (callback: (tx: CommerceTransaction) => Promise<unknown>) =>
            target.transaction((tx) =>
              callback(
                new Proxy(tx, {
                  get(inner, method, innerReceiver) {
                    if (method === "insert")
                      return (table: unknown) => {
                        if (table === schema.auditEvents) throw new Error("Injected audit failure");
                        return Reflect.apply(inner.insert, inner, [table]);
                      };
                    return Reflect.get(inner, method, innerReceiver);
                  },
                }),
              ),
            );
        return Reflect.get(target, property, receiver);
      },
    });
    const faulty = new CommerceService(db, { mode: "test", environment: "test", now: () => now });
    const body = { kind: "out_of_stock", reason: "Must audit atomically", idempotencyKey: key() };
    await expect(faulty.reportSupplierIssue(f.supplierUser, itemId, body)).rejects.toMatchObject({
      status: 500,
      code: "commerce_write_failed",
    });
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]!.openCase).toBe(false);
    expect((await service.adminOrder(order.id)).order.items[0]!.supplierIssue).toBeNull();
    expect(
      await conn.db
        .select()
        .from(schema.commerceOperations)
        .where(
          and(
            eq(schema.commerceOperations.actorId, f.supplierUser.id),
            eq(schema.commerceOperations.key, body.idempotencyKey),
          ),
        ),
    ).toHaveLength(0);
    await service.reportSupplierIssue(f.supplierUser, itemId, body);
    expect((await service.adminOrder(order.id)).order.items[0]!.supplierIssue?.kind).toBe(
      "out_of_stock",
    );
  });
  it("keeps same-name SKU identities in immutable sale snapshots and supplier fulfillment", async () => {
    const a = await fixture(),
      b = await fixture({ name: a.product.name });
    const buyer = await user();
    const { order } = await service.createOrder(buyer, {
      items: [
        { productId: a.product.id, quantity: 1 },
        { productId: b.product.id, quantity: 1 },
      ],
      address,
      idempotencyKey: key(),
    });
    expect(new Set(order.items.map((line) => line.sku))).toEqual(
      new Set([a.product.sku, b.product.sku]),
    );
    await service.saveProduct(
      admin,
      {
        sku: key(),
        reason: "Test-only administrator checked supplier quote and approved catalog change",
      },
      a.product.id,
    );
    const paid = (await service.testPay(buyer, order.id, key())).order;
    expect(paid.items.find((line) => line.productId === a.product.id)!.sku).toBe(a.product.sku);
    const own = (await service.supplierOrders(a.supplierUser.id)).orders;
    expect(own.find((line) => line.orderId === order.id)!.sku).toBe(a.product.sku);
    await expect(
      conn.db
        .update(schema.commerceOrderItems)
        .set({ sku: "tampered" })
        .where(eq(schema.commerceOrderItems.id, order.items[0]!.id)),
    ).rejects.toThrow();
  });
  it("recovers committed checkout intent while paused without writing or expiring reservations", async () => {
    const f = await fixture();
    const buyer = await user();
    const other = { ...buyer, id: crypto.randomUUID() };
    await conn.db.insert(schema.user).values({
      id: other.id,
      name: "Commerce test",
      email: `${other.id}@test.invalid`,
      emailVerified: true,
    });
    const input = {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    };
    // The order committed, but the buyer did not receive this result.
    const { order } = await service.createOrder(buyer, input);
    const { order: sentinel } = await service.createOrder(buyer, {
      ...input,
      idempotencyKey: key(),
    });
    const paused = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      checkoutPaused: true,
      now: () => now,
    });
    const snapshot = async () =>
      (
        await conn.db.execute(sql`select
        (select count(*)::int from commerce_orders) as orders,
        (select count(*)::int from commerce_order_items) as items,
        (select count(*)::int from commerce_operations) as operations,
        (select count(*)::int from commerce_customers) as customers,
        (select count(*)::int from audit_events) as audits,
        (select count(*)::int from commerce_ledger) as ledger,
        (select stock from commerce_products where id = ${f.product.id}) as stock,
        (select reserved from commerce_products where id = ${f.product.id}) as reserved,
        (select status from commerce_orders where id = ${sentinel.id}) as sentinel_status`)
      )[0];

    const awaiting = await snapshot();
    await expect(paused.createOrder(buyer, input)).resolves.toMatchObject({
      order: { id: order.id, status: "awaiting_payment" },
    });
    const recoveryInput = { expectedUserId: buyer.id, idempotencyKey: input.idempotencyKey };
    await expect(paused.recoverOrder(buyer, recoveryInput)).resolves.toEqual({
      status: "found",
      order,
    });
    expect(await snapshot()).toEqual(awaiting);

    await paused.cancelOrder(buyer, order.id, key());
    now = new Date(now.getTime() + 31 * 60_000);
    const before = await snapshot();
    expect(before).toMatchObject({ reserved: 1, sentinel_status: "awaiting_payment" });
    await expect(paused.createOrder(buyer, input)).resolves.toMatchObject({
      order: { id: order.id, status: "cancelled" },
    });
    await expect(paused.recoverOrder(buyer, recoveryInput)).resolves.toMatchObject({
      status: "found",
      order: { id: order.id, status: "cancelled" },
    });
    await expect(
      paused.createOrder(buyer, {
        ...input,
        items: [{ productId: f.product.id, quantity: 2 }],
      }),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
    await expect(
      paused.createOrder(buyer, { ...input, idempotencyKey: key() }),
    ).rejects.toMatchObject({
      status: 503,
      code: "commerce_checkout_paused",
    });
    await expect(paused.createOrder(other, input)).rejects.toMatchObject({
      status: 503,
      code: "commerce_checkout_paused",
    });
    expect(await snapshot()).toEqual(before);
    await expect(
      service.createOrder(buyer, { ...input, idempotencyKey: key() }),
    ).resolves.toMatchObject({
      order: { status: "awaiting_payment" },
    });
    expect(await snapshot()).toMatchObject({ reserved: 1, sentinel_status: "cancelled" });
  });
  it("rejects a closed checkout intent before reserving stock", async () => {
    const f = await fixture();
    const buyer = await user();
    const idempotencyKey = key();
    await conn.db.insert(schema.commerceOperations).values({
      actorId: buyer.id,
      kind: "order.create",
      key: idempotencyKey,
      fingerprint: "checkout-attempt-closed-v1",
      resourceId: idempotencyKey,
    });
    const input = {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey,
    };
    await expect(service.createOrder(buyer, input)).rejects.toMatchObject({
      status: 409,
      code: "checkout_attempt_closed",
    });
    expect((await service.listOrders(buyer.id)).orders).toHaveLength(0);
    const [product] = await conn.db
      .select({ stock: schema.commerceProducts.stock, reserved: schema.commerceProducts.reserved })
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.id, f.product.id));
    expect(product).toEqual({ stock: 20, reserved: 0 });
  });
  it("closes an absent checkout once without business mutations and isolates the buyer", async () => {
    const f = await fixture();
    const buyer = { id: key(), type: "user", traceId: "commerce-test" } as const;
    await conn.db.insert(schema.user).values({
      id: buyer.id,
      name: "Commerce test",
      email: `${buyer.id}@test.invalid`,
      emailVerified: true,
    });
    const other = await user();
    const recover = { expectedUserId: buyer.id, idempotencyKey: key() };
    const create = { ...recover, items: [{ productId: f.product.id, quantity: 1 }], address };
    const paused = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      checkoutPaused: true,
      now: () => now,
    });
    const snapshot = async () =>
      (
        await conn.db.execute(sql`select
        (select count(*)::int from commerce_orders) as orders,
        (select count(*)::int from commerce_order_items) as items,
        (select count(*)::int from commerce_customers) as customers,
        (select count(*)::int from audit_events) as audits,
        (select count(*)::int from commerce_ledger) as ledger,
        (select stock from commerce_products where id = ${f.product.id}) as stock,
        (select reserved from commerce_products where id = ${f.product.id}) as reserved`)
      )[0];
    const before = await snapshot();
    await expect(paused.recoverOrder(buyer, recover)).resolves.toEqual({ status: "closed" });
    await expect(service.recoverOrder(buyer, recover)).resolves.toEqual({ status: "closed" });
    await expect(service.createOrder(buyer, create)).rejects.toMatchObject({
      status: 409,
      code: "checkout_attempt_closed",
    });
    await expect(service.recoverOrder(other, recover)).rejects.toMatchObject({
      status: 401,
      code: "commerce_account_changed",
    });
    await expect(service.createOrder(other, create)).rejects.toMatchObject({
      status: 401,
      code: "commerce_account_changed",
    });
    expect(await snapshot()).toEqual(before);
    expect(
      await conn.db
        .select()
        .from(schema.commerceOperations)
        .where(eq(schema.commerceOperations.key, recover.idempotencyKey)),
    ).toMatchObject([
      {
        actorId: buyer.id,
        kind: "order.create",
        fingerprint: "checkout-attempt-closed-v1",
        resourceId: recover.idempotencyKey,
      },
    ]);
    const { order } = await service.createOrder(other, { ...create, expectedUserId: other.id });
    await expect(
      service.recoverOrder(other, { ...recover, expectedUserId: other.id }),
    ).resolves.toEqual({ status: "found", order });
    await expect(service.recoverOrder(buyer, recover)).resolves.toEqual({ status: "closed" });
  });
  it("validates the exact canonical recovery body before touching the database", async () => {
    const service = new CommerceService({} as DjlDatabase, { mode: "test", environment: "test" });
    const actor = { ...admin, type: "user" } as const;
    const recovery = {
      expectedUserId: actor.id,
      idempotencyKey: "abcdef01-2345-4678-8abc-abcdef012345",
    };
    for (const malformed of [
      { ...recovery, extra: 1 },
      { ...recovery, expectedUserId: 1 },
      { idempotencyKey: recovery.idempotencyKey },
      { ...recovery, idempotencyKey: recovery.idempotencyKey.toUpperCase() },
      { ...recovery, idempotencyKey: recovery.idempotencyKey + "\n" },
      { ...recovery, idempotencyKey: "legacy-key" },
    ])
      await expect(service.recoverOrder(actor, malformed)).rejects.toMatchObject({
        status: 400,
        code: "bad_request",
      });
    await expect(service.recoverOrder(admin, recovery)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    await expect(
      service.recoverOrder(actor, { ...recovery, expectedUserId: key() }),
    ).rejects.toMatchObject({ status: 401, code: "commerce_account_changed" });
    await expect(service.createOrder(actor, { expectedUserId: key() })).rejects.toMatchObject({
      status: 401,
      code: "commerce_account_changed",
    });
  });
  it("caps only new checkout closures per buyer in a rolling day", async () => {
    const f = await fixture();
    const buyer = await user();
    const other = await user();
    const recover = { expectedUserId: buyer.id, idempotencyKey: key() };
    const input = { items: [{ productId: f.product.id, quantity: 1 }], address };
    const { order } = await service.createOrder(buyer, {
      ...input,
      idempotencyKey: recover.idempotencyKey,
    });
    // Adding the optional identity guard does not change a legacy order's fingerprint.
    await expect(service.createOrder(buyer, { ...input, ...recover })).resolves.toEqual({ order });
    const keys = Array.from({ length: 20 }, key);
    for (const idempotencyKey of keys)
      await expect(service.recoverOrder(buyer, { ...recover, idempotencyKey })).resolves.toEqual({
        status: "closed",
      });
    const next = { ...recover, idempotencyKey: key() };
    await expect(service.recoverOrder(buyer, next)).rejects.toMatchObject({
      status: 429,
      code: "checkout_recovery_limit",
    });
    await expect(
      service.recoverOrder(buyer, { ...recover, idempotencyKey: keys[0] }),
    ).resolves.toEqual({
      status: "closed",
    });
    await expect(service.recoverOrder(buyer, recover)).resolves.toEqual({ status: "found", order });
    await expect(
      service.recoverOrder(other, { ...next, expectedUserId: other.id }),
    ).resolves.toEqual({
      status: "closed",
    });
    now = new Date(now.getTime() + 86_400_000);
    await expect(service.recoverOrder(buyer, next)).resolves.toEqual({ status: "closed" });
  });
  it("serializes concurrent order creation and recovery into one terminal result", async () => {
    const f = await fixture();
    const buyer = await user();
    const recover = { expectedUserId: buyer.id, idempotencyKey: key() };
    const input = { ...recover, items: [{ productId: f.product.id, quantity: 1 }], address };
    const [created, recovered] = await Promise.allSettled([
      service.createOrder(buyer, input),
      service.recoverOrder(buyer, recover),
    ]);
    if (recovered.status === "rejected") throw recovered.reason;
    if (recovered.value.status === "found") {
      expect(created).toMatchObject({
        status: "fulfilled",
        value: { order: recovered.value.order },
      });
    } else {
      expect(created).toMatchObject({
        status: "rejected",
        reason: { status: 409, code: "checkout_attempt_closed" },
      });
    }
    await expect(service.recoverOrder(buyer, recover)).resolves.toEqual(recovered.value);
    expect(
      await conn.db
        .select()
        .from(schema.commerceOperations)
        .where(eq(schema.commerceOperations.key, recover.idempotencyKey)),
    ).toHaveLength(1);
  });
  it("pauses new checkout and withdrawal independently without blocking history, cancellation, or support", async () => {
    const f = await fixture();
    const buyer = await user();
    const input = {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    };
    const { order } = await service.createOrder(buyer, input);
    const checkoutPaused = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      checkoutPaused: true,
      now: () => now,
    });
    await expect(
      checkoutPaused.createOrder(buyer, { ...input, idempotencyKey: key() }),
    ).rejects.toMatchObject({
      status: 503,
      code: "commerce_checkout_paused",
    });
    expect((await checkoutPaused.catalog()).checkoutPaused).toBe(true);
    expect((await checkoutPaused.listOrders(buyer.id)).orders).toHaveLength(1);
    await checkoutPaused.cancelOrder(buyer, order.id, key());
    const paid = await pay(buyer, f.product.id);
    const withdrawalsPaused = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      withdrawalsPaused: true,
      now: () => now,
    });
    await expect(withdrawalsPaused.requestWithdrawal(buyer, key())).rejects.toMatchObject({
      status: 503,
      code: "commerce_withdrawals_paused",
    });
    expect((await withdrawalsPaused.profile(buyer.id)).withdrawalsPaused).toBe(true);
    await withdrawalsPaused.requestReturn(buyer, paid.id, {
      itemId: paid.items[0]!.id,
      reason: "Support remains open",
    });
    expect(
      (await withdrawalsPaused.listOrders(buyer.id)).orders.find((o) => o.id === paid.id)!.items[0]!
        .openCase,
    ).toBe(true);
  });
  it("fails closed for test-money commands in staging and production", async () => {
    for (const environment of ["staging", "production"] as const) {
      const disabled = new CommerceService({} as DjlDatabase, { mode: "test", environment });
      expect(disabled.mode).toBe("disabled");
      await expect(disabled.createOrder(admin, {})).rejects.toMatchObject({ status: 503 });
      await expect(disabled.requestWithdrawal(admin, key())).rejects.toMatchObject({ status: 503 });
    }
  });

  it("binds once before first payment, rejects self/mutual/cyclic links, and refunds never reset eligibility", async () => {
    const f = await fixture();
    const [a, b, c, other] = await Promise.all([user(), user(), user(), user()]);
    const aCode = (await service.profile(a.id)).referralCode;
    const bCode = (await service.profile(b.id)).referralCode;
    const cCode = (await service.profile(c.id)).referralCode;
    await expect(service.bindReferral(a, aCode)).rejects.toMatchObject({ status: 409 });
    await service.bindReferral(b, aCode);
    await service.bindReferral(c, bCode);
    await expect(service.bindReferral(a, bCode)).rejects.toMatchObject({ status: 409 });
    await expect(service.bindReferral(a, cCode)).rejects.toMatchObject({ status: 409 });
    await expect(service.bindReferral(b, cCode)).rejects.toMatchObject({ status: 409 });
    const order = await pay(other, f.product.id);
    await service.refund(admin, order.items[0]!.id, {
      refundTotalCents: order.totalCents,
      reason: "Test refund",
      idempotencyKey: key(),
    });
    expect((await service.profile(other.id)).firstPaidAt).not.toBeNull();
    await expect(service.bindReferral(other, aCode)).rejects.toMatchObject({ status: 409 });
  });

  it("pays only a persistent direct referrer, never a grandparent or the buyer, with replay safety", async () => {
    const f = await fixture();
    const [a, b, c] = await Promise.all([user(), user(), user()]);
    await service.bindReferral(b, (await service.profile(a.id)).referralCode);
    await service.bindReferral(c, (await service.profile(b.id)).referralCode);
    const createKey = key();
    const input = {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: createKey,
    };
    const created = await service.createOrder(c, input);
    expect((await service.createOrder(c, input)).order.id).toBe(created.order.id);
    await expect(
      service.createOrder(c, { ...input, items: [{ productId: f.product.id, quantity: 2 }] }),
    ).rejects.toMatchObject({ status: 409 });
    await service.testPay(c, created.order.id, key());
    await service.testPay(c, created.order.id, key());
    await pay(c, f.product.id);
    expect((await service.wallet(a.id)).pendingCents).toBe(0);
    expect((await service.wallet(b.id)).pendingCents).toBe(2000);
    expect((await service.wallet(c.id)).pendingCents).toBe(0);
    const entries = await service.ledgerEntries(b.id);
    expect(entries.entries.every((entry) => entry.ownerId === b.id && entry.mode === "test")).toBe(
      true,
    );
    expect(entries.entries).toHaveLength(2);
  });

  it("captures a referral bound after order creation but before first successful payment", async () => {
    const f = await fixture();
    const buyer = await user();
    const referrer = await user();
    const { order } = await service.createOrder(buyer, {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    });
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    await service.testPay(buyer, order.id, key());
    expect((await service.wallet(referrer.id)).pendingCents).toBe(1000);
  });

  it("freezes price/cost/rate snapshots, rejects buyer IDOR, and scopes supplier fulfillment", async () => {
    const f = await fixture();
    const buyer = await user();
    const stranger = await user();
    const { order } = await service.createOrder(buyer, {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    });
    await service.saveProduct(
      admin,
      {
        priceCents: 20000,
        costCents: 8000,
        commissionBps: 5000,
        reason: "Test-only administrator checked supplier quote and approved catalog change",
      },
      f.product.id,
    );
    await expect(service.testPay(stranger, order.id, key())).rejects.toMatchObject({ status: 404 });
    await expect(service.cancelOrder(stranger, order.id, key())).rejects.toMatchObject({
      status: 404,
    });
    expect((await service.listOrders(stranger.id)).orders).toHaveLength(0);
    const paid = (await service.testPay(buyer, order.id, key())).order;
    expect(paid.totalCents).toBe(10000);
    await expect(service.accept(stranger, paid.items[0]!.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.supplierOrders(stranger.id)).rejects.toMatchObject({ status: 403 });
    await expect(service.updateStock(stranger, f.product.id, 100)).rejects.toMatchObject({
      status: 404,
    });
    const [line] = await conn.db
      .select()
      .from(schema.commerceOrderItems)
      .where(eq(schema.commerceOrderItems.orderId, order.id));
    expect(line).toMatchObject({ priceCents: 10000, costCents: 4000, commissionBps: 1000 });
    await expect(
      conn.db
        .update(schema.commerceOrderItems)
        .set({ costCents: 1 })
        .where(eq(schema.commerceOrderItems.id, line!.id)),
    ).rejects.toThrow();
    await deliver(f, line!.id);
    expect((await service.listOrders(buyer.id)).orders[0]!.items[0]).toMatchObject({
      status: "delivered",
      openCase: false,
      returnDays: 30,
    });
  });

  it("holds stock until expiry/cancellation and never restores physical stock on a refund", async () => {
    const f = await fixture({ stock: 1 });
    const buyer = await user();
    const { order } = await service.createOrder(buyer, {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    });
    await expect(service.updateStock(f.supplierUser, f.product.id, 0)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      service.createOrder(buyer, {
        items: [{ productId: f.product.id, quantity: 1 }],
        address,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    now = new Date(now.getTime() + 31 * 60000);
    await service.expireReservations();
    await expect(service.testPay(buyer, order.id, key())).rejects.toMatchObject({ status: 409 });
    const paid = await pay(buyer, f.product.id);
    await service.refund(admin, paid.items[0]!.id, {
      refundTotalCents: paid.totalCents,
      reason: "Return",
      idempotencyKey: key(),
    });
    const [p] = await conn.db
      .select()
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.id, f.product.id));
    expect(p).toMatchObject({ stock: 0, reserved: 0 });
  });

  it.skipIf(process.env.COMMERCE_TEST_PGLITE === "true")(
    "does not oversell competing transactions on a multi-connection PostgreSQL server",
    async () => {
      const f = await fixture({ stock: 1 });
      const [a, b] = await Promise.all([user(), user()]);
      const create = (buyer: CommerceActor) =>
        service.createOrder(buyer, {
          items: [{ productId: f.product.id, quantity: 1 }],
          address,
          idempotencyKey: key(),
        });
      const results = await Promise.allSettled([create(a), create(b)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const [p] = await conn.db
        .select()
        .from(schema.commerceProducts)
        .where(eq(schema.commerceProducts.id, f.product.id));
      expect(p!.reserved).toBe(1);
    },
  );

  it("releases only after the longer return window with no open case; cumulative refunds reverse exact cents", async () => {
    const f = await fixture({
      priceCents: 101,
      costCents: 50,
      commissionBps: 1000,
      returnDays: 45,
    });
    const buyer = await user();
    const referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const order = await pay(buyer, f.product.id);
    const itemId = order.items[0]!.id;
    await deliver(f, itemId);
    now = new Date("2026-11-01T00:00:00Z");
    await service.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect((await service.wallet(referrer.id)).availableCents).toBe(0);
    await service.requestReturn(buyer, order.id, { itemId, reason: "Inspect return" });
    now = new Date("2026-11-16T00:00:00Z");
    await service.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect((await service.wallet(referrer.id)).pendingCents).toBe(10);
    await closeReviewedCase(order.id, itemId, "Reviewed test support outcome");
    await service.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    await service.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    expect((await service.wallet(referrer.id)).availableCents).toBe(10);
    const refund = { refundTotalCents: 1, reason: "Partial", idempotencyKey: key() };
    await service.refund(admin, itemId, refund);
    await service.refund(admin, itemId, refund);
    expect((await service.wallet(referrer.id)).availableCents).toBe(10);
    await service.refund(admin, itemId, {
      refundTotalCents: 11,
      reason: "Partial again",
      idempotencyKey: key(),
    });
    expect((await service.wallet(referrer.id)).availableCents).toBe(9);
    await service.refund(admin, itemId, {
      refundTotalCents: 101,
      reason: "Full",
      idempotencyKey: key(),
    });
    expect((await service.wallet(referrer.id)).availableCents).toBe(0);
  });

  it.each([2500, 10000])(
    "keeps a %i-cent simulated refund separate from manual support closure",
    async (total) => {
      const f = await fixture();
      const buyer = await user(),
        referrer = await user();
      await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
      const order = await pay(buyer, f.product.id),
        itemId = order.items[0]!.id;
      await deliver(f, itemId);
      await service.requestReturn(buyer, order.id, {
        itemId,
        reason: "Return parcel still needs inspection",
      });
      now = new Date("2026-11-02T00:00:00Z");
      const firstPaidAt = (await service.profile(buyer.id)).firstPaidAt;
      const request = {
        refundTotalCents: total,
        reason: "Financial refund does not finish the return inspection",
        idempotencyKey: key(),
      };
      await service.refund(admin, itemId, request);
      const refundLedger = await conn.db
        .select()
        .from(schema.commerceLedger)
        .where(eq(schema.commerceLedger.resourceId, itemId))
        .orderBy(schema.commerceLedger.id);
      await service.refund(admin, itemId, request);
      expect(
        await conn.db
          .select()
          .from(schema.commerceLedger)
          .where(eq(schema.commerceLedger.resourceId, itemId))
          .orderBy(schema.commerceLedger.id),
      ).toEqual(refundLedger);
      await service.releaseCommissions(
        admin,
        "Test-only review of observation window and support outcomes",
      );
      const remaining = (10000 - total) / 10;
      expect(await service.wallet(referrer.id)).toMatchObject({
        availableCents: 0,
        pendingCents: remaining,
      });
      const current = (await service.listOrders(buyer.id)).orders.find(
        (row) => row.id === order.id,
      )!;
      expect(current.items[0]).toMatchObject({ refundedCents: total, openCase: true });
      expect((await service.profile(buyer.id)).firstPaidAt).toBe(firstPaidAt);
      expect(
        (
          await conn.db
            .select()
            .from(schema.commerceProducts)
            .where(eq(schema.commerceProducts.id, f.product.id))
        )[0]!.stock,
      ).toBe(19);
      await closeReviewedCase(order.id, itemId, "Reviewed test support outcome");
      await service.releaseCommissions(
        admin,
        "Test-only review of observation window and support outcomes",
      );
      expect(await service.wallet(referrer.id)).toMatchObject({
        availableCents: remaining,
        pendingCents: 0,
      });
      const settled = await service.wallet(referrer.id);
      await service.releaseCommissions(
        admin,
        "Test-only review of observation window and support outcomes",
      );
      expect(await service.wallet(referrer.id)).toEqual(settled);
    },
  );

  it("freezes withdrawals once, requires independent recording, and records recovery after a paid commission refund", async () => {
    const f = await fixture({ priceCents: 30000 });
    const buyer = await user();
    const referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const order = await pay(buyer, f.product.id);
    await deliver(f, order.items[0]!.id);
    now = new Date("2026-11-01T00:00:00Z");
    await service.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    const withdrawalKey = key();
    const result = await service.requestWithdrawal(referrer, withdrawalKey);
    expect((await service.requestWithdrawal(referrer, withdrawalKey)).withdrawal.id).toBe(
      result.withdrawal.id,
    );
    expect(result.wallet).toMatchObject({ availableCents: 0, frozenCents: 3000 });
    await expect(service.requestWithdrawal(referrer, key())).rejects.toMatchObject({ status: 409 });
    await service.reviewWithdrawal(admin, result.withdrawal.id, "approve", {});
    await expect(
      service.reviewWithdrawal(admin, result.withdrawal.id, "record", {
        reference: key(),
        reason: "test",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const record = { reference: key(), reason: "Simulated bank reference, no real transfer" };
    await service.reviewWithdrawal(recorder, result.withdrawal.id, "record", record);
    await service.reviewWithdrawal(recorder, result.withdrawal.id, "record", record);
    expect(await service.wallet(referrer.id)).toMatchObject({ frozenCents: 0, paidCents: 3000 });
    await service.refund(admin, order.items[0]!.id, {
      refundTotalCents: 30000,
      reason: "Post payout return",
      idempotencyKey: key(),
    });
    expect(await service.wallet(referrer.id)).toMatchObject({
      availableCents: 0,
      paidCents: 3000,
      recoveryCents: 3000,
    });
    await expect(service.requestWithdrawal(referrer, key())).rejects.toMatchObject({ status: 409 });
  });

  it("makes the ledger append-only and each committed journal balanced, with admin audit rows", async () => {
    const f = await fixture();
    const buyer = await user();
    const order = await pay(buyer, f.product.id);
    const [entry] = await conn.db
      .select()
      .from(schema.commerceLedger)
      .where(eq(schema.commerceLedger.resourceId, order.id));
    await expect(
      conn.db
        .update(schema.commerceLedger)
        .set({ amountCents: 1 })
        .where(eq(schema.commerceLedger.id, entry!.id)),
    ).rejects.toThrow();
    await expect(
      conn.db.delete(schema.commerceLedger).where(eq(schema.commerceLedger.id, entry!.id)),
    ).rejects.toThrow();
    await expect(conn.db.execute(sql`truncate commerce_ledger`)).rejects.toThrow();
    await expect(conn.db.execute(sql`truncate commerce_operations`)).rejects.toThrow();
    await expect(
      conn.db.insert(schema.commerceLedger).values({
        eventKey: key(),
        line: 0,
        ownerId: buyer.id,
        account: "available",
        amountCents: 1,
        resourceId: order.id,
      }),
    ).rejects.toThrow();
    const unbalanced = await conn.db
      .select({
        eventKey: schema.commerceLedger.eventKey,
        total: sql<string>`sum(${schema.commerceLedger.amountCents})::text`,
      })
      .from(schema.commerceLedger)
      .groupBy(schema.commerceLedger.eventKey)
      .having(sql`sum(${schema.commerceLedger.amountCents}) <> 0`);
    expect(unbalanced).toHaveLength(0);
    const audit = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.targetId, f.product.id),
          eq(schema.auditEvents.action, "commerce.product.save"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it("rejects payment-time binding resets in SQL, including after a full refund", async () => {
    const f = await fixture();
    const buyer = await user();
    const referrer = await user();
    const order = await pay(buyer, f.product.id);
    await service.refund(admin, order.items[0]!.id, {
      refundTotalCents: order.totalCents,
      reason: "Full",
      idempotencyKey: key(),
    });
    await expect(
      conn.db
        .update(schema.commerceCustomers)
        .set({ firstPaidAt: null })
        .where(eq(schema.commerceCustomers.userId, buyer.id)),
    ).rejects.toThrow();
    await expect(
      conn.db
        .update(schema.commerceCustomers)
        .set({ referrerId: referrer.id })
        .where(eq(schema.commerceCustomers.userId, buyer.id)),
    ).rejects.toThrow();
  });

  it("imports CSV as drafts only, previews without mutation, and rolls a bad batch back", async () => {
    const f = await fixture();
    const sku = key();
    const header =
      "supplierId,sku,name,description,category,imageUrl,priceCents,costCents,commissionBps,returnDays,stock";
    const csv = `${header}\n${f.supplier.id},${sku},Tote,Cotton tote,Bags,/shop/media/tote.png,3900,1900,1000,30,10`;
    expect((await service.importCatalog(admin, { csv })).imported).toBe(0);
    expect(
      await conn.db
        .select()
        .from(schema.commerceProducts)
        .where(eq(schema.commerceProducts.sku, sku)),
    ).toHaveLength(0);
    expect(
      (await service.importCatalog(admin, { csv, confirm: true, reason: "Test batch" })).imported,
    ).toBe(1);
    const [product] = await conn.db
      .select()
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.sku, sku));
    expect(product!.status).toBe("draft");
    const newSku = key();
    const conflicting = `${csv}\n${f.supplier.id},${newSku},Tote,Cotton tote,Bags,/shop/media/tote.png,3900,1900,1000,30,10`;
    await expect(
      service.importCatalog(admin, { csv: conflicting, confirm: true, reason: "Conflict" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await conn.db
        .select()
        .from(schema.commerceProducts)
        .where(eq(schema.commerceProducts.sku, newSku)),
    ).toHaveLength(0);
  });

  it("holds a frozen withdrawal on refund recovery until reviewed rejection offsets the debt", async () => {
    const f = await fixture({ priceCents: 30000 });
    const buyer = await user();
    const referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const order = await pay(buyer, f.product.id);
    await deliver(f, order.items[0]!.id);
    now = new Date("2026-11-01T00:00:00Z");
    await service.releaseCommissions(
      admin,
      "Test-only review of observation window and support outcomes",
    );
    const { withdrawal } = await service.requestWithdrawal(referrer, key());
    await service.refund(admin, order.items[0]!.id, {
      refundTotalCents: 10000,
      reason: "Partial return",
      idempotencyKey: key(),
    });
    expect(await service.wallet(referrer.id)).toMatchObject({
      availableCents: 0,
      frozenCents: 3000,
      recoveryCents: 1000,
    });
    await expect(
      service.reviewWithdrawal(admin, withdrawal.id, "approve", {}),
    ).rejects.toMatchObject({ status: 409 });
    await service.reviewWithdrawal(admin, withdrawal.id, "reject", { reason: "Refund review" });
    expect(await service.wallet(referrer.id)).toMatchObject({
      availableCents: 2000,
      frozenCents: 0,
      recoveryCents: 0,
    });
    await service.reviewWithdrawal(admin, withdrawal.id, "reject", { reason: "Replay" });
    expect((await service.wallet(referrer.id)).availableCents).toBe(2000);
  });

  it("enforces the pilot's 1000 published-SKU ceiling even when an admin publishes a draft", async () => {
    const f = await fixture();
    const existing = await conn.db
      .select({ id: schema.commerceProducts.id })
      .from(schema.commerceProducts)
      .where(eq(schema.commerceProducts.status, "published"));
    const added = Array.from({ length: 1000 - existing.length }, () => ({
      supplierId: f.supplier.id,
      sku: key(),
      name: "Cap test",
      description: "Cap test",
      category: "Test",
      imageUrl: "/shop/media/test.png",
      priceCents: 100,
      costCents: 20,
      commissionBps: 0,
      returnDays: 30,
      stock: 1,
      status: "published" as const,
    }));
    const ids = added.length
      ? await conn.db
          .insert(schema.commerceProducts)
          .values(added)
          .returning({ id: schema.commerceProducts.id })
      : [];
    try {
      const { product } = await service.saveProduct(admin, {
        supplierId: f.supplier.id,
        sku: key(),
        name: "Draft limit",
        description: "Draft limit",
        category: "Test",
        imageUrl: "/shop/media/test.png",
        priceCents: 100,
        costCents: 20,
        commissionBps: 0,
        returnDays: 30,
        stock: 1,
        status: "draft",
        reason: "Test-only administrator checked supplier quote and approved catalog change",
      });
      await expect(
        service.saveProduct(
          admin,
          {
            status: "published",
            reason: "Test-only administrator checked supplier quote and approved catalog change",
          },
          product.id,
        ),
      ).rejects.toMatchObject({ status: 409, code: "catalog_limit" });
    } finally {
      for (const { id } of ids)
        await conn.db
          .update(schema.commerceProducts)
          .set({ status: "draft" })
          .where(eq(schema.commerceProducts.id, id));
    }
  });

  it("keeps new supplier fulfillment visible beyond 100 historical items and paginates history", async () => {
    const f = await fixture();
    const buyer = await user();
    const historical = await conn.db
      .insert(schema.commerceOrders)
      .values(
        Array.from({ length: 105 }, () => ({
          userId: buyer.id,
          status: "paid" as const,
          totalCents: 100,
          address: address as typeof schema.commerceOrders.$inferInsert.address,
          expiresAt: now,
          paidAt: now,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        })),
      )
      .returning({ id: schema.commerceOrders.id });
    await conn.db.insert(schema.commerceOrderItems).values(
      historical.map((o) => ({
        orderId: o.id,
        productId: f.product.id,
        supplierId: f.supplier.id,
        name: "Historical tote",
        quantity: 1,
        priceCents: 100,
        costCents: 20,
        lineCents: 100,
        commissionBps: 0,
        returnDays: 30,
        status: "delivered" as const,
        deliveredAt: now,
      })),
    );
    const recent = await pay(buyer, f.product.id);
    const first = await service.supplierOrders(f.supplierUser.id);
    const second = await service.supplierOrders(f.supplierUser.id, 1);
    expect(first.orders[0]!.id).toBe(recent.items[0]!.id);
    expect(first).toMatchObject({ page: 0, hasMore: true });
    expect(second).toMatchObject({ page: 1, hasMore: false });
    expect(new Set([...first.orders, ...second.orders].map((o) => o.id)).size).toBe(106);
    const buyerFirst = await service.listOrders(buyer.id);
    const buyerSecond = await service.listOrders(buyer.id, "1");
    expect(new Set([...buyerFirst.orders, ...buyerSecond.orders].map((o) => o.id)).size).toBe(106);
  });

  it("retains reachable catalog drafts and archived supplier stock beyond 1000 historical SKUs", async () => {
    const f = await fixture();
    await conn.db.insert(schema.commerceProducts).values(
      Array.from({ length: 1001 }, () => ({
        supplierId: f.supplier.id,
        sku: key(),
        name: "Historical",
        description: "Historical",
        category: "Test",
        imageUrl: "/shop/media/test.png",
        priceCents: 100,
        costCents: 20,
        commissionBps: 0,
        returnDays: 30,
        stock: 0,
        status: "archived" as const,
        createdAt: new Date("2027-01-01T00:00:00Z"),
      })),
    );
    const { product } = await service.saveProduct(admin, {
      supplierId: f.supplier.id,
      sku: key(),
      name: "New review",
      description: "New review",
      category: "Test",
      imageUrl: "/shop/media/test.png",
      priceCents: 100,
      costCents: 20,
      commissionBps: 0,
      returnDays: 30,
      stock: 1,
      status: "draft",
      reason: "Test-only administrator checked supplier quote and approved catalog change",
    });
    expect((await service.adminCatalog()).products.some((p) => p.id === product.id)).toBe(true);
    const ids = new Set<string>();
    let page = 0;
    do {
      const result = await service.supplierProducts(f.supplierUser.id, page);
      for (const p of result.products) ids.add(p.id);
      if (!result.hasMore) break;
      page++;
    } while (page < 20);
    expect(ids.size).toBe(1003);
    expect(ids.has(product.id)).toBe(true);
  });

  it("does not block existing auth account purging or cascade immutable commerce history", async () => {
    const f = await fixture();
    const buyer = await user();
    const referrer = await user();
    await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
    const order = await pay(buyer, f.product.id);
    const before = await conn.db
      .select({ id: schema.commerceLedger.id })
      .from(schema.commerceLedger)
      .where(eq(schema.commerceLedger.resourceId, order.id));
    await service.addSupplierMember(
      admin,
      f.supplier.id,
      buyer.id,
      "Test-only administrator supplier access approved",
    );
    await conn.db.delete(schema.user).where(eq(schema.user.id, buyer.id));
    expect(
      await conn.db
        .select()
        .from(schema.commerceSupplierMembers)
        .where(eq(schema.commerceSupplierMembers.userId, buyer.id)),
    ).toHaveLength(0);
    expect(
      await conn.db
        .select()
        .from(schema.commerceOrders)
        .where(eq(schema.commerceOrders.id, order.id)),
    ).toHaveLength(1);
    expect(
      await conn.db
        .select()
        .from(schema.commerceCustomers)
        .where(eq(schema.commerceCustomers.userId, buyer.id)),
    ).toHaveLength(1);
    expect(
      await conn.db
        .select()
        .from(schema.commerceLedger)
        .where(eq(schema.commerceLedger.resourceId, order.id)),
    ).toHaveLength(before.length);
  });

  it("paginates older withdrawals and journal entries without leaking another user's records", async () => {
    const buyer = await user();
    const other = await user();
    await conn.db.insert(schema.commerceWithdrawals).values(
      Array.from({ length: 105 }, () => ({
        userId: buyer.id,
        amountCents: 2000,
        status: "rejected" as const,
      })),
    );
    await conn.db.insert(schema.commerceLedger).values(
      Array.from({ length: 105 }, () => {
        const eventKey = key(),
          resourceId = key();
        return [
          { eventKey, resourceId, line: 0, ownerId: buyer.id, account: "paid", amountCents: 1 },
          {
            eventKey,
            resourceId,
            line: 1,
            ownerId: "platform",
            account: "test_offset",
            amountCents: -1,
          },
        ];
      }).flat(),
    );
    const withdrawalsFirst = await service.listWithdrawals(buyer.id),
      withdrawalsSecond = await service.listWithdrawals(buyer.id, 1);
    expect(withdrawalsFirst.hasMore).toBe(true);
    expect(withdrawalsSecond.hasMore).toBe(false);
    expect(
      new Set([...withdrawalsFirst.withdrawals, ...withdrawalsSecond.withdrawals].map((w) => w.id))
        .size,
    ).toBe(105);
    const first = await service.ledgerEntries(buyer.id),
      second = await service.ledgerEntries(buyer.id, 1);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.entries, ...second.entries].map((e) => e.id)).size).toBe(105);
    expect((await service.ledgerEntries(other.id)).entries).toHaveLength(0);
    expect((await service.listWithdrawals(other.id)).withdrawals).toHaveLength(0);
    expect((await service.listWithdrawals(undefined)).hasMore).toBe(true);
  });
});
