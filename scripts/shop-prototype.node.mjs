import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import {
  PRODUCTS,
  createInitialState,
  restoreState,
  remainingStock,
  addToCart,
  setQuantity,
  cartItems,
  totals,
  checkout,
  createWithdrawal,
  formatMoney,
} from "../apps/web/public/shop/state.mjs";

const now = new Date("2026-10-25T12:00:00.000Z");
const escaped = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

test("sample preview styling does not reset the inherited product sprite", async () => {
  const css = await readFile(new URL("../apps/web/public/shop/style.css", import.meta.url), "utf8");
  const preview = css.match(/\.upload-preview\s*\{([^}]+)\}/)?.[1];
  assert.ok(preview, "sample preview style exists");
  assert.doesNotMatch(
    preview,
    /(?:^|;)\s*background\s*:/,
    "background shorthand erases the sprite",
  );
  assert.match(preview, /background-color\s*:/);
});

test("prototype product details render the existing escaped specifications", async () => {
  const app = await readFile(new URL("../apps/web/public/shop/app.js", import.meta.url), "utf8");
  const detail = app.slice(app.indexOf("function showProduct("), app.indexOf("function summary("));
  assert.match(detail, /<dt>规格<\/dt><dd>\$\{escape\(product\.specs\)\}<\/dd>/);
});

test("the real reset action writes only the shop key and preserves unrelated AI storage", async () => {
  const app = await readFile(new URL("../apps/web/public/shop/app.js", import.meta.url), "utf8");
  const keyDeclaration = app.match(/^const STORAGE_KEY = "djl-shop-prototype-v1";/m)?.[0];
  assert.ok(keyDeclaration);
  const save = app.slice(app.indexOf("function save("), app.indexOf("function toast("));
  const action = app.slice(
    app.indexOf("function handleAction("),
    app.indexOf('document.addEventListener("click"'),
  );
  const stored = new Map([
    ["djl-shop-prototype-v1", JSON.stringify(addToCart(createInitialState(), "tote", 2))],
    ["fixture-ai-draft", "synthetic unsent AI draft"],
  ]);
  const writes = [];
  const closed = [];
  const navigation = [];
  runInNewContext(
    `${keyDeclaration}\n${save}\n${action}\nhandleAction("reset");`,
    {
      state: null,
      createInitialState,
      localStorage: {
        setItem(key, value) {
          writes.push(key);
          stored.set(key, value);
        },
        clear() {
          assert.fail("reset must not clear unrelated storage");
        },
        removeItem() {
          assert.fail("reset must not remove unrelated storage");
        },
      },
      updateNavigation() {},
      clearImage() {},
      closeDialog(id) {
        closed.push(id);
      },
      navigate(view) {
        navigation.push(view);
      },
      toast() {},
    },
    { timeout: 1000 },
  );
  assert.deepEqual(writes, ["djl-shop-prototype-v1"]);
  assert.deepEqual(JSON.parse(stored.get("djl-shop-prototype-v1")), createInitialState());
  assert.equal(stored.get("fixture-ai-draft"), "synthetic unsent AI draft");
  assert.deepEqual(closed, ["#reset-dialog"]);
  assert.deepEqual(navigation, ["home"]);
});

test("fresh demo states do not share cart or wallet state", () => {
  const first = createInitialState();
  first.cart.tote = 1;
  first.wallet.availableCents = 0;
  assert.deepEqual(createInitialState().cart, {});
  assert.equal(createInitialState().wallet.availableCents, 4800);
});

test("cart additions and removals are immutable and totals use integer cents", () => {
  const initial = createInitialState();
  let next = addToCart(initial, "tote", 2);
  next = addToCart(next, "lamp");
  assert.deepEqual(initial.cart, {});
  assert.deepEqual(totals(next), {
    subtotalCents: 12700,
    shippingCents: 0,
    totalCents: 12700,
    count: 3,
  });
  assert.equal(cartItems(next)[0].product.name, "日常帆布包");
  assert.deepEqual(setQuantity(next, "tote", 0).cart, { lamp: 1 });
  assert.equal(formatMoney(3900), "CAD 39.00");
});

test("invalid products, fractional quantities and stock overflow are rejected", () => {
  const state = createInitialState();
  assert.throws(() => addToCart(state, "missing"), /商品不存在/);
  for (const amount of [-1, 0, 0.5, NaN, Infinity])
    assert.throws(() => addToCart(state, "tote", amount));
  assert.throws(() => setQuantity(state, "tote", 13), /库存/);
  assert.throws(() => setQuantity(state, "tote", -1));
  assert.throws(() => formatMoney(1.5));
});

