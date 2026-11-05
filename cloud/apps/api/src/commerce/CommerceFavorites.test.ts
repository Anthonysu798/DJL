/** Real PostgreSQL suite; requires the normal isolated, migrated loopback test database. */
import { eq, sql } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";

import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { CommerceService, type CommerceActor } from "./CommerceService.ts";

const connection = await isolatedCommerceTestDatabase();
afterAll(() => connection.close());
const service = new CommerceService(connection.db, { mode: "disabled", environment: "test" });
const actor = (id: string): CommerceActor => ({ id, type: "user", traceId: "favorites-test" });
async function buyer() {
  const id = crypto.randomUUID();
  await connection.db
    .insert(schema.user)
    .values({ id, name: "Favorite QA", email: `${id}@test.invalid`, emailVerified: true });
  return actor(id);
}
async function product(status: "published" | "archived" | "draft" = "published") {
  const [supplier] = await connection.db
    .insert(schema.commerceSuppliers)
    .values({ name: "Favorite QA", returnAddress: "Test-only address" })
    .returning();
  const [row] = await connection.db
    .insert(schema.commerceProducts)
    .values({
      supplierId: supplier!.id,
      sku: crypto.randomUUID(),
      name: "Favorite QA product",
      description: "Synthetic fixture",
      category: "QA",
      imageUrl: "",
      priceCents: 100,
      costCents: 0,
      commissionBps: 0,
      returnDays: 30,
      stock: 0,
      status,
    })
    .returning();
  return { row: row!, supplier: supplier! };
}

describe("account-owned commerce favorites", () => {
  it("persists across service instances, is replay-safe, private, and never moves funds", async () => {
    const a = await buyer(),
      b = await buyer(),
      p = await product();
    await service.setFavorite(a, p.row.id, true, a.id);
    await service.setFavorite(a, p.row.id, true, a.id);
    const otherClient = new CommerceService(connection.db, {
      mode: "disabled",
      environment: "test",
    });
    expect(await otherClient.favorites(a.id)).toEqual({ userId: a.id, productIds: [p.row.id] });
    expect(await service.favorites(b.id)).toEqual({ userId: b.id, productIds: [] });
    await service.setFavorite(b, p.row.id, false, b.id);
    expect((await service.favorites(a.id)).productIds).toEqual([p.row.id]);
    await service.setFavorite(a, p.row.id, false, a.id);
    await service.setFavorite(a, p.row.id, false, a.id);
    expect((await service.favorites(a.id)).productIds).toEqual([]);
    expect(await connection.db.select().from(schema.commerceLedger)).toHaveLength(0);
    expect(await connection.db.select().from(schema.commerceOrders)).toHaveLength(0);
  });

  it("rejects another account, admin callers, invalid ids, and non-boolean desired states", async () => {
    const a = await buyer(),
      b = await buyer(),
      p = await product();
    await expect(service.setFavorite(a, p.row.id, true, b.id)).rejects.toMatchObject({
      status: 401,
      code: "commerce_account_changed",
    });
    await expect(
      service.setFavorite({ ...a, type: "admin" }, p.row.id, true, a.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.setFavorite(a, "invalid-id", true, a.id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.setFavorite(a, p.row.id, "true", a.id)).rejects.toMatchObject({
      status: 400,
    });
    expect((await service.favorites(a.id)).productIds).toEqual([]);
  });

  it("allows out-of-stock published items, but not draft or suspended-supplier products", async () => {
    const a = await buyer(),
      draft = await product("draft"),
      p = await product();
    await expect(service.setFavorite(a, draft.row.id, true, a.id)).rejects.toMatchObject({
      status: 404,
    });
    await service.setFavorite(a, p.row.id, true, a.id);
    await connection.db
      .update(schema.commerceSuppliers)
      .set({ active: false })
      .where(eq(schema.commerceSuppliers.id, p.supplier.id));
    await expect(service.setFavorite(a, p.row.id, true, a.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await service.favorites(a.id)).toEqual({ userId: a.id, productIds: [p.row.id] });
    await service.setFavorite(a, p.row.id, false, a.id);
    expect((await service.favorites(a.id)).productIds).toEqual([]);
  });

  it("deduplicates concurrent saves without removing another buyer's record", async () => {
    const a = await buyer(),
      b = await buyer(),
      p = await product();
    await Promise.all(
      Array.from({ length: 8 }, () => service.setFavorite(a, p.row.id, true, a.id)),
    );
    await service.setFavorite(b, p.row.id, true, b.id);
    expect((await service.favorites(a.id)).productIds).toEqual([p.row.id]);
    await service.setFavorite(a, p.row.id, false, a.id);
    expect((await service.favorites(b.id)).productIds).toEqual([p.row.id]);
  });

  it("caps retained favorites even when older products are archived", async () => {
    const a = await buyer(),
      p = await product();
    const archived = await connection.db
      .insert(schema.commerceProducts)
      .values(
        Array.from({ length: 1000 }, () => ({
          supplierId: p.supplier.id,
          sku: crypto.randomUUID(),
          name: "Archived QA",
          description: "Synthetic cap fixture",
          category: "QA",
          imageUrl: "",
          priceCents: 100,
          costCents: 0,
          commissionBps: 0,
          returnDays: 30,
          stock: 0,
          status: "archived" as const,
        })),
      )
      .returning({ id: schema.commerceProducts.id });
    await connection.db
      .insert(schema.commerceFavorites)
      .values(archived.map(({ id }) => ({ userId: a.id, productId: id })));
    await expect(service.setFavorite(a, p.row.id, true, a.id)).rejects.toMatchObject({
      status: 409,
      code: "favorites_limit",
    });
    await service.setFavorite(a, archived[0]!.id, false, a.id);
    await service.setFavorite(a, p.row.id, true, a.id);
    expect((await service.favorites(a.id)).productIds).toHaveLength(1000);
  });

  it("cleans up favorite rows when an account is deleted", async () => {
    const a = await buyer(),
      p = await product();
    await service.setFavorite(a, p.row.id, true, a.id);
    await connection.db.delete(schema.user).where(eq(schema.user.id, a.id));
    const rows = await connection.db.execute(
      sql`select * from commerce_favorites where user_id=${a.id}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });
});
