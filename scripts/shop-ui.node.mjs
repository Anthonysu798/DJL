import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as stateApi from "../apps/web/public/shop/state.mjs";

const app = await readFile(new URL("../apps/web/public/shop/app.js", import.meta.url), "utf8");
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const file = (name) => ({ name, type: "image/png", size: 100 });

function fixture({ seed = stateApi.createInitialState(), search, sample } = {}) {
  const events = new Map();
  const images = [];
  const revoked = [];
  const stored = new Map([["djl-shop-prototype-v1", JSON.stringify(seed)]]);
  const writes = [];
  const main = {
    innerHTML: "",
    querySelector(selector) {
      if (selector === ".crop-stage") return stage;
      if (selector === "#product-search") return { focus: () => (searchFocused = true) };
      return null;
    },
  };
  let searchFocused = false;
  let focusCount = 0;
  const cartFocus = [];
  const classes = { add() {}, remove() {}, toggle() {}, contains: () => false };
  const frame = { style: { cssText: "" } };
  const stage = {
    classList: { contains: (name) => name === "crop-stage" },
    querySelector: () => frame,
    focus: () => {
      focusCount++;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
  };
  const elements = new Map([
    ["#main", main],
    ["#sample-product", { value: "tote" }],
    ["#image-results-body", { innerHTML: "" }],
    [".crop-stage", stage],
    [
      "#cart-dialog",
      {
        innerHTML: "",
        showModal() {},
        close() {},
        querySelector(selector) {
          return { focus: () => cartFocus.push(selector) };
        },
      },
    ],
  ]);
  function element(selector) {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: "",
        textContent: "",
        classList: classes,
        setAttribute() {},
        removeAttribute() {},
        showModal() {},
        close() {},
      });
    return elements.get(selector);
  }
  class TestImage extends EventTarget {
    naturalWidth = 640;
    naturalHeight = 480;
    constructor() {
      super();
      images.push(this);
    }
    set src(value) {
      this.url = value;
    }
    ready() {
      this.dispatchEvent(new Event("load"));
    }
  }
  let urlNumber = 0;
  class TestURL extends URL {
    static createObjectURL() {
      return `blob:test-${++urlNumber}`;
    }
    static revokeObjectURL(url) {
      revoked.push(url);
    }
  }
  const context = {
    ...stateApi,
    LOCAL_PRODUCT_IMAGES: [],
    searchCatalogImage: search ?? (async () => ({ matches: [] })),
    createCatalogSample: sample ?? (async (id) => file(`${id}.png`)),
    AbortController,
    Image: TestImage,
    URL: TestURL,
    URLSearchParams,
    location: { hash: "#find", search: "", href: "http://127.0.0.1/shop/index.html#find" },
    history: { replaceState() {} },
    window: { scrollTo() {}, addEventListener() {} },
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener: (name, handler) => events.set(name, handler),
      body: { classList: classes },
    },
    localStorage: {
      getItem: (key) => stored.get(key),
      setItem: (key, value) => {
        writes.push(key);
        stored.set(key, value);
      },
    },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  runInNewContext(
    `${app.slice(app.indexOf("const STORAGE_KEY"))}\n` +
      "globalThis.testUi = { ui, selectImage, runImageSearch, navigate, handleAction, showProduct, getState: () => state };",
    context,
    { timeout: 1000 },
  );
  return {
    ...context.testUi,
    main,
    images,
    revoked,
    events,
    elements,
    writes,
    stored,
    focusCount: () => focusCount,
    searchFocused: () => searchFocused,
    cartFocus,
    click(dataset) {
      const button = { dataset, disabled: false };
      events.get("click")({ target: { closest: () => button } });
    },
  };
}

test("the zero-result action clears text and category, restores search focus, and keeps the cart and favorites", () => {
  const seed = stateApi.toggleFavorite(
    stateApi.addToCart(stateApi.createInitialState(), "lamp"),
    "tote",
  );
  const h = fixture({ seed });
  h.navigate("home");
  h.click({ category: "家居" });
  h.events.get("input")({ target: { id: "product-search", value: "no-match-qa" } });
  const count = h.elements.get("#product-count");
  const grid = h.elements.get("#product-grid");
  assert.equal(count.textContent, "0 件精选好物");
  assert.match(grid.innerHTML, /没有找到相关商品/);
  const action = grid.innerHTML.match(/<button[^>]+data-(view|action)="([^"]+)"[^>]*>([^<]+)/);
  assert.ok(action, "the empty state offers an action");

  h.click({ [action[1]]: action[2] });

  assert.equal(count.textContent, `${stateApi.PRODUCTS.length} 件精选好物`);
  assert.equal(action[3], "清空筛选");
  assert.match(h.main.innerHTML, /id="product-search"[^>]+value=""/);
  assert.match(h.main.innerHTML, /data-category="全部" aria-pressed="true"/);
  assert.equal(h.searchFocused(), true);
  assert.deepEqual(h.getState().cart, seed.cart);
  assert.deepEqual(h.getState().favorites, seed.favorites);
  assert.deepEqual(h.writes, []);
});

