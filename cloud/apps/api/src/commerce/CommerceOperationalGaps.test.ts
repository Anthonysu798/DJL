import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { schema } from "@djl/db";

import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import {
  CommerceService,
  type CommerceActor,
  type CommerceTransaction,
} from "./CommerceService.ts";

const conn = await isolatedCommerceTestDatabase();
let now = new Date("2026-10-01T00:00:00Z");
const service = new CommerceService(conn.db, { mode: "test", environment: "test", now: () => now });
const admin: CommerceActor = {
  id: crypto.randomUUID(),
  type: "admin",
  traceId: "commerce-operational-gaps",
};
const key = () => crypto.randomUUID();
const reason = "Synthetic administrator checked supplier quote and catalog approval";
const address = {
  name: "Synthetic buyer",
  line1: "100 Test Street",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA",
};
async function user() {
  const actor: CommerceActor = { id: key(), type: "user", traceId: "commerce-operational-gaps" };
  await conn.db.insert(schema.user).values({
    id: actor.id,
    name: "Synthetic gap fixture",
    email: `${actor.id}@test.invalid`,
    emailVerified: true,
  });
  await service.profile(actor.id);
  return actor;
}
async function fixture() {
  now = new Date("2026-10-01T00:00:00Z");
  const supplierUser = await user(),
    buyer = await user(),
    referrer = await user();
  const { supplier } = await service.createSupplier(admin, {
    name: "Synthetic supplier",
    returnAddress: "Toronto, Canada",
    reason,
    idempotencyKey: key(),
  });
  await service.addSupplierMember(admin, supplier.id, supplierUser.id, reason);
  await service.bindReferral(buyer, (await service.profile(referrer.id)).referralCode);
  const { product } = await service.saveProduct(admin, {
    supplierId: supplier.id,
    sku: key(),
    name: "Synthetic tote",
    description: "Operational fixture",
    category: "QA",
    imageUrl: "/shop/media/test.png",
    priceCents: 10000,
    costCents: 4000,
    commissionBps: 1000,
    returnDays: 30,
    stock: 20,
    status: "published",
    reason,
  });
  return { supplierUser, buyer, referrer, supplier, product };
}
async function paid(f: Awaited<ReturnType<typeof fixture>>, productIds = [f.product.id]) {
  const { order } = await service.createOrder(f.buyer, {
    items: productIds.map((productId) => ({ productId, quantity: 1 })),
    address,
    idempotencyKey: key(),
  });
  return (await service.testPay(f.buyer, order.id, key())).order;
}
async function fulfilled(status: "shipped" | "delivered", multiple = false) {
  const f = await fixture(),
    ids = [f.product.id];
  if (multiple)
    ids.push((await service.saveProduct(admin, { ...f.product, sku: key(), reason })).product.id);
  const order = await paid(f, ids),
    line = order.items.find((item) => item.productId === f.product.id)!;
  await service.accept(f.supplierUser, line.id);
  await service.ship(f.supplierUser, line.id, {
    carrier: "Synthetic courier",
    trackingNumber: key(),
  });
  if (status === "delivered") await service.deliver(admin, line.id, reason);
  await service.refund(admin, line.id, {
    refundTotalCents: line.lineCents,
    reason,
    idempotencyKey: key(),
  });
  return { ...f, order: (await service.adminOrder(order.id)).order, lineId: line.id };
}
async function finance() {
  return Promise.all([
    conn.db.select().from(schema.commerceOrders).orderBy(schema.commerceOrders.id),
    conn.db.select().from(schema.commerceProducts).orderBy(schema.commerceProducts.id),
    conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    conn.db.select().from(schema.commerceCommissions).orderBy(schema.commerceCommissions.id),
    conn.db.select().from(schema.commerceCustomers).orderBy(schema.commerceCustomers.userId),
    conn.db.select().from(schema.commerceWithdrawals).orderBy(schema.commerceWithdrawals.id),
    conn.db.select().from(schema.commerceOperations).orderBy(schema.commerceOperations.id),
  ]);
}
async function productAudit(id: string) {
  return conn.db
    .select()
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.action, "commerce.product.save"),
        eq(schema.auditEvents.targetId, id),
      ),
    )
    .orderBy(schema.auditEvents.id);
}
afterAll(() => conn.close());

