// Standalone, local-only demonstration data. No account, payment or AI service is called.
export const DEMO_ADDRESS = Object.freeze({
  name: "演示收件人",
  line1: "仅用于演示，不真实发货",
  city: "多伦多",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA",
});

export const PRODUCTS = Object.freeze(
  [
    {
      id: "tote",
      name: "日常帆布包",
      category: "配饰",
      priceCents: 3900,
      stock: 12,
      description: "轻盈耐用的日常帆布包，装下出门需要的小物。",
      specs: "米白色 · 帆布 · 约 35 × 38 cm",
    },
    {
      id: "lamp",
      name: "简约台灯",
      category: "家居",
      priceCents: 4900,
      stock: 8,
      description: "干净简约的桌面照明，让阅读和工作更舒适。",
      specs: "暖白色 · 演示款 · 桌面使用",
    },
    {
      id: "tumbler",
      name: "保温随行杯",
      category: "日用",
      priceCents: 2900,
      stock: 20,
      description: "适合通勤和散步的随行杯，简单好携带。",
      specs: "奶白色 · 不锈钢 · 约 450 ml",
    },
    {
      id: "organizer",
      name: "桌面收纳架",
      category: "家居",
      priceCents: 3500,
      stock: 10,
      description: "把文具和小物放在手边，让桌面清爽有序。",
      specs: "原木色 · 多格收纳 · 桌面使用",
    },
  ].map(Object.freeze),
);

export function createInitialState() {
  return {
    cart: {},
    orders: [],
    wallet: { availableCents: 4800, pendingCents: 1200, paidCents: 8000, withdrawals: [] },
    favorites: [],
    recentlyViewed: [],
  };
}

const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const productById = (id) => PRODUCTS.find((product) => product.id === id);
const validDate = (value) =>
  typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9-]{1,100}$/.test(value);

function knownProductIds(value, limit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => productById(id)))].slice(0, limit);
}

function requireProduct(id) {
  const product = productById(id);
  if (!product) throw new Error("商品不存在");
  return product;
}

function timestamp(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("无效日期");
  return now.toISOString();
}

export function remainingStock(state, id) {
  const product = requireProduct(id);
  const purchased = state.orders.reduce(
    (total, order) =>
      total + order.items.reduce((count, item) => count + (item.id === id ? item.quantity : 0), 0),
    0,
  );
  return product.stock - purchased;
}

export function setQuantity(state, id, quantity) {
  requireProduct(id);
  if (!integer(quantity)) throw new Error("商品数量必须是非负整数");
  if (quantity > remainingStock(state, id)) throw new Error("已达到演示库存上限");
  const cart = { ...state.cart };
  if (quantity === 0) delete cart[id];
  else cart[id] = quantity;
  return { ...state, cart };
}

export function addToCart(state, id, quantity = 1) {
  requireProduct(id);
  if (!integer(quantity, 1)) throw new Error("加入数量必须是正整数");
  return setQuantity(state, id, (state.cart[id] ?? 0) + quantity);
}

export function toggleFavorite(state, id) {
  requireProduct(id);
  const favorites = knownProductIds(state.favorites, PRODUCTS.length);
  return {
    ...state,
    favorites: favorites.includes(id)
      ? favorites.filter((favorite) => favorite !== id)
      : [...favorites, id],
  };
}

export function rememberViewed(state, id) {
  requireProduct(id);
  return { ...state, recentlyViewed: knownProductIds([id, ...(state.recentlyViewed ?? [])], 8) };
}

export function reorderOrder(state, orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) throw new Error("订单不存在");
  cartItems(state);
  const cart = { ...state.cart };
  const added = [];
  const adjusted = [];
  const skipped = [];
  for (const item of order.items) {
    const available = remainingStock(state, item.id) - (cart[item.id] ?? 0);
    const quantity = Math.min(item.quantity, available);
    if (quantity === 0) {
      skipped.push({ id: item.id, reason: "out-of-stock" });
      continue;
    }
    cart[item.id] = (cart[item.id] ?? 0) + quantity;
    added.push({ id: item.id, quantity });
    if (quantity < item.quantity)
      adjusted.push({ id: item.id, requestedQuantity: item.quantity, addedQuantity: quantity });
  }
  return { state: { ...state, cart }, added, adjusted, skipped };
}

export function cartItems(state) {
  return Object.entries(state.cart).map(([id, quantity]) => {
    const product = requireProduct(id);
    if (!integer(quantity, 1) || quantity > remainingStock(state, id))
      throw new Error("购物车数量无效，请重置演示数据");
    return { product, quantity, lineCents: product.priceCents * quantity };
  });
}

