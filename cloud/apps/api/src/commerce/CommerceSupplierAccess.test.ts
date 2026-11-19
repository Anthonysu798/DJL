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
const service = new CommerceService(conn.db, { mode: "test", environment: "test" });
const admin: CommerceActor = {
  id: crypto.randomUUID(),
  type: "admin",
  traceId: "supplier-access-test",
};
const reason = "Synthetic administrator supplier access review";
const key = () => crypto.randomUUID();
const address = {
  name: "Synthetic buyer",
  line1: "100 Test Road",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA",
};

const access = service;
async function user() {
  const actor: CommerceActor = { id: key(), type: "user", traceId: "supplier-access-test" };
  await conn.db.insert(schema.user).values({
    id: actor.id,
    name: "Synthetic supplier access",
    email: `${actor.id}@test.invalid`,
    emailVerified: true,
  });
  await service.profile(actor.id);
  return actor;
}
async function fixture() {
  const supplierUser = await user();
  const { supplier } = await service.createSupplier(admin, {
    name: "Synthetic supplier",
    returnAddress: "Toronto, Canada",
    reason,
    idempotencyKey: crypto.randomUUID(),
  });
  await access.addSupplierMember(admin, supplier.id, supplierUser.id, reason);
  const { product } = await service.saveProduct(admin, {
    supplierId: supplier.id,
    sku: key(),
    name: "Synthetic tote",
    description: "Supplier access fixture",
    category: "QA",
    imageUrl: "/shop/media/test.png",
    priceCents: 10000,
    costCents: 4000,
    commissionBps: 1000,
    returnDays: 30,
    stock: 20,
    status: "published",
    reason: "Test-only administrator checked supplier quote and approved catalog change",
  });
  return { supplierUser, supplier, product };
}
async function order(buyer: CommerceActor, productId: string, paid = true) {
  const created = await service.createOrder(buyer, {
    items: [{ productId, quantity: 1 }],
    address,
    idempotencyKey: key(),
  });
  return paid ? (await service.testPay(buyer, created.order.id, key())).order : created.order;
}
async function history() {
  return Promise.all([
    conn.db.select().from(schema.commerceProducts).orderBy(schema.commerceProducts.id),
    conn.db.select().from(schema.commerceOrders).orderBy(schema.commerceOrders.id),
    conn.db.select().from(schema.commerceOrderItems).orderBy(schema.commerceOrderItems.id),
    conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    conn.db.select().from(schema.commerceCommissions).orderBy(schema.commerceCommissions.id),
    conn.db.select().from(schema.commerceWithdrawals).orderBy(schema.commerceWithdrawals.id),
    conn.db.select().from(schema.commerceCustomers).orderBy(schema.commerceCustomers.userId),
  ]);
}
async function audit(action: string, supplierId: string) {
  return conn.db
    .select()
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.action, `commerce.${action}`),
        eq(schema.auditEvents.targetId, supplierId),
      ),
    )
    .orderBy(schema.auditEvents.createdAt, schema.auditEvents.id);
}
const membership = (supplierId: string, userId: string) =>
  conn.db
    .select()
    .from(schema.commerceSupplierMembers)
    .where(
      and(
        eq(schema.commerceSupplierMembers.supplierId, supplierId),
        eq(schema.commerceSupplierMembers.userId, userId),
      ),
    );
afterAll(() => conn.close());

