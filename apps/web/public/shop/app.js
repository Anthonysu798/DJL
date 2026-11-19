import {
  PRODUCTS,
  DEMO_ADDRESS,
  createInitialState,
  restoreState,
  cartItems,
  totals,
  remainingStock,
  addToCart,
  setQuantity,
  checkout,
  createWithdrawal,
  toggleFavorite,
  rememberViewed,
  reorderOrder,
  formatMoney,
} from "./state.mjs";
import { searchCatalogImage, createCatalogSample, LOCAL_PRODUCT_IMAGES } from "./image-search.mjs";

const STORAGE_KEY = "djl-shop-prototype-v1";
const main = document.querySelector("#main");
const ui = {
  view: "home",
  query: "",
  category: "全部",
  imageUrl: null,
  imageName: "",
  imageFile: null,
  imageFromSample: false,
  imageAspect: 1,
  crop: "full",
  matches: null,
  imageStatus: "idle",
  imageError: "",
  resultQuery: "",
  sampleId: "tote",
  cartStep: "cart",
  latestOrder: null,
};
let state;
try {
  state = restoreState(localStorage.getItem(STORAGE_KEY));
} catch {
  state = createInitialState();
}
let toastTimer;
let imageSearchController;
let imageSelection;
let imageLoadVersion = 0;

