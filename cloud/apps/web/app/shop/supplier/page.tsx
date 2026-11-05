"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { scopedShopConfig } from "@/lib/scoped-shop";
import {
  cad,
  commerce,
  commerceErrorMessage,
  shopSignInPath,
  type CommerceMe,
  type SupplierProduct,
  type SupplierItem,
} from "@/lib/commerce";
import styles from "@/components/commerce/shop.module.css";
import { SupplierStatement } from "@/components/commerce/SupplierStatement";

const fulfillmentLabels: Record<SupplierItem["status"], string> = {
  pending: "待接单",
  accepted: "已接单，待发货",
  shipped: "已发货",
  delivered: "已签收",
  cancelled: "已取消",
};

export default function SupplierPage() {
  if (scopedShopConfig.mode !== "off")
    return (
      <p role="status" className="p-8">
        本地独立测试商城不开放供应商后台。
      </p>
    );
  return <DefaultSupplierPage />;
}

function DefaultSupplierPage() {
  const { refetch } = authClient.useSession();
  const current = authClient.$store.atoms.session?.get() as
    | ReturnType<typeof authClient.useSession>
    | undefined;
  const data = current?.data ?? null;
  const isPending = current?.isPending ?? false;
  const error = current?.error;
  const [checked, setChecked] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  // Prefer layout timing so committed mounts can join this fresh SDK flight.
  // Cold hydration may already have started a request; freshness still takes priority.
  useLayoutEffect(() => {
    let active = true;
    void refetch({ query: { disableCookieCache: true } })
      .then(() => {
        const fresh = authClient.$store.atoms.session?.get() as
          | ReturnType<typeof authClient.useSession>
          | undefined;
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
          throw new Error("Fresh supplier identity was not confirmed.");
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
  }, [refetch, retryVersion]);
  const [deniedSession, setDeniedSession] = useState<string | null>(null);
  const sessionId = data?.session.id ?? null;
  const denied = Boolean(sessionId && sessionId === deniedSession);
  const identityDenied = error?.status === 401 || error?.status === 403;
  const identityUnavailable = !denied && !identityDenied && (Boolean(error) || refreshFailed);
  const pending = isPending || !checked;
  const authenticated = Boolean(
    !pending && !error && !refreshFailed && data?.user.id && sessionId && !denied,
  );
  const onDenied = useCallback(() => setDeniedSession(sessionId), [sessionId]);
  function retryIdentity() {
    if (pending || denied || identityDenied) return;
    setChecked(false);
    setRefreshFailed(false);
    setRetryVersion((current) => current + 1);
  }
  return (
    <SupplierBody
      key={`${sessionId}:${data?.user.id}:${pending}:${denied}:${authenticated}`}
      authenticated={authenticated}
      pending={pending}
      denied={denied || identityDenied}
      identityUnavailable={identityUnavailable}
      identityRateLimited={error?.status === 429}
      onRetryIdentity={retryIdentity}
      onDenied={onDenied}
    />
  );
}

function SupplierBody({
  authenticated,
  pending,
  denied,
  identityUnavailable,
  identityRateLimited,
  onRetryIdentity,
  onDenied,
}: {
  authenticated: boolean;
  pending: boolean;
  denied: boolean;
  identityUnavailable: boolean;
  identityRateLimited: boolean;
  onRetryIdentity: () => void;
  onDenied: () => void;
}) {
  const [profile, setProfile] = useState<CommerceMe | null>(null);
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [orders, setOrders] = useState<SupplierItem[]>([]);
  const [productPage, setProductPage] = useState(0);
  const [orderPage, setOrderPage] = useState(0);
  const [moreProducts, setMoreProducts] = useState(false);
  const [moreOrders, setMoreOrders] = useState(false);
  const [loading, setLoading] = useState(authenticated || pending);
  const [listsRead, setListsRead] = useState(false);
  const [listsFailed, setListsFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmedIssues, setUnconfirmedIssues] = useState<ReadonlySet<string>>(new Set());
  const issueKeys = useRef(new Map<string, string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function reload(pages = { products: productPage, orders: orderPage }) {
    if (!authenticated) return;
    try {
      const me = await commerce.me();
      if (
        profile?.suppliers
          .map((supplier) => supplier.id)
          .toSorted()
          .join(",") !==
        me.suppliers
          .map((supplier) => supplier.id)
          .toSorted()
          .join(",")
      ) {
        setProducts([]);
        setOrders([]);
        setListsRead(false);
        setListsFailed(false);
      }
      setProfile(me);
      if (!me.suppliers.length) return;
      const [catalog, fulfillment] = await Promise.all([
        commerce.supplierProducts(pages.products),
        commerce.supplierOrders(pages.orders),
      ]);
      setProducts(catalog.products);
      setOrders(fulfillment.orders);
      setUnconfirmedIssues(new Set());
      setProductPage(pages.products);
      setOrderPage(pages.orders);
      setMoreProducts(catalog.hasMore ?? false);
      setMoreOrders(fulfillment.hasMore ?? false);
      setListsRead(true);
      setListsFailed(false);
    } catch (cause) {
      setListsFailed(true);
      throw cause;
    }
  }
  const loadInitial = useEffectEvent(() => reload({ products: 0, orders: 0 }));
  const failure = useCallback(
    (cause: unknown) => {
      if (!mounted.current) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
        setProfile(null);
        setProducts([]);
        setOrders([]);
        onDenied();
      } else setError(commerceErrorMessage(cause));
    },
    [onDenied],
  );
  useEffect(() => {
    if (!authenticated) {
      setLoading(pending);
      return;
    }
    let active = true;
    void loadInitial()
      .catch((cause) => {
        if (active) failure(cause);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated, pending, failure]);
  const mutate = async (work: () => Promise<unknown>, refresh = true) => {
    if (busy || !authenticated) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (refresh) await reload();
      setMessage("服务器记录已更新。");
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  };
  function ship(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(() =>
      commerce.ship(
        id,
        String(form.get("trackingNumber") ?? "").trim(),
        String(form.get("carrier") ?? "").trim(),
      ),
    );
  }
  function reportIssue(event: FormEvent<HTMLFormElement>, item: SupplierItem) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind")) as "out_of_stock" | "delay" | "other";
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason || reason.length > 500 || !["out_of_stock", "delay", "other"].includes(kind))
      return;
    const signature = JSON.stringify([item.id, kind, reason]);
    if (!issueKeys.current.has(signature)) issueKeys.current.set(signature, crypto.randomUUID());
    setUnconfirmedIssues((current) => new Set([...current, item.id]));
    void mutate(() =>
      commerce.reportSupplierIssue(item.id, kind, reason, issueKeys.current.get(signature)!),
    );
  }

  return (
    <div className={styles.shop}>
      <div className={styles.modeBar}>
        供应商履约后台 · TEST 测试环境，非真实交易或到账 · 仅显示明确授权给你的供应商数据
      </div>
      <main className={styles.supplier}>
        <p className={styles.supplierNav}>
          <Link href="/shop">← 返回商城</Link>
        </p>
        <div className={styles.sectionHead}>
          <h1>供应商商品与履约</h1>
          <button
            className={styles.secondary}
            disabled={loading || busy || !authenticated}
            onClick={() => void mutate(reload, false)}
          >
            刷新
          </button>
        </div>
        {pending || identityUnavailable ? (
          <section className={styles.notice} role="status" aria-label="供应商账号核实">
            <p>
              {pending
                ? "正在读取供应商授权，确认账号前不会显示收货资料或操作。"
                : identityRateLimited
                  ? "请求过于频繁，暂时无法核实供应商账号。请稍后重试，不需要退出或重新登录。"
                  : "暂时无法核实供应商账号，请检查网络后重试；尚不能判断登录或供货权限是否失效。"}
            </p>
            <button className={styles.secondary} disabled={pending} onClick={onRetryIdentity}>
              重新核实账号
            </button>
          </section>
        ) : null}
        {denied ? (
          <p className={styles.notice}>
            登录状态或供应商授权已失效，原收货地址和操作已隐藏；请重新登录并核对供货权限。
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className={styles.notice} role="status">
            {message}
          </p>
        ) : null}
        {loading ? (
          pending ? null : (
            <p role="status">正在读取供应商授权…</p>
          )
        ) : !profile ? (
          identityUnavailable ? null : (
            <Link className={styles.primary} href={shopSignInPath()}>
              登录 DJL
            </Link>
          )
        ) : !profile.suppliers.length ? (
          <p className={styles.notice}>
            当前账号没有供应商授权。普通用户和 AI 团队管理员不会自动拥有供货权限，请联系平台运营。
          </p>
        ) : (
          <>
            <p className={styles.muted}>
              授权供应商：{profile.suppliers.map((s) => s.name).join("、")}
              。平台统一定价、审核和售后；这里不能修改售价、佣金或直接上架。
            </p>
            {listsFailed ? (
              <p className={styles.notice} role="status">
                {listsRead
                  ? "商品与履约记录刷新失败，保留上次读取的记录，可能已过期；请点击刷新核实。"
                  : "商品与履约记录尚未读取成功，当前未确认是否为空；请点击刷新重试。"}
              </p>
            ) : !listsRead ? (
              <p role="status">正在读取商品与履约记录…</p>
            ) : null}
            <SupplierStatement suppliers={profile.suppliers} />
            <h2>商品与库存</h2>
            <div style={{ overflowX: "auto", marginBottom: 35 }}>
              <table className={styles.supplierTable}>
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>售价</th>
                    <th>库存</th>
                    <th>更新总库存</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        <br />
                        <small className={styles.small}>SKU：{p.sku}</small>
                      </td>
                      <td>{cad(p.priceCents)}</td>
                      <td>
                        <div>总库存：{p.stock}</div>
                        <div className={styles.small}>已预占：{p.reserved}</div>
                        <div className={styles.small}>可售：{p.stock - p.reserved}</div>
                      </td>
                      <td>
                        <form
                          className={styles.actions}
                          onSubmit={(e) => {
                            e.preventDefault();
                            const data = new FormData(e.currentTarget);
                            void mutate(() =>
                              commerce.updateStock(p.id, Number(data.get("stock"))),
                            );
                          }}
                        >
                          <input
                            className={styles.stockField}
                            name="stock"
                            aria-label={`${p.name}（${p.sku}）库存`}
                            type="number"
                            min={p.reserved}
                            aria-describedby={`stock-${p.id}-hint`}
                            max={1000000}
                            step={1}
                            required
                            defaultValue={p.stock}
                            key={`${p.id}:${p.stock}`}
                          />
                          <button className={styles.secondary} disabled={busy}>
                            更新
                          </button>
                        </form>
                        <p className={styles.small} id={`stock-${p.id}-hint`}>
                          填写总库存，至少保留已预占的 {p.reserved} 件；服务器会重新校验。
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {listsRead && !listsFailed && !products.length ? (
                <p className={styles.muted}>尚无授权商品。</p>
              ) : null}
              <div className={styles.actions}>
                <button
                  className={styles.secondary}
                  disabled={busy || productPage === 0}
                  onClick={() =>
                    void mutate(
                      () => reload({ products: productPage - 1, orders: orderPage }),
                      false,
                    )
                  }
                >
                  上一页商品
                </button>
                <span>第 {productPage + 1} 页</span>
                <button
                  className={styles.secondary}
                  disabled={busy || !moreProducts}
                  onClick={() =>
                    void mutate(
                      () => reload({ products: productPage + 1, orders: orderPage }),
                      false,
                    )
                  }
                >
                  下一页商品
                </button>
              </div>
            </div>
            <h2>履约与历史订单</h2>
            <p className={styles.small}>
              只会看到属于你的履约资料。签收由平台核实，不把“已发货”自动当作“已签收”。
              当前按整条商品明细发货，不支持同一 SKU
              分批数量发货；缺货或延期请先上报平台，不要填写虚假运单。
            </p>
            <div className={styles.orderList}>
              {orders.map((item) => (
                <article className={styles.orderCard} key={item.id}>
                  <div className={styles.orderHead}>
                    <strong>
                      {item.name} × {item.quantity}
                    </strong>
                    <span>{fulfillmentLabels[item.status] ?? "状态待核实"}</span>
                  </div>
                  <p className={styles.small}>订单 {item.orderId}</p>
                  <p className={styles.small}>
                    {item.sku ? `SKU：${item.sku}` : "历史订单未记录 SKU"}
                  </p>
                  <p>
                    {item.address.name}
                    <br />
                    {item.address.line1}
                    <br />
                    {item.address.city}, {item.address.province} {item.address.postalCode}, CA
                  </p>
                  {item.trackingNumber ? (
                    <p>
                      运单：{item.carrier} · {item.trackingNumber}
                    </p>
                  ) : null}
                  {item.openCase ? (
                    <p className={styles.notice}>该商品正在处理售后，请等待平台核实，暂勿发货。</p>
                  ) : null}
                  {item.supplierIssue ? (
                    <p className={styles.notice}>
                      最近一次供应商反馈（
                      {item.supplierIssue.kind === "out_of_stock"
                        ? "缺货"
                        : item.supplierIssue.kind === "delay"
                          ? "延期"
                          : "其他问题"}
                      ）：{item.supplierIssue.reason}
                      <br />
                      {new Date(item.supplierIssue.reportedAt).toLocaleString()}
                      。是否已解决以平台核查和当前售后标记为准。
                    </p>
                  ) : null}
                  {unconfirmedIssues.has(item.id) ? (
                    <p className={styles.notice}>
                      问题报告状态尚待查询，请先刷新核实，暂勿接单或发货；重试相同内容不会重复提交。
                    </p>
                  ) : null}
                  {item.status === "pending" &&
                  !item.openCase &&
                  !unconfirmedIssues.has(item.id) ? (
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void mutate(() => commerce.accept(item.id))}
                    >
                      确认接单
                    </button>
                  ) : null}
                  {["pending", "accepted"].includes(item.status) &&
                  !item.openCase &&
                  !unconfirmedIssues.has(item.id) &&
                  item.refundedCents < item.lineCents ? (
                    <form onSubmit={(e) => ship(e, item.id)}>
                      <div className={styles.twoColumns}>
                        <label className={styles.field}>
                          承运商
                          <input name="carrier" required maxLength={100} />
                        </label>
                        <label className={styles.field}>
                          运单号
                          <input name="trackingNumber" required maxLength={150} />
                        </label>
                      </div>
                      <button className={styles.primary} disabled={busy}>
                        确认发货
                      </button>
                    </form>
                  ) : null}
                  {item.status !== "cancelled" ? (
                    <details>
                      <summary>报告缺货、延期或其他问题</summary>
                      <form onSubmit={(event) => reportIssue(event, item)}>
                        <p className={styles.small}>
                          提交后暂停该明细接单与发货，进入平台人工处理；不会自动退款、增加库存或改变佣金。
                        </p>
                        <label className={styles.field}>
                          问题类型
                          <select
                            name="kind"
                            disabled={busy}
                            defaultValue={
                              item.refundedCents < item.lineCents &&
                              ["pending", "accepted"].includes(item.status)
                                ? "out_of_stock"
                                : item.status === "delivered" ||
                                    item.refundedCents >= item.lineCents
                                  ? "other"
                                  : "delay"
                            }
                          >
                            {item.refundedCents < item.lineCents &&
                            ["pending", "accepted"].includes(item.status) ? (
                              <option value="out_of_stock">缺货 / 无法供货</option>
                            ) : null}
                            {item.refundedCents < item.lineCents && item.status !== "delivered" ? (
                              <option value="delay">履约延期</option>
                            ) : null}
                            <option value="other">其他履约或售后问题</option>
                          </select>
                        </label>
                        <label className={styles.field}>
                          问题说明
                          <textarea name="reason" required maxLength={500} disabled={busy} />
                        </label>
                        <button className={styles.secondary} disabled={busy}>
                          提交问题给平台
                        </button>
                      </form>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
            {listsRead && !listsFailed && !orders.length ? (
              <p className={styles.muted}>暂无需要履约的订单。</p>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                disabled={busy || orderPage === 0}
                onClick={() =>
                  void mutate(() => reload({ products: productPage, orders: orderPage - 1 }), false)
                }
              >
                上一页订单
              </button>
              <span>第 {orderPage + 1} 页</span>
              <button
                className={styles.secondary}
                disabled={busy || !moreOrders}
                onClick={() =>
                  void mutate(() => reload({ products: productPage, orders: orderPage + 1 }), false)
                }
              >
                下一页订单
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
