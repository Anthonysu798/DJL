"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";

import { Shell } from "@/components/Shell";
import {
  admin,
  AdminApiError,
  getAdminSessionRevision,
  getToken,
  subscribeAdminSession,
} from "@/lib/api";
import { canCommerce, type AdminIdentity } from "@/lib/commerce-access";
import type {
  CommerceAdminOrder,
  CommerceOrderAttentionReason,
  CommerceReviewedCaseCloseInput,
  CommercePaymentStatus,
  CommerceProviderRefund,
  CommerceAdminWithdrawal,
  CommerceConfirmWithdrawalPaymentInput,
  CommerceWithdrawal,
} from "@synara/contracts/cloud";
import { ProviderPaymentAdmin } from "./ProviderPaymentAdmin";
import { SupplierStatementAdmin } from "./SupplierStatementAdmin";
import { CommerceAlerts } from "./CommerceAlerts";
import { Reconciliation } from "./Reconciliation";
import { SupplierAccess } from "./SupplierAccess";

interface ProductRow {
  id: string;
  supplierId: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  priceCents: number;
  costCents: number;
  commissionBps: number;
  returnDays: number;
  stock: number;
  reserved: number;
  status: "draft" | "published" | "archived";
}
interface SupplierRow {
  id: string;
  name: string;
  returnAddress: string;
  active: boolean;
}
interface SupplierCreationIntent {
  readonly body: {
    readonly name: string;
    readonly returnAddress: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  };
  supplierId: string | null;
}
interface ItemRow {
  sku: string | null;
  id: string;
  name: string;
  quantity: number;
  lineCents: number;
  refundedCents: number;
  status: string;
  trackingNumber: string | null;
  openCase: boolean;
}
type OrderRow = CommerceAdminOrder;
type CaseItem = OrderRow["items"][number];
function caseRevision(item: CaseItem): string | null {
  const revision = item.caseRevision;
  return typeof revision === "string" && revision.length === 64 && /^[a-f0-9]{64}$/.test(revision)
    ? revision
    : null;
}
interface LedgerRow {
  id: string;
  ownerId: string;
  account: string;
  amountCents: number;
  eventKey: string;
  createdAt: string;
}
type WithdrawalRow = CommerceAdminWithdrawal;
type WithdrawalFilter = "all" | "requested" | "approved" | "payment_pending" | "payment_unknown";
interface WithdrawalPaymentIntent {
  action: "start-payment" | "mark-payment-unknown";
  body: { operationId: string; reason: string };
  amountCents: number;
  confirmed: "payment_pending" | "payment_unknown" | null;
}
interface WithdrawalSuccessIntent {
  body: CommerceConfirmWithdrawalPaymentInput;
  token: string | null;
  confirmed: boolean;
}
const primary = "rounded-lg bg-emerald-900 px-4 py-2 text-sm text-white disabled:opacity-40";
const secondary = "rounded-lg border border-border bg-card px-4 py-2 text-sm disabled:opacity-40";
const panel = "rounded-xl border border-border bg-card p-5";
const money = (value: number) => `CAD ${(value / 100).toFixed(2)}`;
function confirmedPayment(
  row: WithdrawalRow,
  id: string,
  operationId: string,
  amountCents: number,
) {
  return (
    row.id === id &&
    row.paymentOperationId === operationId &&
    row.amountCents === amountCents &&
    row.status === "paid_test" &&
    !!row.reference?.trim() &&
    !!row.paymentConfirmedAt &&
    !!row.paymentConfirmedBy &&
    !!row.paymentEvidenceReference?.trim() &&
    !!row.paymentConfirmationReason?.trim()
  );
}
const attentionLabels: Record<CommerceOrderAttentionReason, string> = {
  open_case: "存在未结售后",
  payment_unresolved: "付款创建中或结果待确认",
  payment_review: "付款异常，需人工核实",
  refund_unresolved: "退款处理中或结果待确认",
  external_refund_unresolved: "外部退款归属或渠道结果待核实",
};

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm">
      {label}
      <input
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        required
        {...props}
      />
    </label>
  );
}
const formData = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));
const commerceTabs = [
  ["catalog", "商品与供应商", "commerce.read"],
  ["orders", "履约与售后", "commerce.read"],
  ["finance", "佣金与提现", "commerce.finance.read"],
  ["alerts", "异常监控", "commerce.monitor.read"],
  ["reconciliation", "TEST 流水比对", "commerce.finance.read"],
] as const;
const initialSessionRevision = () => 0;

export default function CommerceAdminPage() {
  const session = useSyncExternalStore(
    subscribeAdminSession,
    getAdminSessionRevision,
    initialSessionRevision,
  );
  // A changed bearer must not inherit a previous account's loaded records or pending writes.
  return <CommerceWorkspace key={session} />;
}