test("mock checkout creates a snapshot, empties cart, and never awards own commission", () => {
  const initial = addToCart(createInitialState(), "tumbler", 2);
  const result = checkout(initial, now);
  assert.equal(result.order.status, "paid-demo");
  assert.equal(result.order.currency, "CAD");
  assert.equal(result.order.totalCents, 5800);
  assert.deepEqual(result.order.items[0], {
    id: "tumbler",
    name: "保温随行杯",
    priceCents: 2900,
    quantity: 2,
    lineCents: 5800,
  });
  assert.equal(result.order.createdAt, now.toISOString());
  assert.deepEqual(result.state.cart, {});
  assert.deepEqual(result.state.wallet, initial.wallet);
  assert.equal(initial.orders.length, 0);
  assert.throws(() => checkout(result.state, now), /空/);
});

test("new mock orders keep independent demonstration address snapshots across refresh", () => {
  const expectedAddress = {
    name: "演示收件人",
    line1: "仅用于演示，不真实发货",
    city: "多伦多",
    province: "ON",
    postalCode: "M5V 2T6",
    country: "CA",
  };
  const first = checkout(addToCart(createInitialState(), "tote"), now);
  const second = checkout(addToCart(first.state, "tumbler"), new Date(now.getTime() + 1000));
  assert.deepEqual(first.order.address, expectedAddress);
  assert.deepEqual(second.order.address, expectedAddress);
  assert.notEqual(first.order.address, second.order.address);
  assert.deepEqual(
    restoreState(JSON.stringify(second.state)).orders.map((order) => order.address),
    [expectedAddress, expectedAddress],
  );
  first.order.address.name = "另一笔演示订单的合成修改";
  assert.deepEqual(second.order.address, expectedAddress);
});

test("real order rendering escapes each saved address instead of the current checkout and survives refresh", async () => {
  const app = await readFile(new URL("../apps/web/public/shop/app.js", import.meta.url), "utf8");
  const presentation = app.slice(app.indexOf("const paths ="), app.indexOf("function save("));
  const pages = app.slice(app.indexOf("function heading("), app.indexOf("function invitationUrl("));
  const first = checkout(addToCart(createInitialState(), "tote"), now);
  const second = checkout(addToCart(first.state, "tumbler"), new Date(now.getTime() + 1000));
  const addresses = [
    {
      name: "演示收件人 <甲> & \"A\" '一'",
      line1: "仅演示 <街道甲> & \"B\" '二'",
      city: "虚拟城市 <丙> & \"C\" '三'",
      province: "ON",
      postalCode: "M5V 2T6",
      country: "CA",
    },
    {
      name: "另一收件人 <乙> & \"D\" '四'",
      line1: "不发货 <街道乙> & \"E\" '五'",
      city: "另一虚拟城市 <丁> & \"F\" '六'",
      province: "BC",
      postalCode: "V6B 1A1",
      country: "CA",
    },
  ];
  const saved = {
    ...second.state,
    orders: second.state.orders.map((order, index) =>
      Object.assign({}, order, { address: addresses[index] }),
    ),
  };
  const currentAddress = { ...addresses[0], name: "CURRENT-CHECKOUT-NOT-AN-ORDER-SNAPSHOT" };
  const renderOrders = (state) =>
    runInNewContext(
      `${presentation}\n${pages}\norders();`,
      {
        PRODUCTS,
        formatMoney,
        state,
        DEMO_ADDRESS: currentAddress,
        ui: { address: currentAddress },
      },
      { timeout: 1000 },
    );
  const restored = restoreState(JSON.stringify(saved));
  const beforeRefresh = renderOrders(saved);
  const afterRefresh = renderOrders(restored);
  for (const html of [beforeRefresh, afterRefresh]) {
    for (const address of addresses) {
      for (const value of Object.values(address)) assert.ok(html.includes(escaped(value)), value);
      for (const value of [address.name, address.line1, address.city])
        assert.equal(html.includes(value), false, "address text must not become raw markup");
    }
    assert.equal(html.includes(currentAddress.name), false);
    assert.match(html, /模拟订单只保存在当前设备，不会真实付款或发货/);
  }
  assert.equal(afterRefresh, beforeRefresh);
  assert.deepEqual(
    restored.orders.map((order) => order.address),
    addresses,
  );
});

