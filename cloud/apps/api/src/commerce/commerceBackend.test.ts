import { describe, expect, it, vi } from "vitest";
import type { DjlDatabase } from "@djl/db";
import {
  CommerceService,
  commerceAddress,
  commerceId,
  commerceImageUrl,
  commerceInteger,
  commercePage,
  commerceRemainingSupplierCost,
} from "./CommerceService.ts";
import { COMMERCE_CSV_COLUMNS, parseCommerceCsv } from "./csv.ts";

describe("commerce input boundaries", () => {
  it("reads every wallet bucket in one grouped query instead of mixing commit snapshots", async () => {
    const groupBy = vi.fn(async () => [
      { account: "available", amount: "2000" },
      { account: "frozen", amount: "1000" },
      { account: "recovery", amount: "-5" },
    ]);
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ groupBy }) }) }));
    const service = new CommerceService({ select } as unknown as DjlDatabase, {
      mode: "test",
      environment: "test",
    });
    expect(await service.wallet(crypto.randomUUID())).toEqual({
      pendingCents: 0,
      availableCents: 2000,
      frozenCents: 1000,
      paidCents: 0,
      recoveryCents: 5,
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
  });
  it("reads the trusted catalog snapshot without sweeping reservations but still sweeps the public catalog", async () => {
    const row = {
      id: crypto.randomUUID(),
      sku: "SNAPSHOT-TEST",
      name: "Test tote",
      description: "Cotton tote",
      category: "Bags",
      imageUrl: "/shop/media/test-tote.png",
      priceCents: 10000,
      costCents: 4000,
      commissionBps: 1000,
      returnDays: 30,
      stock: 2,
      reserved: 1,
    };
    const limit = vi.fn(async () => [{ product: row }]);
    const select = vi.fn(() => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit }) }) }) }),
    }));
    const transaction = vi.fn(async () => {
      throw new Error("This catalog projection must not enter a write transaction.");
    });
    const service = new CommerceService({ select, transaction } as unknown as DjlDatabase, {
      mode: "disabled",
      environment: "test",
      checkoutPaused: true,
    });
    const snapshot = await service.catalogSnapshot();
    expect(snapshot).toEqual({
      mode: "disabled",
      paymentProvider: "disabled",
      checkoutPaused: true,
      currency: "CAD",
      products: [
        {
          id: row.id,
          sku: row.sku,
          name: row.name,
          description: row.description,
          category: row.category,
          imageUrl: row.imageUrl,
          priceCents: row.priceCents,
          commissionBps: row.commissionBps,
          returnDays: row.returnDays,
          stock: 1,
        },
      ],
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(row.reserved).toBe(1);
    expect(limit).toHaveBeenCalledExactlyOnceWith(1000);

    const sweep = vi.spyOn(service, "expireReservations").mockImplementation(async () => {
      row.reserved = 0;
    });
    await expect(service.catalog()).resolves.toEqual({
      ...snapshot,
      products: [{ ...snapshot.products[0], stock: 2 }],
    });
    expect(sweep).toHaveBeenCalledOnce();
  });

  it("accepts bounded zero-based pages, never arbitrary offsets or fractional pages", () => {
    expect(commercePage()).toBe(0);
    expect(commercePage("2")).toBe(2);
    for (const page of [-1, 1.1, 10001, "1.5", "NaN", null])
      expect(() => commercePage(page)).toThrow();
  });
  it("does not expose SQL bind parameters after a failed write or assert an unknown commit failed", async () => {
    const db = {
      transaction: async () => {
        throw new Error("query params: private-address private-note");
      },
    } as unknown as DjlDatabase;
    const service = new CommerceService(db, { mode: "test", environment: "test" });
    await expect(
      service.createSupplier(
        { id: crypto.randomUUID(), type: "admin", traceId: "private-error" },
        {
          name: "Test supplier",
          returnAddress: "private-address",
          reason: "Test-only administrator supplier creation approved",
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    ).rejects.toMatchObject({
      status: 500,
      code: "commerce_write_failed",
      message: "Commerce operation could not be confirmed. Refresh its status before retrying.",
    });
  });
  it("accepts Canadian addresses only and normalizes province/postal code", () => {
    const address = {
      name: "Buyer",
      line1: "100 Test St",
      city: "Toronto",
      province: "on",
      postalCode: "m5v 2t6",
      country: "CA",
    };
    expect(commerceAddress(address)).toMatchObject({ province: "ON", postalCode: "M5V2T6" });
    for (const invalid of [
      { ...address, country: "US" },
      { ...address, province: "ZZ" },
      { ...address, postalCode: "123456" },
      null,
    ])
      expect(() => commerceAddress(invalid)).toThrow();
  });
  it("rejects non-integer cents, invalid identifiers and unsafe image schemes", () => {
    for (const value of [1.5, NaN, Infinity, "20", -1, Number.MAX_SAFE_INTEGER + 1])
      expect(() => commerceInteger(value, "cents", 0, 100)).toThrow();
    for (const value of [
      "",
      "../user",
      "https://test.invalid",
      "00000000-0000-0000-0000-000000000000",
    ])
      expect(() => commerceId(value)).toThrow();
    expect(commerceImageUrl("/shop/media/tote.jpg")).toBe("/shop/media/tote.jpg");
    expect(commerceImageUrl("https://media.test/tote.jpg")).toBe("https://media.test/tote.jpg");
    for (const value of [
      "//foreign.test/image",
      "javascript:alert(1)",
      "http://media.test/image",
      "https://secret@media.test/image",
      "/\\foreign.test/image",
      "/products/tote.jpg",
      "/shop/../chat/image.jpg",
      "/shop/%2e%2e/chat/image.jpg",
      "/shop/media//foreign.test/image.jpg",
    ])
      expect(() => commerceImageUrl(value)).toThrow();
  });
  it("allocates supplier costs exactly even when intermediate multiplication exceeds 2^53", () => {
    const goods = 99_999_989 * 999;
    const cost = 99_999_983;
    for (const refunded of [0, 1, 33_333_331, goods - 1, goods]) {
      const expected = Number((BigInt(goods - refunded) * BigInt(cost)) / 99_999_989n);
      expect(commerceRemainingSupplierCost(goods, refunded, 99_999_989, cost)).toBe(expected);
    }
    expect(() => commerceRemainingSupplierCost(100, 101, 100, 50)).toThrow();
    expect(() => commerceRemainingSupplierCost(100, 0, 0, 0)).toThrow();
  });
  it("parses escaped CSV to draft inputs and rejects malformed/oversized batches", () => {
    const header = COMMERCE_CSV_COLUMNS.join(",");
    const row =
      '00000000-0000-4000-8000-000000000001,SKU,"Canvas, tote","Line 1\nLine ""2""",Bags,/shop/media/tote.jpg,3900,1900,1000,30,10';
    expect(parseCommerceCsv(`\uFEFF${header}\r\n${row}`)).toEqual([
      {
        supplierId: "00000000-0000-4000-8000-000000000001",
        sku: "SKU",
        name: "Canvas, tote",
        description: 'Line 1\nLine "2"',
        category: "Bags",
        imageUrl: "/shop/media/tote.jpg",
        priceCents: 3900,
        costCents: 1900,
        commissionBps: 1000,
        returnDays: 30,
        stock: 10,
      },
    ]);
    for (const text of [
      "wrong,header\n1,2",
      `${header}\n"unclosed`,
      `${header}\n1,2`,
      "x".repeat(200001),
      header,
    ])
      expect(() => parseCommerceCsv(text)).toThrow();
  });
});