test("actual detail and favorite handlers persist only shop preferences and collection removal renders empty", () => {
  const h = fixture();
  const before = h.getState();
  h.showProduct("lamp");
  assert.deepEqual(h.getState().recentlyViewed, ["lamp"]);
  h.click({ favorite: "lamp" });
  assert.deepEqual(h.getState().favorites, ["lamp"]);
  h.navigate("favorites");
  assert.match(h.main.innerHTML, /取消收藏简约台灯/);
  h.click({ favorite: "lamp" });
  assert.match(h.main.innerHTML, /把喜欢的先收藏起来/);
  assert.deepEqual(h.getState().favorites, []);
  assert.deepEqual(h.getState().orders, before.orders);
  assert.deepEqual(h.getState().wallet, before.wallet);
  assert.ok(h.writes.length > 0);
  assert.ok(h.writes.every((key) => key === "djl-shop-prototype-v1"));
  assert.deepEqual(stateApi.restoreState(h.stored.get("djl-shop-prototype-v1")).recentlyViewed, [
    "lamp",
  ]);
});

test("actual reorder click adds available quantities and opens review without another payment", () => {
  const original = stateApi.checkout(stateApi.addToCart(stateApi.createInitialState(), "lamp", 5));
  const seed = stateApi.addToCart(original.state, "lamp", 2);
  const h = fixture({ seed });
  h.click({ reorder: original.order.id });
  assert.deepEqual(h.getState().cart, { lamp: 3 });
  assert.equal(h.getState().orders.length, 1);
  assert.deepEqual(h.getState().wallet, seed.wallet);
  assert.match(h.elements.get("#cart-dialog").innerHTML, /CAD 147.00/);
  assert.match(h.elements.get("#toast").textContent, /部分商品库存不足已调整/);
});

test("cart rerenders restore focus to the quantity button or the next checkout step", () => {
  const h = fixture({ seed: stateApi.addToCart(stateApi.createInitialState(), "tote") });
  h.handleAction("open-cart");
  h.click({ quantity: "tote", delta: "1" });
  assert.equal(h.getState().cart.tote, 2);
  assert.equal(h.cartFocus.at(-1), '[data-quantity="tote"][data-delta="1"]');
  h.handleAction("checkout");
  assert.equal(h.cartFocus.at(-1), "#cart-title");
  h.handleAction("back-cart");
  assert.equal(h.cartFocus.at(-1), '[data-action="checkout"]');
  h.handleAction("checkout");
  h.handleAction("pay-demo");
  assert.equal(h.cartFocus.at(-1), "#cart-title");
  assert.equal(h.getState().orders.length, 1);
});

test("clearing a photo revokes its preview and ignores an already-running search", async () => {
  const search = deferred();
  const h = fixture({ search: () => search.promise });
  const selection = h.selectImage(file("selected.png"));
  h.images[0].ready();
  assert.equal(await selection, true);
  const pending = h.runImageSearch();
  h.handleAction("clear-image");
  search.resolve({ matches: [{ id: "tote", score: 1 }] });
  await pending;
  assert.equal(h.ui.imageFile, null);
  assert.equal(h.ui.imageUrl, null);
  assert.equal(h.ui.imageName, "");
  assert.equal(h.ui.matches, null);
  assert.equal(h.ui.crop, "full");
  assert.deepEqual(h.revoked, ["blob:test-1"]);
  assert.match(h.main.innerHTML, /选择图片/);
  assert.deepEqual(h.writes, []);
});

test("resetting the shop clears the image preview as well as simulated data", async () => {
  const h = fixture({ seed: stateApi.addToCart(stateApi.createInitialState(), "tote") });
  const selection = h.selectImage(file("selected.png"));
  h.images[0].ready();
  await selection;
  h.handleAction("reset");
  h.navigate("find");
  assert.equal(h.ui.imageFile, null);
  assert.deepEqual(h.revoked, ["blob:test-1"]);
  assert.deepEqual(h.getState().cart, {});
  assert.doesNotMatch(h.main.innerHTML, /selected\.png/);
});

test("a newer file selection wins even when the older image decodes last", async () => {
  const h = fixture();
  const firstFile = file("first.png");
  const latestFile = file("latest.png");
  const first = h.selectImage(firstFile);
  const latest = h.selectImage(latestFile);
  h.images[1].ready();
  assert.equal(await latest, true);
  h.images[0].ready();
  assert.equal(await first, false);
  assert.equal(h.ui.imageFile, latestFile);
  assert.ok(h.revoked.includes("blob:test-1"));
});