const paths = {
  bag: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
  home: '<path d="m3 10 9-7 9 7v10H3V10Z"/><path d="M9 20v-7h6v7"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="4"/>',
  orders: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6m-6 5h6m-6 5h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  camera: '<path d="M8 5 9.5 3h5L16 5h4v15H4V5h4Z"/><circle cx="12" cy="12" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  truck:
    '<path d="M3 5h11v12H3V5Zm11 5h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  link: '<path d="m9 15 6-6m-6 9-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m-2-2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.bag}</svg>`;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
const photo = (id, extra = "") =>
  `<div class="product-photo photo-${escape(id)} ${extra}" role="img" aria-label="${escape(PRODUCTS.find((product) => product.id === id)?.name || "商品示例图片")}"></div>`;
const dateLabel = (value) =>
  new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
const productById = (id) => PRODUCTS.find((product) => product.id === id);
const addressLabel = (address) =>
  address
    ? `${escape(address.name)}<br>${escape(address.line1)}<br>${escape(address.city)} · ${escape(address.province)} · ${escape(address.postalCode)} · ${escape(address.country)}`
    : "未记录演示收货地址";

function save(next) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast("浏览器未允许保存数据，本次演示仍可继续");
  }
  updateNavigation();
}
function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), 3600);
}
function updateNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === ui.view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const count = totals(state).count;
  document.querySelector("#cart-count").textContent = count;
  document.querySelector(".cart-toggle").setAttribute("aria-label", `购物车，${count} 件商品`);
  document.querySelectorAll("[data-icon]").forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
  });
}
function card(product) {
  const available = remainingStock(state, product.id);
  return `<article class="product-card"><button class="product-open" data-product="${product.id}" aria-label="查看${product.name}">${photo(product.id)}<div class="product-info"><div><h3>${product.name}</h3><span class="price">${formatMoney(product.priceCents)}</span></div></div></button>${favoriteButton(product)}<button class="add-small" data-add="${product.id}" aria-label="将${product.name}加入购物车" title="${available ? "加入购物车" : "演示库存已售完"}" ${available ? "" : "disabled"}>${icon("plus")}</button></article>`;
}
function favoriteButton(product, detail = false) {
  const saved = state.favorites.includes(product.id);
  return `<button class="favorite-button ${detail ? "detail-favorite button secondary" : ""} ${saved ? "is-saved" : ""}" data-favorite="${product.id}" aria-pressed="${saved}" aria-label="${saved ? "取消收藏" : "收藏"}${product.name}">${icon("heart")}${detail ? (saved ? "已收藏" : "收藏商品") : ""}</button>`;
}
function heading(title, description) {
  return `<div class="page-heading"><div><h1 tabindex="-1">${title}</h1><p class="muted">${description}</p></div><span class="tag">${icon("shield")}演示模式</span></div>`;
}
function empty(title, description, action = "home", label = "去逛逛") {
  const target = action === "clear-filters" ? "data-action" : "data-view";
  return `<div class="empty-state"><div class="empty-icon">${icon("bag")}</div><h2>${title}</h2><p>${description}</p><button class="button" ${target}="${action}">${label}${icon("arrow")}</button></div>`;
}
function renderProducts() {
  const products = PRODUCTS.filter(
    (product) =>
      (ui.category === "全部" || product.category === ui.category) &&
      `${product.name} ${product.category} ${product.description}`
        .toLowerCase()
        .includes(ui.query.trim().toLowerCase()),
  );
  document.querySelector("#product-grid").innerHTML = products.length
    ? products.map(card).join("")
    : empty(
        "没有找到相关商品",
        "换个关键词试试，或清空筛选查看全部商品。",
        "clear-filters",
        "清空筛选",
      );
  document.querySelector("#product-count").textContent = `${products.length} 件精选好物`;
}
function home() {
  const referral = new URLSearchParams(location.search).has("ref")
    ? '<div class="referral-notice">这是好友邀请链接演示。正式版会在首单付款前确认绑定推荐人；当前不会创建真实推荐关系。</div>'
    : "";
  return `<section class="page">${referral}<label class="searchbar">${icon("search")}<input id="product-search" type="search" placeholder="搜索你想买的商品" aria-label="搜索商品" value="${escape(ui.query)}"><button data-view="find" aria-label="上传图片找商品">${icon("camera")}</button></label><section class="hero" aria-label="图片找商品"><div class="hero-copy"><p class="eyebrow">A LITTLE HELP FROM AI</p><h1 tabindex="-1">看到喜欢的，<br>不知道叫什么？</h1><p>上传照片或截图，发现相似好物。<br>不用知道名字，也能开始找。</p><button class="button" data-view="find">${icon("camera")}上传图片找商品</button></div><div class="hero-image" role="img" aria-label="帆布包商品示例"></div></section><div class="trust-line">${icon("truck")}加拿大境内发货 · 平台统一售后<span>（原型示意）</span></div><div class="categories" role="group" aria-label="商品分类">${["全部", "家居", "日用", "配饰"].map((category) => `<button class="category ${ui.category === category ? "active" : ""}" data-category="${category}" aria-pressed="${ui.category === category}">${category}</button>`).join("")}</div><div class="section-head"><h2>精选商品</h2><p id="product-count"></p></div><div class="products" id="product-grid"></div><div class="invite-strip">${icon("link")}好东西，和朋友一起分享<button data-view="profile">邀请好友赚佣金 →</button></div></section>`;
}
function find() {
  const busy = ui.imageStatus === "searching";
  const preview = ui.imageUrl
    ? `<div class="crop-stage" tabindex="0" role="group" aria-label="图片选区：拖动框选，方向键移动，加减键缩放，F 恢复整图"><img src="${escape(ui.imageUrl)}" alt="你选择的图片，仅在本机处理" draggable="false"><div class="crop-frame" style="${cropFrameStyle()}"><span>只找框内物品</span></div></div><p class="crop-help">拖动框选想买的物品，减少背景干扰。<br>键盘可用方向键移动，＋／－缩放，F 恢复整图。</p><div class="crop-actions"><button class="text-button" data-action="crop-full">使用整张图</button><button class="text-button" data-action="crop-center">居中框选</button></div>`
    : `<label class="upload-zone" for="image-file">${icon("camera")}<strong>上传照片或截图</strong><span>点击选择、拖入或粘贴截图（Ctrl＋V）<br>JPEG、PNG、WebP，最大 10 MB</span></label>`;
  return `<section class="page">${heading("图片找商品", "上传 → 框选物品 → 查看商城内的相似线索")}<div class="find-layout"><div class="upload-card">${preview}<input class="visually-hidden" type="file" id="image-file" accept="image/jpeg,image/png,image/webp"><p class="upload-filename">${escape(ui.imageName || "图片仅在本机内存处理，不写入收藏或浏览记录")}</p><div class="upload-actions">${ui.imageFile ? `<button class="button" data-action="search-image" ${busy ? "disabled" : ""}>${busy ? "正在匹配…" : "开始找商品"}</button><button class="button secondary" data-action="${busy ? "cancel-image-search" : "choose-image"}">${busy ? "取消" : "换一张图"}</button>` : '<button class="button" data-action="choose-image">选择图片</button>'}</div>${ui.imageFile ? '<button class="text-button" data-action="clear-image">清除当前照片</button>' : ""}<div class="sample-picker"><label for="sample-product">没有照片？试试商品示例</label><div><select id="sample-product" aria-label="选择示例商品">${PRODUCTS.map((p) => `<option value="${p.id}" ${ui.sampleId === p.id ? "selected" : ""}>${p.name}</option>`).join("")}</select><button class="text-button" data-action="sample-image">试一试</button></div></div></div><div class="find-results" aria-live="polite" aria-busy="${busy}"><div class="notice">本地外观匹配（试用）：按图片颜色、轮廓和布局比较当前 4 件演示商品，不是语义识别。换角度、遮挡或库外物品可能找不到；相似线索不代表同款。正式视觉 AI 仍待真实商品与授权图片评测。</div><div id="image-results-body">${imageResults()}</div></div></div></section>`;
}
function imageResults() {
  const retryWholeImage =
    ui.crop === "full"
      ? ""
      : '<button class="button secondary" data-action="retry-image-full">用整张图重新匹配</button>';
  if (ui.imageStatus === "searching")
    return '<div class="empty-state"><h2>正在对比商品图片</h2><p>仅在本机处理，不上传照片。</p></div>';
  if (ui.imageError)
    return `<div class="empty-state"><h2>这次没能完成</h2><p>${escape(ui.imageError)}</p><button class="button secondary" data-action="search-image">重试</button>${retryWholeImage}</div>`;
  if (ui.matches === null)
    return '<div class="empty-state"><h2>先选图，再圈出想找的东西</h2><p>截图中有多件物品时，框选其中一件通常更容易对比。</p></div>';
  return `<h2>${ui.matches.length ? "商城内的相似线索" : "暂时没有可靠的匹配"}</h2><p class="muted">${ui.matches.length ? "只列出当前仍有演示库存的商品，请核对款式、材质和规格。" : "可换一张清晰、物品完整的照片，或用商品名搜索。局部外观与完整参考图可能不同；不会强行给出匹配。"}</p>${ui.matches.length ? '<label class="result-refine">缩小结果范围<input type="search" id="image-result-query" placeholder="输入关键词，例如：台灯" aria-label="在识图结果中筛选关键词" value="' + escape(ui.resultQuery) + '"></label>' : '<button class="button secondary" data-view="home">用文字搜商品</button>' + retryWholeImage}<div id="image-match-grid" class="products">${imageMatchCards()}</div>`;
}
function imageMatchCards() {
  const products = (ui.matches || [])
    .map((match) => productById(match.id))
    .filter(
      (p) =>
        p &&
        remainingStock(state, p.id) > 0 &&
        `${p.name} ${p.category} ${p.description}`.includes(ui.resultQuery.trim()),
    );
  return products.length
    ? products.map(card).join("")
    : ui.matches?.length
      ? '<p class="muted">当前筛选没有商品，试试清空关键词。</p>'
      : "";
}
function cropRect() {
  if (typeof ui.crop === "object") return ui.crop;
  const width = ui.crop === "center" ? Math.min(1, 1 / ui.imageAspect) : 1;
  const height = ui.crop === "center" ? Math.min(1, ui.imageAspect) : 1;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
function imageBounds() {
  const width = Math.min(1, ui.imageAspect),
    height = Math.min(1, 1 / ui.imageAspect);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
function cropFrameStyle() {
  const r = cropRect(),
    b = imageBounds();
  return `left:${(b.x + r.x * b.width) * 100}%;top:${(b.y + r.y * b.height) * 100}%;width:${r.width * b.width * 100}%;height:${r.height * b.height * 100}%;`;
}
function invalidateImageResults() {
  imageLoadVersion += 1;
  imageSearchController?.abort();
  imageSearchController = null;
  ui.matches = null;
  ui.imageStatus = "idle";
  ui.imageError = "";
  ui.resultQuery = "";
  const results = document.querySelector("#image-results-body");
  if (results) results.innerHTML = imageResults();
}
function clearImage() {
  imageSelection = null;
  if (ui.imageUrl) URL.revokeObjectURL(ui.imageUrl);
  Object.assign(ui, {
    imageFile: null,
    imageFromSample: false,
    imageUrl: null,
    imageName: "",
    imageAspect: 1,
    crop: "full",
  });
  invalidateImageResults();
}
async function selectImage(
  file,
  name = file.name,
  version = ++imageLoadVersion,
  imageFromSample = false,
) {
  if (version !== imageLoadVersion || ui.view !== "find") return false;
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("请选择不超过 10 MB 的 JPEG、PNG 或 WebP 图片");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener(
        "error",
        () => reject(new Error("图片无法读取，请重新导出为 JPEG、PNG 或 WebP")),
        { once: true },
      );
      image.src = url;
    });
    if (version !== imageLoadVersion) {
      URL.revokeObjectURL(url);
      return false;
    }
    if (
      image.naturalWidth * image.naturalHeight > 24_000_000 ||
      Math.max(image.naturalWidth, image.naturalHeight) > 16384
    )
      throw new Error("图片像素过大，请缩小图片后再试");
    invalidateImageResults();
    if (ui.imageUrl) URL.revokeObjectURL(ui.imageUrl);
    Object.assign(ui, {
      imageFile: file,
      imageFromSample,
      imageUrl: url,
      imageName: name || "选择的图片",
      imageAspect: image.naturalWidth / image.naturalHeight,
      crop: "full",
    });
    render();
    return true;
  } catch (error) {
    URL.revokeObjectURL(url);
    if (version !== imageLoadVersion || ui.view !== "find") return false;
    throw error;
  }
}
async function runImageSearch() {
  if (!ui.imageFile || ui.imageStatus === "searching") return;
  const controller = new AbortController();
  imageSearchController = controller;
  ui.imageStatus = "searching";
  ui.imageError = "";
  ui.matches = null;
  render();
  try {
    const result = await searchCatalogImage(ui.imageFile, LOCAL_PRODUCT_IMAGES, {
      crop: ui.crop,
      sampleFraming: ui.imageFromSample,
      signal: controller.signal,
    });
    if (imageSearchController !== controller || controller.signal.aborted) return;
    ui.matches = result.matches.filter((m) => productById(m.id) && remainingStock(state, m.id) > 0);
    ui.imageStatus = "ready";
  } catch (error) {
    if (imageSearchController !== controller || controller.signal.aborted) return;
    ui.imageStatus = "error";
    ui.imageError = error instanceof Error ? error.message : "图片处理失败，请换图或缩小选区后重试";
  } finally {
    if (imageSearchController === controller) {
      imageSearchController = null;
      if (ui.view === "find") render();
    }
  }
}
function collection() {
  const favorites = ui.view === "favorites";
  const products = (favorites ? state.favorites : state.recentlyViewed)
    .map(productById)
    .filter(Boolean);
  return `<section class="page">${heading(favorites ? "我的收藏" : "最近浏览", "只保存在当前设备，不包含照片，也不影响 AI 数据。")}${products.length ? `<div class="products">${products.map(card).join("")}</div>` : empty(favorites ? "把喜欢的先收藏起来" : "还没有浏览记录", favorites ? "点商品上的爱心，下次不用重新找。" : "打开商品详情后，这里会帮你记住。")}</section>`;
}
function orders() {
  return `<section class="page">${heading("我的订单", "模拟订单只保存在当前设备，不会真实付款或发货。")}${state.orders.length ? `<div class="order-list">${state.orders.map((order) => `<article class="order-card"><div class="order-top"><div><strong>订单 ${escape(order.id)}</strong><small>${dateLabel(order.createdAt)}</small></div><span class="tag">模拟支付成功 · 未实际发货</span></div>${order.items.map((item) => `<div class="order-line">${photo(item.id)}<div><h3>${escape(item.name)}</h3><span class="muted">数量 ${item.quantity}</span></div><span class="price">${formatMoney(item.priceCents * item.quantity)}</span></div>`).join("")}<div class="order-bottom"><span>演示收货地址<br>${addressLabel(order.address)}<br>自己购买不会给自己产生推荐佣金</span><strong>合计 ${formatMoney(order.totalCents)}</strong></div><div class="order-actions"><button class="button secondary" data-reorder="${escape(order.id)}">再次购买</button><small>按当前价格和库存加购，不会直接付款。</small></div></article>`).join("")}</div>` : empty("还没有模拟订单", "挑一件喜欢的商品，体验加入购物车和模拟结账。")}</section>`;
}
function invitationUrl() {
  const url = new URL("./index.html", location.href);
  url.search = "?ref=DEMO-FRIEND";
  url.hash = "";
  return url.href;
}
function profile() {
  const wallet = state.wallet;
  const processing = wallet.withdrawals.some((withdrawal) => withdrawal.status === "processing");
  const canWithdraw = wallet.availableCents >= 2000 && !processing;
  const current = new Date();
  const examples = [
    { amount: 400, status: "待结算", pending: true },
    { amount: 600, status: "已结算", pending: false },
  ];
  return `<section class="page">${heading("我的收益", "分享好物，好友购买后获得推荐佣金。")}<div class="personal-shortcuts"><button class="button secondary" data-view="favorites">${icon("heart")}我的收藏 · ${state.favorites.length}</button><button class="button secondary" data-view="recent">${icon("orders")}最近浏览 · ${state.recentlyViewed.length}</button></div><div class="profile-grid"><section class="wallet-card" aria-label="模拟佣金钱包"><p class="wallet-label">可提现 · 示例余额</p><div class="wallet-amount">${formatMoney(wallet.availableCents)}</div><button class="button full" data-action="withdraw" ${canWithdraw ? "" : "disabled"}>${processing ? "模拟提现处理中" : "申请模拟提现"}</button><div class="wallet-stats"><div><span>待结算</span><strong>${formatMoney(wallet.pendingCents)}</strong></div><div><span>已提现 · 示例</span><strong>${formatMoney(wallet.paidCents)}</strong></div></div><p class="wallet-note">满 CAD 20 可申请 · 每周人工处理<br>这里仅演示申请和冻结，不会向任何账户打款。</p></section><section class="referral-card"><p class="eyebrow">GOOD THINGS ARE BETTER SHARED</p><h2>好友购买，<br>你得佣金。</h2><p>首单付款前绑定推荐人，<br>好友后续有效购买持续计佣，只奖励直接推荐。</p><input class="referral-input" id="referral-url" value="${escape(invitationUrl())}" aria-label="示例邀请链接" readonly><button class="button" data-action="copy-invite">${icon("link")}分享邀请链接</button></section></div><p class="profile-explainer">每个普通用户都可以推荐好友，无需开店或进货。平台统一供货与售后；佣金需经过售后观察期才可提现。自己的购买不返佣，当前数据与推荐关系均为演示。</p><section class="ledger-section"><h2>佣金与提现记录</h2>${wallet.withdrawals.map((withdrawal) => `<div class="ledger-row"><div class="ledger-icon">${icon("orders")}</div><div><h3>模拟提现申请</h3><small>${dateLabel(withdrawal.createdAt)} · 未真实打款</small></div><div class="ledger-value"><strong>− ${formatMoney(withdrawal.amountCents)}</strong><span class="pending">模拟处理中 · 金额已冻结</span></div></div>`).join("")}${examples.map((entry) => `<div class="ledger-row"><div class="ledger-icon">${icon("bag")}</div><div><h3>好友订单佣金 · 示例</h3><small>${dateLabel(current)}</small></div><div class="ledger-value"><strong>+ ${formatMoney(entry.amount)}</strong><span class="${entry.pending ? "pending" : ""}">${entry.status}</span></div></div>`).join("")}<p class="muted">示例明细用于展示界面，不是可核对的真实财务流水。</p></section></section>`;
}
function render() {
  main.innerHTML = { home, find, orders, profile, favorites: collection, recent: collection }[
    ui.view
  ]();
  if (ui.view === "home") renderProducts();
  updateNavigation();
}
function navigate(view) {
  if (!["home", "find", "orders", "profile", "favorites", "recent"].includes(view)) return;
  if (view !== "find") {
    imageLoadVersion += 1;
    if (imageSearchController) invalidateImageResults();
  }
  ui.view = view;
  history.replaceState(null, "", `#${view}`);
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
  main.querySelector("h1")?.focus({ preventScroll: true });
}
function showDialog(id) {
  document.querySelector(id).showModal();
  document.body.classList.add("no-scroll");
}
function closeDialog(id) {
  document.querySelector(id).close();
  if (!document.querySelector("dialog[open]")) document.body.classList.remove("no-scroll");
}
function showProduct(id) {
  const product = productById(id);
  if (!product) return;
  save(rememberViewed(state, id));
  const available = remainingStock(state, id);
  document.querySelector("#product-dialog").innerHTML =
    `<div class="modal-top"><strong>商品详情 · 演示</strong><button class="icon-button" data-action="close-product" aria-label="关闭商品详情">${icon("close")}</button></div><div class="product-detail">${photo(id)}<div class="detail-info"><p class="eyebrow">DJL SELECTED</p><h2 id="product-title">${product.name}</h2><div class="price">${formatMoney(product.priceCents)}</div><p>${escape(product.description)}</p><dl class="detail-specs"><dt>规格</dt><dd>${escape(product.specs)}</dd><dt>配送</dt><dd>加拿大境内 · 演示免运费</dd><dt>售后</dt><dd>平台统一处理（原型示意）</dd><dt>库存</dt><dd>剩余 ${available} 件演示库存</dd><dt>推荐奖励</dt><dd>好友有效购买后计佣，自己购买不返佣</dd></dl><button class="button full" data-add="${product.id}" ${available ? "" : "disabled"}>${icon("plus")}${available ? "加入购物车" : "演示库存已售完"}</button><button class="button secondary full" data-action="detail-cart">查看购物车</button>${favoriteButton(product, true)}</div></div>`;
  showDialog("#product-dialog");
}
function summary() {
  const amounts = totals(state);
  return `<div class="cart-summary"><div class="summary-row"><span>商品小计</span><span>${formatMoney(amounts.subtotalCents)}</span></div><div class="summary-row"><span>演示运费</span><span>免费</span></div><div class="summary-row"><span>税费</span><span>原型不计算，非真实税务报价</span></div><div class="summary-row total"><span>演示合计</span><span>${formatMoney(amounts.totalCents)}</span></div></div>`;
}
function renderCart(focusSelector) {
  const items = cartItems(state);
  const title =
    ui.cartStep === "checkout" ? "模拟结账" : ui.cartStep === "success" ? "订单已创建" : "购物车";
  let content;
  if (ui.cartStep === "success") {
    content = `<div class="success-panel"><div class="success-icon">${icon("check")}</div><h2>模拟支付成功</h2><p>没有扣款，也不会真实发货。<br>订单 ${escape(ui.latestOrder?.id || "")}<br>自己购买不会给自己产生佣金。</p><button class="button full" data-action="view-orders">查看模拟订单${icon("arrow")}</button></div>`;
  } else if (!items.length) {
    content = empty("购物车还是空的", "先挑选一件好物，再回来体验模拟结账。");
  } else if (ui.cartStep === "checkout") {
    content = `<div class="notice">这是模拟结账，不连接支付机构。请勿填写真实收货地址或银行卡信息。</div><div class="checkout-box"><h3>演示收货地址</h3><p>${addressLabel(DEMO_ADDRESS)}</p></div><div class="checkout-box"><h3>演示支付方式</h3><p>模拟付款 · 不收集卡号 · 不扣除任何资金</p></div>${summary()}<button class="button full" data-action="pay-demo">确认模拟付款${icon("shield")}</button><button class="text-button" style="margin-top:18px" data-action="back-cart">返回购物车</button>`;
  } else {
    content = `<div class="cart-items">${items.map(({ product, quantity }) => `<div class="cart-item">${photo(product.id)}<div class="cart-item-copy"><h3>${product.name}</h3><div class="price">${formatMoney(product.priceCents)}</div><div class="quantity-row"><div class="quantity-control" aria-label="${product.name}数量"><button data-quantity="${product.id}" data-delta="-1" aria-label="减少${product.name}数量">−</button><span>${quantity}</span><button data-quantity="${product.id}" data-delta="1" aria-label="增加${product.name}数量">+</button></div><button class="remove-button" data-remove="${product.id}" aria-label="移除${product.name}">移除</button></div></div></div>`).join("")}</div>${summary()}<button class="button full" data-action="checkout">去模拟结账${icon("arrow")}</button><p class="wallet-note">演示订单不会真实扣款或发货。</p>`;
  }
  const dialog = document.querySelector("#cart-dialog");
  dialog.innerHTML = `<div class="modal-top"><h2 id="cart-title" tabindex="-1">${title}</h2><button class="icon-button" data-action="close-cart" aria-label="关闭购物车">${icon("close")}</button></div><div class="cart-body">${content}</div>`;
  if (focusSelector) {
    (dialog.querySelector(focusSelector) || dialog.querySelector("#cart-title"))?.focus();
  }
}
function openCart() {
  ui.cartStep = "cart";
  renderCart();
  showDialog("#cart-dialog");
}
function handleAction(action) {
  switch (action) {
    case "clear-filters":
      ui.query = "";
      ui.category = "全部";
      render();
      main.querySelector("#product-search")?.focus();
      break;
    case "open-cart":
      openCart();
      break;
    case "close-cart":
      closeDialog("#cart-dialog");
      break;
    case "close-product":
      closeDialog("#product-dialog");
      break;
    case "detail-cart":
      closeDialog("#product-dialog");
      openCart();
      break;
    case "checkout":
      ui.cartStep = "checkout";
      renderCart("#cart-title");
      break;
    case "back-cart":
      ui.cartStep = "cart";
      renderCart('[data-action="checkout"]');
      break;
    case "pay-demo": {
      const result = checkout(state);
      save(result.state);
      ui.latestOrder = result.order;
      ui.cartStep = "success";
      renderCart("#cart-title");
      render();
      break;
    }
    case "view-orders":
      closeDialog("#cart-dialog");
      navigate("orders");
      break;
    case "sample-image": {
      const id = document.querySelector("#sample-product").value;
      ui.sampleId = id;
      const version = ++imageLoadVersion;
      createCatalogSample(id)
        .then(async (file) => {
          if (version !== imageLoadVersion || ui.view !== "find") return;
          if (await selectImage(file, `${productById(id).name} · 商品示例`, version, true))
            await runImageSearch();
        })
        .catch((error) => {
          if (version === imageLoadVersion && ui.view === "find")
            toast(error.message || "示例图片读取失败");
        });
      break;
    }
    case "choose-image":
      document.querySelector("#image-file").click();
      break;
    case "clear-image":
      clearImage();
      render();
      main.querySelector('[data-action="choose-image"]')?.focus();
      break;
    case "search-image":
      void runImageSearch();
      break;
    case "retry-image-full":
      if (!ui.imageFile || ui.imageStatus === "searching") break;
      invalidateImageResults();
      ui.crop = "full";
      void runImageSearch();
      break;
    case "cancel-image-search":
      invalidateImageResults();
      render();
      toast("已取消本次匹配");
      break;
    case "crop-full":
    case "crop-center":
      invalidateImageResults();
      ui.crop = action === "crop-full" ? "full" : "center";
      render();
      break;
    case "withdraw":
      save(createWithdrawal(state).state);
      render();
      toast("模拟提现申请已提交，金额已冻结；不会真实打款");
      break;
    case "copy-invite": {
      const input = document.querySelector("#referral-url");
      input.select();
      if (navigator.clipboard?.writeText)
        navigator.clipboard
          .writeText(invitationUrl())
          .then(() => toast("示例邀请链接已复制，可以粘贴给朋友"))
          .catch(() => toast("已选中邀请链接，请手动复制"));
      else toast("已选中邀请链接，请手动复制");
      break;
    }
    case "reset-confirm":
      showDialog("#reset-dialog");
      break;
    case "close-reset":
      closeDialog("#reset-dialog");
      break;
    case "reset":
      closeDialog("#reset-dialog");
      clearImage();
      save(createInitialState());
      navigate("home");
      toast("演示数据已重置，AI 工作区数据未改动");
      break;
  }
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  try {
    if (button.dataset.view) {
      document.querySelectorAll("dialog[open]").forEach((dialog) => closeDialog(`#${dialog.id}`));
      navigate(button.dataset.view);
    } else if (button.dataset.category) {
      ui.category = button.dataset.category;
      document.querySelectorAll("[data-category]").forEach((category) => {
        const active = category.dataset.category === ui.category;
        category.classList.toggle("active", active);
        category.setAttribute("aria-pressed", String(active));
      });
      renderProducts();
    } else if (button.dataset.product) showProduct(button.dataset.product);
    else if (button.dataset.favorite) {
      const id = button.dataset.favorite;
      save(toggleFavorite(state, id));
      if (ui.view === "favorites" || ui.view === "profile") render();
      document.querySelectorAll("[data-favorite]").forEach((item) => {
        const product = productById(item.dataset.favorite);
        item.outerHTML = favoriteButton(product, item.classList.contains("detail-favorite"));
      });
      toast(state.favorites.includes(id) ? "已收藏，下次在“我的”中查看" : "已取消收藏");
    } else if (button.dataset.reorder) {
      const result = reorderOrder(state, button.dataset.reorder);
      save(result.state);
      const count = result.added.reduce((sum, item) => sum + item.quantity, 0);
      if (count) openCart();
      toast(
        count
          ? `已按当前价格加入 ${count} 件${result.adjusted.length || result.skipped.length ? "，部分商品库存不足已调整" : "，请核对后结账"}`
          : "这些商品目前没有可加购库存",
      );
    } else if (button.dataset.add) {
      save(addToCart(state, button.dataset.add));
      toast("已加入购物车");
    } else if (button.dataset.quantity) {
      const { quantity: id, delta } = button.dataset;
      save(setQuantity(state, id, (state.cart[id] || 0) + Number(delta)));
      renderCart(`[data-quantity="${id}"][data-delta="${delta}"]`);
    } else if (button.dataset.remove) {
      save(setQuantity(state, button.dataset.remove, 0));
      renderCart("#cart-title");
    } else if (button.dataset.action) handleAction(button.dataset.action);
  } catch (error) {
    toast(error instanceof Error ? error.message : "这次操作没有完成，请重试");
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "product-search") {
    ui.query = event.target.value;
    renderProducts();
  } else if (event.target.id === "image-result-query") {
    ui.resultQuery = event.target.value;
    document.querySelector("#image-match-grid").innerHTML = imageMatchCards();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id !== "image-file") return;
  const file = event.target.files?.[0];
  if (!file) return;
  selectImage(file).catch((error) => toast(error.message));
});

