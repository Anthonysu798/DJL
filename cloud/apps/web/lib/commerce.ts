import { api, ApiError } from "./api";

export type {
  CommerceProduct,
  CommerceWallet,
  CommerceAddress,
  CommerceOrder,
  CommerceOrderRecoveryResponse,
  CommerceOrderItem,
  CommerceWithdrawal,
  CommerceLedgerEntry,
  CommercePaymentStatus,
  CommerceSupplierStatement,
  CommerceProfile as CommerceMe,
  CommerceSupplierOrder as SupplierItem,
} from "@synara/contracts/cloud";
import type {
  CommerceReferralSummary,
  CommerceReferralSummaryResponse,
  CommerceFavoritesResponse,
  CommerceFavoriteResponse,
  CommerceProduct,
  CommerceWallet,
  CommerceAddress,
  CommerceOrder,
  CommerceBuyerReturnRequestInput,
  CommerceOrderRecoveryInput,
  CommerceOrderRecoveryResponse,
  CommerceOrderItem,
  CommerceWithdrawal,
  CommerceImageSearchResult,
  CommerceImageUploadCompleteInput,
  CommerceImageUploadInput,
  CommerceImageUploadReceipt,
  CommerceImageUploadResponse,
  CommerceCatalogResponse,
  CommerceLedgerEntry,
  CommercePaymentStatus,
  CommerceSupplierStatement,
  CommerceProfile as CommerceMe,
  CommerceSupplierOrder as SupplierItem,
} from "@synara/contracts/cloud";
export type SupplierProduct = CommerceProduct & { readonly reserved: number };

const base = "/v1/commerce";
const imageUploads = `${base}/image-uploads`;
export type CommerceRequest = <T>(
  path: string,
  init?: RequestInit & { json?: unknown },
) => Promise<T>;