test("leaving image-find invalidates a pending image decode instead of replacing the saved selection later", async () => {
  const h = fixture();
  const pending = h.selectImage(file("late.png"));
  h.navigate("orders");
  const ordersHtml = h.main.innerHTML;
  h.images[0].ready();
  assert.equal(await pending, false);
  assert.equal(h.ui.imageFile, null);
  assert.equal(h.ui.view, "orders");
  assert.equal(h.main.innerHTML, ordersHtml);
});

test("a crop change invalidates an in-flight replacement file decode", async () => {
  const h = fixture();
  const pending = h.selectImage(file("late.png"));
  h.handleAction("crop-center");
  h.images[0].ready();
  assert.equal(await pending, false);
  assert.equal(h.ui.imageFile, null);
  assert.equal(h.ui.crop, "center");
});

test("older sample generation cannot override the newer sample or start a second hidden search", async () => {
  const samples = [deferred(), deferred()];
  const searches = [];
  let sampleNumber = 0;
  const h = fixture({
    sample: () => samples[sampleNumber++].promise,
    search: async (selected) => {
      searches.push(selected.name);
      return { matches: [] };
    },
  });
  h.handleAction("sample-image");
  h.elements.get("#sample-product").value = "lamp";
  h.handleAction("sample-image");
  samples[1].resolve(file("lamp.png"));
  await tick();
  assert.equal(h.images.length, 1);
  h.images[0].ready();
  await tick();
  assert.equal(h.ui.imageName, "简约台灯 · 商品示例");
  samples[0].resolve(file("tote.png"));
  await tick();
  assert.equal(h.images.length, 1);
  assert.equal(h.ui.imageName, "简约台灯 · 商品示例");
  assert.deepEqual(searches, ["lamp.png"]);
});

test("leaving before a sample is generated prevents its decode and search", async () => {
  const sample = deferred();
  let searches = 0;
  const h = fixture({
    sample: () => sample.promise,
    search: async () => {
      searches++;
      return { matches: [] };
    },
  });
  h.handleAction("sample-image");
  h.navigate("home");
  sample.resolve(file("late.png"));
  await tick();
  assert.equal(h.images.length, 0);
  assert.equal(searches, 0);
  assert.equal(h.ui.imageFile, null);
});

test("cancelled search results cannot reappear after the underlying work resolves", async () => {
  const search = deferred();
  const h = fixture({ search: () => search.promise });
  h.ui.imageFile = file("selected.png");
  h.ui.imageUrl = "blob:selected";
  const pending = h.runImageSearch();
  assert.match(h.main.innerHTML, /正在匹配/);
  h.handleAction("cancel-image-search");
  search.resolve({ matches: [{ id: "tote", score: 1 }] });
  await pending;
  assert.equal(h.ui.matches, null);
  assert.equal(h.ui.imageStatus, "idle");
  assert.doesNotMatch(h.main.innerHTML, /正在匹配/);
});

test("keyboard crop cancels busy search, refreshes disabled controls and retains keyboard focus", async () => {
  const search = deferred();
  const h = fixture({ search: () => search.promise });
  h.ui.imageFile = file("selected.png");
  h.ui.imageUrl = "blob:selected";
  const pending = h.runImageSearch();
  let prevented = false;
  h.events.get("keydown")({
    key: "+",
    target: h.elements.get(".crop-stage"),
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(h.ui.imageStatus, "idle");
  assert.doesNotMatch(h.main.innerHTML, /正在匹配/);
  assert.match(h.main.innerHTML, /aria-busy="false"/);
  assert.ok(h.focusCount() > 0);
  search.resolve({ matches: [{ id: "tote", score: 1 }] });
  await pending;
  assert.equal(h.ui.matches, null);
});

test("paste uses only supplied image files on image-find and leaves text and other pages untouched", async () => {
  const h = fixture();
  const screenshot = file("screenshot.png");
  let prevented = 0;
  const imagePaste = {
    clipboardData: { files: [screenshot] },
    preventDefault() {
      prevented++;
    },
  };
  h.navigate("orders");
  h.events.get("paste")(imagePaste);
  assert.equal(h.images.length, 0);
  assert.equal(prevented, 0);
  h.navigate("find");
  h.events.get("paste")({
    clipboardData: { files: [] },
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 0);
  h.events.get("paste")(imagePaste);
  assert.equal(prevented, 1);
  assert.equal(h.images.length, 1);
  h.images[0].ready();
  await tick();
  assert.equal(h.ui.imageFile, screenshot);
  assert.equal(h.ui.imageName, "粘贴的截图");
});