function selectionPoint(event, stage) {
  const r = stage.getBoundingClientRect(),
    b = imageBounds();
  return {
    x: Math.max(0, Math.min(1, ((event.clientX - r.left) / r.width - b.x) / b.width)),
    y: Math.max(0, Math.min(1, ((event.clientY - r.top) / r.height - b.y) / b.height)),
  };
}
document.addEventListener("pointerdown", (event) => {
  const stage = event.target.closest(".crop-stage");
  if (!stage || event.button !== 0) return;
  stage.setPointerCapture(event.pointerId);
  imageSelection = {
    stage,
    pointerId: event.pointerId,
    start: selectionPoint(event, stage),
    previous: ui.crop,
    moved: false,
  };
});
document.addEventListener("pointermove", (event) => {
  if (!imageSelection || event.pointerId !== imageSelection.pointerId) return;
  const { stage, start } = imageSelection;
  const end = selectionPoint(event, stage);
  if (Math.abs(end.x - start.x) < 0.03 || Math.abs(end.y - start.y) < 0.03) return;
  invalidateImageResults();
  ui.crop = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
  imageSelection.moved = true;
  stage.querySelector(".crop-frame").style.cssText = cropFrameStyle();
});
for (const type of ["pointerup", "pointercancel"])
  document.addEventListener(type, (event) => {
    if (!imageSelection || event.pointerId !== imageSelection.pointerId) return;
    const selection = imageSelection;
    imageSelection = null;
    if (type === "pointercancel") ui.crop = selection.previous;
    if (selection.moved) render();
  });