export function createCommerceClient(api: CommerceRequest) {
  return {
    catalog: () => api<CommerceCatalogResponse>(`${base}/catalog`),
    favorites: async (expectedUserId: string) => {
      const result = await api<CommerceFavoritesResponse>(`${base}/favorites`);
      if (result.userId !== expectedUserId)
        throw new ApiError(401, "commerce_account_changed", "商城账号已变化，请重新登录。", null);
      return result;
    },
    setFavorite: async (expectedUserId: string, productId: string, saved: boolean) => {
      const result = await api<CommerceFavoriteResponse>(
        `${base}/favorites/${encodeURIComponent(productId)}`,
        {
          method: "POST",
          json: { expectedUserId, saved },
        },
      );
      if (result.userId !== expectedUserId)
        throw new ApiError(401, "commerce_account_changed", "商城账号已变化，请重新登录。", null);
      if (result.productId !== productId || result.saved !== saved)
        throw new Error("收藏保存结果尚未确认，请刷新收藏核实后再操作。");
      return result;
    },
    me: () => api<CommerceMe>(`${base}/me`),
    referralSummary: async (
      expectedUserId: string,
      signal: AbortSignal,
    ): Promise<CommerceReferralSummary> => {
      if (!expectedUserId) throw new Error("商城账号尚未确认。");
      signal.throwIfAborted();
      const reply = await api<CommerceReferralSummaryResponse | null>(
        base + "/me?referralSummary=1",
        { method: "GET", cache: "no-store", signal },
      );
      signal.throwIfAborted();
      if (typeof reply?.userId === "string" && reply.userId && reply.userId !== expectedUserId)
        throw new ApiError(401, "commerce_account_changed", "商城账号已变化，请重新登录。", null);
      const summary = reply?.referralSummary;
      if (
        reply?.userId !== expectedUserId ||
        summary?.mode !== "test" ||
        summary.currency !== "CAD" ||
        [summary.directBuyers, summary.ordersWithCommission, summary.netCommissionCents].some(
          (value) => !Number.isSafeInteger(value) || value < 0,
        )
      )
        throw new ApiError(
          503,
          "commerce_referral_summary_unavailable",
          "推荐统计暂不可用，不能据此判断为零。",
          null,
        );
      return {
        mode: summary.mode,
        currency: summary.currency,
        directBuyers: summary.directBuyers,
        ordersWithCommission: summary.ordersWithCommission,
        netCommissionCents: summary.netCommissionCents,
      };
    },
    bind: (code: string) =>
      api<CommerceMe>(`${base}/referrals/bind`, { method: "POST", json: { code } }),
    orders: (page = 0) =>
      api<{ orders: CommerceOrder[]; page: number; hasMore: boolean }>(
        `${base}/orders${page ? `?page=${page}` : ""}`,
      ),
    createOrder: (
      items: { productId: string; quantity: number }[],
      address: CommerceAddress,
      idempotencyKey: string,
      expectedUserId?: string,
    ) =>
      api<{ order: CommerceOrder }>(`${base}/orders`, {
        method: "POST",
        json: {
          items,
          address,
          idempotencyKey,
          ...(expectedUserId !== undefined ? { expectedUserId } : {}),
        },
      }),
    recoverOrder: async (expectedUserId: string, idempotencyKey: string) => {
      const reply = await api<CommerceOrderRecoveryResponse | null>(`${base}/orders/recover`, {
        method: "POST",
        json: { expectedUserId, idempotencyKey } satisfies CommerceOrderRecoveryInput,
      });
      if (reply?.status === "closed" && Object.keys(reply).length === 1) return reply;
      if (reply?.status === "found" && Object.keys(reply).length === 2) {
        const order = reply.order;
        if (
          typeof order?.id === "string" &&
          order.id &&
          order.mode === "test" &&
          order.currency === "CAD" &&
          ["awaiting_payment", "paid", "cancelled", "refunded"].includes(order.status) &&
          order.address &&
          Array.isArray(order.items)
        )
          return reply;
      }
      throw new ApiError(
        503,
        "checkout_recovery_unconfirmed",
        "原下单请求尚未核实，请重试。",
        null,
      );
    },
    testPay: (id: string, idempotencyKey: string) =>
      api<{ order: CommerceOrder }>(`${base}/orders/${encodeURIComponent(id)}/test-pay`, {
        method: "POST",
        json: { idempotencyKey },
      }),
    checkout: (id: string, idempotencyKey: string) =>
      api<{ payment: CommercePaymentStatus; checkoutUrl: string | null }>(
        `${base}/orders/${encodeURIComponent(id)}/checkout`,
        { method: "POST", json: { idempotencyKey } },
      ),
    payment: (id: string) =>
      api<{ payment: CommercePaymentStatus }>(`${base}/orders/${encodeURIComponent(id)}/payment`),
    cancelCheckout: (id: string, idempotencyKey: string) =>
      api<{ payment: CommercePaymentStatus }>(
        `${base}/orders/${encodeURIComponent(id)}/checkout/cancel`,
        { method: "POST", json: { idempotencyKey } },
      ),
    cancel: (id: string, idempotencyKey: string) =>
      api<{ order: CommerceOrder }>(`${base}/orders/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        json: { idempotencyKey },
      }),
    requestReturn: (
      orderId: string,
      {
        request: { itemId, reason },
        idempotencyKey,
        expectedUserId,
      }: CommerceBuyerReturnRequestInput,
    ) =>
      api<{ order: CommerceOrder }>(`${base}/orders/${encodeURIComponent(orderId)}/returns`, {
        method: "POST",
        json: { request: { itemId, reason }, idempotencyKey, expectedUserId },
      }),
    withdrawals: (page = 0) =>
      api<{ withdrawals: CommerceWithdrawal[]; page: number; hasMore: boolean }>(
        `${base}/withdrawals${page ? `?page=${page}` : ""}`,
      ),
    ledger: (page = 0) =>
      api<{ entries: CommerceLedgerEntry[]; page: number; hasMore: boolean }>(
        `${base}/wallet/entries${page ? `?page=${page}` : ""}`,
      ),
    withdraw: (idempotencyKey: string) =>
      api<{ wallet: CommerceWallet }>(`${base}/withdrawals`, {
        method: "POST",
        json: { idempotencyKey },
      }),
    supplierOrders: (page = 0) =>
      api<{ orders: SupplierItem[]; page: number; hasMore: boolean }>(
        `${base}/supplier/orders${page ? `?page=${page}` : ""}`,
      ),
    supplierProducts: (page = 0) =>
      api<{ products: SupplierProduct[]; page: number; hasMore: boolean }>(
        `${base}/supplier/products${page ? `?page=${page}` : ""}`,
      ),
    supplierStatement: (
      supplierId: string,
      query: { from?: string; to?: string; page?: number } = {},
    ) => {
      const search = new URLSearchParams();
      if (query.from) search.set("from", query.from);
      if (query.to) search.set("to", query.to);
      if (query.page) search.set("page", String(query.page));
      return api<CommerceSupplierStatement>(
        `${base}/supplier/${encodeURIComponent(supplierId)}/statement${search.size ? `?${search}` : ""}`,
      );
    },
    updateStock: (id: string, stock: number) =>
      api(`${base}/supplier/products/${encodeURIComponent(id)}/stock`, {
        method: "PATCH",
        json: { stock },
      }),
    accept: (id: string) =>
      api(`${base}/supplier/items/${encodeURIComponent(id)}/accept`, { method: "POST", json: {} }),
    ship: (id: string, trackingNumber: string, carrier: string) =>
      api(`${base}/supplier/items/${encodeURIComponent(id)}/ship`, {
        method: "POST",
        json: { trackingNumber, carrier },
      }),
    reportSupplierIssue: (
      id: string,
      kind: "out_of_stock" | "delay" | "other",
      reason: string,
      idempotencyKey: string,
    ) =>
      api(`${base}/supplier/items/${encodeURIComponent(id)}/issues`, {
        method: "POST",
        json: { kind, reason, idempotencyKey },
      }),
    searchImage: (fileId: string, query?: string, signal?: AbortSignal) =>
      api<CommerceImageSearchResult>(`${base}/image-search`, {
        method: "POST",
        ...(signal ? { signal } : {}),
        json: { fileId, ...(query?.trim() ? { query: query.trim() } : {}) },
      }),
  };
}
export const commerce = createCommerceClient(api);

const unconfirmedOperation =
  "操作结果暂时无法确认，请先查询原订单或提现状态并联系平台核实，不要重复付款、退款或提现。";
const paymentNotConfigured = "测试付款渠道尚未配置或已关闭，暂时不能付款；不会自动切换成模拟支付。";
const commerceErrors: Readonly<Record<string, string>> = {
  favorites_limit: "最多收藏 1,000 件商品，请先取消部分收藏。",
  product_not_found: "商品已下架或暂不可售，请刷新商城后再试。",
  commerce_account_changed: "商城账号已变化，请重新登录后核实收藏。",
  out_of_stock: "商品库存已变化或暂时缺货，请刷新商品并调整购物车后再试。",
  inventory_conflict: "订单库存状态需要核实，请刷新订单并联系平台，不要重复付款。",
  reserved_stock: "库存不能低于已被订单预占的数量，请核对订单后再更新库存。",
  supplier_issue_not_allowed:
    "这条明细当前不能按所选类型上报，请刷新履约状态；已发货不能再报告缺货，已全额退款只能反馈尚未结束的其他售后问题。取消明细请联系平台。",
  referral_not_found: "推荐码不存在，请核对后再试。",
  referral_locked:
    "无法绑定这位推荐人。推荐关系只能在商城首单成功付款前确认，不能更换，也不能自绑、互绑或形成循环。",
  withdrawal_unavailable: "需有至少 CAD 20 可提现佣金，且没有退款待追回，才能申请提现。",
  withdrawal_pending: "已有提现申请处理中，请等待人工审核，不要重复申请。",
  withdrawal_review_required: "相关订单还有退款或售后需要核实，暂时不能申请提现。",
  commerce_checkout_paused: "商城暂时暂停新下单或新的测试收银台，历史订单和售后仍可查看。",
  checkout_attempt_closed: "这次下单请求已关闭，不会再生成订单。",
  checkout_recovery_limit: "今天关闭未创建请求的次数已达上限；请稍后核实，暂不要重复下单。",
  checkout_recovery_unconfirmed: "原下单请求尚未核实，请重试。",
  commerce_withdrawals_paused: "提现申请暂时暂停，历史收益和已有提现记录仍可查看。",
  image_search_limit: "图片找货当前较忙或已达到次数、服务额度限制，请稍后再试，也可使用文字搜索。",
  image_search_unavailable: "图片找货暂未启用或暂不可用，可以先使用文字搜索。",
  image_search_failed: "这次图片找货未能完成，请稍后再试或使用文字搜索。",
  commerce_stripe_test_disabled: paymentNotConfigured,
  commerce_payment_configuration: paymentNotConfigured,
  commerce_payment_provider_unavailable: unconfirmedOperation,
  commerce_payment_unavailable: unconfirmedOperation,
  commerce_write_failed: unconfirmedOperation,
  commerce_payment_unresolved:
    "付款结果尚未确认，请先查询并完成或确认取消原付款，再继续操作；不要新建付款或重复付款。",
  commerce_refund_unresolved:
    "先前的付款或退款仍待核实，请查询渠道状态或联系平台，不要重复退款或强行关闭售后。",
  commerce_checkout_in_progress:
    "已有付款请求尚未结束，请查询原订单的支付状态，不要新建付款或重复付款。",
  commerce_payment_proof_invalid:
    "付款或退款凭证与订单不一致，需要平台核实；不要重复付款、退款或将其视为成功。",
  commerce_payment_provider_mismatch:
    "这份订单需要使用原先指定的付款渠道，请刷新订单后按提示操作；不会自动切换成模拟支付。",
  idempotency_conflict:
    "这次请求与之前的操作不一致，请先查询原订单、退款或提现状态，涉及资金时请联系平台，不要重复提交。",
  commerce_funds_disabled: "商城交易和提现尚未启用，可以继续浏览商品及历史记录，不会收取真实款项。",
};

/** Commerce-only copy; unknown server messages remain text, without control characters. */
export function commerceErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return "暂时无法连接商城服务，请稍后重试。";
  if (error instanceof ApiError && commerceErrors[error.code]) return commerceErrors[error.code]!;
  const message = error instanceof Error ? error.message : "操作失败，请重试。";
  return (
    Array.from(message, (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character,
    )
      .join("")
      .trim() || "操作失败，请重试。"
  );
}

export function cad(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid CAD minor-unit amount");
  return `CAD ${(cents / 100).toFixed(2)}`;
}

/** Cart cache contains product ids and quantities only, never money or account information. */
export function readCart(raw: string | null): Record<string, number> {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([id, quantity]) =>
          /^[a-zA-Z0-9-]{1,100}$/.test(id) &&
          Number.isSafeInteger(quantity) &&
          Number(quantity) > 0 &&
          Number(quantity) <= 1000,
      ),
    );
  } catch {
    return {};
  }
}

/** Reuse product IDs and quantities only; fresh catalog prices remain authoritative. */
export function reorderCart(
  current: Readonly<Record<string, number>>,
  items: readonly Pick<CommerceOrderItem, "productId" | "quantity">[],
  products: readonly CommerceProduct[],
) {
  const cart = { ...current };
  const catalog = new Map(products.map((product) => [product.id, product]));
  let addedCount = 0,
    adjustedCount = 0,
    skippedCount = 0;
  for (const { productId, quantity } of items) {
    const product = catalog.get(productId);
    const existing = Object.hasOwn(cart, productId) ? cart[productId]! : 0;
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(productId) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000 ||
      !product ||
      !Number.isSafeInteger(product.stock) ||
      (!existing && Object.keys(cart).length >= 50)
    ) {
      skippedCount += 1;
      continue;
    }
    const added = Math.max(0, Math.min(quantity, product.stock - existing, 1000 - existing));
    if (!added) {
      skippedCount += 1;
      continue;
    }
    cart[productId] = existing + added;
    addedCount += added;
    if (added < quantity) adjustedCount += 1;
  }
  return { cart, addedCount, adjustedCount, skippedCount };
}

export function imageSource(raw: string | null): string | undefined {
  if (!raw) return undefined;
  if (
    raw.startsWith("/shop/") &&
    !raw.includes("//") &&
    !raw.includes("\\") &&
    Array.from(raw).every((character) => character.charCodeAt(0) > 32) &&
    !/%(?:2e|2f|5c)/i.test(raw)
  ) {
    const local = new URL(raw, "https://commerce.invalid");
    if (local.pathname === raw.split(/[?#]/)[0]) return raw;
    return undefined;
  }
  try {
    const url = new URL(raw);
    if (url.username || url.password) return undefined;
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      return url.href;
  } catch {
    /* invalid catalog image */
  }
  return undefined;
}

export function shopSignInPath(referralCode?: string): string {
  const next = `/shop${referralCode ? `?ref=${encodeURIComponent(referralCode)}` : ""}`;
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

/** Crop the previewed square; the re-encoded file is what gets hashed and uploaded. */
export async function centerCropImage(
  file: File,
  signal?: AbortSignal,
  focus: { readonly x: number; readonly y: number } = { x: 0.5, y: 0.5 },
): Promise<File> {
  signal?.throwIfAborted();
  if (![focus.x, focus.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
    throw new Error("裁剪位置无效，请重新选择图片。");
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("请选择不超过 10 MB 的 JPEG、PNG 或 WebP 图片。");
  const image = await createImageBitmap(file);
  try {
    signal?.throwIfAborted();
    const side = Math.min(image.width, image.height);
    if (!side) throw new Error("无法读取这张图片，请选择其他图片。");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(side, 1536);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持图片裁剪，可以取消裁剪后上传原图。");
    context.drawImage(
      image,
      (image.width - side) * focus.x,
      (image.height - side) * focus.y,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("裁剪失败，请重试。"))),
        "image/png",
      ),
    );
    signal?.throwIfAborted();
    return new File([blob], "commerce-search-crop.png", { type: "image/png" });
  } finally {
    image.close();
  }
}

export async function uploadCommerceImage(
  file: File,
  { expectedUserId, signal }: { readonly expectedUserId: string; readonly signal: AbortSignal },
  request: CommerceRequest = api,
): Promise<string> {
  signal.throwIfAborted();
  if (!expectedUserId) throw new Error("商城账号尚未确认，请重新登录。");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("请选择 JPEG、PNG 或 WebP 图片。");
  if (file.size === 0 || file.size > 10 * 1024 * 1024)
    throw new Error("图片应大于 0 且不超过 10 MB。");
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  signal.throwIfAborted();
  const sha256 = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const presign = await request<CommerceImageUploadResponse>(imageUploads, {
    method: "POST",
    signal,
    json: {
      expectedUserId,
      mimeType: file.type,
      size: file.size,
      sha256,
    } satisfies CommerceImageUploadInput,
  });
  signal.throwIfAborted();
  assertImageUploadOwner(presign, expectedUserId);
  if (typeof presign.id !== "string" || !presign.id || presign.upload?.method !== "PUT")
    throw new Error("图片上传地址尚未确认，请重试。");

  let url: URL;
  try {
    url = new URL(presign.upload.url);
  } catch {
    throw new Error("图片上传地址无效，请重试。");
  }
  const localHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.hash)
    throw new Error("图片上传地址无效，请重试。");
  const contentType = new Headers(presign.upload.headers).get("content-type");
  if (contentType !== file.type) throw new Error("图片上传类型尚未确认，请重试。");
  // Storage signs this content type and the length supplied by the browser.
  // Never forward account/CSRF headers or cookies to the storage origin.
  const response = await fetch(url.href, {
    method: "PUT",
    headers: new Headers({ "content-type": contentType }),
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    body: file,
    signal,
  });
  signal.throwIfAborted();
  if (!response.ok) throw new Error("图片上传失败，请重试。");
  const completed = await request<CommerceImageUploadReceipt>(
    `${imageUploads}/${encodeURIComponent(presign.id)}/complete`,
    { method: "POST", signal, json: { expectedUserId } satisfies CommerceImageUploadCompleteInput },
  );
  signal.throwIfAborted();
  assertImageUploadOwner(completed, expectedUserId);
  if (completed.id !== presign.id) throw new Error("图片上传结果尚未确认，请重新选择图片再试。");
  return completed.id;
}

function assertImageUploadOwner(receipt: CommerceImageUploadReceipt, expectedUserId: string) {
  if (receipt?.userId !== expectedUserId)
    throw new ApiError(
      401,
      "commerce_account_changed",
      "商城账号已变化，请重新选择图片再试。",
      null,
    );
}
