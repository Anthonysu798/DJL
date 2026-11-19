import test from "node:test";
import assert from "node:assert/strict";
import * as shop from "../apps/web/public/shop/state.mjs";

const now = new Date("2026-11-03T12:00:00.000Z");
const purchased = (id, quantity) =>
  shop.checkout(shop.addToCart(shop.createInitialState(), id, quantity), now);

test("new demo states have independent favorite and recently viewed lists", () => {
  const first = shop.createInitialState();
  assert.deepEqual(first.favorites, []);
  assert.deepEqual(first.recentlyViewed, []);
  first.favorites.push("tote");
  first.recentlyViewed.push("lamp");
  assert.deepEqual(shop.createInitialState().favorites, []);
  assert.deepEqual(shop.createInitialState().recentlyViewed, []);
});

test("legacy v1 storage keeps cart, orders and frozen wallet when preferences are absent", () => {
  let legacy = purchased("organizer", 1).state;
  legacy = shop.addToCart(legacy, "tote", 2);
  legacy = shop.createWithdrawal(legacy, now).state;
  delete legacy.favorites;
  delete legacy.recentlyViewed;
  const restored = shop.restoreState(JSON.stringify(legacy));
  assert.deepEqual(restored, { ...legacy, favorites: [], recentlyViewed: [] });
});

test("restored preference lists keep only unique known product IDs without resetting business data", () => {
  const state = purchased("tote", 1).state;
  const allIds = shop.PRODUCTS.map((product) => product.id);
  const restored = shop.restoreState(
    JSON.stringify({
      ...state,
      favorites: ["missing", "tote", "tote", null, {}, ...allIds, ...allIds],
      recentlyViewed: ["lamp", "lamp", false, "missing", ...allIds, ...allIds],
    }),
  );
  assert.deepEqual(restored.favorites, allIds);
  assert.deepEqual(restored.recentlyViewed, ["lamp", "tote", "tumbler", "organizer"]);
  assert.ok(restored.recentlyViewed.length <= 8);
  assert.deepEqual(restored.orders, state.orders);
  assert.deepEqual(restored.wallet, state.wallet);
  for (const value of [null, {}, "tote", 7]) {
    const withBadLists = shop.restoreState(
      JSON.stringify({ ...state, favorites: value, recentlyViewed: value }),
    );
    assert.deepEqual(withBadLists, { ...state, favorites: [], recentlyViewed: [] });
  }
});

test("favorite toggles are immutable and never alter cart, orders or wallet", () => {
  const initial = purchased("organizer", 1).state;
  const first = shop.toggleFavorite(initial, "tote");
  const second = shop.toggleFavorite(first, "lamp");
  const removed = shop.toggleFavorite(second, "tote");
  assert.deepEqual(initial.favorites, []);
  assert.deepEqual(first.favorites, ["tote"]);
  assert.deepEqual(second.favorites, ["tote", "lamp"]);
  assert.deepEqual(removed.favorites, ["lamp"]);
  assert.equal(removed.cart, initial.cart);
  assert.equal(removed.orders, initial.orders);
  assert.equal(removed.wallet, initial.wallet);
  assert.throws(() => shop.toggleFavorite(initial, "missing"), /商品不存在/);
});

test("recently viewed puts revisits first and never stores duplicate or foreign IDs", () => {
  const initial = shop.createInitialState();
  const first = shop.rememberViewed(initial, "tote");
  const second = shop.rememberViewed(first, "lamp");
  const revisit = shop.rememberViewed(second, "tote");
  assert.deepEqual(initial.recentlyViewed, []);
  assert.deepEqual(second.recentlyViewed, ["lamp", "tote"]);
  assert.deepEqual(revisit.recentlyViewed, ["tote", "lamp"]);
  assert.equal(revisit.orders, initial.orders);
  assert.equal(revisit.wallet, initial.wallet);
  assert.throws(() => shop.rememberViewed(initial, "missing"), /商品不存在/);
  assert.deepEqual(shop.restoreState(JSON.stringify(revisit)), revisit);
});

test("reorder merges into the existing cart and uses current catalog pricing", () => {
  const original = purchased("tote", 2);
  const state = shop.addToCart(original.state, "tumbler", 1);
  const result = shop.reorderOrder(state, original.order.id);
  assert.deepEqual(result.state.cart, { tumbler: 1, tote: 2 });
  assert.deepEqual(result.added, [{ id: "tote", quantity: 2 }]);
  assert.deepEqual(result.adjusted, []);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(state.cart, { tumbler: 1 });
  assert.equal(shop.totals(result.state).totalCents, 10700);
  assert.equal(shop.cartItems(result.state)[1].product, shop.PRODUCTS[0]);
  assert.equal(result.state.orders, state.orders);
  assert.equal(result.state.wallet, state.wallet);
  assert.deepEqual(shop.restoreState(JSON.stringify(result.state)), result.state);
});

test("reorder reports a partial addition after purchases and existing cart consume availability", () => {
  const original = purchased("lamp", 5);
  const state = shop.addToCart(original.state, "lamp", 2);
  const result = shop.reorderOrder(state, original.order.id);
  assert.deepEqual(result.state.cart, { lamp: 3 });
  assert.deepEqual(result.added, [{ id: "lamp", quantity: 1 }]);
  assert.deepEqual(result.adjusted, [{ id: "lamp", requestedQuantity: 5, addedQuantity: 1 }]);
  assert.deepEqual(result.skipped, []);
  assert.equal(shop.remainingStock(result.state, "lamp"), 3);
  assert.throws(() => shop.addToCart(result.state, "lamp"), /库存/);
});

test("sold-out reorders report skipped lines without inventing a purchase or changing the wallet", () => {
  const original = purchased("lamp", 8);
  const result = shop.reorderOrder(original.state, original.order.id);
  assert.deepEqual(result.state.cart, {});
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.adjusted, []);
  assert.deepEqual(result.skipped, [{ id: "lamp", reason: "out-of-stock" }]);
  assert.equal(result.state.orders, original.state.orders);
  assert.equal(result.state.wallet, original.state.wallet);
  assert.equal(result.state.orders.length, 1);
});

test("one reorder truthfully distinguishes fully skipped and partially added lines", () => {
  let firstCart = shop.addToCart(shop.createInitialState(), "lamp", 7);
  firstCart = shop.addToCart(firstCart, "tote", 2);
  const first = shop.checkout(firstCart, now);
  const second = shop.checkout(shop.addToCart(first.state, "lamp", 1), new Date(now.getTime() + 1));
  const state = shop.addToCart(second.state, "tote", 9);
  const result = shop.reorderOrder(state, first.order.id);
  assert.deepEqual(result.added, [{ id: "tote", quantity: 1 }]);
  assert.deepEqual(result.adjusted, [{ id: "tote", requestedQuantity: 2, addedQuantity: 1 }]);
  assert.deepEqual(result.skipped, [{ id: "lamp", reason: "out-of-stock" }]);
  assert.deepEqual(result.state.cart, { tote: 10 });
  const checkedOut = shop.checkout(result.state, new Date(now.getTime() + 2));
  assert.equal(checkedOut.order.totalCents, 39000);
  assert.equal(shop.remainingStock(checkedOut.state, "tote"), 0);
  assert.deepEqual(checkedOut.state.wallet, state.wallet);
});

test("unknown reorder IDs fail without mutating any demo state", () => {
  const state = purchased("organizer", 1).state;
  const before = JSON.stringify(state);
  assert.throws(() => shop.reorderOrder(state, "missing-order"), /订单不存在/);
  assert.equal(JSON.stringify(state), before);
});