document.addEventListener("keydown", (event) => {
  if (!event.target.classList?.contains("crop-stage")) return;
  const r = cropRect();
  if (
    !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "f", "F"].includes(
      event.key,
    )
  )
    return;
  event.preventDefault();
  invalidateImageResults();
  if (event.key.toLowerCase() === "f") ui.crop = "full";
  else {
    if (["+", "=", "-"].includes(event.key)) {
      const factor = event.key === "-" ? 1.25 : 0.8;
      const width = Math.max(0.05, Math.min(1, r.width * factor)),
        height = Math.max(0.05, Math.min(1, r.height * factor));
      r.x += (r.width - width) / 2;
      r.y += (r.height - height) / 2;
      r.width = width;
      r.height = height;
    } else {
      r.x += event.key === "ArrowLeft" ? -0.03 : event.key === "ArrowRight" ? 0.03 : 0;
      r.y += event.key === "ArrowUp" ? -0.03 : event.key === "ArrowDown" ? 0.03 : 0;
    }
    r.x = Math.max(0, Math.min(1 - r.width, r.x));
    r.y = Math.max(0, Math.min(1 - r.height, r.y));
    ui.crop = r;
  }
  render();
  main.querySelector(".crop-stage")?.focus({ preventScroll: true });
});
document.addEventListener("dragover", (event) => {
  if (event.target.closest(".upload-card")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  if (!event.target.closest(".upload-card")) return;
  event.preventDefault();
  const file = event.dataTransfer.files?.[0];
  if (file) selectImage(file).catch((error) => toast(error.message));
});
document.addEventListener("paste", (event) => {
  if (ui.view !== "find") return;
  const file = [...(event.clipboardData?.files || [])].find((item) =>
    item.type.startsWith("image/"),
  );
  if (!file) return;
  event.preventDefault();
  selectImage(file, "粘贴的截图").catch((error) => toast(error.message));
});
window.addEventListener("beforeunload", () => {
  imageLoadVersion += 1;
  imageSearchController?.abort();
  if (ui.imageUrl) URL.revokeObjectURL(ui.imageUrl);
});
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("close", () => {
    if (!document.querySelector("dialog[open]")) document.body.classList.remove("no-scroll");
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        closeDialog(`#${dialog.id}`);
    }
  });
});
window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "home"));
const initialView = location.hash.slice(1);
ui.view = ["home", "find", "orders", "profile", "favorites", "recent"].includes(initialView)
  ? initialView
  : "home";
render();