describe("commerce operational requirement gaps", () => {
  it.each(["shipped", "delivered"] as const)(
    "allows nonfinancial support after a full refund of an owned %s item without changing money, stock or referral eligibility",
    async (status) => {
      const f = await fulfilled(status);
      expect(f.order.status).toBe("refunded");
      expect(f.order.items.find((item) => item.id === f.lineId)).toMatchObject({
        status,
        openCase: false,
        refundedCents: 10000,
      });
      const before = await finance();
      now = new Date(now.getTime() + 500 * 86400000); // Existing support has no new return-window cutoff.
      const result = await service.requestReturn(f.buyer, f.order.id, {
        itemId: f.lineId,
        reason: "  Physical return still needs assistance  ",
      });
      expect(result.order.items.find((item) => item.id === f.lineId)).toMatchObject({
        status,
        openCase: true,
        refundedCents: 10000,
      });
      expect(await finance()).toEqual(before);
      const managed = await service.adminOrder(f.order.id);
      expect(managed.order.items.find((item) => item.id === f.lineId)?.returnRequest?.reason).toBe(
        "Physical return still needs assistance",
      );
    },
  );

  it("allows support for a fully refunded fulfilled line while another SKU keeps the order paid", async () => {
    const f = await fulfilled("shipped", true),
      before = await finance();
    expect(f.order.status).toBe("paid");
    expect(f.order.refundedCents).toBe(10000);
    await service.requestReturn(f.buyer, f.order.id, {
      itemId: f.lineId,
      reason: "One shipped line is refunded but physical aftersales remains",
    });
    expect(
      (await service.adminOrder(f.order.id)).order.items.find((item) => item.id === f.lineId)
        ?.openCase,
    ).toBe(true);
    expect(await finance()).toEqual(before);
  });

  it("continues rejecting unpaid/cancelled/unfulfilled full refunds, other buyers and an item outside the given order", async () => {
    const f = await fulfilled("shipped"),
      stranger = await user();
    const ownOther = await paid(f);
    await expect(
      service.requestReturn(stranger, f.order.id, { itemId: f.lineId, reason }),
    ).rejects.toHaveProperty("status", 404);
    await expect(
      service.requestReturn(f.buyer, f.order.id, { itemId: ownOther.items[0]!.id, reason }),
    ).rejects.toHaveProperty("status", 404);
    const unpaid = (
      await service.createOrder(f.buyer, {
        items: [{ productId: f.product.id, quantity: 1 }],
        address,
        idempotencyKey: key(),
      })
    ).order;
    await expect(
      service.requestReturn(f.buyer, unpaid.id, { itemId: unpaid.items[0]!.id, reason }),
    ).rejects.toHaveProperty("status", 409);
    await service.cancelOrder(f.buyer, unpaid.id, key());
    await expect(
      service.requestReturn(f.buyer, unpaid.id, { itemId: unpaid.items[0]!.id, reason }),
    ).rejects.toHaveProperty("status", 409);
    await service.refund(admin, ownOther.items[0]!.id, {
      refundTotalCents: ownOther.items[0]!.lineCents,
      reason,
      idempotencyKey: key(),
    });
    const before = await finance();
    await expect(
      service.requestReturn(f.buyer, ownOther.id, { itemId: ownOther.items[0]!.id, reason }),
    ).rejects.toHaveProperty("status", 404);
    expect(await finance()).toEqual(before);
  });

  it("archives an existing inactive supplier SKU without reactivation, changing supplier association or financial history", async () => {
    const f = await fixture();
    await service.createOrder(f.buyer, {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    });
    await service.setSupplierActive(admin, f.supplier.id, false, reason);
    const before = await finance();
    const result = await service.saveProduct(admin, { status: "archived", reason }, f.product.id);
    expect(result.product).toMatchObject({
      id: f.product.id,
      supplierId: f.supplier.id,
      status: "archived",
      reserved: 1,
    });
    expect((await service.adminSupplierMembers(f.supplier.id)).supplier.active).toBe(false);
    const after = await finance();
    expect(after.filter((_, index) => index !== 1)).toEqual(
      before.filter((_, index) => index !== 1),
    );
    await service.setSupplierActive(admin, f.supplier.id, true, reason);
    expect((await service.catalog()).products.some((product) => product.id === f.product.id)).toBe(
      false,
    );
  });

  it("preserves administrator reassignment to an active supplier without rewriting prior supplier/cost/SKU snapshots", async () => {
    const f = await fixture(),
      replacement = await fixture(),
      order = await paid(f);
    const [before] = await conn.db
      .select()
      .from(schema.commerceOrderItems)
      .where(eq(schema.commerceOrderItems.orderId, order.id));
    const ledger = await conn.db
      .select()
      .from(schema.commerceLedger)
      .orderBy(schema.commerceLedger.id);
    await service.setSupplierActive(admin, f.supplier.id, false, reason);
    const result = await service.saveProduct(
      admin,
      { supplierId: replacement.supplier.id, costCents: 3000, sku: key(), reason },
      f.product.id,
    );
    expect(result.product).toMatchObject({
      supplierId: replacement.supplier.id,
      costCents: 3000,
      status: "published",
    });
    expect(
      (
        await conn.db
          .select()
          .from(schema.commerceOrderItems)
          .where(eq(schema.commerceOrderItems.orderId, order.id))
      )[0],
    ).toEqual(before);
    expect(before).toMatchObject({
      supplierId: f.supplier.id,
      costCents: 4000,
      sku: f.product.sku,
    });
    expect(
      await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    ).toEqual(ledger);
  });

  it("does not broaden inactive target supplier creation/publication/drafts/reassignment or permit stock below existing reservations", async () => {
    const f = await fixture(),
      other = await fixture();
    await service.createOrder(f.buyer, {
      items: [{ productId: f.product.id, quantity: 1 }],
      address,
      idempotencyKey: key(),
    });
    await service.setSupplierActive(admin, f.supplier.id, false, reason);
    await service.setSupplierActive(admin, other.supplier.id, false, reason);
    await expect(
      service.saveProduct(admin, { ...f.product, sku: key(), status: "archived", reason }),
    ).rejects.toHaveProperty("status", 404);
    await expect(
      service.saveProduct(admin, { status: "published", reason }, f.product.id),
    ).rejects.toHaveProperty("status", 404);
    await expect(
      service.saveProduct(admin, { status: "draft", reason }, f.product.id),
    ).rejects.toHaveProperty("status", 404);
    await expect(
      service.saveProduct(
        admin,
        { supplierId: other.supplier.id, status: "archived", reason },
        f.product.id,
      ),
    ).rejects.toHaveProperty("status", 404);
    await expect(
      service.saveProduct(admin, { status: "archived", stock: 0, reason }, f.product.id),
    ).rejects.toHaveProperty("status", 409);
  });

  it("requires a trimmed 1..500 character reason on actual product creates and updates before any data or audit mutation", async () => {
    const f = await fixture(),
      before = await finance(),
      priorAudit = await productAudit(f.product.id);
    for (const value of [undefined, null, "", "  ", "x".repeat(501), 4]) {
      await expect(
        service.saveProduct(admin, { priceCents: 11000, reason: value }, f.product.id),
      ).rejects.toHaveProperty("status", 400);
      await expect(
        service.saveProduct(admin, { ...f.product, sku: key(), reason: value }),
      ).rejects.toHaveProperty("status", 400);
    }
    expect(await finance()).toEqual(before);
    expect(await productAudit(f.product.id)).toEqual(priorAudit);
  });

  it("records the full trimmed reason in standard and structured audit fields without rewriting legacy history", async () => {
    const f = await fixture(),
      auditReason = "x".repeat(500);
    const [legacy] = await conn.db
      .insert(schema.auditEvents)
      .values({
        actorType: "admin",
        actorId: admin.id,
        action: "commerce.product.save",
        targetType: "commerce",
        targetId: f.product.id,
        after: { status: "draft" },
        reason: null,
        traceId: "synthetic-legacy-product-audit",
      })
      .returning();
    await service.saveProduct(
      admin,
      { priceCents: 11000, reason: ` ${auditReason} ` },
      f.product.id,
    );
    const [entry] = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, "commerce.product.save"),
          eq(schema.auditEvents.targetId, f.product.id),
          eq(schema.auditEvents.reason, auditReason),
        ),
      );
    expect(entry).toMatchObject({
      reason: auditReason,
      after: { reason: auditReason, priceCents: 11000, sku: f.product.sku },
    });
    expect(
      (
        await conn.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.id, legacy!.id))
      )[0],
    ).toEqual(legacy);
  });

  it("rolls back catalog changes and their audit together if recording the reason fails", async () => {
    const f = await fixture();
    const proxy = new Proxy(conn.db, {
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
                            throw new Error("Injected catalog audit failure");
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
    const failing = new CommerceService(proxy, service.options),
      before = await finance(),
      priorAudit = await productAudit(f.product.id);
    await expect(
      failing.saveProduct(admin, { priceCents: 13000, reason }, f.product.id),
    ).rejects.toHaveProperty("status", 500);
    expect(await finance()).toEqual(before);
    expect(await productAudit(f.product.id)).toEqual(priorAudit);
  });
});
