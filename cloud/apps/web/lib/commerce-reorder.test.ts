import { describe, expect, it } from "vitest";
import type { CommerceProduct } from "@synara/contracts/cloud";
import * as commerce from "./commerce";

const product = (id: string, stock = 10): CommerceProduct => ({
  id,
  sku: id,
  name: id,
  category: "test",
  description: "test",
  imageUrl: "",
  priceCents: 7900,
  stock,
  commissionBps: 0,
  returnDays: 30,
});

describe("cloud reorder cart", () => {
  it("merges quantities immutably without importing historical price or address", () => {
    const cart = Object.freeze({ a: 1 });
    const lines = [
      { productId: "a", quantity: 2, priceCents: 1 },
      { productId: "b", quantity: 1 },
    ];
    const result = commerce.reorderCart(cart, lines, [product("a"), product("b")]);
    expect(result).toEqual({
      cart: { a: 3, b: 1 },
      addedCount: 3,
      adjustedCount: 0,
      skippedCount: 0,
    });
    expect(cart).toEqual({ a: 1 });
    expect(Object.keys(result.cart)).toEqual(["a", "b"]);
  });
  it("reports partial stock, unavailable products and per-SKU caps without deleting the existing cart", () => {
    expect(
      commerce.reorderCart(
        { a: 1, b: 999, removed: 2 },
        [
          { productId: "a", quantity: 4 },
          { productId: "b", quantity: 4 },
          { productId: "missing", quantity: 1 },
          { productId: "empty", quantity: 2 },
        ],
        [product("a", 2), product("b", 5000), product("empty", 0)],
      ),
    ).toEqual({
      cart: { a: 2, b: 1000, removed: 2 },
      addedCount: 2,
      adjustedCount: 2,
      skippedCount: 2,
    });
  });
  it("never adds a 51st SKU and still permits an existing SKU to increase", () => {
    const current = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`p-${i}`, 1]));
    const result = commerce.reorderCart(
      current,
      [
        { productId: "new", quantity: 1 },
        { productId: "p-0", quantity: 1 },
      ],
      [product("new"), product("p-0")],
    );
    expect(result.cart).toEqual({ ...current, "p-0": 2 });
    expect(result.addedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });
  it("repeated source lines cannot exceed fresh stock or the per-SKU cap", () => {
    expect(
      commerce.reorderCart(
        {},
        [
          { productId: "a", quantity: 2 },
          { productId: "a", quantity: 2 },
        ],
        [product("a", 3)],
      ),
    ).toEqual({ cart: { a: 3 }, addedCount: 3, adjustedCount: 1, skippedCount: 0 });
  });
  it("skips invalid historic quantities and unsafe product identifiers", () => {
    const result = commerce.reorderCart(
      {},
      [
        { productId: "a", quantity: 0 },
        { productId: "a", quantity: 1.5 },
        { productId: "a", quantity: NaN },
        { productId: "__proto__", quantity: 1 },
      ],
      [product("a"), product("__proto__")],
    );
    expect(result.cart).toEqual({});
    expect(result.addedCount).toBe(0);
    expect(result.skippedCount).toBe(4);
    expect(Object.getPrototypeOf(result.cart)).toBe(Object.prototype);
  });
});