describe("audited supplier access administration", () => {
  it("creates once per explicit intent, fingerprints trimmed fields and never reactivates a supplier on replay", async () => {
    const body = {
      name: "Idempotent supplier",
      returnAddress: "Toronto, Canada",
      reason,
      idempotencyKey: key(),
    };
    const { supplier } = await service.createSupplier(admin, body);
    const replay = await service.createSupplier(admin, {
      ...body,
      name: ` ${body.name} `,
      returnAddress: ` ${body.returnAddress} `,
      reason: ` ${reason} `,
      actorId: "ignored",
    });
    expect(replay.supplier.id).toBe(supplier.id);
    expect(await audit("supplier.create", supplier.id)).toHaveLength(1);
    await expect(
      service.createSupplier(admin, { ...body, name: "Different payload" }),
    ).rejects.toHaveProperty("status", 409);
    await access.setSupplierActive(admin, supplier.id, false, reason);
    expect((await service.createSupplier(admin, { ...body, active: true })).supplier).toMatchObject(
      { id: supplier.id, active: false },
    );
    expect(await audit("supplier.create", supplier.id)).toHaveLength(1);
    expect(
      await conn.db
        .select()
        .from(schema.commerceOperations)
        .where(
          and(
            eq(schema.commerceOperations.actorId, admin.id),
            eq(schema.commerceOperations.kind, "supplier.create"),
            eq(schema.commerceOperations.key, body.idempotencyKey),
          ),
        ),
    ).toHaveLength(1);
    const before = await conn.db.select().from(schema.commerceSuppliers);
    await expect(
      service.createSupplier(admin, { name: "Missing intent", returnAddress: "Toronto", reason }),
    ).rejects.toHaveProperty("status", 400);
    expect(await conn.db.select().from(schema.commerceSuppliers)).toEqual(before);
  });
  it("does not accept a regular user or system actor as supplier administration authority", async () => {
    const f = await fixture(),
      before = await history();
    for (const actor of [f.supplierUser, { ...admin, type: "system" as const }]) {
      await expect(
        service.createSupplier(actor, {
          name: "Forbidden",
          returnAddress: "Toronto",
          reason,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toHaveProperty("status", 403);
      await expect(
        service.addSupplierMember(actor, f.supplier.id, f.supplierUser.id, reason),
      ).rejects.toHaveProperty("status", 403);
      await expect(
        service.revokeSupplierMember(actor, f.supplier.id, f.supplierUser.id, reason),
      ).rejects.toHaveProperty("status", 403);
      await expect(
        service.setSupplierActive(actor, f.supplier.id, false, reason),
      ).rejects.toHaveProperty("status", 403);
    }
    expect(await history()).toEqual(before);
    expect(await membership(f.supplier.id, f.supplierUser.id)).toHaveLength(1);
  });
  it("requires and atomically records trimmed creation and grant reasons in both standard and structured audit fields", async () => {
    const before = await conn.db.select().from(schema.commerceSuppliers);
    await expect(
      service.createSupplier(admin, {
        name: "No reason",
        returnAddress: "Toronto",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toHaveProperty("status", 400);
    expect(await conn.db.select().from(schema.commerceSuppliers)).toEqual(before);
    const { supplier } = await service.createSupplier(admin, {
      name: "With reason",
      returnAddress: "Toronto",
      reason: `  ${reason}  `,
      idempotencyKey: crypto.randomUUID(),
    });
    expect((await audit("supplier.create", supplier.id)).at(-1)).toMatchObject({
      reason,
      after: { reason, name: "With reason" },
    });
    const member = await user();
    await expect(
      access.addSupplierMember(admin, supplier.id, member.id, undefined),
    ).rejects.toHaveProperty("status", 400);
    expect(await membership(supplier.id, member.id)).toHaveLength(0);
    await access.addSupplierMember(admin, supplier.id, member.id, `  ${reason}  `);
    expect((await audit("supplier.member", supplier.id)).at(-1)).toMatchObject({
      reason,
      after: { reason, userId: member.id },
    });
  });

  it("paginates every member deterministically without exposing additional user PII, including inactive supplier metadata", async () => {
    const f = await fixture();
    const ids = Array.from({ length: 104 }, key);
    await conn.db.insert(schema.user).values(
      ids.map((id) => ({
        id,
        name: "Synthetic list fixture",
        email: `${id}@test.invalid`,
        emailVerified: true,
      })),
    );
    await conn.db
      .insert(schema.commerceSupplierMembers)
      .values(ids.map((userId) => ({ supplierId: f.supplier.id, userId })));
    await access.setSupplierActive(admin, f.supplier.id, false, reason);
    const first = await access.adminSupplierMembers(f.supplier.id),
      second = await access.adminSupplierMembers(f.supplier.id, 1);
    expect(first.supplier).toEqual({ id: f.supplier.id, name: f.supplier.name, active: false });
    expect(first.members).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect(first.page).toBe(0);
    expect(second.members).toHaveLength(5);
    expect(second.hasMore).toBe(false);
    const all = [...first.members, ...second.members];
    expect(all.map((row) => row.userId)).toEqual([...ids, f.supplierUser.id].toSorted());
    expect(all.every((row) => Object.keys(row).join() === "userId")).toBe(true);
    expect((await access.adminSupplierMembers(f.supplier.id, 2)).members).toEqual([]);
    await expect(access.adminSupplierMembers(f.supplier.id, "-1")).rejects.toHaveProperty(
      "status",
      400,
    );
    await expect(access.adminSupplierMembers(key())).rejects.toHaveProperty("status", 404);
  });

  it("revokes the existing actor immediately without changing financial history or removing another supplier membership", async () => {
    const f = await fixture(),
      other = await fixture(),
      buyer = await user();
    const paid = await order(buyer, f.product.id),
      itemId = paid.items[0]!.id;
    const before = await history();
    await access.revokeSupplierMember(admin, f.supplier.id, f.supplierUser.id, `  ${reason}  `);
    expect(await membership(f.supplier.id, f.supplierUser.id)).toEqual([]);
    expect(await membership(other.supplier.id, other.supplierUser.id)).toHaveLength(1);
    expect((await service.profile(f.supplierUser.id)).suppliers).toEqual([]);
    await expect(service.supplierProducts(f.supplierUser.id)).rejects.toHaveProperty("status", 403);
    await expect(service.supplierOrders(f.supplierUser.id)).rejects.toHaveProperty("status", 403);
    await expect(service.supplierStatement(f.supplierUser, f.supplier.id)).rejects.toHaveProperty(
      "status",
      403,
    );
    await expect(service.updateStock(f.supplierUser, f.product.id, 19)).rejects.toHaveProperty(
      "status",
      404,
    );
    await expect(service.accept(f.supplierUser, itemId)).rejects.toHaveProperty("status", 404);
    await expect(
      service.ship(f.supplierUser, itemId, { carrier: "Synthetic", trackingNumber: key() }),
    ).rejects.toHaveProperty("status", 404);
    await expect(
      service.reportSupplierIssue(f.supplierUser, itemId, {
        kind: "other",
        reason,
        idempotencyKey: key(),
      }),
    ).rejects.toHaveProperty("status", 404);
    expect(await history()).toEqual(before);
    expect((await audit("supplier.member.revoke", f.supplier.id)).at(-1)).toMatchObject({
      reason,
      after: { reason, userId: f.supplierUser.id },
    });
  });

  it("does not revoke a member through the wrong supplier or accept missing objects", async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(
      access.revokeSupplierMember(admin, other.supplier.id, f.supplierUser.id, reason),
    ).rejects.toHaveProperty("status", 404);
    await expect(
      access.revokeSupplierMember(admin, key(), f.supplierUser.id, reason),
    ).rejects.toHaveProperty("status", 404);
    await expect(access.setSupplierActive(admin, key(), false, reason)).rejects.toHaveProperty(
      "status",
      404,
    );
    expect(await membership(f.supplier.id, f.supplierUser.id)).toHaveLength(1);
    expect(await audit("supplier.member.revoke", other.supplier.id)).toEqual([]);
  });

  it("suppresses new shopping and fulfillment when inactive, retains admin history and never restores a revoked member on reactivation", async () => {
    const f = await fixture(),
      buyer = await user(),
      retained = await user();
    await access.addSupplierMember(admin, f.supplier.id, retained.id, reason);
    const paid = await order(buyer, f.product.id),
      before = await history();
    await access.setSupplierActive(admin, f.supplier.id, false, `  ${reason}  `);
    expect((await service.catalog()).products.some((row) => row.id === f.product.id)).toBe(false);
    await expect(
      service.createOrder(buyer, {
        items: [{ productId: f.product.id, quantity: 1 }],
        address,
        idempotencyKey: key(),
      }),
    ).rejects.toHaveProperty("status", 409);
    await expect(service.accept(retained, paid.items[0]!.id)).rejects.toHaveProperty("status", 404);
    expect((await service.adminOrder(paid.id)).order.id).toBe(paid.id);
    expect((await service.supplierStatement(admin, f.supplier.id)).summary.closingCents).toBe(4000);
    expect(await history()).toEqual(before);
    await access.revokeSupplierMember(admin, f.supplier.id, f.supplierUser.id, reason);
    await access.setSupplierActive(admin, f.supplier.id, true, reason);
    await expect(service.supplierProducts(f.supplierUser.id)).rejects.toHaveProperty("status", 403);
    expect(
      (await service.supplierProducts(retained.id)).products.some((row) => row.id === f.product.id),
    ).toBe(true);
    expect(await membership(f.supplier.id, f.supplierUser.id)).toEqual([]);
    expect((await audit("supplier.status", f.supplier.id))[0]).toMatchObject({
      reason,
      after: { active: false, reason },
    });
    expect(await history()).toEqual(before);
  });

  it("does not cancel existing reservations, block known payment settlement, or remove buyer aftersales on supplier deactivation", async () => {
    const f = await fixture(),
      buyer = await user();
    const pending = await order(buyer, f.product.id, false),
      cancellable = await order(buyer, f.product.id, false);
    const before = await history();
    await access.setSupplierActive(admin, f.supplier.id, false, reason);
    expect(await history()).toEqual(before);
    expect(
      (await service.listOrders(buyer.id)).orders.find((row) => row.id === pending.id)?.status,
    ).toBe("awaiting_payment");
    const paid = (await service.testPay(buyer, pending.id, key())).order;
    expect(paid.status).toBe("paid");
    expect(paid.items[0]).toMatchObject({ sku: f.product.sku, priceCents: 10000 });
    await service.requestReturn(buyer, paid.id, { itemId: paid.items[0]!.id, reason });
    expect((await service.adminOrder(paid.id)).order.items[0]!.openCase).toBe(true);
    expect((await service.cancelOrder(buyer, cancellable.id, key())).order.status).toBe(
      "cancelled",
    );
    await service.refund(admin, paid.items[0]!.id, {
      refundTotalCents: 10000,
      reason,
      idempotencyKey: key(),
    });
    expect((await service.adminOrder(paid.id)).order.items[0]!.openCase).toBe(true);
  });

  it("strictly validates boolean status and trimmed nonempty reasons before any state or audit mutation", async () => {
    const f = await fixture(),
      before = await history();
    const baseline = await conn.db.select().from(schema.auditEvents);
    for (const active of [undefined, null, 0, 1, "false", "true", {}])
      await expect(
        access.setSupplierActive(admin, f.supplier.id, active, reason),
      ).rejects.toHaveProperty("status", 400);
    for (const invalid of [undefined, null, "", "   ", "x".repeat(501), 1]) {
      await expect(
        access.setSupplierActive(admin, f.supplier.id, false, invalid),
      ).rejects.toHaveProperty("status", 400);
      await expect(
        access.revokeSupplierMember(admin, f.supplier.id, f.supplierUser.id, invalid),
      ).rejects.toHaveProperty("status", 400);
    }
    expect((await access.adminSupplierMembers(f.supplier.id)).supplier.active).toBe(true);
    expect(await membership(f.supplier.id, f.supplierUser.id)).toHaveLength(1);
    expect(await conn.db.select().from(schema.auditEvents)).toEqual(baseline);
    expect(await history()).toEqual(before);
  });

  it("rolls back creation, membership grants, revocation and status changes if their required audit insert fails", async () => {
    const f = await fixture(),
      newMember = await user();
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
                            throw new Error("Injected supplier access audit failure");
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
    const failingService = new CommerceService(proxy, service.options),
      failing = failingService;
    const suppliersBefore = await conn.db.select().from(schema.commerceSuppliers),
      before = await history();
    const createBody = {
      name: "Must roll back",
      returnAddress: "Toronto",
      reason,
      idempotencyKey: key(),
    };
    await expect(failingService.createSupplier(admin, createBody)).rejects.toHaveProperty(
      "status",
      500,
    );
    await expect(
      failing.addSupplierMember(admin, f.supplier.id, newMember.id, reason),
    ).rejects.toHaveProperty("status", 500);
    await expect(
      failing.revokeSupplierMember(admin, f.supplier.id, f.supplierUser.id, reason),
    ).rejects.toHaveProperty("status", 500);
    await expect(
      failing.setSupplierActive(admin, f.supplier.id, false, reason),
    ).rejects.toHaveProperty("status", 500);
    expect(await conn.db.select().from(schema.commerceSuppliers)).toEqual(suppliersBefore);
    expect(await membership(f.supplier.id, newMember.id)).toEqual([]);
    expect(await membership(f.supplier.id, f.supplierUser.id)).toHaveLength(1);
    expect(await history()).toEqual(before);
    expect(
      await conn.db
        .select()
        .from(schema.commerceOperations)
        .where(eq(schema.commerceOperations.key, createBody.idempotencyKey)),
    ).toEqual([]);
    const retried = await service.createSupplier(admin, createBody);
    expect((await service.createSupplier(admin, createBody)).supplier.id).toBe(retried.supplier.id);
    expect(await audit("supplier.create", retried.supplier.id)).toHaveLength(1);
  });
});