export function totals(state) {
  const items = cartItems(state);
  const subtotalCents = items.reduce((sum, item) => sum + item.lineCents, 0);
  return {
    subtotalCents,
    shippingCents: 0,
    totalCents: subtotalCents,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export function checkout(state, now = new Date()) {
  const items = cartItems(state);
  if (items.length === 0) throw new Error("购物车还是空的");
  const createdAt = timestamp(now);
  const summary = totals(state);
  const order = {
    id: `DEMO-${now.getTime().toString(36).toUpperCase()}-${state.orders.length + 1}`,
    createdAt,
    status: "paid-demo",
    currency: "CAD",
    address: { ...DEMO_ADDRESS },
    items: items.map(({ product, quantity, lineCents }) => ({
      id: product.id,
      name: product.name,
      priceCents: product.priceCents,
      quantity,
      lineCents,
    })),
    subtotalCents: summary.subtotalCents,
    shippingCents: 0,
    totalCents: summary.totalCents,
  };
  return { state: { ...state, cart: {}, orders: [order, ...state.orders] }, order };
}

export function createWithdrawal(state, now = new Date()) {
  if (state.wallet.withdrawals.some((withdrawal) => withdrawal.status === "processing"))
    throw new Error("已有一笔模拟提现申请正在处理中");
  const amountCents = state.wallet.availableCents;
  if (!integer(amountCents, 2000)) throw new Error("满 CAD 20.00 才可申请提现");
  const withdrawal = {
    id: `WD-${now.getTime().toString(36).toUpperCase()}-${state.wallet.withdrawals.length + 1}`,
    amountCents,
    status: "processing",
    createdAt: timestamp(now),
  };
  const wallet = {
    ...state.wallet,
    availableCents: 0,
    withdrawals: [withdrawal, ...state.wallet.withdrawals],
  };
  return { state: { ...state, wallet }, withdrawal };
}

export function formatMoney(cents) {
  if (!integer(cents)) throw new Error("金额必须是非负整数分");
  return `CAD ${(cents / 100).toFixed(2)}`;
}

function validOrder(order) {
  if (
    !order ||
    !validId(order.id) ||
    !validDate(order.createdAt) ||
    order.status !== "paid-demo" ||
    order.currency !== "CAD" ||
    !Array.isArray(order.items) ||
    order.items.length === 0 ||
    order.items.length > PRODUCTS.length
  )
    return false;
  const ids = new Set();
  for (const item of order.items) {
    const product = item && productById(item.id);
    if (
      !product ||
      ids.has(item.id) ||
      item.name !== product.name ||
      item.priceCents !== product.priceCents ||
      !integer(item.quantity, 1) ||
      item.quantity > product.stock ||
      item.lineCents !== item.priceCents * item.quantity
    )
      return false;
    ids.add(item.id);
  }
  const subtotal = order.items.reduce((sum, item) => sum + item.lineCents, 0);
  return (
    order.subtotalCents === subtotal && order.shippingCents === 0 && order.totalCents === subtotal
  );
}

function restoreAddress(address) {
  const fields = Object.keys(DEMO_ADDRESS);
  if (
    !address ||
    typeof address !== "object" ||
    Array.isArray(address) ||
    fields.some(
      (field) =>
        typeof address[field] !== "string" || address[field].length > 500 || !address[field].trim(),
    )
  )
    return null;
  return Object.fromEntries(fields.map((field) => [field, address[field]]));
}

export function restoreState(raw) {
  try {
    const state = JSON.parse(raw);
    if (
      !state ||
      !state.cart ||
      typeof state.cart !== "object" ||
      Array.isArray(state.cart) ||
      !Array.isArray(state.orders) ||
      !state.orders.every(validOrder) ||
      new Set(state.orders.map((order) => order.id)).size !== state.orders.length
    )
      return createInitialState();
    const wallet = state.wallet;
    if (
      !wallet ||
      !integer(wallet.availableCents) ||
      wallet.pendingCents !== 1200 ||
      wallet.paidCents !== 8000 ||
      !Array.isArray(wallet.withdrawals) ||
      wallet.withdrawals.length > 1
    )
      return createInitialState();
    if (
      !wallet.withdrawals.every(
        (withdrawal) =>
          withdrawal &&
          validId(withdrawal.id) &&
          validDate(withdrawal.createdAt) &&
          withdrawal.status === "processing" &&
          integer(withdrawal.amountCents, 2000),
      )
    )
      return createInitialState();
    const frozenCents = wallet.withdrawals.reduce(
      (sum, withdrawal) => sum + withdrawal.amountCents,
      0,
    );
    if (wallet.availableCents + frozenCents !== 4800) return createInitialState();
    cartItems(state);
    if (PRODUCTS.some((product) => remainingStock(state, product.id) < 0))
      return createInitialState();
    // Only return known demonstration fields, never foreign account/storage data.
    return {
      cart: { ...state.cart },
      orders: state.orders.map((order) => ({
        id: order.id,
        createdAt: order.createdAt,
        status: order.status,
        currency: order.currency,
        address: restoreAddress(order.address),
        items: order.items.map(({ id, name, priceCents, quantity, lineCents }) => ({
          id,
          name,
          priceCents,
          quantity,
          lineCents,
        })),
        subtotalCents: order.subtotalCents,
        shippingCents: 0,
        totalCents: order.totalCents,
      })),
      wallet: {
        availableCents: wallet.availableCents,
        pendingCents: wallet.pendingCents,
        paidCents: wallet.paidCents,
        withdrawals: wallet.withdrawals.map(({ id, amountCents, status, createdAt }) => ({
          id,
          amountCents,
          status,
          createdAt,
        })),
      },
      favorites: knownProductIds(state.favorites, PRODUCTS.length),
      recentlyViewed: knownProductIds(state.recentlyViewed, 8),
    };
  } catch {
    return createInitialState();
  }
}