test("legacy mock orders keep their data without inventing a historical address", async () => {
  const app = await readFile(new URL("../apps/web/public/shop/app.js", import.meta.url), "utf8");
  const presentation = app.slice(app.indexOf("const paths ="), app.indexOf("function save("));
  const pages = app.slice(app.indexOf("function heading("), app.indexOf("function invitationUrl("));
  const legacy = checkout(addToCart(createInitialState(), "organizer"), now).state;
  delete legacy.orders[0].address;
  legacy.cart = { tote: 2 };
  const restored = restoreState(JSON.stringify(legacy));
  const html = runInNewContext(
    `${presentation}\n${pages}\norders();`,
    {
      PRODUCTS,
      formatMoney,
      state: restored,
      DEMO_ADDRESS: { name: "DO-NOT-BACKFILL-CURRENT-ADDRESS" },
    },
    { timeout: 1000 },
  );
  const { address, ...restoredOrder } = restored.orders[0];
  assert.equal(address, null);
  assert.deepEqual(restoredOrder, legacy.orders[0]);
  assert.deepEqual(restored.wallet, legacy.wallet);
  assert.deepEqual(restored.cart, legacy.cart);
  assert.match(html, /未记录演示收货地址/);
  assert.equal(html.includes("DO-NOT-BACKFILL-CURRENT-ADDRESS"), false);
});

test("bad saved addresses become null without clearing orders, cart or frozen withdrawals", () => {
  let model = checkout(addToCart(createInitialState(), "organizer"), now).state;
  model = addToCart(model, "tote", 2);
  model = createWithdrawal(model, now).state;
  const knownAddress = {
    name: "演示收件人",
    line1: "仅用于演示，不真实发货",
    city: "多伦多",
    province: "ON",
    postalCode: "M5V 2T6",
    country: "CA",
  };
  const missingField = { ...knownAddress };
  delete missingField.line1;
  const badAddresses = [
    null,
    "not-an-address",
    42,
    [],
    missingField,
    { ...knownAddress, name: 7 },
    { ...knownAddress, line1: "x".repeat(10001) },
    { ...knownAddress, line1: "" },
    { ...knownAddress, city: " \t " },
  ];
  const expectedWithoutAddress = {
    ...model,
    orders: [{ ...model.orders[0], address: null }],
  };
  for (const address of badAddresses) {
    const input = { ...model, orders: [{ ...model.orders[0], address }] };
    assert.deepEqual(restoreState(JSON.stringify(input)), expectedWithoutAddress);
  }
  const withForeignFields = {
    ...model,
    orders: [
      {
        ...model.orders[0],
        address: { ...knownAddress, untrustedNote: "synthetic field must not be restored" },
      },
    ],
  };
  assert.deepEqual(restoreState(JSON.stringify(withForeignFields)), {
    ...model,
    orders: [{ ...model.orders[0], address: knownAddress }],
  });
});

test("completed mock orders reduce remaining inventory and cannot oversell", () => {
  const first = checkout(addToCart(createInitialState(), "lamp", 7), now);
  assert.equal(remainingStock(first.state, "lamp"), 1);
  assert.throws(() => addToCart(first.state, "lamp", 2), /库存/);
  const second = checkout(addToCart(first.state, "lamp"), now);
  assert.notEqual(first.order.id, second.order.id);
  assert.equal(remainingStock(second.state, "lamp"), 0);
  assert.throws(() => addToCart(second.state, "lamp"), /库存/);
});

test("withdrawal freezes funds without reporting a real payout or altering paid totals", () => {
  const initial = createInitialState();
  const result = createWithdrawal(initial, now);
  assert.equal(initial.wallet.availableCents, 4800);
  assert.equal(result.withdrawal.amountCents, 4800);
  assert.equal(result.withdrawal.status, "processing");
  assert.equal(result.state.wallet.availableCents, 0);
  assert.equal(result.state.wallet.paidCents, 8000);
  assert.equal(result.state.wallet.pendingCents, 1200);
  assert.throws(() => createWithdrawal(result.state, now), /正在处理中/);
  const low = createInitialState();
  low.wallet.availableCents = 1999;
  assert.throws(() => createWithdrawal(low, now), /CAD 20/);
});

test("valid cart/order/withdrawal state survives persistence", () => {
  let state = checkout(addToCart(createInitialState(), "organizer"), now).state;
  state = addToCart(state, "tote", 3);
  state = createWithdrawal(state, now).state;
  assert.deepEqual(restoreState(JSON.stringify(state)), state);
});

test("corrupt, foreign and inconsistent stored data resets only the demo model", () => {
  for (const raw of [null, "", "not-json", "null", "[]", '{"auth":"secret"}'])
    assert.deepEqual(restoreState(raw), createInitialState());
  const invalid = createInitialState();
  invalid.cart.tote = PRODUCTS[0].stock + 1;
  assert.deepEqual(restoreState(JSON.stringify(invalid)), createInitialState());
  const tampered = checkout(addToCart(createInitialState(), "lamp"), now).state;
  tampered.orders[0].totalCents = 1;
  assert.deepEqual(restoreState(JSON.stringify(tampered)), createInitialState());
  const money = createInitialState();
  money.wallet.availableCents = 480000;
  assert.deepEqual(restoreState(JSON.stringify(money)), createInitialState());
});