function CommerceWorkspace() {
  const [activeTab, setTab] = useState<(typeof commerceTabs)[number][0]>("catalog");
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const tabs = commerceTabs.filter(([, , permission]) => canCommerce(identity, permission));
  const tab = tabs.some(([id]) => id === activeTab) ? activeTab : "catalog";
  const canRead = canCommerce(identity, "commerce.read");
  const canWriteCatalog = canCommerce(identity, "commerce.catalog.write");
  const canWriteFulfillment = canCommerce(identity, "commerce.fulfillment.write");
  const canWriteSupport = canCommerce(identity, "commerce.support.write");
  const canReadFinance = canCommerce(identity, "commerce.finance.read");
  const canWriteFinance = canReadFinance && canCommerce(identity, "commerce.finance.write");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRow | null>(null);
  const [selectedOrderUnavailable, setSelectedOrderUnavailable] = useState(false);
  const [selectedWithdrawalUnavailable, setSelectedWithdrawalUnavailable] = useState(false);
  const [providerPayments, setProviderPayments] = useState<Record<string, CommercePaymentStatus>>(
    {},
  );
  const [catalogPage, setCatalogPage] = useState(0);
  const [orderPage, setOrderPage] = useState(0);
  const [attention, setAttention] = useState<"all" | "needs_attention">("all");
  const [withdrawalFilter, setWithdrawalFilter] = useState<WithdrawalFilter>("all");
  const [moreProducts, setMoreProducts] = useState(false);
  const [moreOrders, setMoreOrders] = useState(false);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [entries, setEntries] = useState<LedgerRow[]>([]);
  const [withdrawalPage, setWithdrawalPage] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [moreWithdrawals, setMoreWithdrawals] = useState(false);
  const [moreLedger, setMoreLedger] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState<"signin" | "scoped" | "platform" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [csvPreview, setCsvPreview] = useState<{ input: string; rows: unknown } | null>(null);
  const keys = useRef(new Map<string, string>());
  const paymentIntents = useRef(new Map<string, WithdrawalPaymentIntent>());
  const successIntents = useRef(new Map<string, WithdrawalSuccessIntent>());
  const paymentWorking = useRef(false);
  const caseWorking = useRef(false);
  const [rejectedCaseRevisions, setRejectedCaseRevisions] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const paymentActive = useRef(true);
  const workspaceSession = getAdminSessionRevision();
  const workspaceActive = () =>
    paymentActive.current && workspaceSession === getAdminSessionRevision();
  const [, updatePaymentIntents] = useState(0);
  useEffect(() => {
    paymentActive.current = true;
    return () => {
      paymentActive.current = false;
    };
  }, []);
  const selectionRequest = useRef(0);
  const reloadRequest = useRef(0);
  const supplierCreation = useRef<SupplierCreationIntent | null>(null);
  const supplierCreationWorking = useRef(false);
  const supplierCreationForm = useRef<HTMLFormElement>(null);
  const [supplierCreationStatus, setSupplierCreationStatus] = useState<
    "ready" | "unconfirmed" | "confirmed" | "verified"
  >("ready");
  const [supplierCreationError, setSupplierCreationError] = useState<string | null>(null);
  useEffect(
    () => () => {
      supplierCreation.current = null;
    },
    [],
  );

  async function reload(
    next: Partial<{
      catalog: number;
      orders: number;
      withdrawals: number;
      ledger: number;
      attention: "all" | "needs_attention";
      withdrawalFilter: WithdrawalFilter;
    }> = {},
  ) {
    if (!workspaceActive()) return;
    const request = ++reloadRequest.current;
    const active = () => workspaceActive() && request === reloadRequest.current;
    let verified: AdminIdentity;
    try {
      ({ admin: verified } = await admin<{ admin: AdminIdentity }>("/me"));
    } catch (cause) {
      if (!active()) return;
      setIdentity(null);
      throw cause;
    }
    if (!active()) return;
    if (!canCommerce(verified, "commerce.read")) {
      setIdentity(null);
      setAccessDenied(verified?.role === "commerce" ? "scoped" : "platform");
      return;
    }
    const finance = canCommerce(verified, "commerce.finance.read");
    if (!finance) {
      setWithdrawals([]);
      setEntries([]);
      setSelectedWithdrawal(null);
      setProviderPayments({});
    }
    setIdentity(verified);
    setAccessDenied(null);
    const selection = selectionRequest.current;
    const pages = {
      catalog: catalogPage,
      orders: orderPage,
      withdrawals: withdrawalPage,
      ledger: ledgerPage,
      attention,
      withdrawalFilter,
      ...next,
    };
    const orderQuery = new URLSearchParams();
    if (pages.orders) orderQuery.set("page", String(pages.orders));
    if (pages.attention !== "all") orderQuery.set("attention", pages.attention);
    const withdrawalQuery = new URLSearchParams();
    if (pages.withdrawals) withdrawalQuery.set("page", String(pages.withdrawals));
    if (pages.withdrawalFilter !== "all") withdrawalQuery.set("status", pages.withdrawalFilter);
    const [catalog, vendors, purchases, payouts, ledger, locatedOrder, locatedWithdrawal] =
      await Promise.all([
        admin<{ products: ProductRow[]; hasMore: boolean }>(
          `/commerce/catalog${pages.catalog ? `?page=${pages.catalog}` : ""}`,
        ),
        admin<{ suppliers: SupplierRow[] }>("/commerce/suppliers"),
        admin<{ orders: OrderRow[]; hasMore: boolean }>(
          `/commerce/orders${orderQuery.size ? `?${orderQuery}` : ""}`,
        ),
        finance
          ? admin<{ withdrawals: WithdrawalRow[]; hasMore: boolean }>(
              `/commerce/withdrawals${withdrawalQuery.size ? `?${withdrawalQuery}` : ""}`,
            )
          : null,
        finance
          ? admin<{ entries: LedgerRow[]; hasMore: boolean }>(
              `/commerce/ledger${pages.ledger ? `?page=${pages.ledger}` : ""}`,
            )
          : null,
        selectedOrder
          ? admin<{ order: OrderRow }>(`/commerce/orders/${encodeURIComponent(selectedOrder.id)}`)
          : null,
        finance && selectedWithdrawal
          ? admin<{ withdrawal: WithdrawalRow }>(
              `/commerce/withdrawals/${encodeURIComponent(selectedWithdrawal.id)}`,
            )
          : null,
      ]).catch((cause) => {
        if (active() && selection === selectionRequest.current) {
          if (selectedOrder) setSelectedOrderUnavailable(true);
          if (selectedWithdrawal) setSelectedWithdrawalUnavailable(true);
        }
        throw cause;
      });
    if (!active()) return;
    if (locatedOrder && selection === selectionRequest.current) {
      setSelectedOrder(locatedOrder.order);
      setSelectedOrderUnavailable(false);
    }
    if (locatedWithdrawal && selection === selectionRequest.current) {
      setSelectedWithdrawal(locatedWithdrawal.withdrawal);
      setSelectedWithdrawalUnavailable(false);
    }
    setProducts(catalog.products);
    setSuppliers(vendors.suppliers);
    setOrders(purchases.orders);
    setAttention(pages.attention);
    setWithdrawalFilter(pages.withdrawalFilter);
    setWithdrawals(payouts?.withdrawals ?? []);
    setEntries(ledger?.entries ?? []);
    setWithdrawalPage(pages.withdrawals);
    setLedgerPage(pages.ledger);
    setMoreWithdrawals(payouts?.hasMore ?? false);
    setMoreLedger(ledger?.hasMore ?? false);
    setCatalogPage(pages.catalog);
    setOrderPage(pages.orders);
    setMoreProducts(catalog.hasMore ?? false);
    setMoreOrders(purchases.hasMore ?? false);
  }
  async function locateOrder(id: string) {
    if (!canRead || !workspaceActive()) return;
    const request = ++selectionRequest.current;
    const { order } = await admin<{ order: OrderRow }>(
      `/commerce/orders/${encodeURIComponent(id)}`,
    );
    if (!workspaceActive() || request !== selectionRequest.current) return;
    setSelectedOrder(order);
    setSelectedOrderUnavailable(false);
    setProviderPayments((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setTab("orders");
  }
  async function locateWithdrawal(id: string) {
    if (!canReadFinance || !workspaceActive()) return;
    const request = ++selectionRequest.current;
    const { withdrawal } = await admin<{ withdrawal: WithdrawalRow }>(
      `/commerce/withdrawals/${encodeURIComponent(id)}`,
    );
    if (!workspaceActive() || request !== selectionRequest.current) return;
    setSelectedWithdrawal(withdrawal);
    setSelectedWithdrawalUnavailable(false);
    setTab("finance");
  }
  function showLoadError(e: unknown) {
    if (!workspaceActive()) return;
    if (
      e instanceof AdminApiError &&
      (e.status === 401 ||
        (e.status === 403 && (e.code === "forbidden" || e.code === "mfa_required")))
    ) {
      setIdentity(null);
      setAccessDenied(
        e.status === 401 || e.code === "mfa_required"
          ? "signin"
          : identity?.role === "commerce"
            ? "scoped"
            : "platform",
      );
      return;
    }
    setError(
      e instanceof TypeError
        ? "暂时无法连接商城管理服务，请稍后重试。"
        : e instanceof Error
          ? e.message
          : "操作失败",
    );
  }
  const loadInitial = useEffectEvent(async () => {
    try {
      await reload({ catalog: 0, orders: 0, withdrawals: 0, ledger: 0 });
    } catch (cause) {
      showLoadError(cause);
    } finally {
      if (workspaceActive()) setLoading(false);
    }
  });
  useEffect(() => {
    void loadInitial();
  }, []);
  async function action(
    work: () => Promise<unknown>,
    success = "操作已完成，审计与业务记录由服务器保存。",
    refresh = true,
  ) {
    if (busy || !workspaceActive()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (!workspaceActive()) return;
      if (refresh) await reload();
      if (workspaceActive()) setMessage(success);
    } catch (e) {
      if (workspaceActive()) showLoadError(e);
    } finally {
      if (workspaceActive()) setBusy(false);
    }
  }
  async function submitCase(event: FormEvent<HTMLFormElement>, item: CaseItem) {
    event.preventDefault();
    if (!canWriteSupport || !workspaceActive() || busy || caseWorking.current) return;
    const revision = caseRevision(item);
    if (item.openCase && (!revision || rejectedCaseRevisions.has(item.id))) {
      setError("请先刷新售后记录，核对最新状态后再重新填写处理说明。");
      return;
    }
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("caseReason") ?? "").trim();
    if (!reason || reason.length > 500) {
      setError("售后处理说明须为 1–500 个字符。");
      return;
    }
    const json =
      item.openCase && revision
        ? ({ reviewedClose: { reason, revision } } satisfies CommerceReviewedCaseCloseInput)
        : { open: true, reason };
    caseWorking.current = true;
    try {
      await action(async () => {
        try {
          await admin("/commerce/items/" + encodeURIComponent(item.id) + "/case", {
            method: "POST",
            json,
          });
          if (workspaceActive()) form.reset();
        } catch (cause) {
          if (
            workspaceActive() &&
            item.openCase &&
            revision &&
            cause instanceof AdminApiError &&
            cause.status === 409 &&
            (cause.code === "commerce_case_review_stale" ||
              cause.code === "commerce_case_review_required")
          ) {
            setRejectedCaseRevisions((current) => new Map(current).set(item.id, revision));
            throw new Error(
              "售后状态已变化或核验凭据不可用。请先刷新售后记录，再重新填写处理说明。",
              { cause },
            );
          }
          throw cause;
        }
      });
    } finally {
      caseWorking.current = false;
    }
  }

  async function refreshCaseReview(orderId: string, itemId: string) {
    if (!canWriteSupport || !workspaceActive() || busy || caseWorking.current) return;
    caseWorking.current = true;
    const request = ++reloadRequest.current;
    try {
      await action(
        async () => {
          const { order } = await admin<{ order: OrderRow }>(
            "/commerce/orders/" + encodeURIComponent(orderId),
          );
          if (!workspaceActive()) return;
          if (request !== reloadRequest.current)
            throw new Error("售后记录已被另一项刷新更新，请重新核对售后记录。");
          const matches =
            order?.id === orderId && Array.isArray(order.items)
              ? order.items.filter((item) => item?.id === itemId)
              : [];
          const item = matches.length === 1 ? matches[0] : undefined;
          if (!item || typeof item.openCase !== "boolean")
            throw new Error("尚未取得当前商品的售后记录，不能关闭。");
          setOrders((current) => current.map((row) => (row.id === orderId ? order : row)));
          setSelectedOrder((current) => (current?.id === orderId ? order : current));
          const revision = caseRevision(item);
          if (item.openCase && (!revision || revision === rejectedCaseRevisions.get(itemId)))
            throw new Error("售后记录仍未取得新的有效核验凭据，请稍后重新刷新。");
          setRejectedCaseRevisions((current) => {
            if (!current.has(itemId)) return current;
            const next = new Map(current);
            next.delete(itemId);
            return next;
          });
        },
        "售后记录已刷新。请重新核对并填写新的处理说明。",
        false,
      );
    } finally {
      caseWorking.current = false;
    }
  }

  function renderCaseAction(order: OrderRow, item: CaseItem) {
    const revision = caseRevision(item);
    const needsReview = item.openCase && (!revision || rejectedCaseRevisions.has(item.id));
    // A refreshed revision or state is a new review; never carry over the old reason.
    const formKey = item.openCase
      ? "close:" + (revision ?? "missing") + (needsReview ? ":blocked" : ":ready")
      : "open";
    return (
      <>
        <form
          key={formKey}
          className="flex flex-wrap items-center gap-3"
          onSubmit={(event) => void submitCase(event, item)}
        >
          <Field
            label="售后处理说明"
            name="caseReason"
            maxLength={500}
            required
            disabled={busy || needsReview}
          />
          <button className={secondary} disabled={busy || needsReview}>
            {item.openCase ? "核实售后已解决并关闭" : "标记售后处理中"}
          </button>
        </form>
        {needsReview ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p className="text-amber-900">请先刷新售后记录，核对最新状态后再重新填写处理说明。</p>
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() => void refreshCaseReview(order.id, item.id)}
            >
              刷新售后记录
            </button>
          </div>
        ) : null}
      </>
    );
  }

  function showWithdrawal(result: CommerceWithdrawal) {
    setWithdrawals((current) =>
      current.map((row) => (row.id === result.id ? { ...row, ...result } : row)),
    );
    setSelectedWithdrawal((current) =>
      current?.id === result.id ? { ...current, ...result } : current,
    );
  }
  function canRegisterPayment(withdrawal: WithdrawalRow) {
    return (
      canWriteFinance &&
      !!withdrawal.approvedBy &&
      withdrawal.approvedBy !== identity?.id &&
      withdrawal.userId !== identity?.id
    );
  }
  async function registerWithdrawalPayment(
    withdrawal: WithdrawalRow,
    operation: WithdrawalPaymentIntent["action"],
    reason = "",
  ) {
    if (
      !canRegisterPayment(withdrawal) ||
      !workspaceActive() ||
      busy ||
      paymentWorking.current ||
      successIntents.current.has(withdrawal.id)
    )
      return;
    let intent = paymentIntents.current.get(withdrawal.id);
    if (!intent) {
      const trimmed = reason.trim();
      if (!trimmed || trimmed.length > 500) {
        setError("请填写 1–500 字的人工测试操作原因。");
        return;
      }
      if (
        (operation === "start-payment" && withdrawal.status !== "approved") ||
        (operation === "mark-payment-unknown" &&
          (withdrawal.status !== "payment_pending" || !withdrawal.paymentOperationId))
      )
        return;
      intent = {
        action: operation,
        amountCents: withdrawal.amountCents,
        body: {
          operationId: withdrawal.paymentOperationId ?? crypto.randomUUID(),
          reason: trimmed,
        },
        confirmed: null,
      };
      paymentIntents.current.set(withdrawal.id, intent);
    }
    if (intent.action !== operation || intent.confirmed) return;
    const token = getToken();
    const active = () => paymentActive.current && getToken() === token;
    paymentWorking.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    updatePaymentIntents((value) => value + 1);
    try {
      const { withdrawal: result } = await admin<{ withdrawal: CommerceWithdrawal }>(
        `/commerce/withdrawals/${encodeURIComponent(withdrawal.id)}/${intent.action}`,
        { method: "POST", json: intent.body },
      );
      if (!active()) return;
      if (
        result.id !== withdrawal.id ||
        result.amountCents !== intent.amountCents ||
        result.paymentOperationId !== intent.body.operationId ||
        !["payment_pending", "payment_unknown"].includes(result.status) ||
        (intent.action === "mark-payment-unknown" && result.status !== "payment_unknown")
      )
        throw new Error("服务器返回的操作记录尚无法核对，请查询原提现。");
      intent.confirmed =
        result.status === "payment_unknown" ? "payment_unknown" : "payment_pending";
      showWithdrawal(result);
      try {
        const { withdrawal: refreshed } = await admin<{ withdrawal: WithdrawalRow }>(
          `/commerce/withdrawals/${encodeURIComponent(withdrawal.id)}`,
        );
        if (!active()) return;
        if (
          confirmedPayment(refreshed, withdrawal.id, intent.body.operationId, intent.amountCents)
        ) {
          showWithdrawal(refreshed);
          paymentIntents.current.delete(withdrawal.id);
          setMessage("原操作的 TEST 成功登记已核对，不代表真实到账；不会再次提交或付款。");
          return;
        }
        if (
          refreshed.id !== withdrawal.id ||
          refreshed.amountCents !== intent.amountCents ||
          refreshed.paymentOperationId !== intent.body.operationId ||
          !["payment_pending", "payment_unknown"].includes(refreshed.status) ||
          (intent.confirmed === "payment_unknown" && refreshed.status !== "payment_unknown")
        )
          throw new Error("提现操作记录不匹配");
        showWithdrawal(refreshed);
        paymentIntents.current.delete(withdrawal.id);
        setMessage("已登记人工测试操作，结果未确认；金额仍冻结。没有发送真实付款请求。");
      } catch {
        if (active())
          setMessage("登记已由服务器确认，但列表刷新失败。请查询原提现核对，不要再次开始付款。");
      }
    } catch {
      if (active())
        setError(
          "登记结果尚未确认。请查询原提现，或使用原操作编号和原原因重试；不要另行开始付款。",
        );
    } finally {
      paymentWorking.current = false;
      if (paymentActive.current) {
        setBusy(false);
        updatePaymentIntents((value) => value + 1);
      }
    }
  }
  async function verifyWithdrawalPayment(id: string) {
    if (!canReadFinance || busy || paymentWorking.current) return;
    const intent = paymentIntents.current.get(id);
    if (!intent) return;
    const token = getToken();
    const active = () => paymentActive.current && getToken() === token;
    paymentWorking.current = true;
    setBusy(true);
    setError(null);
    try {
      const { withdrawal } = await admin<{ withdrawal: WithdrawalRow }>(
        `/commerce/withdrawals/${encodeURIComponent(id)}`,
      );
      if (!active()) return;
      if (
        withdrawal.id === id &&
        withdrawal.amountCents === intent.amountCents &&
        withdrawal.paymentOperationId === intent.body.operationId &&
        (confirmedPayment(withdrawal, id, intent.body.operationId, intent.amountCents) ||
          withdrawal.status === "payment_unknown" ||
          (intent.action === "start-payment" &&
            intent.confirmed !== "payment_unknown" &&
            withdrawal.status === "payment_pending"))
      ) {
        showWithdrawal(withdrawal);
        paymentIntents.current.delete(id);
        updatePaymentIntents((value) => value + 1);
        setMessage(
          withdrawal.status === "paid_test"
            ? "原操作的 TEST 成功登记已核对，不代表真实到账；不会再次提交或付款。"
            : "原操作记录已核对，结果仍未确认；金额保持冻结，不代表真实到账。",
        );
      } else {
        setError("尚未查到原操作的已确认结果，保留原操作编号；不要改原因或另建付款操作。");
      }
    } catch {
      if (active()) setError("原提现查询失败，结果仍未确认；不要重复付款。");
    } finally {
      paymentWorking.current = false;
      if (paymentActive.current) setBusy(false);
    }
  }
  async function confirmWithdrawalSuccess(withdrawal: WithdrawalRow, form?: HTMLFormElement) {
    if (
      !canRegisterPayment(withdrawal) ||
      !workspaceActive() ||
      busy ||
      paymentWorking.current ||
      paymentIntents.current.has(withdrawal.id)
    )
      return;
    const token = getToken();
    let intent = successIntents.current.get(withdrawal.id);
    if (intent && intent.token !== token) {
      setError("登录身份已变化；原 TEST 请求只能只读核对，不能由新身份重试登记。");
      return;
    }
    if (!intent) {
      if (
        !form ||
        !["payment_pending", "payment_unknown"].includes(withdrawal.status) ||
        !withdrawal.paymentOperationId
      )
        return;
      const raw = new FormData(form);
      if (raw.get("acknowledge") !== "on") {
        setError("请确认已独立核验 TEST 结果；本操作不发起转账、不自动核验银行、不代表真实到账。");
        return;
      }
      const reference = String(raw.get("reference") ?? "").trim();
      const evidenceReference = String(raw.get("evidenceReference") ?? "").trim();
      const reason = String(raw.get("reason") ?? "").trim();
      if (
        !reference ||
        reference.length > 150 ||
        !evidenceReference ||
        evidenceReference.length > 500 ||
        !reason ||
        reason.length > 500
      ) {
        setError("请填写测试流水号（1–150 字）、核验依据编号及原因（各 1–500 字），不能只填空白。");
        return;
      }
      intent = {
        body: {
          operationId: withdrawal.paymentOperationId,
          amountCents: withdrawal.amountCents,
          currency: "CAD",
          reference,
          evidenceReference,
          reason,
        },
        token,
        confirmed: false,
      };
      successIntents.current.set(withdrawal.id, intent);
    }
    if (intent.confirmed) return;
    const active = () => paymentActive.current && getToken() === token;
    paymentWorking.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    updatePaymentIntents((value) => value + 1);
    try {
      const { withdrawal: result } = await admin<{ withdrawal: WithdrawalRow }>(
        `/commerce/withdrawals/${encodeURIComponent(withdrawal.id)}/confirm-payment-success`,
        { method: "POST", json: intent.body },
      );
      if (!active()) return;
      if (!matchesSuccess(result, withdrawal.id, intent)) throw new Error("TEST 成功记录不匹配");
      intent.confirmed = true;
      showWithdrawal(result);
      try {
        const { withdrawal: refreshed } = await admin<{ withdrawal: WithdrawalRow }>(
          `/commerce/withdrawals/${encodeURIComponent(withdrawal.id)}`,
        );
        if (!active()) return;
        if (!matchesSuccess(refreshed, withdrawal.id, intent))
          throw new Error("TEST 成功记录不匹配");
        showWithdrawal(refreshed);
        successIntents.current.delete(withdrawal.id);
        setMessage("已登记并核对 TEST 付款成功结果；没有发起转账或自动核验银行，不代表真实到账。");
      } catch {
        if (active())
          setMessage(
            "成功登记已由服务器确认，但只读核对失败。只能查询原 TEST 付款结果，不会再次提交。",
          );
      }
    } catch {
      if (active())
        setError(
          "成功结果登记尚未确认。请先只读查询原 TEST 付款结果；如需重试，只能使用原完整请求，不能另建付款操作。",
        );
    } finally {
      paymentWorking.current = false;
      if (paymentActive.current) {
        setBusy(false);
        updatePaymentIntents((value) => value + 1);
      }
    }
  }
  function matchesSuccess(row: WithdrawalRow, id: string, intent: WithdrawalSuccessIntent) {
    return (
      confirmedPayment(row, id, intent.body.operationId, intent.body.amountCents) &&
      row.reference === intent.body.reference &&
      row.paymentEvidenceReference === intent.body.evidenceReference &&
      row.paymentConfirmationReason === intent.body.reason
    );
  }
  async function verifyWithdrawalSuccess(id: string) {
    if (!canReadFinance || busy || paymentWorking.current) return;
    const intent = successIntents.current.get(id);
    if (!intent) return;
    const token = getToken();
    const active = () => paymentActive.current && getToken() === token;
    paymentWorking.current = true;
    setBusy(true);
    setError(null);
    try {
      const { withdrawal } = await admin<{ withdrawal: WithdrawalRow }>(
        `/commerce/withdrawals/${encodeURIComponent(id)}`,
      );
      if (!active()) return;
      if (!matchesSuccess(withdrawal, id, intent)) throw new Error("TEST 成功记录不匹配");
      showWithdrawal(withdrawal);
      successIntents.current.delete(id);
      updatePaymentIntents((value) => value + 1);
      setMessage("原 TEST 成功登记已核对；未再次提交或付款，不代表真实到账。");
    } catch {
      if (active())
        setError(
          "尚未核对到原完整请求的 TEST 成功记录；保留原请求，不改金额、编号或核验依据，不另行付款。",
        );
    } finally {
      paymentWorking.current = false;
      if (paymentActive.current) setBusy(false);
    }
  }
  function key(input: unknown) {
    const signature = JSON.stringify(input);
    if (!keys.current.has(signature)) keys.current.set(signature, crypto.randomUUID());
    return keys.current.get(signature)!;
  }
  function providerRefundBlocked(order: OrderRow, itemId: string) {
    if (order.paymentProvider !== "stripe_test") return false;
    const payment = providerPayments[order.id];
    return (
      payment?.enabled !== true ||
      payment.status !== "paid" ||
      payment.refunds.some(
        (refund) =>
          refund.itemId === itemId &&
          ["submitting", "unknown", "pending", "requires_review"].includes(refund.status),
      )
    );
  }
  function refundItem(event: FormEvent<HTMLFormElement>, order: OrderRow, item: ItemRow) {
    event.preventDefault();
    if (!canWriteFinance) return;
    if (providerRefundBlocked(order, item.id)) {
      setError("请先查询并核实渠道测试状态；未确认结果不能重复退款。");
      return;
    }
    const data = formData(event.currentTarget);
    const payload = {
      refundTotalCents: Number(data.refundTotalCents),
      reason: String(data.reason),
      idempotencyKey: key({
        itemId: item.id,
        refundTotalCents: Number(data.refundTotalCents),
        reason: String(data.reason),
      }),
    };
    const stripe = order.paymentProvider === "stripe_test";
    void action(
      async () => {
        if (stripe) {
          const result = await admin<{ refund: CommerceProviderRefund }>(
            `/commerce/items/${encodeURIComponent(item.id)}/provider-refunds`,
            { method: "POST", json: payload },
          );
          setProviderPayments((current) => {
            const payment = current[order.id];
            return payment
              ? {
                  ...current,
                  [order.id]: {
                    ...payment,
                    refunds: [
                      ...payment.refunds.filter((refund) => refund.id !== result.refund.id),
                      result.refund,
                    ],
                  },
                }
              : current;
          });
        } else
          await admin(`/commerce/items/${encodeURIComponent(item.id)}/refund`, {
            method: "POST",
            json: payload,
          });
      },
      stripe
        ? "渠道测试退款请求已提交；请核实渠道状态，处理中或未知不代表退款成功。"
        : "测试退款操作已由服务器处理，业务记录与审计已刷新。",
    );
  }
  function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWriteCatalog) return;
    const raw = formData(event.currentTarget);
    const values = {
      ...raw,
      priceCents: Number(raw.priceCents),
      costCents: Number(raw.costCents),
      commissionBps: Number(raw.commissionBps),
      returnDays: Number(raw.returnDays),
      stock: Number(raw.stock),
    };
    void action(
      () => admin("/commerce/catalog", { method: "POST", json: values }),
      "商品草稿已创建，审核上架前不会出现在买家商城。",
    );
  }
  function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWriteCatalog) return;
    if (busy || supplierCreationWorking.current || supplierCreation.current) return;
    const raw = formData(event.currentTarget);
    const name = String(raw.name ?? "").trim();
    const returnAddress = String(raw.returnAddress ?? "").trim();
    const reason = String(raw.reason ?? "").trim();
    if (
      !name ||
      name.length > 100 ||
      !returnAddress ||
      returnAddress.length > 500 ||
      !reason ||
      reason.length > 500
    ) {
      setSupplierCreationError(
        "请填写供应商名称（1–100 字符）、加拿大退货地址及创建原因（各 1–500 字符），不能只填空白。",
      );
      return;
    }
    const intent: SupplierCreationIntent = {
      body: { name, returnAddress, reason, idempotencyKey: crypto.randomUUID() },
      supplierId: null,
    };
    supplierCreation.current = intent;
    setSupplierCreationStatus("unconfirmed");
    void confirmSupplierCreation(intent);
  }
  async function confirmSupplierCreation(intent: SupplierCreationIntent) {
    if (!canWriteCatalog) return;
    const active = () => workspaceActive() && supplierCreation.current === intent;
    if (busy || supplierCreationWorking.current || !active()) return;
    supplierCreationWorking.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    setSupplierCreationError(null);
    try {
      if (!intent.supplierId) {
        const result = await admin<{ supplier: SupplierRow }>("/commerce/suppliers", {
          method: "POST",
          json: intent.body,
        });
        if (!active()) return;
        if (!result.supplier?.id) throw new Error("创建响应未包含供应商 ID，请使用原请求核对。");
        intent.supplierId = result.supplier.id;
        setSupplierCreationStatus("confirmed");
      }
      const result = await admin<{ suppliers: SupplierRow[] }>("/commerce/suppliers");
      if (!active()) return;
      if (!result.suppliers.some((supplier) => supplier.id === intent.supplierId))
        throw new Error("当前列表尚未查到已确认的供应商 ID，请稍后再次只读核对。");
      setSuppliers(result.suppliers);
      setSupplierCreationStatus("verified");
    } catch (cause) {
      if (!active()) return;
      setSupplierCreationStatus(intent.supplierId ? "confirmed" : "unconfirmed");
      setSupplierCreationError(
        cause instanceof TypeError
          ? "暂时无法连接商城管理服务，请稍后核对。"
          : cause instanceof Error
            ? cause.message
            : "请核对服务器记录。",
      );
    } finally {
      supplierCreationWorking.current = false;
      if (active()) setBusy(false);
    }
  }

  if (accessDenied)
    return (
      <Shell title="Commerce">
        <div className="space-y-5 px-8 pb-10">
          <p role="alert" className={panel}>
            {accessDenied === "signin"
              ? "管理会话已结束或尚未完成 MFA 验证。请重新登录。"
              : "当前账号没有商城管理权限。请联系平台管理员核对授权。"}
          </p>
          {accessDenied === "scoped" ? null : (
            <a href={accessDenied === "signin" ? "/login" : "/"} className={secondary}>
              {accessDenied === "signin" ? "前往管理登录" : "返回管理首页"}
            </a>
          )}
        </div>
      </Shell>
    );

  return (
    <Shell
      title="Commerce"
      subtitle="平台统一供货、供应商履约、直接推荐佣金与人工结算。管理员账号及 MFA 独立验证。"
    >
      <div className="space-y-5 px-8 pb-10">
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          当前仅支持测试订单、测试退款及测试结算。这里不会发起真实扣款或银行打款；不能把测试凭证当作实际到账。经营主体、税务、渠道、供应商协议和收款人核验未完成前，不开放真实资金。
        </p>
        <nav className="flex flex-wrap gap-2" aria-label="商城管理导航">
          {canRead &&
            tabs.map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? primary : secondary}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => {
                  selectionRequest.current++;
                  setTab(id);
                }}
              >
                {label}
              </button>
            ))}
          <button
            className={secondary}
            disabled={busy || loading}
            onClick={() => void action(reload, "数据已刷新。", false)}
          >
            刷新
          </button>
        </nav>
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
          >
            {message}
          </p>
        ) : null}
        {loading ? <p role="status">正在加载商城管理数据…</p> : null}
        {canRead && tab === "alerts" ? (
          <CommerceAlerts
            onOrder={locateOrder}
            onWithdrawal={canReadFinance ? locateWithdrawal : undefined}
            disabled={busy || loading}
          />
        ) : null}
        {canRead && tab === "reconciliation" ? <Reconciliation disabled={busy || loading} /> : null}
        {canRead && !loading && tab === "catalog" ? (
          <>
            {canWriteCatalog ? (
              <section className={panel}>
                <h2 className="mb-4 text-lg font-semibold">创建商品草稿</h2>
                <form onSubmit={createProduct} className="grid gap-4 md:grid-cols-3">
                  <label className="flex flex-col gap-1.5 text-sm">
                    供应商
                    <select
                      className="rounded-lg border border-border bg-background px-3 py-2"
                      name="supplierId"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        选择供应商
                      </option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field label="SKU（唯一）" name="sku" maxLength={100} />
                  <Field label="商品名称" name="name" maxLength={150} />
                  <Field label="分类" name="category" maxLength={100} />
                  <Field
                    label="商品图片地址（获准的 HTTPS 媒体或 /shop/media/ 路径）"
                    name="imageUrl"
                    maxLength={2048}
                    placeholder="https://获准媒体域名/图片.png 或 /shop/media/图片.png"
                  />
                  <Field label="商品说明" name="description" maxLength={4000} />
                  <Field label="售价（加分）" name="priceCents" type="number" min={1} step={1} />
                  <Field label="采购成本（加分）" name="costCents" type="number" min={0} step={1} />
                  <Field
                    label="佣金（基点，1000 = 10%）"
                    name="commissionBps"
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                  />
                  <Field
                    label="售后窗口（天）"
                    name="returnDays"
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    defaultValue={30}
                  />
                  <Field label="库存" name="stock" type="number" min={0} max={1000000} step={1} />
                  <Field label="创建原因" name="reason" maxLength={500} />
                  <button className={primary} disabled={busy || !suppliers.length}>
                    创建草稿
                  </button>
                </form>
              </section>
            ) : null}
            <section className={panel}>
              <h2 className="mb-3 text-lg font-semibold">商品审核</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-2">商品 / SKU</th>
                      <th>价格 / 成本</th>
                      <th>库存 / 预占</th>
                      <th>审核</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr className="border-b border-border" key={p.id}>
                        <td className="p-3">
                          {p.name}
                          <small className="block text-muted-foreground">{p.sku}</small>
                        </td>
                        <td>
                          {money(p.priceCents)}
                          <small className="block text-muted-foreground">
                            成本 {money(p.costCents)} · 佣金 {p.commissionBps / 100}%
                          </small>
                        </td>
                        <td>
                          {p.stock} / {p.reserved}
                        </td>
                        <td>
                          {canWriteCatalog ? (
                            <form
                              className="flex flex-wrap gap-2 py-3"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const data = formData(e.currentTarget);
                                void action(() =>
                                  admin(`/commerce/catalog/${encodeURIComponent(p.id)}`, {
                                    method: "PATCH",
                                    json: data,
                                  }),
                                );
                              }}
                            >
                              <select
                                aria-label={`${p.name}上架状态`}
                                className="rounded border border-border bg-background p-2"
                                name="status"
                                defaultValue={p.status}
                                key={`${p.id}:${p.status}`}
                              >
                                <option value="draft">草稿</option>
                                <option value="published">审核上架</option>
                                <option value="archived">下架归档</option>
                              </select>
                              <input
                                aria-label={`${p.name}审核原因`}
                                className="rounded border border-border bg-background p-2"
                                name="reason"
                                required
                                maxLength={500}
                                placeholder="审核原因"
                              />
                              <button className={secondary} disabled={busy}>
                                保存
                              </button>
                            </form>
                          ) : (
                            <span>
                              {p.status === "published"
                                ? "已上架"
                                : p.status === "archived"
                                  ? "已归档"
                                  : "草稿"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  className={secondary}
                  disabled={busy || catalogPage === 0}
                  onClick={() =>
                    void action(
                      () => reload({ catalog: catalogPage - 1, orders: orderPage }),
                      "列表已更新。",
                      false,
                    )
                  }
                >
                  上一页商品
                </button>
                <span className="text-sm">第 {catalogPage + 1} 页</span>
                <button
                  className={secondary}
                  disabled={busy || !moreProducts}
                  onClick={() =>
                    void action(
                      () => reload({ catalog: catalogPage + 1, orders: orderPage }),
                      "列表已更新。",
                      false,
                    )
                  }
                >
                  下一页商品
                </button>
              </div>
              {!products.length ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  暂无商品，先添加供应商和商品草稿。
                </p>
              ) : null}
            </section>
            {canWriteCatalog ? (
              <>
                <section className={panel}>
                  <h2 className="mb-3 text-lg font-semibold">CSV 批量导入草稿</h2>
                  <p className="mb-3 text-sm text-muted-foreground">
                    固定表头：supplierId,sku,name,description,category,imageUrl,priceCents,costCents,commissionBps,returnDays,stock。先校验预览，再确认整批导入；不覆盖已有
                    SKU。
                  </p>
                  <textarea
                    aria-label="商品CSV正文"
                    className="min-h-32 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
                    value={csv}
                    onChange={(e) => {
                      setCsv(e.target.value);
                      setCsvPreview(null);
                    }}
                  />
                  <div className="mt-3 flex gap-3">
                    <button
                      className={secondary}
                      disabled={busy || !csv.trim()}
                      onClick={() =>
                        void action(async () => {
                          const result = await admin<{ rows: unknown }>(
                            "/commerce/catalog/import",
                            {
                              method: "POST",
                              json: { csv, confirm: false },
                            },
                          );
                          setCsvPreview({ input: csv, rows: result.rows });
                        }, "CSV 校验通过，请核对预览后确认导入。")
                      }
                    >
                      校验并预览
                    </button>
                    <button
                      className={primary}
                      disabled={busy || !csvPreview || csvPreview.input !== csv}
                      onClick={() => {
                        const reason = window.prompt("请输入本次导入原因");
                        if (!reason?.trim()) return;
                        void action(async () => {
                          await admin("/commerce/catalog/import", {
                            method: "POST",
                            json: { csv, confirm: true, reason: reason.trim() },
                          });
                          setCsv("");
                          setCsvPreview(null);
                        }, "CSV 已整批导入草稿，仍需逐项审核上架。");
                      }}
                    >
                      确认导入草稿
                    </button>
                  </div>
                  {csvPreview ? (
                    <pre className="mt-3 max-h-60 overflow-auto rounded-lg bg-muted p-3 text-xs">
                      {JSON.stringify(csvPreview.rows, null, 2)}
                    </pre>
                  ) : null}
                </section>
                <section className={panel}>
                  <h2 className="mb-4 text-lg font-semibold">供应商与履约授权</h2>
                  <form
                    className="mb-5 grid gap-4 md:grid-cols-3"
                    ref={supplierCreationForm}
                    aria-label="创建供应商"
                    onSubmit={createSupplier}
                  >
                    <Field
                      label="供应商名称"
                      name="name"
                      maxLength={100}
                      disabled={busy || supplierCreationStatus !== "ready"}
                    />
                    <Field
                      label="加拿大退货地址"
                      name="returnAddress"
                      maxLength={500}
                      disabled={busy || supplierCreationStatus !== "ready"}
                    />
                    <Field
                      label="创建原因"
                      name="reason"
                      maxLength={500}
                      disabled={busy || supplierCreationStatus !== "ready"}
                    />
                    <button
                      className={primary}
                      disabled={busy || supplierCreationStatus !== "ready"}
                    >
                      创建供应商
                    </button>
                  </form>
                  {supplierCreationStatus === "unconfirmed" ? (
                    <div className="mb-4 space-y-2">
                      <p role="status">
                        创建结果尚未确认；提交资料和请求标识已锁定，只能显式重试同一次创建，不能修改资料后重新提交。
                      </p>
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() => {
                          if (supplierCreation.current)
                            void confirmSupplierCreation(supplierCreation.current);
                        }}
                      >
                        重试同一次创建
                      </button>
                    </div>
                  ) : null}
                  {supplierCreationStatus === "confirmed" ? (
                    <div className="mb-4 space-y-2">
                      <p role="status">
                        创建请求已确认，最新供应商列表尚未完成只读核对。供应商 ID：
                        {supplierCreation.current?.supplierId}；请勿再次提交创建。
                      </p>
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() => {
                          if (supplierCreation.current)
                            void confirmSupplierCreation(supplierCreation.current);
                        }}
                      >
                        核对已创建供应商
                      </button>
                    </div>
                  ) : null}
                  {supplierCreationStatus === "unconfirmed" ||
                  supplierCreationStatus === "confirmed" ? (
                    <p className="mb-4 text-sm text-amber-900">
                      离开/刷新会丢失当前重试凭据，先核对现有供应商，不要直接新建。
                    </p>
                  ) : null}
                  {supplierCreationStatus === "verified" ? (
                    <div className="mb-4 space-y-2">
                      <p role="status">
                        供应商创建及只读核对已完成。当前状态以服务器列表为准，不会自动恢复停用供应商。
                      </p>
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() => {
                          if (busy || supplierCreationWorking.current) return;
                          supplierCreation.current = null;
                          setSupplierCreationStatus("ready");
                          setSupplierCreationError(null);
                          supplierCreationForm.current?.reset();
                        }}
                      >
                        开始下一次创建
                      </button>
                    </div>
                  ) : null}
                  {supplierCreationError ? (
                    <p role="alert" className="mb-4 text-sm text-red-800">
                      {supplierCreationError}
                    </p>
                  ) : null}
                  <form
                    className="grid gap-4 md:grid-cols-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = formData(e.currentTarget);
                      void action(() =>
                        admin(
                          `/commerce/suppliers/${encodeURIComponent(String(data.supplierId))}/members`,
                          { method: "POST", json: { userId: data.userId, reason: data.reason } },
                        ),
                      );
                    }}
                  >
                    <label className="flex flex-col gap-1.5 text-sm">
                      供应商
                      <select
                        className="rounded-lg border border-border bg-background px-3 py-2"
                        name="supplierId"
                        required
                        defaultValue=""
                      >
                        <option value="" disabled>
                          选择供应商
                        </option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field label="经平台管理员核实的授权用户 ID" name="userId" />
                    <Field label="授权原因" name="reason" maxLength={500} />
                    <button className={secondary} disabled={busy || !suppliers.length}>
                      授予供应商权限
                    </button>
                  </form>
                  <p className="mt-4 text-xs text-muted-foreground">
                    AI 团队 owner 不会自动获得供应商权限；授权由服务器和审计记录确认。
                  </p>
                </section>
                <SupplierAccess suppliers={suppliers} disabled={busy} onUpdated={() => reload()} />
              </>
            ) : (
              <section className={panel}>
                <h2 className="mb-3 text-lg font-semibold">供应商</h2>
                {suppliers.length ? (
                  <ul className="space-y-2 text-sm">
                    {suppliers.map((supplier) => (
                      <li key={supplier.id}>
                        {supplier.name} · {supplier.active ? "启用" : "停用"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">暂无供应商。</p>
                )}
              </section>
            )}
          </>
        ) : null}
        {canRead && !loading && tab === "orders" ? (
          <>
            <h2 className="text-lg font-semibold">订单与售后</h2>
            {selectedOrder ? (
              <p className="flex flex-wrap items-center gap-3 text-sm">
                已按告警直接定位订单 {selectedOrder.id}，不受当前列表分页限制。
                <button
                  className={secondary}
                  disabled={busy}
                  onClick={() => setSelectedOrder(null)}
                >
                  返回订单列表
                </button>
              </p>
            ) : null}
            <label className="flex items-center gap-3 text-sm">
              订单范围
              <select
                className="rounded-lg border border-border bg-background p-2"
                aria-label="订单待处理筛选"
                value={attention}
                disabled={loading || busy || selectedOrder !== null}
                onChange={(event) => {
                  const selected = event.target.value as "all" | "needs_attention";
                  void action(
                    () => reload({ orders: 0, attention: selected }),
                    "服务器订单筛选已更新。",
                    false,
                  );
                }}
              >
                <option value="all">全部订单</option>
                <option value="needs_attention">仅待处理订单</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              服务端先筛选再分页，包含未结售后及付款、退款待核实记录。下方直接使用原处理流程；查询失败不代表没有异常。
            </p>
            {selectedOrder && selectedOrderUnavailable ? (
              <p role="alert" className="text-sm text-red-800">
                已定位订单刷新失败，最新状态尚未确认，处理操作已隐藏。请点击刷新重新查询，不要根据旧页面重复金融操作。
              </p>
            ) : null}
            {(selectedOrder ? (selectedOrderUnavailable ? [] : [selectedOrder]) : orders).map(
              (order) => (
                <section className={panel} key={order.id}>
                  <div className="mb-4 flex flex-wrap justify-between gap-3">
                    <h3 className="font-semibold">订单 {order.id}</h3>
                    <span className="text-sm">
                      {order.status} · 合计 {money(order.totalCents)} · 已退{" "}
                      {money(order.refundedCents)}
                    </span>
                  </div>
                  {order.attentionReasons?.length ? (
                    <ul className="mb-3 text-sm text-amber-900" aria-label="订单待处理原因">
                      {order.attentionReasons.map((reason) => (
                        <li key={reason}>{attentionLabels[reason]}</li>
                      ))}
                    </ul>
                  ) : null}
                  {canReadFinance && order.paymentProvider === "stripe_test" ? (
                    <ProviderPaymentAdmin
                      orderId={order.id}
                      payment={providerPayments[order.id]}
                      onPayment={(payment) =>
                        setProviderPayments((current) => ({ ...current, [order.id]: payment }))
                      }
                      onOrderChanged={reload}
                      canWrite={canWriteFinance}
                      disabled={busy}
                    />
                  ) : null}
                  {order.items.map((item) => (
                    <div className="space-y-3 border-t border-border py-4" key={item.id}>
                      <div className="flex flex-wrap justify-between gap-3">
                        <div>
                          <strong>
                            {item.name} × {item.quantity}
                          </strong>
                          <small className="block text-muted-foreground">
                            {item.sku ? `SKU：${item.sku}` : "历史订单未记录 SKU"}
                          </small>
                        </div>
                        <span className="text-sm">
                          {item.status} · 商品金额 {money(item.lineCents)} · 累计已退{" "}
                          {money(item.refundedCents)}
                        </span>
                      </div>
                      {item.trackingNumber ? (
                        <p className="text-sm text-muted-foreground">运单 {item.trackingNumber}</p>
                      ) : null}
                      {item.supplierIssue ? (
                        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                          最近供应商报告（
                          {item.supplierIssue.kind === "out_of_stock"
                            ? "缺货"
                            : item.supplierIssue.kind === "delay"
                              ? "延期"
                              : "其他问题"}
                          ）：{item.supplierIssue.reason}
                          <br />
                          {new Date(item.supplierIssue.reportedAt).toLocaleString()}
                          。请核实供货、物流及售后再关闭；本条历史反馈不自动认定已解决，也不会自动退款。
                        </p>
                      ) : null}
                      {item.returnRequest ? (
                        <p className="rounded-lg border border-border p-3 text-sm">
                          最近买家售后申请（历史记录，不代表当前未结案）：
                          {item.returnRequest.reason}
                          <br />
                          {new Date(item.returnRequest.requestedAt).toLocaleString()}
                        </p>
                      ) : null}
                      {item.caseHandling ? (
                        <p className="rounded-lg border border-border p-3 text-sm">
                          最近管理员处理（历史记录）：
                          {item.caseHandling.open ? "标记处理中" : "核实关闭"} ·{" "}
                          {item.caseHandling.reason ?? "历史处理未记录说明"}
                          <br />
                          操作者 {item.caseHandling.handledBy} ·{" "}
                          {new Date(item.caseHandling.handledAt).toLocaleString()}
                          。当前是否未结案以下方状态为准。
                        </p>
                      ) : null}
                      <p className="text-sm">
                        {item.openCase ? "存在未结售后，佣金释放已阻止" : "无未结售后"}
                      </p>
                      {canWriteSupport ? renderCaseAction(order, item) : null}
                      {canWriteFulfillment && item.status === "shipped" ? (
                        <form
                          className="flex flex-wrap gap-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void action(() =>
                              admin(`/commerce/items/${encodeURIComponent(item.id)}/deliver`, {
                                method: "POST",
                                json: formData(e.currentTarget),
                              }),
                            );
                          }}
                        >
                          <input
                            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            name="reason"
                            required
                            placeholder="核实签收的依据"
                            maxLength={500}
                          />
                          <button className={secondary} disabled={busy}>
                            核实已签收
                          </button>
                        </form>
                      ) : null}
                      {canWriteFinance && order.status === "paid" ? (
                        <form
                          className="grid items-end gap-3 md:grid-cols-3"
                          onSubmit={(event) => refundItem(event, order, item)}
                        >
                          <Field
                            label="累计退款商品金额（加分，非本次增量）"
                            name="refundTotalCents"
                            type="number"
                            min={item.refundedCents}
                            max={item.lineCents}
                            step={1}
                            required
                            defaultValue={item.refundedCents}
                            key={`${item.id}:${item.refundedCents}`}
                          />
                          <Field label="退款原因" name="reason" maxLength={500} />
                          <button
                            className={secondary}
                            disabled={busy || providerRefundBlocked(order, item.id)}
                          >
                            {order.paymentProvider === "stripe_test"
                              ? "提交 Stripe 测试退款请求"
                              : "提交测试退款"}
                          </button>
                          {order.paymentProvider === "stripe_test" ? (
                            <p className="text-xs text-muted-foreground">
                              需先查询渠道测试状态；存在未确认的退款时，不允许重复提交。
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground md:col-span-3">
                            部分或全额退款不等于退货或售后结案；已有售后不会自动关闭。请在退货、验收等真正处理完成后另行核实关闭，未结案仍阻止剩余佣金释放。
                          </p>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </section>
              ),
            )}
            {!selectedOrder ? (
              <div className="flex items-center gap-3">
                <button
                  className={secondary}
                  disabled={busy || orderPage === 0}
                  onClick={() =>
                    void action(
                      () => reload({ catalog: catalogPage, orders: orderPage - 1 }),
                      "列表已更新。",
                      false,
                    )
                  }
                >
                  上一页订单
                </button>
                <span className="text-sm">第 {orderPage + 1} 页</span>
                <button
                  className={secondary}
                  disabled={busy || !moreOrders}
                  onClick={() =>
                    void action(
                      () => reload({ catalog: catalogPage, orders: orderPage + 1 }),
                      "列表已更新。",
                      false,
                    )
                  }
                >
                  下一页订单
                </button>
              </div>
            ) : null}
            {!loading && !error && !selectedOrder && !orders.length ? (
              <p className="text-sm text-muted-foreground">
                {attention === "needs_attention" ? "当前筛选没有待处理订单。" : "暂无测试订单。"}
              </p>
            ) : null}
          </>
        ) : null}
        {canRead && canReadFinance && !loading && tab === "finance" ? (
          <>
            <SupplierStatementAdmin suppliers={suppliers} canWrite={canWriteFinance} />
            {canWriteFinance ? (
              <section className={panel}>
                <h2 className="mb-3 text-lg font-semibold">佣金释放</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  服务器检查签收、至少 30 天观察期及售后状态，只释放符合条件的直接推荐佣金。不会移动
                  AI 积分。
                </p>
                <form
                  className="flex flex-wrap gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(() =>
                      admin("/commerce/commissions/release", {
                        method: "POST",
                        json: formData(e.currentTarget),
                      }),
                    );
                  }}
                >
                  <input
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    name="reason"
                    placeholder="本次释放原因"
                    required
                    maxLength={500}
                  />
                  <button className={primary} disabled={busy}>
                    检查并释放合格测试佣金
                  </button>
                </form>
              </section>
            ) : null}
            <section className={panel}>
              <h2 className="mb-3 text-lg font-semibold">测试总账追踪</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                按页查询追加式流水；不同账户分别核算，不包含 AI
                积分，也不代表支付渠道或银行已实际对账。
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="p-2">时间 / 事件</th>
                      <th>账户所有者</th>
                      <th>科目</th>
                      <th>CAD 变动</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-t border-border">
                        <td className="p-2">
                          {new Date(entry.createdAt).toLocaleString()}
                          <small className="block">{entry.eventKey}</small>
                        </td>
                        <td className="p-2">{entry.ownerId}</td>
                        <td className="p-2">{entry.account}</td>
                        <td className="p-2">{money(entry.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  className={secondary}
                  disabled={busy || ledgerPage === 0}
                  onClick={() =>
                    void action(() => reload({ ledger: ledgerPage - 1 }), "列表已更新。", false)
                  }
                >
                  上一页流水
                </button>
                <span className="text-sm">第 {ledgerPage + 1} 页</span>
                <button
                  className={secondary}
                  disabled={busy || !moreLedger}
                  onClick={() =>
                    void action(() => reload({ ledger: ledgerPage + 1 }), "列表已更新。", false)
                  }
                >
                  下一页流水
                </button>
              </div>
              {!entries.length ? (
                <p className="mt-3 text-sm text-muted-foreground">暂无测试账本记录。</p>
              ) : null}
            </section>
            <h2 className="text-lg font-semibold">提现审批与核实</h2>
            {selectedWithdrawal ? (
              <p className="flex flex-wrap items-center gap-3 text-sm">
                已按告警直接定位提现 {selectedWithdrawal.id}，不受当前列表分页限制。
                <button
                  className={secondary}
                  disabled={busy}
                  onClick={() => setSelectedWithdrawal(null)}
                >
                  返回提现列表
                </button>
              </p>
            ) : null}
            <label className="flex items-center gap-3 text-sm">
              提现范围
              <select
                className="rounded-lg border border-border bg-background p-2"
                aria-label="提现待处理筛选"
                value={withdrawalFilter}
                disabled={loading || busy || selectedWithdrawal !== null}
                onChange={(event) => {
                  const selected = event.target.value as WithdrawalFilter;
                  void action(
                    () => reload({ withdrawals: 0, withdrawalFilter: selected }),
                    "服务器提现筛选已更新。",
                    false,
                  );
                }}
              >
                <option value="all">全部提现</option>
                <option value="requested">待审核</option>
                <option value="approved">已批准，待核实付款记录</option>
                <option value="payment_pending">已登记人工操作，结果未确认</option>
                <option value="payment_unknown">付款结果未知，待人工核实</option>
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              审批与记录付款需由不同管理员完成。记录测试凭证不会产生真实银行转账，禁止把截图或请求超时当作已到账。
            </p>
            {selectedWithdrawal && selectedWithdrawalUnavailable ? (
              <p role="alert" className="text-sm text-red-800">
                已定位提现刷新失败，最新状态尚未确认，处理操作已隐藏。请点击刷新重新查询，不要根据旧页面重复审批或登记付款。
              </p>
            ) : null}
            {(selectedWithdrawal
              ? selectedWithdrawalUnavailable
                ? []
                : [selectedWithdrawal]
              : withdrawals
            ).map((withdrawal) => (
              <section className={panel} key={withdrawal.id}>
                <div className="mb-4 flex flex-wrap justify-between gap-3">
                  <strong>
                    {money(withdrawal.amountCents)} · {withdrawal.status}
                  </strong>
                  <small>{withdrawal.id}</small>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  用户 {withdrawal.userId} · {new Date(withdrawal.createdAt).toLocaleString()}
                  {withdrawal.reference ? ` · 凭证 ${withdrawal.reference}` : ""}
                </p>
                {withdrawal.paymentOperationId ? (
                  <p className="mb-4 text-xs text-muted-foreground">
                    操作编号 {withdrawal.paymentOperationId} · 开始人 {withdrawal.paymentStartedBy}
                    {withdrawal.paymentStartedAt
                      ? ` · 开始时间 ${new Date(withdrawal.paymentStartedAt).toLocaleString()}`
                      : ""}
                    {withdrawal.paymentUnknownAt
                      ? ` · 标记未知时间 ${new Date(withdrawal.paymentUnknownAt).toLocaleString()}`
                      : ""}
                  </p>
                ) : null}
                {withdrawal.paymentConfirmedAt ? (
                  <p className="mb-4 text-xs text-muted-foreground">
                    TEST 成功登记时间 {new Date(withdrawal.paymentConfirmedAt).toLocaleString()}
                    {` · 登记人 ${withdrawal.paymentConfirmedBy} · 核验依据 ${withdrawal.paymentEvidenceReference}`}
                    。仅为人工核验记录，不代表真实到账。
                  </p>
                ) : null}
                {["payment_pending", "payment_unknown"].includes(withdrawal.status) ? (
                  <p className="mb-4 text-sm text-amber-900">
                    结果未确认，需人工核实；金额仍冻结。不会自动重付、解冻或认定真实到账。
                  </p>
                ) : null}
                {canWriteFinance &&
                ["approved", "payment_pending", "payment_unknown"].includes(withdrawal.status) &&
                (!withdrawal.approvedBy || withdrawal.approvedBy === identity?.id) ? (
                  <p className="mb-4 text-sm text-amber-900">
                    {withdrawal.approvedBy
                      ? "本笔由你审批。请交由另一位有财务权限的管理员开始付款记录或登记结果。"
                      : "当前记录缺少可核对的审批人。请先刷新核对审批，不要登记付款。"}
                  </p>
                ) : null}
                {canRegisterPayment(withdrawal) && paymentIntents.current.has(withdrawal.id) ? (
                  <div className="mb-4 space-y-3 text-sm">
                    <p>
                      {paymentIntents.current.get(withdrawal.id)!.confirmed
                        ? "登记已确认，等待只读核对；不会再次提交。"
                        : "登记结果未确认，只能按原操作编号和原原因重试，不会新建付款操作。"}
                      离开或刷新本页会丢失当前重试凭据，请先核对原提现，不要直接重新开始。
                    </p>
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() => void verifyWithdrawalPayment(withdrawal.id)}
                    >
                      查询原提现操作
                    </button>
                    {!paymentIntents.current.get(withdrawal.id)!.confirmed ? (
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() =>
                          void registerWithdrawalPayment(
                            withdrawal,
                            paymentIntents.current.get(withdrawal.id)!.action,
                          )
                        }
                      >
                        按原操作编号重试登记
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {canRegisterPayment(withdrawal) && successIntents.current.has(withdrawal.id) ? (
                  <div className="mb-4 space-y-3 text-sm">
                    <p>
                      {successIntents.current.get(withdrawal.id)!.confirmed
                        ? "成功登记已确认，等待只读核对；不会再次提交。"
                        : "成功结果登记尚未确认，请先只读查询；只能按原完整请求重试，不会新建付款操作。"}
                      离开或刷新本页会丢失当前重试凭据，请先核对原提现，不要重新付款。
                    </p>
                    <p className="break-all text-xs">
                      原操作编号 {successIntents.current.get(withdrawal.id)!.body.operationId}
                      {` · ${money(successIntents.current.get(withdrawal.id)!.body.amountCents)} · 测试流水号 ${successIntents.current.get(withdrawal.id)!.body.reference}`}
                      {` · 核验依据 ${successIntents.current.get(withdrawal.id)!.body.evidenceReference} · 原因 ${successIntents.current.get(withdrawal.id)!.body.reason}`}
                    </p>
                    {successIntents.current.get(withdrawal.id)!.token !== getToken() ? (
                      <p role="alert">
                        登录身份已变化；原 TEST 请求只能只读核对，不能由新身份重试登记。
                      </p>
                    ) : null}
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() => void verifyWithdrawalSuccess(withdrawal.id)}
                    >
                      只读查询原 TEST 付款结果
                    </button>
                    {!successIntents.current.get(withdrawal.id)!.confirmed ? (
                      <button
                        className={secondary}
                        disabled={
                          busy || successIntents.current.get(withdrawal.id)!.token !== getToken()
                        }
                        onClick={() => void confirmWithdrawalSuccess(withdrawal)}
                      >
                        按原完整请求重试 TEST 成功登记
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {canRegisterPayment(withdrawal) &&
                !paymentIntents.current.has(withdrawal.id) &&
                !successIntents.current.has(withdrawal.id) &&
                withdrawal.paymentOperationId &&
                ["payment_pending", "payment_unknown"].includes(withdrawal.status) ? (
                  <form
                    className="my-4 grid items-end gap-3 md:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void confirmWithdrawalSuccess(withdrawal, event.currentTarget);
                    }}
                  >
                    <p className="break-all text-sm md:col-span-2">
                      登记原操作编号 {withdrawal.paymentOperationId} · 原金额{" "}
                      {money(withdrawal.amountCents)}
                    </p>
                    <p className="text-sm text-muted-foreground md:col-span-2">
                      仅登记已独立核验的 TEST 成功结果，不发起转账、不自动核验银行、不代表真实到账。
                      确认人不能是收款人或本笔审批人，可以是原开始人；服务器核验权限、原编号及原金额。
                    </p>
                    <Field
                      label="已核验的 TEST 付款流水号"
                      name="reference"
                      maxLength={150}
                      disabled={busy}
                    />
                    <Field
                      label="TEST 核验依据编号（非截图自动识别）"
                      name="evidenceReference"
                      maxLength={500}
                      disabled={busy}
                    />
                    <Field
                      label="TEST 成功结果核验原因"
                      name="reason"
                      maxLength={500}
                      disabled={busy}
                    />
                    <label className="flex items-start gap-2 text-sm md:col-span-2">
                      <input type="checkbox" name="acknowledge" required disabled={busy} />
                      我已独立核验该原操作及金额的 TEST
                      成功依据；知悉此登记不会转账，也不代表真实到账。
                    </label>
                    <button className={primary} disabled={busy}>
                      登记已核验的 TEST 付款成功结果
                    </button>
                  </form>
                ) : null}
                {canRegisterPayment(withdrawal) &&
                !paymentIntents.current.has(withdrawal.id) &&
                !successIntents.current.has(withdrawal.id) &&
                ["approved", "payment_pending"].includes(withdrawal.status) ? (
                  <form
                    className="my-4 grid items-end gap-3 md:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void registerWithdrawalPayment(
                        withdrawal,
                        withdrawal.status === "approved" ? "start-payment" : "mark-payment-unknown",
                        String(new FormData(event.currentTarget).get("reason") ?? ""),
                      );
                    }}
                  >
                    <p className="text-sm text-muted-foreground md:col-span-2">
                      仅登记人工操作，不连接银行或发送真实付款请求。必须先登记再按 TEST
                      流程人工核实； 开始人不能是收款人或本笔审批人，权限由服务器核验。
                    </p>
                    <Field label="人工测试操作原因" name="reason" maxLength={500} />
                    <button className={primary} disabled={busy}>
                      {withdrawal.status === "approved"
                        ? "登记开始人工测试付款"
                        : "标记测试付款结果未知"}
                    </button>
                  </form>
                ) : null}
                {canWriteFinance &&
                withdrawal.status === "requested" &&
                !paymentIntents.current.has(withdrawal.id) &&
                !successIntents.current.has(withdrawal.id) ? (
                  <button
                    className={primary}
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        admin(
                          `/commerce/withdrawals/${encodeURIComponent(withdrawal.id)}/approve`,
                          { method: "POST", json: {} },
                        ),
                      )
                    }
                  >
                    批准测试提现申请
                  </button>
                ) : null}
                {canRegisterPayment(withdrawal) &&
                withdrawal.status === "approved" &&
                !paymentIntents.current.has(withdrawal.id) &&
                !successIntents.current.has(withdrawal.id) ? (
                  <form
                    className="mt-4 grid items-end gap-3 md:grid-cols-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(() =>
                        admin(`/commerce/withdrawals/${encodeURIComponent(withdrawal.id)}/record`, {
                          method: "POST",
                          json: formData(e.currentTarget),
                        }),
                      );
                    }}
                  >
                    <Field label="已核实的测试付款流水号" name="reference" maxLength={150} />
                    <Field label="核实说明" name="reason" maxLength={500} />
                    <button className={primary} disabled={busy}>
                      记录已核实测试付款
                    </button>
                  </form>
                ) : null}
                {canWriteFinance &&
                ["requested", "approved"].includes(withdrawal.status) &&
                !paymentIntents.current.has(withdrawal.id) &&
                !successIntents.current.has(withdrawal.id) ? (
                  <form
                    className="mt-4 flex flex-wrap gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(() =>
                        admin(`/commerce/withdrawals/${encodeURIComponent(withdrawal.id)}/reject`, {
                          method: "POST",
                          json: formData(e.currentTarget),
                        }),
                      );
                    }}
                  >
                    <input
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      name="reason"
                      required
                      placeholder="驳回原因"
                      maxLength={500}
                    />
                    <button className={secondary} disabled={busy}>
                      驳回并解冻
                    </button>
                  </form>
                ) : null}
              </section>
            ))}
            {!selectedWithdrawal ? (
              <div className="flex items-center gap-3">
                <button
                  className={secondary}
                  disabled={busy || withdrawalPage === 0}
                  onClick={() =>
                    void action(
                      () => reload({ withdrawals: withdrawalPage - 1 }),
                      "列表已更新。",
                      false,
                    )
                  }
                >
                  上一页提现
                </button>
                <span className="text-sm">第 {withdrawalPage + 1} 页</span>
                <button
                  className={secondary}
                  disabled={busy || !moreWithdrawals}
                  onClick={() =>
                    void action(
                      () => reload({ withdrawals: withdrawalPage + 1 }),
                      "列表已更新。",
                      false,
                    )
                  }
                >
                  下一页提现
                </button>
              </div>
            ) : null}
            {!loading && !error && !selectedWithdrawal && !withdrawals.length ? (
              <p className="text-sm text-muted-foreground">
                {withdrawalFilter === "all" ? "暂无提现申请。" : "当前筛选没有提现记录。"}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Shell>
  );
}
