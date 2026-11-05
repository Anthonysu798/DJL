"use client";

import {
  Camera,
  Copy,
  Heart,
  Package,
  Search,
  ShoppingBag,
  ShoppingCart,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { ApiError } from "@/lib/api";
import { authClient, type Session } from "@/lib/auth-client";
import type {
  CommerceBuyerReturnRequestInput,
  CommerceCatalogResponse,
  CommerceDesktopBridge,
  CommerceImageSearchResult,
  CommerceReferralSummary,
} from "@synara/contracts/cloud";
import {
  cad,
  centerCropImage,
  commerce as defaultCommerce,
  commerceErrorMessage,
  imageSource,
  readCart,
  reorderCart,
  shopSignInPath,
  uploadCommerceImage,
  type CommerceAddress,
  type CommerceMe,
  type CommerceOrder,
  type CommerceProduct,
  type CommerceWithdrawal,
  type CommerceLedgerEntry,
} from "@/lib/commerce";
import {
  scopedShopCommerce,
  scopedShopConfig,
  scopedShopSignInPath,
  scopedUploadCommerceImage,
  signOutScopedShop,
} from "@/lib/scoped-shop";

import styles from "./shop.module.css";
import { CanadianAddressLookup } from "./CanadianAddressLookup";
import { HostedPayment } from "./HostedPayment";
import { CopyReference } from "./CopyReference";
import { ScopedShopAdmission, useScopedShopSession } from "./ScopedShopSession";
import {
  checkoutAttemptStorageKey,
  clearCheckoutAttempt,
  readCheckoutAttempt,
  saveCheckoutAttempt,
  type CheckoutAttemptMarker,
} from "./checkoutAttemptStorage";

const CART_KEY = "djl-commerce-cart-v1";
const MAX_QUANTITY = 1000;
const MAX_DISTINCT_SKUS = 50;
// Server uploads live for 30 minutes from creation; leave room for signing and transport.
const READY_PHOTO_REUSE_MS = 29 * 60_000;
type View = "home" | "find" | "orders" | "mine" | "favorites";
type HistoryKind = "orders" | "withdrawals" | "ledger";
type HistoryRead = { read: boolean; pending: boolean; failed: boolean };
type OrderAttempt = {
  items: { productId: string; quantity: number }[];
  address: CommerceAddress;
  key: string;
  ownerId: string;
  unknown: boolean;
};
const provinces = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
type ReturnTarget = { orderId: string; itemId: string; name: string };
type PendingReturn = { target: ReturnTarget; input: CommerceBuyerReturnRequestInput };
type ReturnStatus = "open" | "closed" | "unconfirmed";
const returnLineKey = (orderId: string, itemId: string) => orderId + "/" + itemId;
function confirmedReturnStatus(
  item: CommerceOrder["items"][number] | undefined,
): ReturnStatus | null {
  if (
    item?.openCase === true &&
    (item.afterSalesStatus === undefined || item.afterSalesStatus === "open")
  )
    return "open";
  if (
    item?.openCase === false &&
    (item.afterSalesStatus === "closed" || item.afterSalesStatus === "unconfirmed")
  )
    return item.afterSalesStatus;
  return null;
}
const pendingReturnMessage =
  "售后申请结果尚未确认，只能重试原申请。请在刷新或离开前先核实；刷新后请先查看订单记录，不要重复提交。";
const provinceRequiredMessage = "请选择收货地址的省／地区。";
const checkoutStorageUnavailable = "无法读取此标签页的下单核实记录。请允许会话存储并刷新本标签页。";
const checkoutSaveFailed = "无法保存下单核实记录，请允许此标签页的会话存储；本次未提交新订单。";
const checkoutRecoveryFailed = "暂时无法核实原下单请求，请稍后再试；不要另建订单。";
const statuses: Record<string, string> = {
  awaiting_payment: "待测试付款",
  paid: "测试付款成功",
  cancelled: "已取消",
  refunded: "已退款",
  pending: "待发货",
  accepted: "已接单",
  shipped: "已发货",
  delivered: "已签收",
};
const walletAccounts: Record<string, string> = {
  pending: "待结算",
  available: "可提现",
  frozen: "提现处理中",
  paid: "已付测试款",
  recovery: "退款待追回",
};

/** Do not discard a checkout marker for a receipt that cannot be safely shown. */
function isCheckoutOrder(order: CommerceOrder | null | undefined): order is CommerceOrder {
  return (
    typeof order?.id === "string" &&
    order.id.length > 0 &&
    order.address?.country === "CA" &&
    order.currency === "CAD" &&
    order.mode === "test" &&
    ["simulation", "stripe_test"].includes(order.paymentProvider) &&
    ["awaiting_payment", "paid", "cancelled", "refunded"].includes(order.status) &&
    Number.isSafeInteger(order.totalCents) &&
    order.totalCents >= 0 &&
    Number.isSafeInteger(order.refundedCents) &&
    order.refundedCents >= 0 &&
    Array.isArray(order.items) &&
    order.items.every(
      (item) =>
        typeof item?.id === "string" &&
        Number.isSafeInteger(item.lineCents) &&
        item.lineCents >= 0 &&
        Number.isSafeInteger(item.refundedCents) &&
        item.refundedCents >= 0,
    )
  );
}

function ProductImage({ product }: { product: CommerceProduct }) {
  const src = imageSource(product.imageUrl);
  return (
    <div className={styles.productImage}>
      <ProductImageContent key={src} src={src} name={product.name} />
    </div>
  );
}

function ProductImageContent({ src, name }: { src: string | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={src} alt={name} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  ) : (
    <ShoppingBag aria-label="暂无商品图片" />
  );
}

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className={styles.modalHeader}>
        <h2>{title}</h2>
        <button className={styles.iconButton} onClick={close} aria-label={`关闭${title}`}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function ReferralSummaryPanel({
  expectedUserId,
  load,
  onSessionEnded,
}: {
  expectedUserId: string;
  load: typeof defaultCommerce.referralSummary;
  onSessionEnded: (message: string) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    { status: "loading" | "unavailable" } | { status: "ready"; summary: CommerceReferralSummary }
  >({ status: "loading" });
  useLayoutEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return load(expectedUserId, signal);
      })
      .then((summary) => {
        if (!signal.aborted) setState({ status: "ready", summary });
      })
      .catch((cause: unknown) => {
        if (signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          onSessionEnded("商城账号已变化或登录已失效，请重新登录后查看推荐统计。");
          return;
        }
        setState({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [attempt, expectedUserId, load, onSessionEnded]);

  return (
    <section className={styles.panel} aria-label="直接推荐统计">
      <h2>直接推荐统计</h2>
      <p className={styles.small}>
        只统计直接推荐，不显示好友身份。累计模拟净佣金已扣除退款冲回，不是可提现金额；提现以钱包为准。
      </p>
      {state.status === "ready" ? (
        <dl>
          <div className={styles.orderLine}>
            <dt>直接推荐买家</dt>
            <dd>
              <strong>{state.summary.directBuyers}</strong>
            </dd>
          </div>
          <div className={styles.orderLine}>
            <dt>仍有佣金的订单</dt>
            <dd>
              <strong>{state.summary.ordersWithCommission}</strong>
            </dd>
          </div>
          <div className={styles.orderLine}>
            <dt>累计模拟净佣金（退款后）</dt>
            <dd>
              <strong>{cad(state.summary.netCommissionCents)}</strong>
            </dd>
          </div>
        </dl>
      ) : state.status === "loading" ? (
        <p role="status">正在读取直接推荐统计…</p>
      ) : (
        <p role="alert">推荐统计暂不可用，不能据此判断为零。</p>
      )}
      <button
        type="button"
        className={styles.secondary}
        disabled={state.status === "loading"}
        onClick={() => {
          setState({ status: "loading" });
          setAttempt((value) => value + 1);
        }}
      >
        {state.status === "unavailable" ? "重试推荐统计" : "刷新推荐统计"}
      </button>
    </section>
  );
}
type ShopIdentity = Pick<Session["user"], "id" | "name" | "email" | "emailVerified">;
type LoadInitialCatalog = (retry?: boolean) => Promise<CommerceCatalogResponse>;
type ShopSessionState = {
  readonly data: { readonly session: { readonly id: string }; readonly user: ShopIdentity } | null;
  readonly isPending: boolean;
  readonly isRefetching: boolean;
  readonly error?: { readonly status?: number } | null;
};

export function ShopClient() {
  if (scopedShopConfig.mode === "off") return <DefaultShopClient />;
  return (
    <ScopedShopAdmission>
      <PilotShopClient />
    </ScopedShopAdmission>
  );
}

const readDefaultShopSession = () =>
  authClient.$store.atoms.session?.get() as ShopSessionState | undefined;

function DefaultShopClient() {
  const { refetch } = authClient.useSession();
  return <ShopSessionRoot read={readDefaultShopSession} refetch={refetch} scoped={false} />;
}

function PilotShopClient() {
  const { read, refetch } = useScopedShopSession();
  return <ShopSessionRoot read={read} refetch={refetch} scoped />;
}

function ShopSessionRoot({
  read,
  refetch,
  scoped,
}: {
  read: () => ShopSessionState | undefined;
  refetch: (options: { query: { disableCookieCache: true } }) => Promise<unknown>;
  scoped: boolean;
}) {
  // refetch returns void: its published atom, not a pre-mount React cache, is the result.
  const current = read();
  const data = current?.data ?? null;
  const isPending = current?.isPending ?? false;
  const error = current?.error;
  const [checked, setChecked] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  // Preserve only navigation while each account/session keeps its own private subtree.
  const [view, setView] = useState<View>("home");
  // Start the fresh check before the SDK's mount timer so it joins this flight,
  // rather than sending an automatic request that this refetch then cancels.
  useLayoutEffect(() => {
    let active = true;
    void refetch({ query: { disableCookieCache: true } })
      .then(() => {
        const fresh = read();
        if (
          !fresh ||
          fresh.error ||
          fresh.isPending !== false ||
          fresh.isRefetching !== false ||
          (fresh.data &&
            (typeof fresh.data.user?.id !== "string" ||
              !fresh.data.user.id ||
              typeof fresh.data.session?.id !== "string" ||
              !fresh.data.session.id))
        )
          throw new Error("Fresh commerce identity was not confirmed.");
      })
      .catch(() => {
        if (active) setRefreshFailed(true);
      })
      .finally(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, [read, refetch, retryVersion]);
  const [endedSession, setEndedSession] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionId = data?.session.id ?? null;
  const checking = isPending || !checked;
  const commerce = scoped ? scopedShopCommerce : defaultCommerce;
  const catalogHandoff = useRef<{
    version: number;
    request: Promise<CommerceCatalogResponse>;
  } | null>(null);
  const loadInitialCatalog = useCallback<LoadInitialCatalog>(
    (retry = false) => {
      const pending = catalogHandoff.current;
      const request =
        !retry && pending?.version === retryVersion ? pending.request : commerce.catalog();
      // The keyed body still remounts for identity isolation. Only hand off the
      // public catalog once; later account changes and manual refreshes read afresh.
      catalogHandoff.current = checking ? { version: retryVersion, request } : null;
      return request;
    },
    [checking, commerce, retryVersion],
  );
  const user =
    !checking && !error && !refreshFailed && sessionId !== endedSession ? data?.user : null;
  const identity: ShopIdentity | null = user
    ? { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified }
    : null;
  const endSession = useCallback(
    (message: string) => {
      setEndedSession(sessionId);
      setEpoch((current) => current + 1);
      setNotice(message);
      setView("mine");
    },
    [sessionId],
  );
  function retryIdentity() {
    if (checking) return;
    setChecked(false);
    setRefreshFailed(false);
    setRetryVersion((current) => current + 1);
  }
  return (
    <ShopBody
      key={`${checking ? "checking" : (identity?.id ?? "guest")}:${sessionId ?? "none"}:${epoch}`}
      identity={identity}
      loadInitialCatalog={loadInitialCatalog}
      identityPending={checking}
      identityFailed={Boolean(error) || refreshFailed}
      identityRateLimited={error?.status === 429}
      notice={identity ? null : notice}
      onSessionEnded={endSession}
      onRetryIdentity={retryIdentity}
      scoped={scoped}
      view={view}
      setView={setView}
    />
  );
}

/** A new account gets a new private state tree; old asynchronous requests cannot refill it. */
function ShopBody({
  loadInitialCatalog,
  identity,
  identityPending,
  identityFailed,
  identityRateLimited,
  notice,
  onSessionEnded,
  onRetryIdentity,
  scoped,
  view,
  setView,
}: {
  loadInitialCatalog: LoadInitialCatalog;
  identity: ShopIdentity | null;
  identityPending: boolean;
  identityFailed: boolean;
  identityRateLimited: boolean;
  notice: string | null;
  onSessionEnded: (message: string) => void;
  onRetryIdentity: () => void;
  scoped: boolean;
  view: View;
  setView: (view: View) => void;
}) {
  const router = useRouter();
  const commerce = scoped ? scopedShopCommerce : defaultCommerce;
  const signInPath = scoped ? scopedShopSignInPath : shopSignInPath;
  const cartKey = scoped ? CART_KEY + "-scoped-test" : CART_KEY;
  const checkoutKey = identity ? checkoutAttemptStorageKey(scoped, identity.id) : null;
  const authenticated = identity !== null;
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [mode, setMode] = useState<"test" | "disabled">("disabled");
  const [paymentProvider, setPaymentProvider] = useState<"simulation" | "stripe_test" | "disabled">(
    "disabled",
  );
  const [loading, setLoading] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const initialCatalogRequest = useRef<Promise<CommerceCatalogResponse> | null>(null);
  const [checkoutPaused, setCheckoutPaused] = useState(false);
  const [accountLoading, setAccountLoading] = useState(identityPending || Boolean(identity));
  const [me, setMe] = useState<CommerceMe | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<readonly string[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [favoritesPending, setFavoritesPending] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const favoriteRequest = useRef<{ scope: { active: boolean } } | null>(null);
  const [orders, setOrders] = useState<CommerceOrder[]>([]);
  const [recoveredOrder, setRecoveredOrder] = useState<CommerceOrder | null>(null);
  const [withdrawals, setWithdrawals] = useState<CommerceWithdrawal[]>([]);
  const [ledger, setLedger] = useState<CommerceLedgerEntry[]>([]);
  const [history, setHistory] = useState<Record<HistoryKind, HistoryRead>>({
    orders: { read: false, pending: false, failed: false },
    withdrawals: { read: false, pending: false, failed: false },
    ledger: { read: false, pending: false, failed: false },
  });
  const historyRequests = useRef({ orders: 0, withdrawals: 0, ledger: 0 });
  const [orderPage, setOrderPage] = useState(0);
  const [withdrawalPage, setWithdrawalPage] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [moreOrders, setMoreOrders] = useState(false);
  const [moreWithdrawals, setMoreWithdrawals] = useState(false);
  const [moreLedger, setMoreLedger] = useState(false);
  const [returnItem, setReturnItem] = useState<ReturnTarget | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [pendingReturn, setPendingReturn] = useState<PendingReturn | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnReceipts, setReturnReceipts] = useState<ReadonlyMap<string, ReturnStatus>>(
    () => new Map(),
  );
  const returnSending = useRef(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartReady, setCartReady] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [provinceInvalid, setProvinceInvalid] = useState(false);
  const provinceLabelId = useId();
  const provinceErrorId = useId();
  const [selected, setSelected] = useState<CommerceProduct | null>(null);
  const [query, setQuery] = useState("");
  const focusTextSearch = useRef(false);
  const [category, setCategory] = useState("全部");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(notice);
  const [actionBusy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const busy = actionBusy || signingOut || imageBusy;
  const [embedded, setEmbedded] = useState(false);
  const [referral, setReferral] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState(false);
  const [cropFocus, setCropFocus] = useState({ x: 0.5, y: 0.5 });
  const [imageResult, setImageResult] = useState<CommerceImageSearchResult | null>(null);
  const [imageQuery, setImageQuery] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);
  const imageFlow = useRef<AbortController | null>(null);
  const readyPhoto = useRef<{
    file: File;
    focus: typeof cropFocus | null;
    ownerId: string;
    startedAt: number;
    id: string;
  } | null>(null);
  const imagePicker = useRef<HTMLInputElement>(null);
  const imagePickerButton = useRef<HTMLButtonElement>(null);
  const imageSelectionId = useId();
  const restoreImagePickerFocus = useRef(false);
  const attempt = useRef<OrderAttempt | null>(null);
  const [inPageOrderLocked, setInPageOrderLocked] = useState(false);
  const [checkoutMarker, setCheckoutMarker] = useState<CheckoutAttemptMarker>({
    kind: "unavailable",
  });
  const orderLocked = inPageOrderLocked || checkoutMarker.kind === "pending";
  const orderSending = useRef(false);
  const reorderSending = useRef(false);
  const orderScope = useRef({ active: true });
  const paymentKeys = useRef(new Map<string, string>());
  const withdrawalKey = useRef<string | null>(null);
  const inviteInput = useRef<HTMLInputElement>(null);
  const loadInitialHistory = useEffectEvent(async (active: () => boolean) => {
    await Promise.all([
      loadHistory("orders", 0, active),
      loadHistory("withdrawals", 0, active),
      loadHistory("ledger", 0, active),
    ]);
  });

  useEffect(
    () => () => {
      imageFlow.current?.abort();
      imageFlow.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!file && !busy && restoreImagePickerFocus.current) {
      restoreImagePickerFocus.current = false;
      imagePickerButton.current?.focus();
    }
  }, [file, busy]);

  useLayoutEffect(() => {
    const scope = { active: true };
    orderScope.current = scope;
    return () => {
      scope.active = false;
      attempt.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (checkoutKey) setCheckoutMarker(readCheckoutAttempt(checkoutKey));
  }, [checkoutKey]);

  useEffect(() => {
    setEmbedded(
      (window as Window & { djlCommerce?: CommerceDesktopBridge }).djlCommerce?.kind === "desktop",
    );
    setReferral(new URL(window.location.href).searchParams.get("ref")?.slice(0, 100) ?? "");
    try {
      setCart(readCart(sessionStorage.getItem(cartKey)));
    } catch {
      /* browser cache optional */
    }
    setCartReady(true);
    let active = true;
    // StrictMode replays the effect, not the keyed body. Reattach to its live read.
    const request = (initialCatalogRequest.current ??= loadInitialCatalog());
    void request
      .then((data) => {
        if (active) {
          setProducts([...data.products]);
          setMode(data.mode);
          setPaymentProvider(
            data.paymentProvider ?? (data.mode === "test" ? "simulation" : "disabled"),
          );
          setCheckoutPaused(data.checkoutPaused ?? false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(commerceErrorMessage(e));
          setCatalogFailed(true);
        }
      })
      .finally(() => {
        if (initialCatalogRequest.current === request) initialCatalogRequest.current = null;
        if (active) setLoading(false);
      });
    if (authenticated)
      commerce
        .me()
        .then(async (profile) => {
          if (!active) return;
          setMe(profile);
          await loadInitialHistory(() => active);
        })
        .catch((e: unknown) => {
          if (!active) return;
          if (e instanceof ApiError && e.status === 401)
            onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
          else setError(commerceErrorMessage(e));
        })
        .finally(() => {
          if (active) setAccountLoading(false);
        });
    return () => {
      active = false;
    };
  }, [authenticated, cartKey, commerce, loadInitialCatalog, onSessionEnded]);

  useEffect(() => {
    if (!cartReady) return;
    try {
      sessionStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      /* server orders remain authoritative */
    }
  }, [cart, cartKey, cartReady]);
  useEffect(() => {
    readyPhoto.current = null;
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const favoritesUserId = identity?.id ?? null;
  const loadFavorites = useCallback(
    async (refreshCatalog = false) => {
      const scope = orderScope.current;
      if (!favoritesUserId || !scope.active || favoriteRequest.current?.scope === scope) return;
      const request = { scope };
      favoriteRequest.current = request;
      if (refreshCatalog) setMessage(null);
      setFavoritesPending(true);
      setFavoriteError(null);
      try {
        const [result, catalog] = await Promise.all([
          commerce.favorites(favoritesUserId),
          refreshCatalog ? commerce.catalog() : undefined,
        ]);
        if (!scope.active || favoriteRequest.current !== request) return;
        setFavoriteIds(result.productIds);
        setFavoritesLoaded(true);
        if (catalog) {
          setProducts([...catalog.products]);
          setMode(catalog.mode);
          setPaymentProvider(
            catalog.paymentProvider ?? (catalog.mode === "test" ? "simulation" : "disabled"),
          );
          setCheckoutPaused(catalog.checkoutPaused ?? false);
          setCatalogFailed(false);
        }
      } catch (cause) {
        if (!scope.active || favoriteRequest.current !== request) return;
        setFavoritesLoaded(false);
        setFavoriteError(commerceErrorMessage(cause));
        if (cause instanceof ApiError && cause.status === 401)
          onSessionEnded("商城账号已变化，请重新登录后核实收藏。");
      } finally {
        if (favoriteRequest.current === request) {
          favoriteRequest.current = null;
          if (scope.active) setFavoritesPending(false);
        }
      }
    },
    [commerce, favoritesUserId, onSessionEnded],
  );
  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);
  async function toggleFavorite(productId: string) {
    if (!identity) {
      setView("mine");
      setMessage(
        identityRateLimited
          ? "账号暂时无法核实，请稍后重新核实后再收藏。"
          : "登录商城账号后即可收藏，收藏商品会保存在该账号下。",
      );
      return;
    }
    const scope = orderScope.current;
    if (
      !identity.emailVerified ||
      !favoritesLoaded ||
      !scope.active ||
      favoriteRequest.current?.scope === scope ||
      busy
    )
      return;
    const request = { scope };
    favoriteRequest.current = request;
    const saved = !favoriteIds.includes(productId);
    setFavoritesPending(true);
    setFavoriteError(null);
    setMessage(null);
    try {
      await commerce.setFavorite(identity.id, productId, saved);
      if (!scope.active || favoriteRequest.current !== request) return;
      setFavoriteIds((ids) =>
        saved
          ? [productId, ...ids.filter((id) => id !== productId)]
          : ids.filter((id) => id !== productId),
      );
      setMessage(saved ? "已保存到账号收藏，可在其他设备登录后查看。" : "已取消收藏。");
    } catch (cause) {
      if (!scope.active || favoriteRequest.current !== request) return;
      setFavoritesLoaded(false);
      setFavoriteError(commerceErrorMessage(cause));
      if (cause instanceof ApiError && cause.status === 401)
        onSessionEnded("商城账号已变化，请重新登录后核实收藏。");
    } finally {
      if (favoriteRequest.current === request) {
        favoriteRequest.current = null;
        if (scope.active) setFavoritesPending(false);
      }
    }
  }
  const favoriteButton = (id: string, name: string, compact = false) => (
    <button
      className={compact ? styles.favoriteButton : styles.secondary}
      aria-label={`${favoriteIds.includes(id) ? "取消收藏" : "收藏"}${name}`}
      aria-pressed={favoriteIds.includes(id)}
      disabled={
        identityPending ||
        busy ||
        (authenticated && (favoritesPending || !favoritesLoaded || !identity?.emailVerified))
      }
      onClick={() => void toggleFavorite(id)}
    >
      <Heart size={18} fill={favoriteIds.includes(id) ? "currentColor" : "none"} />
      {compact ? null : favoriteIds.includes(id) ? "已收藏" : "收藏商品"}
    </button>
  );
  const favoriteProblem = favoriteError ? (
    <div className={styles.notice}>
      <p role="alert">收藏尚未确认，请刷新收藏核实。{favoriteError}</p>
      <button
        className={styles.secondary}
        onClick={() => {
          setSelected(null);
          setView("favorites");
        }}
      >
        查看收藏并核实
      </button>
    </div>
  ) : null;

  const action = async (work: () => Promise<void>) => {
    if (busy || signingOut) return;
    const scope = orderScope.current;
    if (!scope.active) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      if (!scope.active) return;
      if (e instanceof ApiError && e.status === 401)
        onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
      setError(commerceErrorMessage(e));
    } finally {
      if (scope.active) setBusy(false);
    }
  };
  async function loadHistory(
    kind: HistoryKind,
    page: number,
    active = () => true,
    replaceRecovered = false,
  ) {
    const request = ++historyRequests.current[kind];
    const current = () => active() && historyRequests.current[kind] === request;
    setHistory((previous) => ({
      ...previous,
      [kind]: { ...previous[kind], pending: true, failed: false },
    }));
    try {
      const result = await (kind === "orders"
        ? commerce.orders(page)
        : kind === "withdrawals"
          ? commerce.withdrawals(page)
          : commerce.ledger(page));
      if (!current()) return;
      if ("orders" in result) {
        setOrders(result.orders);
        setReturnReceipts((previous) => {
          if (!previous.size) return previous;
          const next = new Map(previous);
          for (const entry of result.orders)
            for (const item of entry.items)
              if (confirmedReturnStatus(item)) next.delete(returnLineKey(entry.id, item.id));
          // A missing target or an older 'none' read cannot erase the confirmed write.
          return next.size === previous.size ? previous : next;
        });
        if (replaceRecovered) setRecoveredOrder(null);
        setOrderPage(page);
        setMoreOrders(result.hasMore ?? false);
      } else if ("withdrawals" in result) {
        setWithdrawals(result.withdrawals);
        setWithdrawalPage(page);
        setMoreWithdrawals(result.hasMore ?? false);
      } else {
        setLedger(result.entries);
        setLedgerPage(page);
        setMoreLedger(result.hasMore ?? false);
      }
      setHistory((previous) => ({
        ...previous,
        [kind]: { read: true, pending: false, failed: false },
      }));
    } catch (cause) {
      if (current())
        setHistory((previous) => ({
          ...previous,
          [kind]: { ...previous[kind], pending: false, failed: true },
        }));
      throw cause;
    }
  }
  const historyNotice = (kind: HistoryKind, label: string) => {
    const state = history[kind];
    if (state.pending) return <p role="status">正在读取{label}…</p>;
    if (state.read && !state.failed) return null;
    return (
      <div className={styles.notice}>
        <p role={state.failed ? "alert" : "status"}>
          {state.read
            ? `${label}刷新失败，保留上次读取的记录，可能已过期；请重试核实。`
            : `${label}尚未读取成功，不能据此判断没有历史记录。`}
        </p>
        <button
          className={styles.secondary}
          disabled={busy}
          onClick={() =>
            void action(() =>
              loadHistory(
                kind,
                kind === "orders"
                  ? orderPage
                  : kind === "withdrawals"
                    ? withdrawalPage
                    : ledgerPage,
                () => true,
                true,
              ),
            )
          }
        >
          重新读取{label}
        </button>
      </div>
    );
  };
  const refreshAccount = async (
    next: Partial<{ orders: number; withdrawals: number; ledger: number }> = {},
  ) => {
    const scope = orderScope.current;
    if (!scope.active) return;
    const pages = { orders: orderPage, withdrawals: withdrawalPage, ledger: ledgerPage, ...next };
    try {
      await Promise.all([
        commerce.me().then((profile) => {
          if (scope.active) setMe(profile);
        }),
        loadHistory("orders", pages.orders, () => scope.active, true),
        loadHistory("withdrawals", pages.withdrawals, () => scope.active),
        loadHistory("ledger", pages.ledger, () => scope.active),
      ]);
    } catch (cause) {
      if (scope.active && cause instanceof ApiError && cause.status === 401)
        onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
      throw cause;
    }
  };
  async function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope = orderScope.current;
    if (
      !scope.active ||
      !returnItem ||
      !identity ||
      !me ||
      mode !== "test" ||
      busy ||
      returnReceipts.has(returnLineKey(returnItem.orderId, returnItem.itemId)) ||
      returnSending.current
    )
      return;
    const reason = returnReason.trim();
    if (!pendingReturn && (!reason || reason.length > 500)) {
      setReturnError("请填写 1 至 500 字的售后原因。");
      return;
    }
    const pending: PendingReturn = pendingReturn ?? {
      target: returnItem,
      input: {
        request: { itemId: returnItem.itemId, reason },
        idempotencyKey: crypto.randomUUID(),
        expectedUserId: identity.id,
      },
    };
    if (
      pending.input.expectedUserId !== identity.id ||
      pending.target.orderId !== returnItem.orderId ||
      pending.target.itemId !== returnItem.itemId
    )
      return;

    returnSending.current = true;
    setPendingReturn(pending);
    setBusy(true);
    setReturnError(null);
    setError(null);
    setMessage(null);
    try {
      const response = await commerce.requestReturn(pending.target.orderId, pending.input);
      if (!scope.active) return;
      const returnedOrder = response?.order;
      const lines =
        isCheckoutOrder(returnedOrder) && returnedOrder.id === pending.target.orderId
          ? returnedOrder.items.filter((line) => line.id === pending.target.itemId)
          : [];
      const status = confirmedReturnStatus(lines.length === 1 ? lines[0] : undefined);
      if (!status) {
        setReturnError("返回的售后记录尚未确认。请重试原申请，不要另建申请。");
        return;
      }

      // An acknowledged write must survive a rejected, stale, or off-page readback.
      setReturnReceipts((previous) =>
        new Map(previous).set(returnLineKey(pending.target.orderId, pending.target.itemId), status),
      );
      setPendingReturn(null);
      setReturnItem(null);
      setReturnReason("");
      setMessage(
        status === "open"
          ? "售后申请已提交，平台会核实处理；未结售后期间不会释放相关佣金。当前不发生真实退款。"
          : "已核实原售后记录；没有重新开启售后，不代表退款或到账。",
      );

      try {
        await loadHistory("orders", orderPage, () => scope.active, true);
      } catch (cause) {
        // History shows its own read warning; never turn an acknowledged write into a retry.
        if (scope.active && cause instanceof ApiError && cause.status === 401)
          onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
      }
    } catch (cause) {
      if (!scope.active) return;
      if (
        cause instanceof ApiError &&
        (cause.status === 401 || cause.code === "commerce_account_changed")
      ) {
        onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
      } else if (cause instanceof ApiError && (cause.status === 400 || cause.status === 404)) {
        setReturnError("商城服务无法核实原申请，可能版本不兼容或记录已变化。请勿另建申请。");
      } else {
        setReturnError("连接或服务器响应尚未确认，请重试原申请，不要另建申请。");
      }
    } finally {
      returnSending.current = false;
      if (scope.active) setBusy(false);
    }
  }

  const signOut = async (switchAccount: boolean) => {
    if (busy || signingOut || accountLoading) return;
    setSigningOut(true);
    setError(null);
    setMessage(null);
    try {
      if (scoped) await signOutScopedShop();
      else {
        const result = await authClient.signOut();
        if (result.error || result.data?.success !== true)
          throw new Error("Sign-out not confirmed");
      }
    } catch {
      setError("退出结果尚未确认，仍保留当前商城账号和记录；请稍后重试，不会显示为已退出。");
      setSigningOut(false);
      return;
    }
    try {
      sessionStorage.removeItem(cartKey);
    } catch {
      /* only this optional commerce cache */
    }
    onSessionEnded(
      "商城账号已退出；已清除本页的商城私密视图和草稿，云端订单仍保留，本机 AI 数据未改变。",
    );
    if (switchAccount) router.push(signInPath());
  };
  const retryCatalog = () =>
    void action(async () => {
      setLoading(true);
      try {
        const data = await loadInitialCatalog(true);
        setProducts([...data.products]);
        setMode(data.mode);
        setPaymentProvider(
          data.paymentProvider ?? (data.mode === "test" ? "simulation" : "disabled"),
        );
        setCheckoutPaused(data.checkoutPaused ?? false);
        setCatalogFailed(false);
      } catch (error) {
        setCatalogFailed(true);
        throw error;
      } finally {
        setLoading(false);
      }
    });
  const changeQuantity = (id: string, quantity: number) => {
    if (orderLocked || attempt.current) {
      setError("订单创建结果待核实，请先重试原订单请求或查询订单，不能改动本次选品。");
      return false;
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) return false;
    if (quantity === 0) {
      setError(null);
      setCart((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return true;
    }
    if (quantity > MAX_QUANTITY) {
      setError("每种商品每单最多购买 1000 件，请调整数量。");
      return false;
    }
    const product = products.find((p) => p.id === id);
    const decreasing = quantity < (cart[id] ?? 0);
    if ((!product || quantity > product.stock) && !decreasing) {
      setError("库存不足，请刷新商品后重试。");
      return false;
    }
    const selectedKinds = Object.keys(cart).length;
    if (quantity > 0 && !cart[id] && selectedKinds >= MAX_DISTINCT_SKUS) {
      setError("每单最多购买 50 种商品，请先移除一种再添加新商品。");
      return false;
    }
    setError(null);
    setCart((current) => {
      const next = { ...current };
      next[id] = quantity;
      return next;
    });
    return true;
  };
  const add = (product: CommerceProduct) => {
    setMessage(null);
    if (changeQuantity(product.id, (cart[product.id] ?? 0) + 1)) setMessage("已加入购物车");
  };
  const reorder = (order: CommerceOrder) => {
    const scope = orderScope.current;
    if (
      !scope.active ||
      busy ||
      orderLocked ||
      attempt.current ||
      reorderSending.current ||
      order.status === "awaiting_payment"
    )
      return;
    reorderSending.current = true;
    void action(async () => {
      try {
        const data = await commerce.catalog();
        if (!scope.active || attempt.current) return;
        const result = reorderCart(cart, order.items, data.products);
        setProducts([...data.products]);
        setMode(data.mode);
        setPaymentProvider(
          data.paymentProvider ?? (data.mode === "test" ? "simulation" : "disabled"),
        );
        setCheckoutPaused(data.checkoutPaused ?? false);
        setCatalogFailed(false);
        setCart(result.cart);
        if (result.addedCount) setCartOpen(true);
        setMessage(
          result.addedCount
            ? `已按当前价格和库存加入 ${result.addedCount} 件商品${result.adjustedCount || result.skippedCount ? "；部分商品已下架、缺货或数量受限，已调整，请核对购物车。" : "，请核对后再结账；尚未创建新订单或付款。"}`
            : "原订单商品已下架、缺货或购物车已达上限，没有新增商品。",
        );
      } catch (cause) {
        if (scope.active) setCatalogFailed(true);
        throw cause;
      } finally {
        reorderSending.current = false;
      }
    });
  };
  const cartLines = Object.entries(cart).map(([id, quantity]) => {
    const product = products.find((p) => p.id === id);
    return { id, product, quantity };
  });
  const invalidCart =
    loading ||
    catalogFailed ||
    cartLines.some(({ product, quantity }) => !product || quantity > product.stock);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cartLines.reduce(
    (sum, { product, quantity }) => sum + (product ? product.priceCents * quantity : 0),
    0,
  );
  const categories = ["全部", ...new Set(products.map((p) => p.category))];
  const filtered = products.filter(
    (p) =>
      (category === "全部" || p.category === category) &&
      `${p.name} ${p.sku} ${p.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const signIn = signInPath(referral);

  const clearPhoto = () => {
    const pending = imageFlow.current;
    imageFlow.current = null;
    pending?.abort();
    setImageBusy(false);
    if (imagePicker.current) imagePicker.current.value = "";
    restoreImagePickerFocus.current = true;
    setFile(null);
    setCropFocus({ x: 0.5, y: 0.5 });
    setImageResult(null);
    setImageError(null);
  };

  const invalidatePhotoAttempt = () => {
    setImageResult(null);
    // An invalid selection still needs a replacement, not a change to search settings.
    if (file) setImageError(null);
  };

  const findSimilarProducts = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const expectedUserId = identity?.id;
    if (!file || !me || !expectedUserId || busy || imageFlow.current) return;
    const request = new AbortController();
    imageFlow.current = request;
    const { signal } = request;
    setImageBusy(true);
    setImageError(null);
    setImageResult(null);
    try {
      const focus = crop ? cropFocus : null;
      const startedAt = Date.now();
      let photo = readyPhoto.current;
      if (
        !photo ||
        photo.file !== file ||
        photo.focus !== focus ||
        photo.ownerId !== expectedUserId ||
        startedAt < photo.startedAt ||
        startedAt - photo.startedAt >= READY_PHOTO_REUSE_MS
      ) {
        readyPhoto.current = null;
        const upload = focus ? await centerCropImage(file, signal, focus) : file;
        signal.throwIfAborted();
        const id = await (scoped ? scopedUploadCommerceImage : uploadCommerceImage)(upload, {
          expectedUserId,
          signal,
        });
        signal.throwIfAborted();
        photo = { file, focus, ownerId: expectedUserId, startedAt, id };
        readyPhoto.current = photo;
      }
      const result = await commerce.searchImage(photo.id, imageQuery, signal);
      signal.throwIfAborted();
      setImageResult(result);
      // Refresh display data only; server pricing and stock remain authoritative.
      setProducts((current) => {
        const catalog = new Map(current.map((product) => [product.id, product]));
        for (const product of result.products) catalog.set(product.id, product);
        return [...catalog.values()];
      });
    } catch (cause) {
      if (signal.aborted) return;
      if (
        cause instanceof ApiError &&
        (cause.status === 401 || cause.code === "commerce_account_changed")
      ) {
        readyPhoto.current = null;
        onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
      } else if (
        readyPhoto.current &&
        cause instanceof ApiError &&
        cause.status === 404 &&
        cause.code === "file_unavailable"
      ) {
        readyPhoto.current = null;
        setImageError("已上传的图片已过期或暂不可用；请再次点击查找以重新上传，或换一张图片。");
      } else setImageError(commerceErrorMessage(cause));
    } finally {
      if (imageFlow.current === request) {
        imageFlow.current = null;
        setImageBusy(false);
      }
    }
  };
  const closeCart = () => {
    setCartOpen(false);
    setProvinceInvalid(false);
  };

  const showProvinceError = (field: HTMLSelectElement | null) => {
    setProvinceInvalid(true);
    field?.focus();
  };

  const submitOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      busy ||
      orderLocked ||
      attempt.current ||
      orderSending.current ||
      !me ||
      !identity?.emailVerified ||
      !checkoutKey ||
      checkoutMarker.kind !== "empty" ||
      mode !== "test" ||
      checkoutPaused
    )
      return;
    if (!cartLines.length || invalidCart) {
      setError("购物车有商品或库存待核实，请先调整或明确移除不可用商品，不能只提交其中一部分。");
      return;
    }
    if (cartLines.length > MAX_DISTINCT_SKUS) {
      setError("每单最多购买 50 种商品，请先减少商品种类后再结账。");
      return;
    }
    const data = new FormData(event.currentTarget);
    const province = String(data.get("province") ?? "");
    if (!provinces.includes(province)) {
      showProvinceError(
        event.currentTarget.querySelector<HTMLSelectElement>('select[name="province"]'),
      );
      return;
    }
    const address: CommerceAddress = {
      name: String(data.get("name") ?? "").trim(),
      line1: String(data.get("line1") ?? "").trim(),
      city: String(data.get("city") ?? "").trim(),
      province,
      postalCode: String(data.get("postalCode") ?? "")
        .trim()
        .toUpperCase(),
      country: "CA",
    };
    const pending: OrderAttempt = {
      items: cartLines.map(({ id, quantity }) => ({ productId: id, quantity })),
      address,
      key: crypto.randomUUID(),
      ownerId: identity.id,
      unknown: false,
    };
    if (!saveCheckoutAttempt(checkoutKey, pending.key)) {
      setCheckoutMarker(readCheckoutAttempt(checkoutKey));
      setError(checkoutSaveFailed);
      return;
    }
    attempt.current = pending;
    setInPageOrderLocked(true);
    void sendOrder(pending);
  };

  function resolveCheckoutMarker(key: string): boolean {
    const cleared = checkoutKey !== null && clearCheckoutAttempt(checkoutKey, key);
    attempt.current = null;
    setInPageOrderLocked(false);
    if (cleared) {
      setCheckoutMarker({ kind: "empty" });
    } else {
      const current = checkoutKey && readCheckoutAttempt(checkoutKey);
      setCheckoutMarker(current && current.kind === "pending" ? current : { kind: "pending", key });
    }
    return cleared;
  }

  function showCreatedOrder(order: CommerceOrder) {
    ++historyRequests.current.orders;
    setOrders([order]);
    setRecoveredOrder(null);
    setHistory((previous) => ({
      ...previous,
      orders: { read: true, pending: false, failed: false },
    }));
    setOrderPage(0);
    setMoreOrders(false);
    closeCart();
    setView("orders");
  }

  async function sendOrder(pending: OrderAttempt) {
    if (
      busy ||
      orderSending.current ||
      attempt.current !== pending ||
      identity?.id !== pending.ownerId
    )
      return;
    const scope = orderScope.current;
    orderSending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await commerce.createOrder(
        pending.items,
        pending.address,
        pending.key,
        pending.ownerId,
      );
      if (!scope.active || attempt.current !== pending) return;
      const order = response?.order;
      if (!isCheckoutOrder(order)) {
        pending.unknown = true;
        setError(checkoutRecoveryFailed);
        return;
      }
      const cleared = resolveCheckoutMarker(pending.key);
      if (cleared) setCart({});
      showCreatedOrder(order);
      if (!cleared) setError(checkoutRecoveryFailed);
      setMessage(
        order.status !== "awaiting_payment"
          ? "原订单已由服务器核实，请查看当前订单状态；不会自动再次付款或取消。"
          : order.paymentProvider === "stripe_test"
            ? "订单已由服务器创建并预占库存；尚未付款。请在订单中准备 Stripe 测试收银台。"
            : "订单已由服务器创建并预占库存；尚未付款。请在订单中确认测试付款。",
      );
      try {
        await loadHistory("orders", 0, () => scope.active);
      } catch (cause) {
        if (!scope.active) return;
        if (cause instanceof ApiError && cause.status === 401)
          onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
        setError(commerceErrorMessage(cause));
      }
    } catch (cause) {
      if (!scope.active || attempt.current !== pending) return;
      if (cause instanceof ApiError && cause.code === "commerce_account_changed") {
        onRetryIdentity();
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
        return;
      }
      const closed =
        cause instanceof ApiError &&
        cause.status === 409 &&
        cause.code === "checkout_attempt_closed";
      // After an ambiguous result, a later stock/limit rejection cannot rule out a delayed original.
      const firstRejection =
        !pending.unknown &&
        cause instanceof ApiError &&
        ((cause.status === 409 && cause.code === "out_of_stock") ||
          (cause.status === 429 && cause.code === "order_limit") ||
          (cause.status === 400 && cause.code === "bad_request") ||
          (cause.status === 403 && cause.code === "email_verification_required") ||
          (cause.status === 503 && cause.code === "commerce_checkout_paused"));
      if (closed || firstRejection) {
        if (resolveCheckoutMarker(pending.key)) {
          setMessage("订单未创建，可以调整商品或地址后重新提交。");
        } else {
          setError(checkoutRecoveryFailed);
          return;
        }
      } else pending.unknown = true;
      setError(commerceErrorMessage(cause));
    } finally {
      orderSending.current = false;
      if (scope.active) setBusy(false);
    }
  }
  const recoveryKey =
    checkoutMarker.kind === "pending"
      ? checkoutMarker.key
      : attempt.current?.unknown
        ? attempt.current.key
        : null;

  async function recoverOrder() {
    if (!checkoutKey || !identity?.emailVerified || !recoveryKey || busy || orderSending.current)
      return;
    const current = readCheckoutAttempt(checkoutKey);
    if (current.kind === "unavailable") {
      setError(checkoutStorageUnavailable);
      return;
    }
    if (current.kind === "pending" && current.key !== recoveryKey) {
      attempt.current = null;
      setInPageOrderLocked(false);
      setCheckoutMarker(current);
      setError(checkoutRecoveryFailed);
      return;
    }
    const scope = orderScope.current;
    if (!scope.active) return;
    orderSending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await commerce.recoverOrder(identity.id, recoveryKey);
      if (!scope.active) return;
      const order = response?.status === "found" ? response.order : null;
      if (
        !(response?.status === "closed" && Object.keys(response).length === 1) &&
        !isCheckoutOrder(order)
      ) {
        setError(checkoutRecoveryFailed);
        return;
      }
      if (!resolveCheckoutMarker(recoveryKey)) {
        setError(checkoutRecoveryFailed);
        return;
      }
      if (order) {
        // A recovered order may belong to another page. Do not replace the history or its paging.
        setRecoveredOrder(order);
        closeCart();
        setView("orders");
        setMessage(
          "服务器确认原订单已存在，请查看原订单。购物车已保留，没有再次下单、付款或取消。",
        );
      } else {
        setMessage("服务器确认原下单请求已关闭，没有创建订单。购物车已保留，可以重新核对后下单。");
      }
    } catch (cause) {
      if (!scope.active) return;
      if (cause instanceof ApiError && cause.code === "commerce_account_changed") {
        onRetryIdentity();
      } else if (cause instanceof ApiError && cause.status === 401) {
        onSessionEnded("商城登录状态已失效，请重新登录；没有清理本机 AI 数据。");
      } else {
        setError(
          cause instanceof ApiError && cause.code === "checkout_recovery_limit"
            ? commerceErrorMessage(cause)
            : checkoutRecoveryFailed,
        );
      }
    } finally {
      orderSending.current = false;
      if (scope.active) setBusy(false);
    }
  }

  function updateRecoveredOrder(id: string, updated: CommerceOrder | undefined) {
    if (isCheckoutOrder(updated) && updated.id === id) {
      setRecoveredOrder((current) => (current?.id === id ? updated : current));
    }
  }

  const pay = (order: CommerceOrder) =>
    void action(async () => {
      if (scoped && order.paymentProvider !== "simulation") return;
      if (!paymentKeys.current.has(order.id))
        paymentKeys.current.set(order.id, crypto.randomUUID());
      const result = await commerce.testPay(order.id, paymentKeys.current.get(order.id)!);
      updateRecoveredOrder(order.id, result?.order);
      await refreshAccount();
      setMessage("测试付款已确认，不会扣除真实资金。自己的购买不会给自己返佣。");
    });
  const cancel = (order: CommerceOrder) =>
    void action(async () => {
      const key = `cancel-${order.id}`;
      const result = await commerce.cancel(order.id, key);
      updateRecoveredOrder(order.id, result?.order);
      await refreshAccount();
      setMessage("订单已取消，服务器已处理库存释放。");
    });
  const cards = (list: readonly CommerceProduct[]) => (
    <div className={styles.grid}>
      {list.map((product) => (
        <article className={styles.card} key={product.id}>
          {favoriteButton(product.id, product.name, true)}
          <button className={styles.productLink} onClick={() => setSelected(product)}>
            <ProductImage product={product} />
            <div>
              <h3>{product.name}</h3>
              <strong>{cad(product.priceCents)}</strong>
            </div>
          </button>
          <button
            className={styles.addButton}
            disabled={
              !product.stock || busy || orderLocked || (cart[product.id] ?? 0) >= MAX_QUANTITY
            }
            onClick={() => add(product)}
            aria-label={`将${product.name}加入购物车`}
          >
            {product.stock ? "+ 加入购物车" : "暂时缺货"}
          </button>
        </article>
      ))}
    </div>
  );

  const identityStatus =
    identityPending || identityFailed ? (
      <section className={styles.notice} role="status" aria-label="商城账号核实">
        <p>
          {identityPending
            ? "正在核实商城账号，商品可以继续浏览。"
            : identityRateLimited
              ? "请求过于频繁，暂时无法核实商城账号。请稍后重试；不需要退出或重新登录。"
              : "暂时无法核实商城账号，请检查网络后重试。"}
        </p>
        <button className={styles.secondary} disabled={identityPending} onClick={onRetryIdentity}>
          重新核实账号
        </button>
      </section>
    ) : null;

  const recoveryNotice = recoveryKey ? (
    <section className={styles.notice}>
      <p>此标签页还有一笔待核实的下单请求。先核实原请求，避免重复下单。</p>
      <p className={styles.small}>
        未创建订单的原请求会被关闭，以防迟到提交；已存在的订单不会被取消或付款。
      </p>
      {!identity?.emailVerified ? <p>请先验证商城账号邮箱。</p> : null}
      <button
        type="button"
        className={styles.secondary}
        disabled={busy || !identity?.emailVerified}
        onClick={() => void recoverOrder()}
      >
        核实原下单请求
      </button>
    </section>
  ) : null;

  const recoveredOutsidePage = recoveredOrder && !orders.some(({ id }) => id === recoveredOrder.id);
  const pagedOrders = recoveredOutsidePage
    ? [recoveredOrder, ...orders]
    : orders.map((order) => (recoveredOrder?.id === order.id ? recoveredOrder : order));
  const visibleOrders = returnReceipts.size
    ? pagedOrders.map(
        (order): CommerceOrder => ({
          ...order,
          items: order.items.map((item) => {
            const status = returnReceipts.get(returnLineKey(order.id, item.id));
            return status
              ? { ...item, openCase: status === "open", afterSalesStatus: status }
              : item;
          }),
        }),
      )
    : pagedOrders;

  return (
    <div className={styles.shop}>
      <div className={styles.modeBar}>
        {scoped
          ? "本地独立测试商城 · 仅模拟付款和提现，不涉及真实资金"
          : mode === "test" && paymentProvider === "stripe_test"
            ? "Stripe 测试商城 · 仅使用测试卡，绝不输入真实银行卡；提现仍为模拟"
            : mode === "test"
              ? "测试商城 · 订单存储在云端，付款与提现不涉及真实资金"
              : "商城交易未启用 · 不接受真实付款或提现"}
      </div>
      <header className={styles.header}>
        <Link href="/shop" className={styles.brand}>
          DJL <span>商城</span>
        </Link>
        <nav className={styles.desktopNav} aria-label="商城导航">
          {(
            [
              ["home", "商城"],
              ["find", "图片找商品"],
              ["orders", "订单"],
              ["mine", "我的"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className={styles.headerRight}>
          <span>加拿大 · CAD</span>
          <button
            className={styles.iconButton}
            onClick={() => setCartOpen(true)}
            aria-label={`购物车，${cartCount}件商品`}
          >
            <ShoppingCart />
            <b>{cartCount}</b>
          </button>
        </div>
      </header>
      <main className={styles.main}>
        {!cartOpen && !selected ? identityStatus : null}
        {!cartOpen && !selected ? recoveryNotice : null}
        {error && !cartOpen && !selected ? (
          <div className={styles.error} role="alert">
            {error}
            <button onClick={() => setError(null)} aria-label="关闭错误提示">
              <X size={16} />
            </button>
          </div>
        ) : null}
        {message && !cartOpen && !selected ? (
          <p className={styles.notice} role="status">
            {message}
          </p>
        ) : null}
        {!selected && view !== "favorites" ? favoriteProblem : null}
        {pendingReturn && !returnItem ? (
          <div className={styles.notice}>
            <p role="status">{pendingReturnMessage}</p>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => setReturnItem(pendingReturn.target)}
            >
              继续核实售后申请
            </button>
          </div>
        ) : null}
        {referral && me && !me.referrerId && !me.firstPaidAt && view !== "mine" ? (
          <p className={styles.notice}>
            你通过推荐链接进入商城。请在首单成功付款前核对介绍人；不会自动绑定。
            <button className={styles.secondary} onClick={() => setView("mine")}>
              核对推荐人
            </button>
          </p>
        ) : null}
        {view === "home" ? (
          <>
            <label className={styles.search}>
              <Search size={20} />
              <input
                ref={(input) => {
                  if (input && focusTextSearch.current) {
                    focusTextSearch.current = false;
                    input.focus();
                  }
                }}
                aria-label="搜索商品"
                placeholder="搜索你想买的商品"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className={styles.iconButton}
                onClick={() => setView("find")}
                aria-label="上传图片找商品"
              >
                <Camera />
              </button>
            </label>
            <section className={styles.hero}>
              <div>
                <p className={styles.eyebrow}>DJL SHOP</p>
                <h1>
                  看到喜欢的，
                  <br />
                  不知道叫什么？
                </h1>
                <p>上传照片或截图，发现商城里的相似商品。</p>
                <button className={styles.primary} onClick={() => setView("find")}>
                  <Camera size={19} />
                  上传图片找商品
                </button>
              </div>
              <div className={styles.heroArt}>
                {products[0] ? (
                  <ProductImage product={products[0]} />
                ) : (
                  <ShoppingBag strokeWidth={1} />
                )}
              </div>
            </section>
            <p className={styles.trust}>
              <Truck size={17} />
              加拿大境内发货 · 平台统一售后
            </p>
            <div className={styles.categories} aria-label="商品分类">
              {categories.map((name) => (
                <button
                  key={name}
                  aria-pressed={category === name}
                  className={category === name ? styles.activeCategory : ""}
                  onClick={() => setCategory(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className={styles.sectionHead}>
              <h2>精选商品</h2>
              <span>
                {loading
                  ? "正在加载"
                  : catalogFailed
                    ? "服务暂不可用"
                    : `${filtered.length} 件商品`}
              </span>
            </div>
            {loading ? (
              <p role="status">正在加载商品…</p>
            ) : catalogFailed ? (
              <div className={styles.empty}>
                <ShoppingBag />
                <h3>商城服务暂时不可用</h3>
                <p>暂时无法确认商品和库存，并不代表商城没有商品。</p>
                <button className={styles.primary} disabled={busy} onClick={retryCatalog}>
                  重新连接商城
                </button>
              </div>
            ) : filtered.length ? (
              cards(filtered)
            ) : (
              <div className={styles.empty}>
                <ShoppingBag />
                <h3>暂无符合条件的商品</h3>
                <p>只展示已审核的真实商品；可以换个关键词或稍后再来。</p>
              </div>
            )}
            <div className={styles.inviteStrip}>
              <span>好东西，和朋友一起分享</span>
              <button onClick={() => setView("mine")}>邀请好友赚佣金 →</button>
            </div>
          </>
        ) : null}

        {view === "find" ? (
          <>
            <div className={styles.sectionHead}>
              <h1>图片找商品</h1>
              <span className={styles.matchCaveat}>相似推荐，不保证同款</span>
            </div>
            <p className={styles.muted}>
              图片仅上传到商城的私有存储用于找货，不会添加到 AI 聊天；费用由平台承担，不扣 AI
              积分或推荐收益。
            </p>
            {!me && !identityRateLimited && !identityPending ? (
              <p className={styles.notice}>
                <Link href={signIn}>登录后上传图片</Link>
              </p>
            ) : null}
            <div className={styles.findLayout}>
              <form className={styles.panel} onSubmit={(event) => void findSimilarProducts(event)}>
                <div className={styles.upload}>
                  <Camera aria-hidden="true" />
                  <button
                    ref={imagePickerButton}
                    type="button"
                    className={styles.secondary}
                    aria-describedby={imageSelectionId}
                    disabled={!me || busy}
                    onClick={() => {
                      const picker = imagePicker.current;
                      if (!picker) return;
                      picker.value = "";
                      picker.click();
                    }}
                  >
                    {file ? "更换图片" : "选择照片或截图"}
                  </button>
                  <div id={imageSelectionId} className={styles.uploadDetails}>
                    <span>JPEG、PNG、WebP，最大 10 MB</span>
                    <span role="status">{file ? "已选择：" + file.name : "尚未选择图片"}</span>
                  </div>
                  <input
                    ref={imagePicker}
                    aria-label="上传找货图片"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={!me || busy}
                    hidden
                    onChange={(e) => {
                      const next = e.target.files?.[0];
                      if (!next) return;
                      setImageResult(null);
                      setCropFocus({ x: 0.5, y: 0.5 });
                      if (
                        !["image/jpeg", "image/png", "image/webp"].includes(next.type) ||
                        !next.size ||
                        next.size > 10 * 1024 * 1024
                      ) {
                        e.currentTarget.value = "";
                        setFile(null);
                        setImageError("请选择大于 0 且不超过 10 MB 的 JPEG、PNG 或 WebP 图片。");
                      } else {
                        setFile(next);
                        setImageError(null);
                      }
                    }}
                  />
                </div>
                {preview ? (
                  <img
                    className={`${styles.preview} ${crop ? styles.cropPreview : ""}`}
                    src={preview}
                    alt={crop ? "将上传预览中的方形区域" : "你选择的找货图片"}
                    style={
                      crop
                        ? { objectPosition: `${cropFocus.x * 100}% ${cropFocus.y * 100}%` }
                        : undefined
                    }
                  />
                ) : null}
                {file ? (
                  <button type="button" className={styles.secondary} onClick={clearPhoto}>
                    清除图片
                  </button>
                ) : null}
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={crop}
                    disabled={busy}
                    onChange={(e) => {
                      setCrop(e.target.checked);
                      invalidatePhotoAttempt();
                    }}
                  />
                  只上传预览中的方形区域；取消则上传原图。
                </label>
                {crop && preview ? (
                  <fieldset className={styles.cropControls} disabled={busy}>
                    <legend>移动裁剪位置，让想找的物品留在预览中</legend>
                    <label className={styles.field}>
                      左右位置
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={cropFocus.x * 100}
                        aria-label="裁剪水平位置"
                        onChange={(e) => {
                          setCropFocus((current) => ({
                            ...current,
                            x: Number(e.target.value) / 100,
                          }));
                          invalidatePhotoAttempt();
                        }}
                      />
                    </label>
                    <label className={styles.field}>
                      上下位置
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={cropFocus.y * 100}
                        aria-label="裁剪垂直位置"
                        onChange={(e) => {
                          setCropFocus((current) => ({
                            ...current,
                            y: Number(e.target.value) / 100,
                          }));
                          invalidatePhotoAttempt();
                        }}
                      />
                    </label>
                  </fieldset>
                ) : null}
                <label className={styles.field}>
                  补充描述（可选）
                  <input
                    value={imageQuery}
                    maxLength={300}
                    disabled={busy}
                    onChange={(e) => {
                      setImageQuery(e.target.value);
                      invalidatePhotoAttempt();
                    }}
                    placeholder="例如：米白色帆布包"
                  />
                </label>
                {imageError ? (
                  <p className={styles.error} role="alert">
                    {imageError}
                  </p>
                ) : null}
                <button className={styles.primary} disabled={!me || !file || busy}>
                  {imageBusy ? "正在查找…" : "查找相似商品"}
                </button>
              </form>
              <section>
                <h2>查找结果</h2>
                {imageResult?.message ? (
                  <p className={styles.notice} role="status">
                    {imageResult.message}
                  </p>
                ) : null}
                {imageResult === null ? (
                  <p className={styles.muted}>
                    还没有搜索结果。模型未配置或预算用尽时会明确提示，不展示虚构匹配。
                  </p>
                ) : imageResult.products.length ? (
                  cards(imageResult.products)
                ) : (
                  <div className={styles.empty}>
                    <Search />
                    <h3>暂时没有合适商品</h3>
                    <p>试试更清晰的照片或补充描述，也可以改用文字搜索。</p>
                  </div>
                )}
                {imageError || (imageResult && !imageResult.products.length) ? (
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => {
                      focusTextSearch.current = true;
                      setQuery(imageQuery.trim());
                      setCategory("全部");
                      setView("home");
                    }}
                  >
                    改用文字搜索
                  </button>
                ) : null}
              </section>
            </div>
          </>
        ) : null}

        {view === "orders" ? (
          <>
            <div className={styles.sectionHead}>
              <h1>我的订单</h1>
              {me ? (
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void action(refreshAccount)}
                >
                  刷新订单
                </button>
              ) : null}
            </div>
            {me && visibleOrders.some((order) => order.status !== "awaiting_payment") ? (
              <p className={styles.small}>
                再次购买只按当前价格和库存加到购物车，不自动下单或付款；下单时仍由服务器重新核价。
              </p>
            ) : null}
            {me ? historyNotice("orders", "订单历史") : null}
            {!me ? (
              <div className={styles.empty}>
                <Package />
                <h3>
                  {accountLoading
                    ? "正在读取账号…"
                    : identityRateLimited
                      ? "稍后重新核实账号即可查看订单"
                      : "登录后查看订单"}
                </h3>
                {!identityRateLimited && !identityPending ? (
                  <Link href={signIn} className={styles.primary}>
                    登录 DJL 账号
                  </Link>
                ) : null}
              </div>
            ) : visibleOrders.length ? (
              <div className={styles.orderList}>
                {visibleOrders.map((order) => (
                  <article className={styles.orderCard} key={order.id}>
                    {recoveredOutsidePage && order.id === recoveredOrder.id ? (
                      <p className={styles.small}>刚核实的原订单（不计入当前分页）</p>
                    ) : null}
                    <div className={styles.orderHead}>
                      <div>
                        <strong>订单 {order.id.slice(0, 8)}</strong>
                        <small>{new Date(order.createdAt).toLocaleString()}</small>
                        <CopyReference label="完整订单号" value={order.id} />
                      </div>
                      <span>{statuses[order.status] ?? order.status} · 测试订单</span>
                    </div>
                    <section className={styles.small} aria-label="下单收货地址">
                      <strong>收货地址（下单快照）</strong>
                      <p>
                        {order.address.name} · {order.address.line1}
                      </p>
                      <p>
                        {order.address.city}, {order.address.province} {order.address.postalCode},{" "}
                        {order.address.country}
                      </p>
                    </section>
                    {order.items.map((item) => (
                      <div key={item.id} className={styles.orderLine}>
                        <div>
                          <h3>{item.name}</h3>
                          <p className={styles.small}>
                            {item.sku ? `SKU：${item.sku}` : "历史订单未记录 SKU"}
                          </p>
                          <p className={styles.muted}>
                            数量 {item.quantity} · {statuses[item.status] ?? item.status}
                            {item.carrier ? ` · 物流公司 ${item.carrier}` : ""}
                            {item.trackingNumber ? ` · 运单 ${item.trackingNumber}` : ""}
                            {item.openCase ? " · 售后处理中" : ""}
                          </p>
                          {item.trackingNumber ? (
                            <CopyReference label="运单号" value={item.trackingNumber} />
                          ) : null}
                          {!item.openCase && item.afterSalesStatus === "closed" ? (
                            <p className={styles.small}>平台已结束本次售后，不代表退款或到账。</p>
                          ) : !item.openCase && item.afterSalesStatus === "unconfirmed" ? (
                            <p className={styles.small}>已有售后记录，处理结果待平台核实。</p>
                          ) : null}
                          {(order.status === "paid" && item.refundedCents < item.lineCents) ||
                          (["paid", "refunded"].includes(order.status) &&
                            ["shipped", "delivered"].includes(item.status)) ? (
                            <button
                              className={styles.secondary}
                              disabled={
                                busy ||
                                item.openCase ||
                                mode !== "test" ||
                                !identity ||
                                Boolean(pendingReturn) ||
                                returnReceipts.has(returnLineKey(order.id, item.id))
                              }
                              onClick={() => {
                                setReturnError(null);
                                setReturnReason("");
                                setReturnItem({
                                  orderId: order.id,
                                  itemId: item.id,
                                  name: item.name,
                                });
                              }}
                            >
                              {item.openCase ? "等待平台处理售后" : "申请售后"}
                            </button>
                          ) : null}
                        </div>
                        <div>
                          <strong>{cad(item.lineCents)}</strong>
                          {item.refundedCents > 0 ? (
                            <p className={styles.small}>明细已退款 {cad(item.refundedCents)}</p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    <div className={styles.orderFooter}>
                      <span>
                        合计 {cad(order.totalCents)}
                        {order.refundedCents ? ` · 已退款 ${cad(order.refundedCents)}` : ""}
                      </span>
                      {order.status === "awaiting_payment" &&
                      (scoped
                        ? order.paymentProvider === "simulation"
                        : order.paymentProvider !== "stripe_test") ? (
                        <div className={styles.actions}>
                          <button
                            className={styles.secondary}
                            disabled={busy}
                            onClick={() => cancel(order)}
                          >
                            取消订单
                          </button>
                          <button
                            className={styles.primary}
                            disabled={busy || mode !== "test"}
                            onClick={() => pay(order)}
                          >
                            确认测试付款
                          </button>
                        </div>
                      ) : null}
                      {order.status !== "awaiting_payment" ? (
                        <button
                          className={styles.secondary}
                          disabled={busy || orderLocked || loading}
                          onClick={() => reorder(order)}
                        >
                          再次购买
                        </button>
                      ) : null}
                    </div>
                    <p className={styles.small}>
                      没有真实扣款；发货及售后状态由服务器维护，购买不会给自己返佣。退款成功不等于退货或售后结案，需由平台另行核实关闭。
                    </p>
                    {!scoped && order.paymentProvider === "stripe_test" ? (
                      <HostedPayment
                        order={order}
                        disabled={busy}
                        enabled={mode === "test"}
                        onOrderChanged={refreshAccount}
                      />
                    ) : null}
                  </article>
                ))}
              </div>
            ) : history.orders.read && !history.orders.pending && !history.orders.failed ? (
              <div className={styles.empty}>
                <Package />
                <h3>还没有订单</h3>
                <button className={styles.primary} onClick={() => setView("home")}>
                  去看看商品
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {view === "orders" && me ? (
          <div className={styles.actions}>
            <button
              className={styles.secondary}
              disabled={busy || orderPage === 0}
              onClick={() => void action(() => refreshAccount({ orders: orderPage - 1 }))}
            >
              上一页订单
            </button>
            <span>第 {orderPage + 1} 页</span>
            <button
              className={styles.secondary}
              disabled={busy || !moreOrders}
              onClick={() => void action(() => refreshAccount({ orders: orderPage + 1 }))}
            >
              下一页订单
            </button>
          </div>
        ) : null}
        {view === "favorites" ? (
          <>
            <div className={styles.sectionHead}>
              <h1>我的收藏</h1>
              <button
                className={styles.secondary}
                disabled={!authenticated || favoritesPending}
                onClick={() => void loadFavorites(true)}
              >
                刷新收藏
              </button>
            </div>
            <p className={styles.muted}>
              收藏只保存商品编号到当前账号，不上传找货照片或最近浏览记录。
            </p>
            {!authenticated && !identityRateLimited && !identityPending ? (
              <Link href={signIn} className={styles.primary}>
                登录后查看收藏
              </Link>
            ) : null}
            {favoritesPending ? <p role="status">正在同步收藏…</p> : null}
            {favoriteError ? (
              <p role="alert" className={styles.error}>
                收藏尚未读取成功或保存结果待核实，请刷新收藏后再操作。{favoriteError}
              </p>
            ) : null}
            {identity && !identity.emailVerified ? (
              <p>验证邮箱后可以修改收藏，已有收藏仍可查看。</p>
            ) : null}
            {authenticated && favoritesLoaded && !loading && !catalogFailed ? (
              <>
                {favoriteIds.length === 0 ? <p>还没有收藏商品，点商品上的爱心即可保存。</p> : null}
                {cards(products.filter((p) => favoriteIds.includes(p.id)))}
                {favoriteIds
                  .filter((id) => !products.some((p) => p.id === id))
                  .map((id) => (
                    <section className={styles.panel} key={id}>
                      <h2>商品暂不可售</h2>
                      <p>保留收藏，重新上架后可查看；也可以取消收藏。</p>
                      {favoriteButton(id, "暂不可售商品")}
                    </section>
                  ))}
              </>
            ) : null}
          </>
        ) : null}
        {view === "mine" ? (
          <>
            <div className={styles.sectionHead}>
              <h1>我的推荐与收益</h1>
              {me ? (
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void action(refreshAccount)}
                >
                  刷新
                </button>
              ) : null}
            </div>
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={() => setView("favorites")}>
                我的收藏{favoritesLoaded ? ` · ${favoriteIds.length}` : ""}
              </button>
              <p className={styles.small}>登录后收藏保存到账号；未确认读取成功时不显示为零条。</p>
            </div>
            <section className={styles.panel} aria-label="商城账号身份">
              <h2>当前商城账号</h2>
              {identityPending ? (
                <p>正在核实登录身份，暂不读取订单或收益。</p>
              ) : identity ? (
                <>
                  <p>
                    {identity.name || "DJL 用户"} · {identity.email}
                  </p>
                  <p className={styles.small}>
                    账号 ID：{identity.id} ·{" "}
                    {identity.emailVerified ? "邮箱已验证" : "邮箱尚未验证"}
                  </p>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      disabled={busy || accountLoading}
                      onClick={() => void signOut(false)}
                    >
                      退出商城账号
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={busy || accountLoading}
                      onClick={() => void signOut(true)}
                    >
                      切换账号
                    </button>
                  </div>
                </>
              ) : (
                <p>
                  {identityFailed
                    ? identityRateLimited
                      ? "暂时无法核实账号，不代表已经退出登录。"
                      : "暂时无法核实账号身份，请重新登录。"
                    : "尚未登录商城账号。"}
                </p>
              )}
              <p className={styles.small}>
                {scoped || embedded
                  ? "这是独立商城登录会话，退出只影响此商城窗口的账号，不清理原 AI 的聊天、草稿、模型凭据或本机数据。"
                  : "手机网页与 DJL 云端站点可能共用登录 Cookie，退出会同时结束该共享云端登录；不会清理本机 AI 聊天、草稿或模型凭据。"}
              </p>
            </section>
            {!me ? (
              <div className={styles.empty}>
                <UserRound />
                <h3>
                  {accountLoading
                    ? "正在读取账号…"
                    : identityRateLimited
                      ? "稍后重新核实账号即可查看收益"
                      : "登录后查看你的收益"}
                </h3>
                <p>账号与 DJL 共用，推荐关系和收益保存在云端。</p>
                {!identityRateLimited && !identityPending ? (
                  <Link href={signIn} className={styles.primary}>
                    登录 DJL 账号
                  </Link>
                ) : null}
              </div>
            ) : (
              <>
                <div className={styles.accountGrid}>
                  <section className={styles.wallet}>
                    <p>可提现 · 测试账本</p>
                    <strong className={styles.balance}>{cad(me.wallet.availableCents)}</strong>
                    <button
                      className={styles.primary}
                      disabled={
                        busy ||
                        mode !== "test" ||
                        me.withdrawalsPaused ||
                        me.wallet.availableCents < 2000 ||
                        me.wallet.frozenCents > 0 ||
                        me.wallet.recoveryCents > 0 ||
                        withdrawals.some((withdrawal) =>
                          ["requested", "approved", "payment_pending", "payment_unknown"].includes(
                            withdrawal.status,
                          ),
                        )
                      }
                      onClick={() =>
                        void action(async () => {
                          withdrawalKey.current ??= crypto.randomUUID();
                          const result = await commerce.withdraw(withdrawalKey.current);
                          setMe({ ...me, wallet: result.wallet });
                          withdrawalKey.current = null;
                          await Promise.all([
                            loadHistory("withdrawals", 0),
                            loadHistory("ledger", 0),
                          ]);
                          setMessage("测试提现申请已提交，对应金额已冻结；没有真实打款。");
                        })
                      }
                    >
                      申请测试提现
                    </button>
                    {me.withdrawalsPaused ? (
                      <p className={styles.notice}>提现申请暂时暂停，历史记录与售后仍可查看。</p>
                    ) : null}
                    <div className={styles.walletStats}>
                      <div>
                        待结算<strong>{cad(me.wallet.pendingCents)}</strong>
                      </div>
                      <div>
                        处理中<strong>{cad(me.wallet.frozenCents)}</strong>
                      </div>
                      <div>
                        已付测试款<strong>{cad(me.wallet.paidCents)}</strong>
                      </div>
                    </div>
                    {me.wallet.recoveryCents > 0 ? (
                      <p className={styles.error}>
                        退款待追回 {cad(me.wallet.recoveryCents)}，处理完成前不可提现。
                      </p>
                    ) : null}
                    <p className={styles.small}>
                      满 CAD 20 可申请 · 每周人工处理。佣金需签收后至少观察 30
                      天、售后窗口结束且无未结售后才能提现。与 AI 积分分开。
                    </p>
                  </section>
                  <section className={styles.panel}>
                    <h2>好友购买，你得佣金</h2>
                    <p>好友绑定后，后续有效购买持续计佣。只奖励直接推荐人，无需开店或进货。</p>
                    <input
                      ref={inviteInput}
                      className={styles.inviteInput}
                      aria-label="我的邀请链接"
                      readOnly
                      value={
                        typeof window === "undefined"
                          ? ""
                          : `${window.location.origin}/shop?ref=${encodeURIComponent(me.referralCode)}`
                      }
                    />
                    <button
                      className={styles.primary}
                      onClick={() =>
                        void action(async () => {
                          const input = inviteInput.current;
                          if (!input) return;
                          try {
                            await navigator.clipboard.writeText(input.value);
                            setMessage("邀请链接已复制。");
                          } catch {
                            input.select();
                            setMessage("请复制已选中的邀请链接。");
                          }
                        })
                      }
                    >
                      <Copy size={17} />
                      分享邀请链接
                    </button>
                    <p className={styles.small}>推广时请清楚说明：好友购买后，你可能获得佣金。</p>
                  </section>
                </div>
                {identity?.emailVerified ? (
                  <ReferralSummaryPanel
                    expectedUserId={identity.id}
                    load={commerce.referralSummary}
                    onSessionEnded={onSessionEnded}
                  />
                ) : null}
                <section className={styles.panel}>
                  <h2>提现记录</h2>
                  {historyNotice("withdrawals", "提现历史")}
                  {withdrawals.length ? (
                    <div className={styles.orderList}>
                      {withdrawals.map((withdrawal) => (
                        <div key={withdrawal.id} className={styles.orderLine}>
                          <div>
                            <strong>{cad(withdrawal.amountCents)}</strong>
                            <p className={styles.small}>
                              {new Date(withdrawal.createdAt).toLocaleString()}
                              {withdrawal.reference ? ` · 测试凭证 ${withdrawal.reference}` : ""}
                            </p>
                          </div>
                          <span>
                            {
                              {
                                requested: "等待人工审核",
                                approved: "已审核，待核实测试打款",
                                payment_pending:
                                  "结果未确认，需人工核实；金额仍冻结。未确认真实到账。",
                                payment_unknown:
                                  "结果未确认，需人工核实；金额仍冻结。未确认真实到账。",
                                paid_test: "已记录测试付款，非真实到账",
                                rejected: "已驳回并解冻",
                              }[withdrawal.status]
                            }
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : history.withdrawals.read &&
                    !history.withdrawals.pending &&
                    !history.withdrawals.failed ? (
                    <p className={styles.muted}>暂无提现申请。所有记录以服务器为准。</p>
                  ) : null}
                </section>
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    disabled={busy || withdrawalPage === 0}
                    onClick={() =>
                      void action(() => refreshAccount({ withdrawals: withdrawalPage - 1 }))
                    }
                  >
                    上一页提现
                  </button>
                  <span>第 {withdrawalPage + 1} 页</span>
                  <button
                    className={styles.secondary}
                    disabled={busy || !moreWithdrawals}
                    onClick={() =>
                      void action(() => refreshAccount({ withdrawals: withdrawalPage + 1 }))
                    }
                  >
                    下一页提现
                  </button>
                </div>
                <section className={styles.panel}>
                  <h2>收益流水</h2>
                  <p className={styles.small}>
                    按页展示服务器测试账本记录，退款冲回与待追回也会保留，不代表真实到账。
                  </p>
                  {historyNotice("ledger", "收益流水")}
                  {ledger.length ? (
                    <div className={styles.orderList}>
                      {ledger.map((entry) => (
                        <div key={entry.id} className={styles.orderLine}>
                          <div>
                            <strong>{walletAccounts[entry.account] ?? entry.account}</strong>
                            <p className={styles.small}>
                              {new Date(entry.createdAt).toLocaleString()} · {entry.eventKey}
                            </p>
                          </div>
                          <span>
                            {entry.amountCents < 0 ? "−" : "+"}
                            {cad(Math.abs(entry.amountCents))}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : history.ledger.read && !history.ledger.pending && !history.ledger.failed ? (
                    <p className={styles.muted}>暂无收益流水。</p>
                  ) : null}
                </section>
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    disabled={busy || ledgerPage === 0}
                    onClick={() => void action(() => refreshAccount({ ledger: ledgerPage - 1 }))}
                  >
                    上一页流水
                  </button>
                  <span>第 {ledgerPage + 1} 页</span>
                  <button
                    className={styles.secondary}
                    disabled={busy || !moreLedger}
                    onClick={() => void action(() => refreshAccount({ ledger: ledgerPage + 1 }))}
                  >
                    下一页流水
                  </button>
                </div>
                <section className={styles.panel}>
                  <h2>我的推荐人</h2>
                  {me.referrerId ? (
                    <p>已绑定推荐人，长期生效，不能自行更换。其他邀请链接不会覆盖这份关系。</p>
                  ) : me.firstPaidAt ? (
                    <p>你已完成过首笔成功付款，不能再补绑推荐人；退款不会恢复资格。</p>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(async () => {
                          try {
                            setMe(await commerce.bind(referral.trim()));
                          } catch (cause) {
                            if (
                              cause instanceof ApiError &&
                              cause.code === "commerce_payment_unresolved"
                            )
                              throw new Error(
                                "先到订单页查询并确认取消尚未付款的收银台，再回来确认推荐人；不要先付款，首单付款后不能补绑。若付款结果未知或已成功，请联系平台核实，不能付款后补绑。",
                                { cause },
                              );
                            throw cause;
                          }
                          setMessage("推荐人已绑定，后续有效购买会给直接推荐人计佣。");
                        });
                      }}
                    >
                      <p>新老账号均可在首单成功付款前绑定一位推荐人。请核对后再确认。</p>
                      <label className={styles.field}>
                        推荐码
                        <input
                          value={referral}
                          maxLength={100}
                          required
                          onChange={(e) => setReferral(e.target.value)}
                        />
                      </label>
                      <label className={styles.check}>
                        <input type="checkbox" required />
                        我确认这是我的介绍人，理解绑定后不能自行更换。
                      </label>
                      <button className={styles.primary} disabled={busy || !referral.trim()}>
                        确认长期绑定
                      </button>
                    </form>
                  )}
                </section>
                {!scoped && me.suppliers.length ? (
                  <p className={styles.notice}>
                    你拥有供应商授权：<Link href="/shop/supplier">进入供应商履约后台 →</Link>
                  </p>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </main>
      <footer className={styles.footer}>
        独立商城 · 本机 AI 数据独立保留 · 商品、订单和收益以云端记录为准
      </footer>
      <nav className={styles.mobileNav} aria-label="手机商城导航">
        {(
          [
            ["home", "商城", ShoppingBag],
            ["find", "找商品", Camera],
            ["orders", "订单", Package],
            ["mine", "我的", UserRound],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            aria-label={label}
            aria-current={view === id ? "page" : undefined}
            onClick={() => setView(id)}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>
      {returnItem ? (
        <Modal title="申请售后" close={() => setReturnItem(null)}>
          <form className={styles.cartBody} onSubmit={(event) => void submitReturn(event)}>
            <h3>{returnItem.name}</h3>
            <p className={styles.small}>
              请描述商品问题或退货原因，不要填写银行卡资料。此操作提交申请，不代表退款已完成。
            </p>
            <label className={styles.field}>
              售后原因
              <textarea
                name="reason"
                required
                minLength={1}
                maxLength={500}
                rows={4}
                value={pendingReturn?.input.request.reason ?? returnReason}
                readOnly={Boolean(pendingReturn)}
                onChange={(event) => {
                  if (!pendingReturn) setReturnReason(event.target.value);
                }}
              />
            </label>
            {pendingReturn ? <p className={styles.small}>{pendingReturnMessage}</p> : null}
            {returnError ? (
              <p role="alert" className={styles.error}>
                {returnError}
              </p>
            ) : null}
            <button className={styles.primary} disabled={busy}>
              {pendingReturn ? "重试原售后申请" : "提交售后申请"}
            </button>
          </form>
        </Modal>
      ) : null}
      {selected ? (
        <Modal title="商品详情" close={() => setSelected(null)}>
          {identityStatus}
          <div className={styles.detail}>
            <ProductImage product={selected} />
            <div>
              <h2>{selected.name}</h2>
              <strong className={styles.price}>{cad(selected.priceCents)}</strong>
              <p>{selected.description}</p>
              <p className={styles.muted}>
                加拿大境内发货 · 平台统一售后
                <br />
                SKU：{selected.sku}
                <br />
                剩余库存 {selected.stock} 件 · 售后窗口 {selected.returnDays} 天
              </p>
              <p className={styles.small}>购买前请核对规格与售后政策；图片相似不等于已确认同款。</p>
              {favoriteButton(selected.id, selected.name)}
              {favoriteProblem}
              <button
                className={styles.primary}
                disabled={
                  !selected.stock || busy || orderLocked || (cart[selected.id] ?? 0) >= MAX_QUANTITY
                }
                onClick={() => add(selected)}
              >
                加入购物车
              </button>
              <button
                className={styles.secondary}
                onClick={() => {
                  setSelected(null);
                  setCartOpen(true);
                }}
              >
                查看购物车
              </button>
              {message ? <p role="status">{message}</p> : null}
              {error ? <p role="alert">{error}</p> : null}
            </div>
          </div>
        </Modal>
      ) : null}
      {cartOpen ? (
        <Modal title={mode === "test" ? "购物车与测试结账" : "购物车"} close={closeCart}>
          {mode === "test" ? identityStatus : null}
          <div className={styles.cartBody}>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            {mode !== "test" ? (
              <p className={styles.notice}>商城暂未开放结账，仍可查看和整理购物车。</p>
            ) : null}
            {!scoped &&
            mode === "disabled" &&
            !loading &&
            !catalogFailed &&
            !identityPending &&
            identity?.emailVerified ? (
              <CanadianAddressLookup key={identity.id} />
            ) : null}
            {mode === "test" ? recoveryNotice : null}
            {mode === "test" && inPageOrderLocked ? (
              <section className={styles.notice}>
                <p>
                  订单创建结果尚未确认，选品、地址和请求标识已锁定；请重试原订单请求或先核实，不要另建订单。
                </p>
                <p className={styles.small}>
                  刷新后不会保留收货地址；在同一标签页仍可核实原下单请求，不要直接重复下单。
                </p>
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => {
                    if (attempt.current) void sendOrder(attempt.current);
                  }}
                >
                  重试原订单请求
                </button>
              </section>
            ) : null}
            {message ? (
              <p className={styles.notice} role="status">
                {message}
              </p>
            ) : null}
            {!cartLines.length ? (
              <p>
                购物车还是空的。
                <button
                  className={styles.secondary}
                  onClick={() => {
                    closeCart();
                    setView("home");
                  }}
                >
                  去选商品
                </button>
              </p>
            ) : (
              <>
                {cartLines.map(({ id, product, quantity }) => (
                  <div className={styles.cartLine} key={id}>
                    <div>
                      <h3>{product?.name ?? "商品信息待核实"}</h3>
                      {product ? (
                        <span>{cad(product.priceCents)}</span>
                      ) : (
                        <>
                          <p className={styles.small} style={{ overflowWrap: "anywhere" }}>
                            ID：{id}
                          </p>
                          <span>价格待核实</span>
                        </>
                      )}
                      {product && quantity > product.stock ? (
                        <p className={styles.small}>
                          所选 {quantity} 件，当前可售 {product.stock} 件；请减少数量或移除
                          {mode === "test" ? "后再结账" : ""}。
                        </p>
                      ) : null}
                    </div>
                    <div className={styles.quantity}>
                      <button
                        aria-label={`减少${product?.name ?? `不可用商品 ${id}`}`}
                        onClick={() => changeQuantity(id, quantity - 1)}
                        disabled={busy || orderLocked}
                      >
                        −
                      </button>
                      <span>{quantity}</span>
                      <button
                        aria-label={`增加${product?.name ?? `不可用商品 ${id}`}`}
                        onClick={() => changeQuantity(id, quantity + 1)}
                        disabled={
                          busy ||
                          orderLocked ||
                          !product ||
                          quantity >= Math.min(product.stock, MAX_QUANTITY)
                        }
                      >
                        +
                      </button>
                      <button
                        aria-label={`移除${product?.name ?? `不可用商品 ${id}`}`}
                        onClick={() => changeQuantity(id, 0)}
                        disabled={busy || orderLocked}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ))}
                <p className={styles.cartTotal}>
                  {invalidCart ? "可核价商品小计（整单待核实）" : "商品小计"} {cad(subtotal)}
                </p>
                {invalidCart ? (
                  <p className={styles.notice}>
                    {mode === "test"
                      ? "商品信息或库存尚未确认，请调整或明确移除不可用商品后再结账；不会静默只购买其余商品。"
                      : "商品信息或库存尚未确认，请调整或移除不可用商品。"}
                  </p>
                ) : null}
                {mode === "test" && cartLines.length > MAX_DISTINCT_SKUS ? (
                  <p className={styles.notice}>
                    购物车现有 {cartLines.length} 种商品，每单最多 50
                    种。全部选品已保留，请先移除部分商品再结账。
                  </p>
                ) : null}
                {mode === "test" ? (
                  <p className={styles.small}>
                    最终金额、库存与配送范围由服务器核验。当前仅测试订单，不收银行卡或真实款项。
                  </p>
                ) : null}
                {mode !== "test" ? null : !me ? (
                  identityRateLimited || identityPending ? (
                    <p>账号核实后即可继续结账，购物车商品已保留。</p>
                  ) : (
                    <Link className={styles.primary} href={signIn}>
                      登录后结账
                    </Link>
                  )
                ) : (
                  <form className={styles.addressForm} onSubmit={submitOrder}>
                    <h3>加拿大收货地址</h3>
                    <p className={styles.small}>
                      当前是测试订单，请使用测试信息，不要输入真实个人资料。
                    </p>
                    {checkoutMarker.kind === "unavailable" ? (
                      <p className={styles.notice}>{checkoutStorageUnavailable}</p>
                    ) : null}
                    {!identity?.emailVerified ? (
                      <p className={styles.notice}>请先验证商城账号邮箱，再提交测试订单。</p>
                    ) : null}
                    <label className={styles.field}>
                      收件人
                      <input
                        name="name"
                        required
                        maxLength={100}
                        autoComplete="off"
                        disabled={busy || orderLocked}
                      />
                    </label>
                    <label className={styles.field}>
                      地址
                      <input
                        name="line1"
                        required
                        maxLength={200}
                        autoComplete="off"
                        disabled={busy || orderLocked}
                      />
                    </label>
                    <div className={styles.twoColumns}>
                      <label className={styles.field}>
                        城市
                        <input
                          name="city"
                          required
                          maxLength={100}
                          autoComplete="off"
                          disabled={busy || orderLocked}
                        />
                      </label>
                      <label className={styles.field}>
                        <span id={provinceLabelId}>省／地区</span>
                        <select
                          name="province"
                          required
                          defaultValue=""
                          disabled={busy || orderLocked}
                          aria-labelledby={provinceLabelId}
                          aria-invalid={provinceInvalid || undefined}
                          aria-describedby={provinceInvalid ? provinceErrorId : undefined}
                          onInvalid={(event) => {
                            event.preventDefault();
                            showProvinceError(event.currentTarget);
                          }}
                          onChange={() => setProvinceInvalid(false)}
                        >
                          <option value="" disabled>
                            请选择省／地区
                          </option>
                          {provinces.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                        {provinceInvalid ? (
                          <span id={provinceErrorId} className={styles.error} role="alert">
                            {provinceRequiredMessage}
                          </span>
                        ) : null}
                      </label>
                    </div>
                    <label className={styles.field}>
                      邮编
                      <input
                        name="postalCode"
                        required
                        maxLength={7}
                        pattern="[A-Za-z][0-9][A-Za-z] ?[0-9][A-Za-z][0-9]"
                        placeholder="A1A 1A1"
                        autoComplete="off"
                        disabled={busy || orderLocked}
                      />
                    </label>
                    {checkoutPaused ? (
                      <p className={styles.notice}>商城暂时暂停新下单，历史订单和售后仍可查看。</p>
                    ) : null}
                    <button
                      className={styles.primary}
                      disabled={
                        busy ||
                        checkoutPaused ||
                        orderLocked ||
                        !identity?.emailVerified ||
                        checkoutMarker.kind !== "empty" ||
                        invalidCart ||
                        cartLines.length > MAX_DISTINCT_SKUS
                      }
                    >
                      {busy ? "正在创建…" : "创建测试订单"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
